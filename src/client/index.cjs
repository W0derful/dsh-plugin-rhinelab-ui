/**
 * RhineLabUI client half — P1: 3D takeover surface.
 *
 * Runs inside the Harness web shell as a `__ModuleLoader__` module (bundle id
 * MUST equal the package name — see SPEC-DEVIATIONS.md D-10).
 *
 * Responsibilities (SPEC §3 / §5 P1):
 *   1. Mount the fullscreen RhineLab layer (`#rhinelab-ui-root`).
 *   2. Host the built RhineLabUI app in a same-origin iframe served by this
 *      plugin's own static route — CSS/JS isolation, and the exact pattern the
 *      verified reference implementation uses (SPEC-DEVIATIONS.md D-3).
 *   3. Suppress the native shell to a ghost with an injected <style> only, so
 *      unloading the plugin restores it byte-for-byte (hard constraint 3).
 *   4. Degrade safely: if the app never loads, drop the suppression and hand
 *      the native UI back instead of showing a dead overlay.
 *
 * Verification state is published on `window.__RHINE__` (read by
 * scripts/probe-browser.mjs). The P0 probe surface is opt-in via `?rhine-probe=1`.
 */
const ROUTE = '/rhinelab-ui'
const APP_URL = `${ROUTE}/index.html`
const LAYER_ID = 'rhinelab-ui-root'
const FRAME_ID = 'rhinelab-ui-frame'
const STYLE_ID = 'rhinelab-ui-style'
/** Plugin-owned preference key (hard constraint 3: rhinelab-ui: prefix). */
const PREFS_KEY = 'rhinelab-ui:prefs'
/** The app's own settings key, namespaced to the plugin prefix (R-11). */
const APP_SETTINGS_KEY = 'rhinelab-ui:settings'
/** How long the app may take to signal load before we fall back. */
const LOAD_TIMEOUT_MS = 20000

const STATE = (globalThis.__RHINE__ = globalThis.__RHINE__ ?? {
  build: 'p1-1',
  startedAt: new Date().toISOString(),
  mounted: false,
  frameLoaded: false,
  fallback: null,
  errors: [],
  lines: [],
})

/**
 * Record one line on the verification state and the browser console.
 * @param tag - short tag.
 * @param payload - JSON-safe payload.
 */
function log(tag, payload) {
  STATE.lines.push({ tag, at: new Date().toISOString(), payload })
  try {
    console.log(`[RHINE-${tag}]`, payload)
  } catch {
    /* console may be unavailable */
  }
}

/**
 * Record one failure.
 * @param where - failing step.
 * @param error - thrown value.
 */
function fail(where, error) {
  STATE.errors.push({ where, message: String(error) })
  try {
    console.error(`[RHINE-ERROR] ${where}`, error)
  } catch {
    /* ignore */
  }
}

/**
 * Read the plugin's persisted preferences.
 * @returns preference object (never throws).
 */
function readPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY)
    return raw === null || raw === undefined ? {} : JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Persist one preference field.
 * @param patch - partial preference object.
 * @returns the merged preference object.
 */
function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch }
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(next))
  } catch {
    /* locked-down storage keeps the live value for this page */
  }
  return next
}

/** Native-shell suppression: ghosted, never removed from the DOM. */
const SUPPRESSION_CSS = [
  '#root{opacity:.16!important;filter:saturate(0) brightness(.7)!important;pointer-events:none!important}',
  `#${LAYER_ID}{contain:strict}`,
  `#${LAYER_ID} iframe{width:100%;height:100%;border:0;display:block;background:#0b0d10}`,
].join('')

/**
 * Project plugin preferences onto the app's own settings record before the
 * frame boots, so render quality and reduced-motion apply from the first frame.
 * Merges (never clobbers) whatever the app's settings panel wrote.
 * @param prefs - plugin preference object.
 * @returns the settings record actually stored, or null when untouched.
 */
function applyPrefsToApp(prefs) {
  if (prefs === null || typeof prefs !== 'object' || Object.keys(prefs).length === 0) return null
  try {
    const store = globalThis.localStorage
    const current = JSON.parse(store?.getItem(APP_SETTINGS_KEY) ?? '{}') ?? {}
    const next = { ...current }
    if (prefs.reduced !== undefined) next.reduced = prefs.reduced === true
    if (prefs.rendering !== undefined) next.rendering = prefs.rendering
    if (prefs.quality !== undefined) next.quality = prefs.quality === true
    store?.setItem(APP_SETTINGS_KEY, JSON.stringify(next))
    return next
  } catch {
    return null
  }
}

/**
 * Build the overlay element containing the app frame.
 * @returns the overlay element.
 */
function createLayer() {
  const layer = document.createElement('div')
  layer.id = LAYER_ID
  layer.dataset.rhinelab = 'root'
  layer.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483000',
    'background:#0b0d10',
    'overflow:hidden',
  ].join(';')

  const frame = document.createElement('iframe')
  frame.id = FRAME_ID
  frame.title = 'Rhine Lab Analysis OS'
  frame.setAttribute('allow', 'autoplay; fullscreen')
  frame.setAttribute('referrerpolicy', 'same-origin')
  frame.src = APP_URL
  layer.append(frame)
  return layer
}

