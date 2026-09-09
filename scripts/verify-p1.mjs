/**
 * P1 acceptance probe: assert the 3D takeover surface against the real app.
 *
 * Two passes, because the boot sequence is ~26 s long and software WebGL in a
 * headless container is fragile (SPEC §5 P1 exit conditions):
 *
 *   --pass boot     full opening animation: wait for #stage[data-mode] to leave
 *                   "boot" and reach "archive", sampling FPS throughout
 *   --pass archive  archive browsing + controls + removal restore, with the
 *                   boot skipped via the app's own reduced-motion preference
 *
 * Usage:
 *   node scripts/verify-p1.mjs --pass boot    --url "http://127.0.0.1:3081/?token=..."
 *   node scripts/verify-p1.mjs --pass archive --url "http://127.0.0.1:3081/?token=..."
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const argv = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const url = argOf('--url', '')
const pass = argOf('--pass', 'archive')
if (url === '') {
  console.error('missing --url')
  process.exit(2)
}
const outDir = resolve(argOf('--out', '.dsh-test/p1'))
mkdirSync(outDir, { recursive: true })

/**
 * Ultra-light preset for the boot pass: software WebGL in a headless container
 * cannot sustain the default (AO + DOF + 2048 shadows) for the full 34 s boot.
 * Values are within the app's own normalizeQuality ranges.
 */
const MINIMAL_QUALITY = {
  scale: 50,
  pixelRatio: 1,
  antialias: 'off',
  shadows: 0,
  aoSamples: 0,
  aoResolution: 0.5,
  depthOfField: 0,
  transmission: 0.25,
  anisotropy: 1,
}

/** RhineLabUI's own `performance` preset (src/render-quality.ts). */
const PERFORMANCE_QUALITY = {
  scale: 80,
  pixelRatio: 1,
  antialias: 'off',
  shadows: 1024,
  aoSamples: 0,
  aoResolution: 0.5,
  depthOfField: 0,
  transmission: 0.5,
  anisotropy: 4,
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--js-flags=--max-old-space-size=4096',
  ],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
const consoleLines = []
const pageErrors = []
let crashed = false
page.on('console', (m) => consoleLines.push({ type: m.type(), text: m.text().slice(0, 300) }))
page.on('pageerror', (e) => pageErrors.push({ message: e.message.slice(0, 300) }))
page.on('crash', () => {
  crashed = true
})

const report = {
  pass,
  url: url.replace(/token=[^&]*/, 'token=<redacted>'),
  startedAt: new Date().toISOString(),
  samples: [],
  screenshots: [],
}

const frameOf = () => page.frames().find((fr) => fr.url().includes('rhinelab-ui/index.html')) ?? null

/**
 * Best-effort screenshot. Software WebGL can starve the compositor, so a
 * screenshot may never settle; visual confirmation is a human step anyway
 * (SPEC §8 人工验收), so a failure here never fails the assertion.
 * @param name - file name inside the output directory.
 */
async function safeShot(name) {
  try {
    await page.screenshot({ path: resolve(outDir, name), timeout: 8000 })
    report.screenshots.push({ name, ok: true })
  } catch (error) {
    report.screenshots.push({ name, ok: false, error: String(error).slice(0, 120) })
  }
}

/**
 * Read the app's live state from inside the iframe.
 * @returns app state or null when the frame is gone.
 */
async function readApp() {
  const frame = frameOf()
  if (frame === null) return null
  try {
    return await frame.evaluate(() => {
      const stage = document.querySelector('#stage')
      const scene = document.querySelector('#three-scene')
      const canvas = scene?.querySelector('canvas')
      return {
        mode: stage?.getAttribute('data-mode') ?? null,
        fps: scene?.getAttribute('data-fps') ?? null,
        hasCanvas: canvas !== undefined && canvas !== null,
        canvas: canvas === undefined || canvas === null ? null : { w: canvas.width, h: canvas.height },
        title: document.querySelector('#selected-title')?.textContent ?? null,
        code: document.querySelector('#selected-code')?.textContent ?? null,
        column: document.querySelector('#column-name')?.textContent ?? null,
        loading: document.querySelector('#loading') !== null,
        errorState: document.querySelector('.error-state') !== null,
      }
    })
  } catch {
    return null
  }
}

