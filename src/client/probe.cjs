/**
 * P0 probe module — opt-in regression surface (SPEC §4).
 *
 * Kept in the shipped bundle so the P0 decision-gate evidence stays
 * reproducible, but it only installs when the page carries `?rhine-probe=1`
 * so the production takeover surface is never polluted by a probe card.
 *
 *   B  official channel — register into the `shell.overlay` list slot and read
 *                         the real session list through `ctx.sessions`
 *   C  fallback channel — same-origin fetch of the host half's session-log route
 *
 * Probe A (visual takeover + restore) is now asserted against the real P1
 * surface via `window.__RHINE__`, so it is not duplicated here.
 */
const React = require('react')

const PROBE = (globalThis.__RHINE_PROBE__ = globalThis.__RHINE_PROBE__ ?? {
  build: 'p1-probe-1',
  startedAt: new Date().toISOString(),
  lines: [],
  probeB: null,
  probeC: null,
  errors: [],
})

/**
 * Record one probe line.
 * @param tag - probe tag.
 * @param payload - JSON-safe payload.
 */
function log(tag, payload) {
  PROBE.lines.push({ tag, at: new Date().toISOString(), payload })
  try {
    console.log(`[RHINE-${tag}]`, payload)
  } catch {
    /* ignore */
  }
}

/**
 * Record one probe failure.
 * @param where - failing step.
 * @param error - thrown value.
 */
function fail(where, error) {
  PROBE.errors.push({ where, message: String(error) })
  try {
    console.error(`[RHINE-ERROR] ${where}`, error)
  } catch {
    /* ignore */
  }
}

/**
 * Describe one element for DOM diffing.
 * @param el - element.
 * @returns compact descriptor.
 */
function describe(el) {
  return {
    tag: el.tagName?.toLowerCase() ?? null,
    id: el.id || null,
    children: el.children?.length ?? 0,
  }
}

/**
 * Snapshot the shell DOM landmarks the takeover must restore.
 * @returns landmark snapshot.
 */
function domSnapshot() {
  const root = document.querySelector('#root')
  return {
    bodyChildren: [...document.body.children].map(describe),
    bodyChildCount: document.body.children.length,
    rootExists: root !== null,
    rootChildren: root === null ? 0 : root.children.length,
    styleTags: [...document.head.querySelectorAll('style')].length,
    title: document.title,
  }
}

/**
 * Probe A: mount a fullscreen takeover layer plus an injected <style>, and
 * return a disposer that must restore the shell exactly.
 * @returns disposer.
 */
function mountProbeA() {
  const before = domSnapshot()
  const layer = document.createElement('div')
  layer.id = 'rhinelab-ui-probe-a'
  layer.dataset.rhinelab = 'probe-a'
  layer.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:radial-gradient(120% 90% at 50% 0%, #0b2f3a 0%, #04121a 55%, #01070b 100%)',
    'color:#dff6ff',
    'font:600 24px/1.4 ui-monospace, monospace',
    'letter-spacing:0.18em',
  ].join(';')
  layer.innerHTML = [
    '<div style="text-align:center">',
    '<div style="font-size:12px;opacity:.62;letter-spacing:.32em">RHINE LABORATORY // ARCHIVE</div>',
    '<div style="margin-top:12px">P0 PROBE A · VISUAL TAKEOVER</div>',
    '</div>',
  ].join('')
  document.body.append(layer)

  const style = document.createElement('style')
  style.id = 'rhinelab-ui-probe-a-style'
  style.textContent = '#rhinelab-ui-probe-a{contain:strict}'
  document.head.append(style)

  const rect = layer.getBoundingClientRect()
  PROBE.probeA = {
    mounted: true,
    layerId: layer.id,
    styleId: style.id,
    coverage: {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      coversViewport: rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1,
    },
    domBefore: before,
    unmounted: null,
  }
  log('PROBE-A', { coverage: PROBE.probeA.coverage, bodyChildCount: before.bodyChildCount })

  return function disposeProbeA() {
    layer.remove()
    style.remove()
    const restored = domSnapshot()
    PROBE.probeA.unmounted = {
      at: new Date().toISOString(),
      layerPresent: document.getElementById('rhinelab-ui-probe-a') !== null,
      stylePresent: document.getElementById('rhinelab-ui-probe-a-style') !== null,
      domAfterUnmount: restored,
      restored: restored.bodyChildCount === before.bodyChildCount && restored.styleTags === before.styleTags,
    }
    log('PROBE-A-UNMOUNT', PROBE.probeA.unmounted)
  }
}

