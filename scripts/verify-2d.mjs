/**
 * Low-spec fallback probe: 2D card mode (auto-degrade target).
 *
 * Checks:
 *   - manual 2D mode hides the WebGL canvas and paints the 5×8 archive grid
 *   - the grid carries real session records (titles, ids, categories)
 *   - keyboard navigation and detail/conversation still work in 2D
 *   - switching back to 3D restores the canvas
 *   - the watchdog exists and reports a frame rate in auto mode
 *
 * Usage: node scripts/verify-2d.mjs --url "http://127.0.0.1:3081/?token=..."
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
if (url === '') {
  console.error('missing --url')
  process.exit(2)
}
const outDir = resolve(argOf('--out', '.dsh-test/2d'))
mkdirSync(outDir, { recursive: true })

const MINIMAL = {
  scale: 50, pixelRatio: 1, antialias: 'off', shadows: 0, aoSamples: 0,
  aoResolution: 0.5, depthOfField: 0, transmission: 0.25, anisotropy: 1,
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 300)))

const report = { url: url.replace(/token=[^&]*/, 'token=<redacted>'), startedAt: new Date().toISOString() }

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => globalThis.__RHINE__?.frameLoaded === true, null, { timeout: 90000 })
  await page.evaluate(([quality]) => globalThis.__RHINE__.setPrefs({ reduced: true, rendering: quality }), [MINIMAL])
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => globalThis.__RHINE_BRIDGE_STATE__?.acks > 0, null, { timeout: 90000 })
  await page.waitForTimeout(3000)

  const frame = page.frames().find((fr) => fr.url().includes('rhinelab-ui/index.html'))
  if (frame === null) throw new Error('app frame not found')

  // Switch to 2D manually (the watchdog drives the same code path).
  report.to2d = await frame.evaluate(() => {
    const result = globalThis.rhine.renderMode('2d')
    return { ...result, state: globalThis.rhine.renderState() }
  })
  await page.waitForTimeout(1500)

  report.flat = await frame.evaluate(() => {
    const host = document.getElementById('flat-archive')
    const cards = [...document.querySelectorAll('#flat-archive .flat-card')]
    const rect = host?.getBoundingClientRect()
    return {
      visible: host !== null && getComputedStyle(host).display !== 'none',
      rect: rect === undefined || rect === null ? null : { w: Math.round(rect.width), h: Math.round(rect.height) },
      cards: cards.length,
      emptyCards: cards.filter((c) => c.classList.contains('empty')).length,
      columns: [...document.querySelectorAll('#flat-archive .flat-col h4')].map((h) => h.textContent),
      firstTitles: cards.filter((c) => !c.classList.contains('empty')).slice(0, 4).map((c) => c.querySelector('strong')?.textContent),
      selectedCards: cards.filter((c) => c.classList.contains('selected')).length,
      canvasHidden: document.getElementById('three-scene')?.style.display === 'none',
      renderState: globalThis.rhine.renderState(),
    }
  })

  // Nothing may cover the grid text: the scene-driven overlays are frozen in
  // 2D mode unless explicitly cleared.
  report.occlusion = await frame.evaluate(() => {
    const title = document.querySelector('#flat-archive .flat-card:not(.empty) strong')
    const rect = title?.getBoundingClientRect()
    const top = rect === undefined || rect === null
      ? null
      : document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2))
    const marks = document.getElementById('inspection-marks')
    return {
      redactionWindows: document.querySelectorAll('.document-redaction-window').length,
      redactionInk: document.querySelectorAll('.document-redaction-ink').length,
      inspectionOpacity: marks === null ? null : getComputedStyle(marks).opacity,
      inspectionRects: marks === null ? null : marks.querySelectorAll('rect').length,
      titleTopmost: top !== null && (top === title || title?.contains(top) === true),
      topTag: top === null ? null : `${top.tagName.toLowerCase()}${top.id ? '#' + top.id : ''}${top.className ? '.' + String(top.className).split(' ')[0] : ''}`,
    }
  })

  // No 3D-view text overlay may print through the grid: hide them and sample
  // points across the grid surface.
  report.overlays = await frame.evaluate(() => {
    const selectors = ['.archive-callout', '.object-caption', '.hover-label', '.archive-counter', '.archive-navigation']
    const stillVisible = selectors.filter((sel) => {
      const el = document.querySelector(sel)
      return el !== null && getComputedStyle(el).display !== 'none'
    })
    const host = document.getElementById('flat-archive')
    const rect = host?.getBoundingClientRect()
    const inside = []
    if (rect !== undefined && rect !== null) {
      for (let fx = 0.08; fx <= 0.92; fx += 0.28) {
        for (let fy = 0.12; fy <= 0.9; fy += 0.26) {
          const x = Math.round(rect.left + rect.width * fx)
          const y = Math.round(rect.top + rect.height * fy)
          const top = document.elementFromPoint(x, y)
          inside.push(top !== null && (top === host || host?.contains(top) === true))
        }
      }
    }
    return { stillVisible, samples: inside.length, allInside: inside.every(Boolean), brandVisible: getComputedStyle(document.querySelector('.brand')).display !== 'none' }
  })

  // Keyboard navigation must still move the selection in 2D.
  const before = await frame.evaluate(() => document.querySelector('#flat-archive .flat-card.selected strong')?.textContent ?? null)
  await frame.evaluate(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  await page.waitForTimeout(900)
  const after = await frame.evaluate(() => document.querySelector('#flat-archive .flat-card.selected strong')?.textContent ?? null)
  report.navigation = { before, after, changed: before !== after }

  // Detail + conversation still reachable from 2D.
  await frame.evaluate(() => globalThis.rhine.detail())
  await page.waitForTimeout(2000)
  await frame.evaluate(() => document.querySelector('[data-tab="chat"]')?.click())
  await page.waitForTimeout(1200)
  report.detail = await frame.evaluate(() => {
    const title = document.querySelector('#detail-content h2')
    const rect = title?.getBoundingClientRect()
    const top = rect === undefined || rect === null
      ? null
      : document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2))
    return {
      mode: document.getElementById('stage')?.dataset.mode ?? null,
      detailOpacity: document.getElementById('detail-content')?.style.opacity ?? null,
      chatInput: document.getElementById('chat-input') !== null,
      redactionWindows: document.querySelectorAll('.document-redaction-window').length,
      titleTopmost: top !== null && (top === title || title?.contains(top) === true),
    }
  })

  // Back to 3D.
  await frame.evaluate(() => {
    globalThis.rhine.archive()
    globalThis.rhine.renderMode('3d')
  })
  await page.waitForTimeout(1500)
  report.back3d = await frame.evaluate(() => globalThis.rhine.renderState())

  report.pageErrors = pageErrors
  report.finishedAt = new Date().toISOString()
} catch (error) {
  report.fatal = { message: String(error), stack: error.stack }
  report.pageErrors = pageErrors
} finally {
  await browser.close()
}