process.stderr.write('[phase] goto\n')
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  process.stderr.write('[phase] first frameLoaded\n')
  await page.waitForFunction(() => globalThis.__RHINE__?.frameLoaded === true, null, { timeout: 90000 })

  // Seed preferences (plugin-owned key → app settings) and reload so the app
  // boots with them.
  report.prefs = await page.evaluate(
    ([quality, reduced]) => globalThis.__RHINE__.setPrefs({ rendering: quality, reduced }),
    [pass === 'boot' ? MINIMAL_QUALITY : PERFORMANCE_QUALITY, pass === 'archive'],
  )
  process.stderr.write('[phase] prefs seeded, reloading\n')
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  process.stderr.write('[phase] reloaded, waiting frameLoaded\n')
  await page.waitForFunction(() => globalThis.__RHINE__?.frameLoaded === true, null, { timeout: 90000 })
  process.stderr.write('[phase] second frameLoaded\n')

  report.surface = await page.evaluate(() => {
    const state = globalThis.__RHINE__
    const layer = document.getElementById('rhinelab-ui-root')
    const root = document.getElementById('root')
    const rect = layer?.getBoundingClientRect()
    return {
      mounted: state.mounted,
      frameLoaded: state.frameLoaded,
      coverage: state.coverage,
      layerRect: rect === undefined ? null : { width: Math.round(rect.width), height: Math.round(rect.height) },
      layerZIndex: layer === null ? null : getComputedStyle(layer).zIndex,
      stylePresent: document.getElementById('rhinelab-ui-style') !== null,
      rootOpacity: root === null ? null : getComputedStyle(root).opacity,
      rootPointerEvents: root === null ? null : getComputedStyle(root).pointerEvents,
      appSettings: state.appSettings,
      errors: state.errors,
    }
  })

  if (pass === 'boot') {
    process.stderr.write('[phase] boot loop start\n')
    const loopStart = Date.now()
    const deadline = loopStart + 150000
    let bootCompleted = false
    while (Date.now() < deadline) {
      const app = await readApp()
      process.stderr.write(`[boot] t+${Math.round((Date.now() - loopStart) / 1000)}s mode=${app?.mode ?? 'null'} fps=${app?.fps ?? '-'}\n`)
      if (app === null) break
      const last = report.samples.at(-1)
      if (last === undefined || last.mode !== app.mode) {
        report.samples.push({ at: new Date().toISOString(), mode: app.mode, fps: app.fps, title: app.title })
      }
      if (report.samples.length === 1) await safeShot('p1-boot-early.png')
      // The boot timeline ends at t=35s and hands over to the detail view.
      if (app.mode !== null && app.mode !== 'boot') {
        bootCompleted = true
        await safeShot('p1-boot-complete.png')
        break
      }
      await page.waitForTimeout(2000)
    }
    report.bootCompleted = bootCompleted
    report.final = await readApp()
  } else {
    // Reduced motion skips the boot, so the archive is immediately available.
    await page.waitForFunction(
      () => {
        const frame = globalThis.__RHINE__?.frameUrl !== undefined
        return frame
      },
      null, { timeout: 30000 },
    ).catch(() => {})
    await page.waitForTimeout(4000)
    report.before = await readApp()

    const frame = frameOf()
    if (frame !== null) {
      // Drive the app through its own document-level listeners. Playwright's
      // actionability checks never settle under software WebGL (the element is
      // never "stable"), so dispatch the real events instead.
      await frame.evaluate(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      })
      await page.waitForTimeout(1500)
      await frame.evaluate(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
      })
      await page.waitForTimeout(1500)
      report.after = await readApp()
      report.navigationChanged =
        report.before !== null &&
        report.after !== null &&
        (report.before.title !== report.after.title || report.before.column !== report.after.column)

      await frame.evaluate(() => {
        document.querySelector('[data-action="settings"]')?.click()
      })
      await page.waitForTimeout(1500)
      report.controls = await frame.evaluate(() => {
        const preset = document.querySelector('#quality-preset')
        return {
          presetOptions: preset === null ? [] : [...preset.options].map((o) => o.value),
          presetCurrent: preset?.value ?? null,
          reducedToggle: document.querySelector('[data-pref="reduced"]') !== null,
          savedCount: document.querySelector('#saved-count')?.textContent ?? null,
          dpr: window.devicePixelRatio,
          fontStatus: document.fonts?.status ?? null,
        }
      })
      await safeShot('p1-archive.png')
    }

    report.removal = await page.evaluate(() => {
      const before = {
        bodyChildren: document.body.children.length,
        styleTags: document.head.querySelectorAll('style').length,
      }
      globalThis.__RHINE__.unmount()
      const root = document.getElementById('root')
      const after = {
        bodyChildren: document.body.children.length,
        styleTags: document.head.querySelectorAll('style').length,
        layerPresent: document.getElementById('rhinelab-ui-root') !== null,
        stylePresent: document.getElementById('rhinelab-ui-style') !== null,
        rootOpacity: root === null ? null : getComputedStyle(root).opacity,
        rootPointerEvents: root === null ? null : getComputedStyle(root).pointerEvents,
      }
      return {
        before,
        after,
        restored:
          after.layerPresent === false &&
          after.stylePresent === false &&
          after.bodyChildren === before.bodyChildren - 1 &&
          after.styleTags === before.styleTags - 1 &&
          after.rootOpacity === '1' &&
          after.rootPointerEvents !== 'none',
      }
    })
    await page.waitForTimeout(800)
    await safeShot('p1-restored.png')
  }

  report.consoleLines = consoleLines
  report.pageErrors = pageErrors
  report.crashed = crashed
  report.finishedAt = new Date().toISOString()
} catch (error) {
  report.fatal = { message: String(error), stack: error.stack }
  report.crashed = crashed
  report.consoleLines = consoleLines
  report.pageErrors = pageErrors
  try {
    await safeShot(`p1-${pass}-fatal.png`)
  } catch {
    /* ignore */
  }
} finally {
  await browser.close()
}

