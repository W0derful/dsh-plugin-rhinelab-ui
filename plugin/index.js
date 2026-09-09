/**
 * RhineLabUI host half (dsh plugin, Node side).
 *
 * Serves this plugin's own HTTP surface from the Harness web server without
 * patching the Harness checkout (hard constraint 1):
 *   - GET /rhinelab-ui/probe/host      — host facts (route, DSH_HOME, plugin root)
 *   - GET /rhinelab-ui/probe/sessions  — P0 probe C: read the real session log
 *                                        store and return parsed records metadata
 *   - GET /rhinelab-ui/*               — static assets from rhine-dist/ (R-6)
 *
 * The static route is the verified asset rule (see SPEC-DEVIATIONS.md D-3):
 * `ctx.webServer.register({ kind: 'prefix', path, handler })`.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

export const name = 'rhinelab-ui'
export const inject = ['webServer']

/** Mount prefix owned by this plugin. */
const ROUTE = '/rhinelab-ui'
/** Package root (plugin/index.js -> ..). */
const PLUGIN_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Static 3D asset root; may not exist during P0. */
const ASSET_ROOT = join(PLUGIN_ROOT, 'rhine-dist')
/** Harness home that owns the session log store. */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
/** Session log store root. */
const SESSIONS_ROOT = join(DSH_HOME, 'sessions')

const MIME = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
})

/**
 * Write a JSON response.
 * @param res - HTTP response.
 * @param status - status code.
 * @param body - JSON-serializable body.
 */
function sendJson(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body, null, 2), 'utf8')
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'x-content-type-options': 'nosniff',
  })
  res.end(payload)
}

/**
 * Zstandard frame magic (`0xFD2FB528` little-endian).
 *
 * The session artifact is a CONCATENATED-FRAME container: every durable batch is
 * its own independently decodable, checksummed frame. Node's one-shot
 * `zstdDecompressSync` stops after the first frame, so a naive read returns only
 * the session header (204 bytes) for a 1.1 MB log. The frame walk below mirrors
 * the container format documented by the Harness JSONL persistence backend
 * (`@deepseek-ai/dsh-session-persistence-jsonl`); it is reimplemented here
 * because cross-package imports of Harness internals are forbidden
 * (hard constraint 2).
 */
const ZSTD_MAGIC = 4247762216

/**
 * Locate every structurally complete frame without decompressing its blocks.
 * @param buffer - complete bytes of the session artifact.
 * @param maxFrames - optional complete-frame limit.
 * @returns complete frame ranges plus the start of a torn final frame, if any.
 */
function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

/** Complete-frame limit for one metadata read (probe scope). */
const MAX_FRAMES = 20000

/**
 * Read and decompress one session log into its JSONL records.
 * @param file - absolute path to session.jsonl.zstd.
 * @returns parsed records, frame statistics, and byte sizes.
 */
async function readSessionLog(file) {
  const raw = await readFile(file)
  const { frames, tornStart } = scanZstdFrames(raw, MAX_FRAMES)
  const records = []
  const recordTypes = Object.create(null)
  let parseErrors = 0
  for (const { start, end } of frames) {
    let text
    try {
      text = zstdDecompressSync(raw.subarray(start, end)).toString('utf8')
    } catch (error) {
      parseErrors += 1
      continue
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try {
        const record = JSON.parse(line)
        records.push(record)
        const type = typeof record?.type === 'string' ? record.type : 'unknown'
        recordTypes[type] = (recordTypes[type] ?? 0) + 1
      } catch {
        parseErrors += 1
      }
    }
  }
  return { raw, frames: frames.length, tornStart: tornStart ?? null, records, recordTypes, parseErrors }
}

/**
 * Enumerate the session log store (P0 probe C / fallback channel D).
 * @returns store summary with per-session record counts.
 */
async function listSessions() {
  const items = []
  let projects = []
  try {
    projects = await readdir(SESSIONS_ROOT)
  } catch (error) {
    return { sessionsRoot: SESSIONS_ROOT, readable: false, error: String(error), count: 0, items: [] }
  }
  for (const project of projects) {
    let sessionIds = []
    try {
      sessionIds = await readdir(join(SESSIONS_ROOT, project))
    } catch {
      continue
    }
    for (const sessionId of sessionIds) {
      const file = join(SESSIONS_ROOT, project, sessionId, 'session.jsonl.zstd')
      if (!existsSync(file)) continue
      try {
        const { raw, frames, tornStart, records, recordTypes, parseErrors } = await readSessionLog(file)
        const first = records[0]
        items.push({
          project,
          sessionId,
          compressedBytes: raw.byteLength,
          frames,
          tornStart,
          records: records.length,
          parseErrors,
          recordTypes,
          firstRecordKeys: first === undefined ? [] : Object.keys(first),
          firstRecordType: first === undefined ? null : (first.type ?? null),
          cwd: first?.cwd ?? null,
          createdAt: first?.createdAt ?? null,
        })
      } catch (error) {
        items.push({ project, sessionId, error: String(error) })
      }
    }
  }
  items.sort((a, b) => (b.records ?? 0) - (a.records ?? 0))
  return { sessionsRoot: SESSIONS_ROOT, readable: true, count: items.length, items }
}