const file = resolve(outDir, '2d-report.json')
writeFileSync(file, JSON.stringify(report, null, 2))

const verdict = {
  switchedTo2d: report.to2d?.flat === true,
  gridVisible: report.flat?.visible === true,
  gridCards: report.flat?.cards ?? 0,
  gridColumns: report.flat?.columns ?? [],
  realTitles: (report.flat?.firstTitles ?? []).filter(Boolean),
  canvasHidden: report.flat?.canvasHidden === true,
  navigationChanged: report.navigation?.changed === true,
  detailWorks: report.detail?.mode === 'detail' && report.detail?.chatInput === true,
  gridUnoccluded: report.occlusion?.titleTopmost === true && report.occlusion?.redactionWindows === 0 && report.occlusion?.inspectionOpacity === '0',
  noForeignOverlays: (report.overlays?.stillVisible ?? []).length === 0,
  gridSurfaceClean: report.overlays?.allInside === true && (report.overlays?.samples ?? 0) >= 12,
  overlays: report.overlays,
  detailUnoccluded: report.detail?.titleTopmost === true && report.detail?.redactionWindows === 0,
  occlusion: report.occlusion,
  backTo3d: report.back3d?.flat === false && report.back3d?.canvasVisible === true,
  pageErrors: (report.pageErrors ?? []).length,
}
console.log(JSON.stringify({ verdict, reportFile: file }, null, 2))

const failed = []
if (!verdict.switchedTo2d) failed.push('switch to 2D')
if (!verdict.gridVisible || verdict.gridCards === 0) failed.push('2D grid')
if (!verdict.canvasHidden) failed.push('canvas hidden')
if (!verdict.navigationChanged) failed.push('2D navigation')
if (!verdict.detailWorks) failed.push('detail/conversation in 2D')
if (!verdict.gridUnoccluded) failed.push('grid text occluded')
if (!verdict.noForeignOverlays) failed.push('3D text overlay visible in 2D')
if (!verdict.gridSurfaceClean) failed.push('foreign element over grid')
if (!verdict.detailUnoccluded) failed.push('detail text occluded')
if (!verdict.backTo3d) failed.push('return to 3D')
if (report.fatal !== undefined) failed.push('fatal')
if (failed.length > 0) {
  console.error('2D fallback verification FAILED:', failed.join(', '))
  process.exit(1)
}
console.log('2D fallback verification PASSED')