/**
 * Mount the takeover surface.
 * @param ctx - client plugin context.
 * @returns disposer restoring the native shell exactly.
 */
function mount(ctx) {
  const prefs = readPrefs()
  const appliedSettings = applyPrefsToApp(prefs)
  const layer = createLayer()
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.rhinelab = 'style'
  style.textContent = SUPPRESSION_CSS

  document.head.append(style)
  document.body.append(layer)

  const frame = layer.querySelector(`#${FRAME_ID}`)
  const rect = layer.getBoundingClientRect()
  const coverage = {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    coversViewport: rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1,
  }

  let disposed = false
  let loaded = false
  let disposeBridge

  const onLoad = () => {
    if (disposed) return
    loaded = true
    STATE.frameLoaded = true
    // Same-origin: read the app's own boot markers for verification.
    let app = null
    try {
      const doc = frame.contentDocument
      const scene = doc?.querySelector('#three-scene')
      app = {
        title: doc?.title ?? null,
        hasStage: doc?.querySelector('#stage') !== null,
        hasScene: scene !== null,
        fps: scene?.getAttribute('data-fps') ?? null,
        mode: doc?.querySelector('#stage')?.getAttribute('data-mode') ?? null,
      }
    } catch (error) {
      fail('frame.inspect', error)
    }
    STATE.app = app
    log('P1-APP-LOADED', { url: APP_URL, app })

    // P2 data bridge: only meaningful once the app's own bridge listener is up.
    if (typeof disposeBridge !== 'function') {
      try {
        disposeBridge = require('./bridge.cjs').install(ctx)
        STATE.bridgeInstalled = true
        log('P2-BRIDGE-INSTALL', { route: ROUTE })
      } catch (error) {
        fail('bridge.install', error)
      }
    }
  }
  frame.addEventListener('load', onLoad)

  const timer = setTimeout(() => {
    if (disposed || loaded) return
    STATE.fallback = { reason: 'app-load-timeout', at: new Date().toISOString() }
    log('P1-FALLBACK', STATE.fallback)
    // Hand the native UI back rather than leaving a dead overlay.
    layer.remove()
    style.remove()
  }, LOAD_TIMEOUT_MS)

  STATE.mounted = true
  STATE.coverage = coverage
  STATE.frameUrl = APP_URL
  STATE.prefs = prefs
  STATE.appSettings = appliedSettings
  log('P1-MOUNT', { coverage, prefs, appliedSettings, appUrl: APP_URL })

  return function dispose() {
    if (disposed) return
    disposed = true
    clearTimeout(timer)
    frame.removeEventListener('load', onLoad)
    if (typeof disposeBridge === 'function') disposeBridge()
    layer.remove()
    style.remove()
    STATE.mounted = false
    STATE.disposedAt = new Date().toISOString()
    const root = document.getElementById('root')
    STATE.removal = {
      layerPresent: document.getElementById(LAYER_ID) !== null,
      stylePresent: document.getElementById(STYLE_ID) !== null,
      rootPresent: root !== null,
      rootOpacity: root === null ? null : getComputedStyle(root).opacity,
    }
    log('P1-DISPOSE', STATE.removal)
  }
}

exports.name = 'rhinelab-ui-client'
// `slots` + `sessions` are required by the P0 probe surface and the P2 data
// bridge; `remote` is required by the P3 send/stream path (session.prompt /
// session.follow). Cordis refuses `ctx.remote` unless it is declared here.
exports.inject = ['slots', 'sessions', 'remote', 'remote.session']

/**
 * Client plugin body.
 * @param ctx - client plugin context.
 */
exports.apply = function apply(ctx) {
  const params = new URLSearchParams(location.search)
  // Probe mode runs without the 3D surface: the P0 decision gate only needs the
  // structured probe report, never the WebGL scene (which is slow to boot and
  // unstable under software rendering).
  const probeOnly = params.get('rhine-probe') === '1'
  log('APPLY', { build: STATE.build, appUrl: APP_URL, probeOnly })

  let dispose
  if (probeOnly) {
    STATE.probeOnly = true
  } else {
    try {
      dispose = mount(ctx)
    } catch (error) {
      fail('mount', error)
      return
    }
  }

  // P0 probe surface is OPT-IN ONLY (`?rhine-probe=1`). It owns a fullscreen
  // opaque layer for probe A, so auto-running it would cover the product UI —
  // the exact regression this line prevents.
  let disposeProbe
  if (probeOnly) {
    try {
      disposeProbe = require('./probe.cjs').install(ctx)
    } catch (error) {
      fail('probe.install', error)
    }
  }

  // Operational hooks (same surface the verification harness drives).
  STATE.unmount = () => {
    if (typeof dispose === 'function') dispose()
  }
  STATE.setPrefs = (patch) => {
    STATE.prefs = writePrefs(patch)
    return STATE.prefs
  }
  // Create a fresh session through the official service (used by verification
  // so probes never inject messages into a live conversation).
  STATE.createSession = async () => {
    const id = await ctx.sessions.create()
    if (typeof ctx.sessions.refresh === 'function') await ctx.sessions.refresh()
    return id
  }

  ctx.effect(
    () => () => {
      if (typeof disposeProbe === 'function') disposeProbe()
      if (typeof dispose === 'function') dispose()
    },
    'rhinelab-ui: 3D takeover surface',
  )
}