/**
 * Locate one session's log file under the store.
 * @param sessionId - session id.
 * @returns absolute path or null.
 */
async function findSessionLog(sessionId) {
  if (typeof sessionId !== 'string' || !/^session-[0-9a-f-]{20,}$/i.test(sessionId)) return null
  let projects = []
  try {
    projects = await readdir(SESSIONS_ROOT)
  } catch {
    return null
  }
  for (const project of projects) {
    const file = join(SESSIONS_ROOT, project, sessionId, 'session.jsonl.zstd')
    if (existsSync(file)) return { file, project }
  }
  return null
}

/**
 * Reduce a raw session log into the reading-panel transcript.
 * @param records - parsed JSONL records.
 * @returns transcript summary.
 */
function buildTranscript(records) {
  const messages = []
  const tools = []
  let title = null
  let cwd = null
  let createdAt = null
  for (const record of records) {
    const data = record?.data
    switch (record?.type) {
      case 'session':
        cwd = data?.cwd ?? cwd
        createdAt = data?.createdAt ?? createdAt
        break
      case 'session/title':
        title = typeof data?.title === 'string' && data.title !== '' ? data.title : title
        break
      case 'user/message': {
        const text = (data?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim()
        if (text !== '') messages.push({ role: 'user', text, at: record.time ?? null })
        break
      }
      case 'assistant/message': {
        const blocks = data?.message?.content ?? []
        const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim()
        if (text !== '') messages.push({ role: 'assistant', text, at: record.time ?? null })
        break
      }
      case 'tool/call':
        tools.push({ name: data?.name ?? 'tool', at: record.time ?? null, args: String(data?.arguments ?? '').slice(0, 400) })
        break
      default:
        break
    }
  }
  const lastAt = records.length === 0 ? null : records[records.length - 1].time ?? null
  return { title, cwd, createdAt, lastAt, messageCount: messages.length, toolCount: tools.length, messages, tools }
}

/**
 * Serve one static asset from rhine-dist/.
 * @param res - HTTP response.
 * @param pathname - request pathname.
 * @returns whether the request was answered.
 */
async function serveAsset(res, pathname) {
  // The mount root serves the app entry; every other path is a file under it.
  const suffix = pathname.slice(ROUTE.length).replace(/^\/+/, '') || 'index.html'
  if (!existsSync(ASSET_ROOT)) return false
  const target = resolve(ASSET_ROOT, suffix)
  if (target !== ASSET_ROOT && !target.startsWith(`${ASSET_ROOT}${sep}`)) return false
  try {
    const body = await readFile(target)
    res.writeHead(200, {
      // The app entry must never be cached across plugin upgrades; hashed
      // asset names under ./assets/ are immutable, so they get a long TTL.
      'cache-control': /\.[0-9a-f]{8,}\.(?:js|css)$/.test(suffix) ? 'public, max-age=31536000, immutable' : 'no-store',
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'content-length': String(body.byteLength),
      'x-content-type-options': 'nosniff',
    })
    res.end(body)
    return true
  } catch {
    return false
  }
}

/**
 * Route handler for every request under {@link ROUTE}.
 * @param req - HTTP request.
 * @param res - HTTP response.
 */
async function handle(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? ROUTE, 'http://dsh.local').pathname)
  } catch {
    sendJson(res, 400, { error: 'bad-request-uri' })
    return
  }

  if (pathname === `${ROUTE}/probe/host` || pathname === `${ROUTE}/probe/host/`) {
    sendJson(res, 200, {
      probe: 'host',
      plugin: name,
      route: ROUTE,
      pluginRoot: PLUGIN_ROOT,
      assetRoot: ASSET_ROOT,
      assetRootExists: existsSync(ASSET_ROOT),
      dshHome: DSH_HOME,
      sessionsRoot: SESSIONS_ROOT,
      node: process.version,
      zstd: typeof zstdDecompressSync === 'function',
      pid: process.pid,
      at: new Date().toISOString(),
    })
    return
  }

  if (pathname === `${ROUTE}/probe/sessions` || pathname === `${ROUTE}/probe/sessions/`) {
    try {
      const summary = await listSessions()
      sendJson(res, 200, { probe: 'sessions', at: new Date().toISOString(), ...summary })
    } catch (error) {
      sendJson(res, 500, { probe: 'sessions', error: String(error) })
    }
    return
  }

  // P2 data bridge: session metadata (durable titles) for the 40 slots.
  if (pathname === `${ROUTE}/sessions` || pathname === `${ROUTE}/sessions/`) {
    try {
      const summary = await listSessions()
      const items = []
      for (const item of summary.items) {
        if (item.error !== undefined) {
          items.push({ sessionId: item.sessionId, project: item.project, error: item.error })
          continue
        }
        let title = null
        let cwd = item.cwd ?? null
        try {
          const { records } = await readSessionLog(join(SESSIONS_ROOT, item.project, item.sessionId, 'session.jsonl.zstd'))
          const transcript = buildTranscript(records)
          title = transcript.title
          cwd = transcript.cwd ?? cwd
          items.push({ ...item, title, cwd, messageCount: transcript.messageCount, toolCount: transcript.toolCount, lastAt: transcript.lastAt })
        } catch (error) {
          items.push({ ...item, title, cwd, error: String(error) })
        }
      }
      sendJson(res, 200, { sessionsRoot: summary.sessionsRoot, count: items.length, items })
    } catch (error) {
      sendJson(res, 500, { error: String(error) })
    }
    return
  }

  // P2 data bridge: one session's transcript for the reading panel.
  const transcriptMatch = new RegExp(`^${ROUTE}/session/([^/]+)/?$`).exec(pathname)
  if (transcriptMatch !== null) {
    const sessionId = transcriptMatch[1]
    try {
      const located = await findSessionLog(sessionId)
      if (located === null) {
        sendJson(res, 404, { error: 'session-not-found', sessionId })
        return
      }
      const { records, frames } = await readSessionLog(located.file)
      sendJson(res, 200, { sessionId, project: located.project, frames, records: records.length, ...buildTranscript(records) })
    } catch (error) {
      sendJson(res, 500, { error: String(error), sessionId })
    }
    return
  }

  // P4: transcript export (the app's EXPORT link targets this route).
  const exportMatch = new RegExp(`^${ROUTE}/export/([^/]+)/?$`).exec(pathname)
  if (exportMatch !== null) {
    const sessionId = exportMatch[1]
    try {
      const located = await findSessionLog(sessionId)
      if (located === null) {
        sendJson(res, 404, { error: 'session-not-found', sessionId })
        return
      }
      const { records } = await readSessionLog(located.file)
      const transcript = buildTranscript(records)
      const lines = [
        `RHINE LABORATORY // ARCHIVE EXPORT`,
        `SESSION   ${sessionId}`,
        `PROJECT   ${located.project}`,
        `TITLE     ${transcript.title ?? '(untitled)'}`,
        `CWD       ${transcript.cwd ?? '-'}`,
        `CREATED   ${transcript.createdAt === null ? '-' : new Date(transcript.createdAt).toISOString()}`,
        `MESSAGES  ${transcript.messageCount}    TOOLS ${transcript.toolCount}`,
        '',
        '────────────────────────────────────────────',
        '',
      ]
      for (const message of transcript.messages) {
        const stamp = message.at === null ? '' : new Date(message.at).toISOString()
        lines.push(`[${message.role.toUpperCase()}] ${stamp}`, message.text, '')
      }
      if (transcript.tools.length > 0) {
        lines.push('────────────────────────────────────────────', 'TOOL CALLS', '')
        for (const tool of transcript.tools) {
          lines.push(`- ${tool.name} ${tool.args}`, '')
        }
      }
      const body = Buffer.from(lines.join('\n'), 'utf8')
      res.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
        'content-length': String(body.byteLength),
        'content-disposition': `attachment; filename="RHINE-LAB-${sessionId}.txt"`,
        'x-content-type-options': 'nosniff',
      })
      res.end(body)
    } catch (error) {
      sendJson(res, 500, { error: String(error), sessionId })
    }
    return
  }

  if (await serveAsset(res, pathname)) return
  sendJson(res, 404, { error: 'not-found', path: pathname })
}

/**
 * Mount the plugin's HTTP surface.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: handle }),
    'rhinelab-ui: static assets + P0 probe endpoints',
  )
}
