/**
 * P2 data bridge: dsh sessions → the 3D archive's 40 slots (SPEC §6).
 *
 * Channel decision (P0 gate): official channel B for the session list
 * (`ctx.sessions.list`), host log route for durable titles and transcripts.
 * The bridge never touches the app's internals directly: it posts a fully
 * mapped payload to the same-origin iframe, and the app's bridge applies it.
 *
 * Mapping (SPEC §6.1): 5 columns × 8 slots = 40, one column per bucket.
 *   一 收藏 · 二 最近 24h · 三 本周 · 四 本月 · 五 更早
 */
const COLUMNS = ['收藏', '最近 24h', '本周', '本月', '更早']
const SLOTS_PER_COLUMN = 8
/** The app's bookmark store; values are stable session keys (see app bridge). */
const SAVED_KEY = 'rhinelab-ui:saved'
const FRAME_ID = 'rhinelab-ui-frame'
const ROUTE = '/rhinelab-ui'
const DAY_MS = 86400000

/**
 * Read the app's bookmark set (same origin, so the store is shared).
 * @returns set of stable record keys.
 */
function readSaved() {
  try {
    const raw = globalThis.localStorage?.getItem(SAVED_KEY)
    const parsed = raw === null || raw === undefined ? [] : JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

/**
 * Title fallback chain: durable title → display title → cwd basename → id.
 * @param session - client session summary.
 * @param durableTitle - title parsed from the session log, when known.
 * @returns display title.
 */
function titleOf(session, durableTitle) {
  if (typeof durableTitle === 'string' && durableTitle.trim() !== '') return durableTitle.trim()
  if (typeof session.title === 'string' && session.title.trim() !== '') return session.title.trim()
  if (typeof session.displayTitle === 'string' && session.displayTitle.trim() !== '') return session.displayTitle.trim()
  const base = typeof session.cwd === 'string' ? session.cwd.split('/').filter(Boolean).pop() : undefined
  return base ?? session.id
}

/**
 * Bucket one session into a column index.
 * @param session - client session summary.
 * @param now - current epoch ms.
 * @param saved - bookmark key set.
 * @returns column index.
 */
function bucketOf(session, now, saved) {
  if (saved.has(session.id)) return 0
  const age = now - (session.updatedAt ?? 0)
  if (age <= DAY_MS) return 1
  if (age <= 7 * DAY_MS) return 2
  if (age <= 30 * DAY_MS) return 3
  return 4
}

/**
 * Format an epoch timestamp for the archive metadata line.
 * @param at - epoch ms.
 * @returns display string.
 */
function formatTime(at) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '—'
  const d = new Date(at)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Build the complete 40-slot payload.
 * @param sessions - client session summaries.
 * @param titles - sessionId → durable title map.
 * @param revision - monotonically increasing revision.
 * @returns bridge payload.
 */
function buildPayload(sessions, titles, revision) {
  const now = Date.now()
  const saved = readSaved()
  const buckets = COLUMNS.map(() => [])
  for (const session of sessions) {
    buckets[bucketOf(session, now, saved)].push(session)
  }
  for (const bucket of buckets) bucket.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

  const records = []
  let slot = 0
  for (let lane = 0; lane < COLUMNS.length; lane += 1) {
    const column = COLUMNS[lane]
    for (let row = 0; row < SLOTS_PER_COLUMN; row += 1) {
      slot += 1
      const id = `X-${String(slot).padStart(3, '0')}`
      const session = buckets[lane][row]
      if (session === undefined) {
        records.push({
          id,
          key: `empty:${lane}:${row}`,
          title: '待归档',
          en: 'PENDING ARCHIVE',
          department: '—',
          category: column,
          date: '—',
          lead: '—',
          clearance: 'REFERENCE AREA',
          abstract: '该槽位暂无档案。',
          findings: [],
          source: '#',
          empty: true,
        })
        continue
      }
      const title = titleOf(session, titles.get(session.id))
      const cwd = typeof session.cwd === 'string' ? session.cwd : ''
      records.push({
        id,
        key: session.id,
        title,
        en: session.id.slice(0, 24).toUpperCase(),
        department: cwd === '' ? '—' : cwd,
        category: column,
        date: formatTime(session.updatedAt),
        lead: session.id,
        clearance: session.blank === true ? 'RESTRICTED' : 'REFERENCE AREA',
        abstract: session.blank === true ? '空白会话，尚未产生内容。' : `${title} · 最近活动 ${formatTime(session.updatedAt)}`,
        findings: [],
        source: `${ROUTE}/session/${encodeURIComponent(session.id)}`,
        empty: false,
      })
    }
  }
  return { columns: [...COLUMNS], records, revision }
}

/**
 * Fetch durable titles for every session from the host log route.
 * @returns sessionId → title map (empty on failure).
 */
async function fetchTitles() {
  const map = new Map()
  try {
    const res = await fetch(`${ROUTE}/sessions`, { credentials: 'same-origin' })
    if (!res.ok) return map
    const data = await res.json()
    for (const item of data.items ?? []) {
      if (typeof item.sessionId === 'string' && typeof item.title === 'string' && item.title !== '') {
        map.set(item.sessionId, item.title)
      }
    }
  } catch {
    /* fall back to display titles */
  }
  return map
}

/**
 * Turn one transcript into reading-panel fields.
 * @param transcript - host transcript response.
 * @returns record patch.
 */
function transcriptPatch(transcript) {
  const messages = Array.isArray(transcript.messages) ? transcript.messages : []
  const tools = Array.isArray(transcript.tools) ? transcript.tools : []
  const firstUser = messages.find((m) => m.role === 'user')
  const findings = []
  for (const message of messages.slice(-6)) {
    findings.push(`${message.role === 'user' ? 'USER' : 'ASSISTANT'} · ${message.text.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  for (const tool of tools.slice(-3)) {
    findings.push(`TOOL · ${tool.name} ${tool.args.replace(/\s+/g, ' ').slice(0, 120)}`)
  }
  return {
    abstract: firstUser === undefined
      ? `${transcript.title ?? '会话'} · ${messages.length} 条消息`
      : firstUser.text.replace(/\s+/g, ' ').slice(0, 400),
    findings: findings.length === 0 ? ['（该会话暂无消息记录）'] : findings,
    date: formatTime(transcript.lastAt ?? transcript.createdAt),
    en: `${messages.length} MSG · ${tools.length} TOOL`.toUpperCase(),
    source: `${ROUTE}/session/${encodeURIComponent(transcript.sessionId)}`,
  }
}

/**
 * Install the bridge.
 * @param ctx - client plugin context.
 * @returns disposer.
 */
exports.install = function install(ctx) {
  const state = { revision: 0, lastPayload: null, patches: new Map(), disposed: false, pushes: 0, acks: 0, errors: [], prompts: 0, streamed: 0, tools: 0, replayed: 0, cursor: null, followOpened: false, followFrames: 0, followKinds: [], followError: null, eventKinds: [] }

  const frameOf = () => document.getElementById(FRAME_ID)

  /**
   * Post one message into the app frame.
   * @param message - bridge message.
   * @returns whether a target window was available.
   */
  const post = (message) => {
    const frame = frameOf()
    const target = frame?.contentWindow
    if (target === null || target === undefined) return false
    target.postMessage(message, location.origin)
    return true
  }

  /** Collect client session summaries from the official channel. */
  const sessionsOf = () => {
    const snapshot = ctx.sessions.list.getSnapshot()
    const byId = snapshot.byId ?? {}
    return Object.keys(byId).map((id) => ({ ...byId[id], id }))
  }

  /** Rebuild and push the full payload. */
  const push = async () => {
    if (state.disposed) return
    try {
      const titles = await fetchTitles()
      state.revision += 1
      const payload = buildPayload(sessionsOf(), titles, state.revision)
      for (const [key, patch] of state.patches) {
        const record = payload.records.find((r) => r.key === key)
        if (record !== undefined) Object.assign(record, patch)
      }
      state.lastPayload = payload
      // Skip no-op pushes: the session list ticks continuously while an agent
      // streams, and every push costs a re-render (and would fight selection).
      const signature = payload.records
        .map((r) => `${r.key}|${r.category}|${r.empty === true ? 1 : 0}|${r.title}`)
        .join('~') + `|saved:${[...readSaved()].sort().join(',')}`
      if (signature === state.signature && state.acks > 0) return
      state.signature = signature
      if (post({ type: 'rhinelab-ui/archive-data', payload })) state.pushes += 1
    } catch (error) {
      state.errors.push(String(error))
    }
  }

  /** Fetch one session's transcript and patch its record in the app. */
  const loadTranscript = async (key) => {
    if (typeof key !== 'string' || key.startsWith('empty:')) return
    try {
      const res = await fetch(`${ROUTE}/session/${encodeURIComponent(key)}`, { credentials: 'same-origin' })
      if (!res.ok) return
      const transcript = await res.json()
      // The conversation panel gets the full history; the archive card keeps
      // only the compact metadata patch.
      post({
        type: 'rhinelab-ui/transcript',
        key,
        payload: {
          title: transcript.title ?? null,
          messages: transcript.messages ?? [],
          tools: transcript.tools ?? [],
          messageCount: transcript.messageCount ?? 0,
          toolCount: transcript.toolCount ?? 0,
        },
      })
      const patch = transcriptPatch(transcript)
      state.patches.set(key, patch)
      post({ type: 'rhinelab-ui/archive-patch', payload: { key, patch } })
    } catch (error) {
      state.errors.push(String(error))
    }
  }

  /**
   * Follow one session and forward its assistant output to the 3D surface.
   *
   * Two sources feed the same renderer: the opening snapshot (records already
   * durable when follow opens — the common case, because a short reply can
   * finish before the stream is established) and live event frames. Text runs
   * are accumulated per assistant block so one reply renders as one line.
   *
   * @param key - session id.
   * @param requestId - the prompt receipt id used to locate our own turn.
   */
  const follow = async (key, requestId) => {
    state.controller?.abort()
    const controller = new AbortController()
    state.controller = controller
    state.cursor = null

    /** Buffered text deltas (live deltas are tiny; batch them ~60ms). */
    let pending = { texts: [], dt: [] }
    let flushTimer

    const flushText = () => {
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer)
        flushTimer = undefined
      }
      if (pending.texts.length === 0) return
      post({ type: 'rhinelab-ui/stream', key, texts: pending.texts, dt: pending.dt })
      state.streamed += 1
      pending = { texts: [], dt: [] }
    }

    const emitText = (text, delay = 8) => {
      if (typeof text !== 'string' || text === '') return
      pending.texts.push(text)
      pending.dt.push(delay)
      if (flushTimer === undefined) flushTimer = setTimeout(flushText, 60)
    }

    /** Tool-call deltas accumulate until the block closes. */
    const toolCalls = new Map()
    /** Call ids already rendered: the same block can arrive live and in replay. */
    const emittedTools = new Set()
    const emitTool = (id, name, args) => {
      const identity = typeof id === 'string' && id !== '' ? id : `${name}:${args}`
      if (emittedTools.has(identity)) return
      emittedTools.add(identity)
      flushText()
      state.tools += 1
      post({ type: 'rhinelab-ui/tool', key, name: name || 'tool', args: args || '' })
    }

    const forward = (event) => {
      // History pages pack delta runs as `chunkrow/<kind>`; the live journal
      // sends raw records. Normalize, then handle both encodings.
      const rawType = event?.type
      const type = typeof rawType === 'string' && rawType.startsWith('chunkrow/')
        ? rawType.slice('chunkrow/'.length)
        : rawType

      if (type === 'assistant/chunk') {
        const chunk = event.data?.chunk
        if (chunk === null || chunk === undefined) return
        switch (chunk.type) {
          case 'text-delta':
            emitText(chunk.text, 8)
            return
          case 'tool-call-delta': {
            const current = toolCalls.get(chunk.index) ?? { name: '', args: '' }
            if (typeof chunk.name === 'string' && chunk.name !== '') current.name = chunk.name
            current.args += chunk.argumentsDelta ?? ''
            toolCalls.set(chunk.index, current)
            return
          }
          case 'block-end': {
            const block = chunk.block
            if (block?.type === 'tool-call') {
              emitTool(
                block.id,
                block.name,
                typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? ''),
              )
            }
            return
          }
          case 'finish':
            flushText()
            post({ type: 'rhinelab-ui/prompt-state', message: 'idle' })
            return
          default:
            return
        }
      }

      if (type === 'text-chunks') {
        // History replay: one packed run per assistant block.
        const texts = Array.isArray(event.data?.texts) ? event.data.texts : []
        const dt = Array.isArray(event.data?.dt) ? event.data.dt : []
        for (let i = 0; i < texts.length; i += 1) emitText(texts[i], dt[i] ?? 8)
        flushText()
        return
      }
      if (type === 'tool-call-chunks') {
        emitTool(
          event.data?.id,
          event.data?.name ?? 'tool',
          Array.isArray(event.data?.args) ? event.data.args.join('') : '',
        )
        return
      }
      if (type === 'turn/end') {
        flushText()
        post({ type: 'rhinelab-ui/prompt-state', message: 'idle' })
      }
    }

    try {
      const iterable = ctx.remote.session.follow(
        { address: { kind: 'session', sessionId: key }, maxMessages: 40 },
        controller.signal,
      )
      state.followOpened = true
      for await (const frame of iterable) {
        if (state.disposed || controller.signal.aborted) break
        state.followFrames += 1
        if (state.followKinds.length < 12) state.followKinds.push(frame?.type ?? 'unknown')

        if (frame?.type === 'snapshot') {
          state.cursor = frame.cursor ?? null
          let started = requestId === undefined
          for (const record of frame.records ?? []) {
            const event = record?.event
            if (!started) {
              if (event?.type === 'user/message' && event?.data?.source?.rpcId === requestId) started = true
              continue
            }
            state.replayed += 1
            forward(event)
          }
          continue
        }
        if (frame?.type === 'event') {
          const event = frame.event
          const kind = event?.type ?? 'unknown'
          if (state.eventKinds.length < 24 && !state.eventKinds.includes(kind)) state.eventKinds.push(kind)
          if (state.cursor !== null && typeof event?.seq === 'number' && event.seq <= state.cursor) continue
          forward(event)
        }
      }
    } catch (error) {
      state.followError = String(error)
      if (!controller.signal.aborted) state.errors.push(`follow: ${String(error)}`)
    } finally {
      flushText()
      post({ type: 'rhinelab-ui/prompt-state', message: 'idle' })
    }
  }

  /**
   * Send one prompt through the official channel (P3 gate: path 2) and start
   * streaming the reply.
   * @param key - session id.
   * @param text - prompt text.
   */
  const sendPrompt = async (key, text) => {
    state.prompts += 1
    try {
      const requestId = typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const result = await ctx.remote.session.prompt({
        requestId,
        sessionId: key,
        mode: 'queue',
        content: [{ type: 'text', text }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      if (result?.ok !== true) {
        const code = result?.error?.code ?? result?.error?.message ?? 'prompt-failed'
        post({ type: 'rhinelab-ui/prompt-state', message: `error: ${String(code)}` })
        return
      }
      post({ type: 'rhinelab-ui/prompt-state', message: 'streaming' })
      void follow(key, requestId)
    } catch (error) {
      state.errors.push(`prompt: ${String(error)}`)
      post({ type: 'rhinelab-ui/prompt-state', message: `error: ${String(error)}` })
    }
  }

  const onMessage = (event) => {
    if (event.origin !== location.origin) return
    const data = event.data
    if (data === null || typeof data !== 'object') return
    if (data.type === 'rhinelab-ui/archive-ack') {
      state.acks += 1
      return
    }
    if (data.type === 'rhinelab-ui/selected' && typeof data.key === 'string') {
      // Staging is the open signal: a session's live event window exists only
      // while it is the current session, so selecting an archive opens it.
      // Only real session ids are stageable: the app's own static records use
      // display ids like X-001 and placeholders use `empty:` keys.
      if (/^session-/.test(data.key)) {
        try {
          ctx.sessions.open(data.key)
          state.staged = data.key
        } catch (error) {
          state.errors.push(`open: ${String(error)}`)
        }
      }
      void loadTranscript(data.key)
      return
    }
    if (data.type === 'rhinelab-ui/prompt' && typeof data.key === 'string' && typeof data.text === 'string') {
      void sendPrompt(data.key, data.text)
      return
    }
    if (data.type === 'rhinelab-ui/bookmark') {
      // The saved set is part of the payload signature, so this re-buckets the
      // 收藏 column without waiting for the next session-list tick.
      void push()
    }
  }
  window.addEventListener('message', onMessage)

  // The list is a live feed: rebuild on every membership change.
  let unsubscribe
  try {
    unsubscribe = ctx.sessions.list.subscribe(() => {
      void push()
    })
  } catch (error) {
    state.errors.push(String(error))
  }

  // The frame may not be ready when install() runs; retry until it acks.
  let attempts = 0
  const timer = setInterval(() => {
    if (state.disposed || state.acks > 0 || attempts >= 20) {
      clearInterval(timer)
      return
    }
    attempts += 1
    void push()
  }, 1000)
  void push()

  globalThis.__RHINE_BRIDGE_STATE__ = state

  return function dispose() {
    state.disposed = true
    clearInterval(timer)
    window.removeEventListener('message', onMessage)
    if (typeof unsubscribe === 'function') unsubscribe()
  }
}
