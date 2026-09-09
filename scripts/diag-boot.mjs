/**
 * Boot-manifest diagnostic: dump `window.__DSH_BOOT__`, the client plugin rows,
 * and every console/page error, without waiting for the probe report.
 *
 * Usage: node scripts/diag-boot.mjs --url "http://127.0.0.1:3081/?token=..."
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
const label = argOf('--label', 'diag')
const outDir = resolve('.dsh-test/diag')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleLines = []
const pageErrors = []
const requests = []
page.on('console', (m) => consoleLines.push({ type: m.type(), text: m.text() }))
page.on('pageerror', (e) => pageErrors.push({ message: e.message }))
page.on('request', (r) => {
  const u = r.url()
  if (u.includes('/plugins/')) requests.push(u)
})

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(12000)

const boot = await page.evaluate(() => {
  const b = globalThis.__DSH_BOOT__
  return {
    rev: b?.rev ?? null,
    entryCount: Array.isArray(b?.entries) ? b.entries.length : null,
    entries: Array.isArray(b?.entries) ? b.entries.map((e) => e.id ?? e.name ?? null) : null,
    pluginCount: Array.isArray(b?.plugins) ? b.plugins.length : null,
    plugins: Array.isArray(b?.plugins) ? b.plugins.map((p) => p.id) : null,
    batchCount: Array.isArray(b?.batches) ? b.batches.length : null,
    batches: Array.isArray(b?.batches) ? b.batches.map((batch) => (Array.isArray(batch) ? batch.length : Object.keys(batch ?? {}).length)) : null,
    raw: JSON.stringify(b).slice(0, 4000),
  }
})

const dom = await page.evaluate(() => ({
  probePresent: globalThis.__RHINE_PROBE__ !== undefined,
  probe: globalThis.__RHINE_PROBE__ ?? null,
  bootCardText: document.body.innerText.slice(0, 400),
}))

const out = { label, boot, dom, consoleLines, pageErrors, requests }
writeFileSync(resolve(outDir, `boot-${label}.json`), JSON.stringify(out, null, 2))

/** Count module ids repeated inside one batch URL. */
const batchReport = requests.map((u) => {
  const query = u.split('??')[1] ?? ''
  const ids = query.split(',').map((s) => s.split('/client.js')[0]).filter(Boolean)
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  return { length: ids.length, duplicates: [...new Set(dupes)] }
})

console.log(JSON.stringify({
  label,
  rev: boot.rev,
  entryCount: boot.entryCount,
  pluginCount: boot.pluginCount,
  plugins: boot.plugins,
  duplicatePluginIds: (boot.plugins ?? []).filter((id, i, arr) => arr.indexOf(id) !== i),
  rhineEntries: (boot.entries ?? []).filter((id) => String(id).includes('rhinelab')),
  probePresent: dom.probePresent,
  pageErrors: pageErrors.map((e) => e.message).slice(0, 5),
  rhineConsole: consoleLines.filter((l) => l.text.includes('[RHINE-')).slice(0, 5),
  pluginRequests: batchReport,
}, null, 2))

await browser.close()