const file = resolve(outDir, `p1-${pass}-report.json`)
writeFileSync(file, JSON.stringify(report, null, 2))

const app = report.final ?? report.after ?? report.before ?? {}
const verdict = {
  pass,
  overlayCovers: report.surface?.coverage?.coversViewport === true,
  nativeGhosted: report.surface?.rootOpacity !== '1' && report.surface?.rootPointerEvents === 'none',
  appLoaded: report.surface?.frameLoaded === true,
  crashed: report.crashed === true,
  ...(pass === 'boot'
    ? {
        bootCompleted: report.bootCompleted === true,
        samples: report.samples?.length ?? 0,
        finalMode: report.final?.mode ?? null,
        maxFps: Math.max(0, ...(report.samples ?? []).map((s) => Number(s.fps) || 0)),
      }
    : {
        mode: app.mode ?? null,
        canvasNonZero: (app.canvas?.w ?? 0) > 0 && (app.canvas?.h ?? 0) > 0,
        navigationChanged: report.navigationChanged === true,
        qualityPresets: report.controls?.presetOptions ?? [],
        presetCurrent: report.controls?.presetCurrent ?? null,
        reducedToggle: report.controls?.reducedToggle === true,
        removalRestored: report.removal?.restored === true,
      }),
  pageErrors: (report.pageErrors ?? []).length,
  appErrors: (report.surface?.errors ?? []).length,
}
console.log(JSON.stringify({ verdict, reportFile: file }, null, 2))

const failed = []
if (!verdict.overlayCovers) failed.push('overlay coverage')
if (!verdict.nativeGhosted) failed.push('native ghost style')
if (!verdict.appLoaded) failed.push('app load')
if (pass === 'boot') {
  if (!verdict.bootCompleted) failed.push('boot did not complete')
} else {
  if (verdict.mode !== 'archive') failed.push('archive mode')
  if (!verdict.canvasNonZero) failed.push('webgl canvas')
  if (!verdict.navigationChanged) failed.push('archive navigation')
  if ((verdict.qualityPresets ?? []).length === 0) failed.push('quality presets')
  if (!verdict.reducedToggle) failed.push('reduced-motion toggle')
  if (!verdict.removalRestored) failed.push('removal restore')
}
if (report.fatal !== undefined) failed.push('fatal')
if (failed.length > 0) {
  console.error(`P1 ${pass} verification FAILED:`, failed.join(', '))
  process.exit(1)
}
console.log(`P1 ${pass} verification PASSED`)