/**
 * Probe B: register a component into the `shell.overlay` list slot and read the
 * real session list through the official client service.
 * @param ctx - Client plugin context.
 * @returns disposer for the slot registration.
 */
function mountProbeB(ctx) {
  const readSessions = () => {
    const snapshot = ctx.sessions.list.getSnapshot()
    const byId = snapshot.byId ?? {}
    const ids = Object.keys(byId)
    return {
      snapshotKeys: Object.keys(snapshot),
      current: snapshot.current ?? null,
      total: ids.length,
      sample: ids.slice(0, 5).map((id) => ({
        id,
        title: byId[id]?.title ?? null,
        displayTitle: byId[id]?.displayTitle ?? null,
        blank: byId[id]?.blank ?? null,
        updatedAt: byId[id]?.updatedAt ?? null,
      })),
    }
  }

  const ProbeCard = (props) => {
    const [snap, setSnap] = React.useState(() => readSessions())
    React.useEffect(() => {
      let off
      try {
        off = ctx.sessions.list.subscribe(() => setSnap(readSessions()))
      } catch (error) {
        fail('probeB.subscribe', error)
      }
      return typeof off === 'function' ? off : undefined
    }, [])
    React.useEffect(() => {
      PROBE.probeB = {
        ...PROBE.probeB,
        rendered: true,
        sessionTotal: snap.total,
        current: snap.current,
        snapshotKeys: snap.snapshotKeys,
        sample: snap.sample,
        injectedPropsKeys: Object.keys(props ?? {}),
      }
      log('PROBE-B', PROBE.probeB)
    }, [snap])
    return React.createElement(
      'div',
      {
        id: 'rhinelab-ui-probe-b',
        style: {
          position: 'absolute',
          left: '16px',
          bottom: '16px',
          padding: '10px 14px',
          borderRadius: '10px',
          background: 'rgba(4,18,26,0.86)',
          border: '1px solid rgba(120,220,255,0.35)',
          color: '#dff6ff',
          font: '500 12px/1.5 ui-monospace, monospace',
          letterSpacing: '0.08em',
        },
      },
      `PROBE B · sessions=${snap.total} · current=${snap.current ?? 'none'}`,
    )
  }

  const spec = { name: 'shell.overlay', id: 'rhinelab-ui-probe-b', order: 10, inject: () => ({}) }
  let dispose
  try {
    dispose = ctx.slots.register(spec, ProbeCard)
    PROBE.probeB = { registered: true, slot: spec.name, entryId: spec.id }
    log('PROBE-B-REGISTER', { slot: spec.name, entryId: spec.id })
  } catch (error) {
    PROBE.probeB = { registered: false, error: String(error) }
    fail('probeB.register', error)
  }
  return () => {
    try {
      if (typeof dispose === 'function') dispose()
      PROBE.probeB = { ...PROBE.probeB, disposedAt: new Date().toISOString() }
    } catch (error) {
      fail('probeB.dispose', error)
    }
  }
}

/**
 * Probe C: same-origin fetch of the host half's session-log route.
 * @returns promise resolving when the report is written.
 */
async function runProbeC() {
  const url = '/rhinelab-ui/probe/sessions'
  try {
    const hostRes = await fetch('/rhinelab-ui/probe/host', { credentials: 'same-origin' })
    const host = await hostRes.json()
    const res = await fetch(url, { credentials: 'same-origin' })
    const data = await res.json()
    PROBE.probeC = {
      url,
      status: res.status,
      ok: res.ok,
      sessionsRoot: data.sessionsRoot,
      count: data.count,
      sample: (data.items ?? []).slice(0, 3),
      hostStatus: hostRes.status,
      hostPid: host.pid ?? null,
    }
    log('PROBE-C', PROBE.probeC)
  } catch (error) {
    PROBE.probeC = { url, error: String(error) }
    fail('probeC', error)
  }
}

/**
 * Install the opt-in probe surface.
 * @param ctx - Client plugin context.
 * @returns disposer for the probe contributions.
 */
exports.install = function install(ctx) {
  log('PROBE-INSTALL', { build: PROBE.build })
  let disposeA
  try {
    disposeA = mountProbeA()
  } catch (error) {
    fail('probeA', error)
  }
  const disposeB = mountProbeB(ctx)
  void runProbeC()
  PROBE.unmountA = () => {
    if (typeof disposeA === 'function') disposeA()
  }
  PROBE.unmountB = () => {
    if (typeof disposeB === 'function') disposeB()
  }
  return () => {
    PROBE.unmountA()
    disposeB()
    PROBE.disposedAt = new Date().toISOString()
  }
}
