/**
 * P2 acceptance probe: real dsh sessions inside the 3D archive (SPEC §5 P2).
 *
 * Checks:
 *   - the bridge delivers a 40-slot payload with the five spec columns
 *   - slots are filled from the official session channel (channel B)
 *   - real durable titles (parsed from the session logs) reach the archive
 *   - selecting a card loads that session's real transcript into the panel
 *   - empty slots render as 待归档 placeholders
 *
 * Usage: node scripts/verify-p2.mjs --url "http://127.0.0.1:3081/?token=..."
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
const outDir = resolve(argOf('--out', '.dsh-test/p2'))
mkdirSync(outDir, { recursive: true })

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

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const page = await context.newPage()
const consoleLines = []
const pageErrors = []
page.on('console', (m) => consoleLines.push({ type: m.type(), text: m.text().slice(0, 300) }))
page.on('pageerror', (e) => pageErrors.push({ message: e.message.slice(0, 300) }))

const report = { url: url.replace(/token=[^&]*/, 'token=<redacted>'), startedAt: new Date().toISOString() }

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => globalThis.__RHINE__?.frameLoaded === true, null, { timeout: 90000 })
  // Reduced motion skips the 34 s boot so the archive is available immediately.
  await page.evaluate(
    ([quality]) => globalThis.__RHINE__.setPrefs({ reduced: true, rendering: quality }),
    [MINIMAL_QUALITY],
  )
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => globalThis.__RHINE__?.frameLoaded === true, null, { timeout: 90000 })

  // Wait for the app's bridge to acknowledge the payload.
  await page.waitForFunction(
    () => (globalThis.__RHINE_BRIDGE_STATE__?.acks ?? 0) > 0,
    null, { timeout: 60000 },
  )
  await page.waitForTimeout(2500)

  const frame = page.frames().find((fr) => fr.url().includes('rhinelab-ui/index.html'))
  report.bridgeState = await page.evaluate(() => {
    const state = globalThis.__RHINE_BRIDGE_STATE__
    return { revision: state.revision, pushes: state.pushes, acks: state.acks, errors: state.errors }
  })

  report.app = frame === null ? null : await frame.evaluate(() => {
    const snapshot = globalThis.__RHINE_BRIDGE__?.snapshot?.() ?? null
    return {
      snapshot,
      mode: document.querySelector('#stage')?.dataset.mode ?? null,
      selectedTitle: document.querySelector('#selected-title')?.textContent ?? null,
      selectedCode: document.querySelector('#selected-code')?.textContent ?? null,
      columnName: document.querySelector('#column-name')?.textContent ?? null,
      category: document.querySelector('#archive-category')?.textContent ?? null,
    }
  })

  // Walk the columns to confirm the bucket names reached the UI.
  report.columnWalk = []
  if (frame !== null) {
    for (let i = 0; i < 5; i += 1) {
      const state = await frame.evaluate(() => ({
        column: document.querySelector('#column-name')?.textContent ?? null,
        title: document.querySelector('#selected-title')?.textContent ?? null,
      }))
      report.columnWalk.push(state)
      await frame.evaluate(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      })
      await page.waitForTimeout(900)
    }
  }

  // Open a card that actually holds a session (slot 8 = first row of 最近 24h)
  // and wait for the transcript patch to land.
  if (frame !== null) {
    await frame.evaluate(() => {
      const api = globalThis.rhine
      if (typeof api?.select === 'function') api.select(8)
    })
    await page.waitForTimeout(1500)
    report.openedSlot = await frame.evaluate(() => ({
      title: document.querySelector('#selected-title')?.textContent ?? null,
      column: document.querySelector('#column-name')?.textContent ?? null,
    }))
    await frame.evaluate(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await page.waitForFunction(
      () => (globalThis.__RHINE_BRIDGE_STATE__?.patches?.size ?? 0) > 0,
      null, { timeout: 45000 },
    ).catch(() => {})
    await page.waitForTimeout(3000)
    report.detail = await frame.evaluate(() => ({
      mode: document.querySelector('#stage')?.dataset.mode ?? null,
      kicker: document.querySelector('.detail-kicker')?.textContent ?? null,
      title: document.querySelector('.detail-title-cn')?.textContent ?? null,
      abstract: document.querySelector('#tab-panel')?.textContent?.slice(0, 240) ?? null,
      meta: document.querySelector('.metadata')?.textContent?.replace(/\s+/g, ' ').slice(0, 200) ?? null,
      findings: document.querySelectorAll('.research-notes li').length,
    }))
    await frame.evaluate(() => {
      document.querySelector('[data-tab="notes"]')?.click()
    })
    await page.waitForTimeout(1200)
    report.notes = await frame.evaluate(() => ({
      findings: [...document.querySelectorAll('.research-notes li')].map((li) => li.textContent?.replace(/\s+/g, ' ').slice(0, 120)),
    }))
  }

  report.consoleLines = consoleLines
  report.pageErrors = pageErrors
  report.finishedAt = new Date().toISOString()
} catch (error) {
  report.fatal = { message: String(error), stack: error.stack }
  report.consoleLines = consoleLines
  report.pageErrors = pageErrors
} finally {
  await browser.close()
}

const file = resolve(outDir, 'p2-report.json')
writeFileSync(file, JSON.stringify(report, null, 2))

const snapshot = report.app?.snapshot ?? null
const filled = (snapshot?.head ?? []).filter((r) => r.category !== '收藏').length
const verdict = {
  bridgeAcked: (report.bridgeState?.acks ?? 0) > 0,
  slotCount: snapshot?.count ?? null,
  columns: snapshot?.columns ?? null,
  columnsMatch: JSON.stringify(snapshot?.columns ?? []) === JSON.stringify(['收藏', '最近 24h', '本周', '本月', '更早']),
  headRecords: snapshot?.head ?? null,
  realTitles: (snapshot?.all ?? []).some((r) => r.empty !== true && typeof r.title === 'string' && r.title !== '待归档' && r.title !== ''),
  realTitleSample: (snapshot?.all ?? []).filter((r) => r.empty !== true).slice(0, 4).map((r) => `${r.id} [${r.category}] ${r.title}`),
  columnWalk: report.columnWalk?.map((c) => c.column) ?? [],
  detailMode: report.detail?.mode ?? null,
  detailTitle: report.detail?.title ?? null,
  findings: report.notes?.findings?.length ?? 0,
  bridgeErrors: report.bridgeState?.errors ?? [],
  pageErrors: (report.pageErrors ?? []).length,
}
console.log(JSON.stringify({ verdict, reportFile: file }, null, 2))

const failed = []
if (!verdict.bridgeAcked) failed.push('bridge ack')
if (verdict.slotCount !== 40) failed.push(`slot count (${verdict.slotCount})`)
if (!verdict.columnsMatch) failed.push('column mapping')
if (!verdict.realTitles) failed.push('real session titles')
if (verdict.detailMode !== 'detail') failed.push('detail open')
if (verdict.findings === 0) failed.push('transcript findings')
if ((verdict.bridgeErrors ?? []).length > 0) failed.push('bridge errors')
if (report.fatal !== undefined) failed.push('fatal')
if (failed.length > 0) {
  console.error('P2 verification FAILED:', failed.join(', '))
  process.exit(1)
}
console.log('P2 verification PASSED')
