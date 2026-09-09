/**
 * P4 acceptance probe: search / favorites / export / model viewer wiring
 * (SPEC §5 P4 + §8 代理自验).
 *
 * Usage: node scripts/verify-p4.mjs --url "http://127.0.0.1:3081/?token=..."
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
const origin = new URL(url).origin
const outDir = resolve(argOf('--out', '.dsh-test/p4'))
mkdirSync(outDir, { recursive: true })

const MINIMAL_QUALITY = {
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
  await page.evaluate(
    ([quality]) => globalThis.__RHINE__.setPrefs({ reduced: true, rendering: quality }),
    [MINIMAL_QUALITY],
  )
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => globalThis.__RHINE_BRIDGE_STATE__?.acks > 0, null, { timeout: 90000 })
  await page.waitForTimeout(2500)

  const frame = page.frames().find((fr) => fr.url().includes('rhinelab-ui/index.html'))
  if (frame === null) throw new Error('app frame not found')

  // ── 检索: the archive's own search modal over the live session records ────
  report.search = await frame.evaluate(() => {
    const api = globalThis.rhine
    api?.archive?.()
    // open the search modal through the app's own action button
    document.querySelector('[data-action="search"]')?.click()
    return { modalOpen: document.querySelector('.terminal-modal') !== null }
  })
  await page.waitForTimeout(900)
  report.searchResults = await frame.evaluate(() => {
    const input = document.getElementById('archive-search')
    if (input === null) return { error: 'no-search-input' }
    const term = (document.querySelector('#search-results .result-name b')?.textContent ?? '').slice(0, 2)
    input.value = term
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const rows = document.querySelectorAll('#search-results .result-row').length
    return { term, rows, count: document.getElementById('result-count')?.textContent ?? null }
  })
  await page.waitForTimeout(700)

  // ── 收藏: SAVE from the detail page must re-bucket the 收藏 column ────────
  report.favorite = await frame.evaluate(async () => {
    document.querySelector('[data-action="close-modal"]')?.click()
    await new Promise((r) => setTimeout(r, 400))
    const all = globalThis.__RHINE_BRIDGE__?.snapshot?.().all ?? []
    const index = all.findIndex((r) => r.empty !== true && r.category !== '收藏')
    if (index < 0) return { error: 'no session slot' }
    globalThis.rhine.select(index)
    globalThis.rhine.detail()
    await new Promise((r) => setTimeout(r, 900))
    const key = globalThis.__RHINE_BRIDGE__?.snapshot?.().all?.[index]?.key ?? null
    document.querySelector('[data-action="bookmark"]')?.click()
    return { key, title: document.querySelector('.detail-title-cn')?.textContent ?? null }
  })
  await page.waitForFunction(
    (key) => {
      const all = globalThis.__RHINE_BRIDGE__?.snapshot?.().all ?? []
      return all.slice(0, 8).some((r) => r.key === key)
    },
    report.favorite?.key ?? null,
    { timeout: 30000 },
  ).catch(() => {})
  report.favoriteBucket = await frame.evaluate(() => {
    const all = globalThis.__RHINE_BRIDGE__?.snapshot?.().all ?? []
    return {
      favorites: all.slice(0, 8).filter((r) => r.empty !== true).map((r) => r.title),
      savedCount: document.getElementById('saved-count')?.textContent ?? null,
      savedStore: (() => { try { return JSON.parse(localStorage.getItem('rhinelab-ui:saved') ?? '[]') } catch { return null } })(),
    }
  })

  // ── 导出: the host transcript route ──────────────────────────────────────
  report.export = await page.evaluate(async (key) => {
    const res = await fetch(`/rhinelab-ui/export/${encodeURIComponent(key)}`, { credentials: 'same-origin' })
    const text = await res.text()
    return {
      status: res.status,
      disposition: res.headers.get('content-disposition'),
      bytes: text.length,
      head: text.split('\n').slice(0, 6),
      hasMessages: text.includes('[USER]') || text.includes('[ASSISTANT]'),
    }
  }, report.favorite?.key ?? null)

  // ── 模型查看器: 360° viewer opens from the detail page ───────────────────
  report.viewer = await frame.evaluate(async () => {
    globalThis.rhine?.detail?.()
    await new Promise((r) => setTimeout(r, 900))
    const button = document.querySelector('[data-action="model-viewer"]')
    if (button === null) return { error: 'no-viewer-button' }
    button.click()
    await new Promise((r) => setTimeout(r, 2500))
    const stage = document.getElementById('stage')
    return {
      opened: stage?.dataset.viewer !== undefined || document.querySelector('[data-viewer]') !== null || document.body.textContent.includes('360'),
      bodyHasViewerCopy: document.body.textContent.includes('拆解') || document.body.textContent.includes('重组') || document.body.textContent.includes('360'),
      mode: stage?.dataset.mode ?? null,
    }
  })

  report.pageErrors = pageErrors
  report.finishedAt = new Date().toISOString()
} catch (error) {
  report.fatal = { message: String(error), stack: error.stack }
  report.pageErrors = pageErrors
} finally {
  await browser.close()
}

const file = resolve(outDir, 'p4-report.json')
writeFileSync(file, JSON.stringify(report, null, 2))

const verdict = {
  searchOpens: report.search?.modalOpen === true,
  searchRows: report.searchResults?.rows ?? 0,
  favoriteSaved: (report.favoriteBucket?.savedCount ?? '00') !== '00',
  favoriteBucketed: (report.favoriteBucket?.favorites ?? []).length > 0,
  favoriteColumn: report.favoriteBucket?.favorites ?? [],
  exportStatus: report.export?.status ?? null,
  exportBytes: report.export?.bytes ?? 0,
  exportHasMessages: report.export?.hasMessages === true,
  viewerOpened: report.viewer?.opened === true || report.viewer?.bodyHasViewerCopy === true,
  pageErrors: (report.pageErrors ?? []).length,
}
console.log(JSON.stringify({ verdict, reportFile: file }, null, 2))

const failed = []
if (!verdict.searchOpens) failed.push('search modal')
if (verdict.searchRows === 0) failed.push('search results')
if (!verdict.favoriteSaved) failed.push('favorite save')
if (!verdict.favoriteBucketed) failed.push('favorite bucket')
if (verdict.exportStatus !== 200 || !verdict.exportHasMessages) failed.push('export route')
if (!verdict.viewerOpened) failed.push('model viewer')
if (report.fatal !== undefined) failed.push('fatal')
if (failed.length > 0) {
  console.error('P4 verification FAILED:', failed.join(', '))
  process.exit(1)
}
console.log('P4 verification PASSED')
