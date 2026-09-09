/**
 * P0 browser probe: drive the isolated Harness instance with headless Chrome and
 * collect first-hand DOM + console evidence for the three P0 probes.
 *
 * Usage:
 *   node scripts/probe-browser.mjs --url "http://127.0.0.1:3081/?token=..." [--out .dsh-test/probe]
 *
 * Exits non-zero when a probe reports a failure, so it can serve as an
 * acceptance assertion (SPEC §8 代理自验).
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
const outDir = resolve(argOf('--out', '.dsh-test/probe'))
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

const consoleLines = []
const pageErrors = []
page.on('console', (message) => {
  consoleLines.push({ type: message.type(), text: message.text() })
})
page.on('pageerror', (error) => {
  pageErrors.push({ message: error.message, stack: error.stack })
})

const report = { url: url.replace(/token=[^&]*/, 'token=<redacted>'), startedAt: new Date().toISOString() }

try {
  // The launch token is consumed by a 303 to a clean `/`, which DROPS extra
  // query parameters. Mint the cookie first, then navigate again so
  // `?rhine-probe=1` actually reaches the page.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const probeUrl = new URL(url)
  probeUrl.search = '?rhine-probe=1'
  await page.goto(probeUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // Wait for the client half to publish its probe report.
  await page.waitForFunction(() => {
    const probe = globalThis.__RHINE_PROBE__
    return probe !== undefined && probe.probeC !== null
  }, null, { timeout: 60000 })

  // Let React commit the slot entry.
  await page.waitForTimeout(1500)

  report.boot = await page.evaluate(() => {
    const boot = globalThis.__DSH_BOOT__
    return {
      hasBoot: boot !== undefined,
      rev: boot?.rev ?? null,
      entries: Array.isArray(boot?.entries) ? boot.entries.map((entry) => entry.id ?? entry.name ?? String(entry)) : null,
      pluginRows: Array.isArray(boot?.plugins) ? boot.plugins.map((p) => ({ id: p.id, immediately: p.immediately ?? null })) : null,
      moduleLoader: typeof globalThis.__ModuleLoader__,
    }
  })

  report.probe = await page.evaluate(() => globalThis.__RHINE_PROBE__)

  report.dom = await page.evaluate(() => {
    const layer = document.getElementById('rhinelab-ui-root')
    const rect = layer?.getBoundingClientRect()
    const slotEntry = document.getElementById('rhinelab-ui-probe-b')
    return {
      layerPresent: layer !== null,
      layerRect: rect === undefined ? null : { width: Math.round(rect.width), height: Math.round(rect.height) },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      layerZIndex: layer === null ? null : getComputedStyle(layer).zIndex,
      slotEntryPresent: slotEntry !== null,
      slotEntryText: slotEntry?.textContent ?? null,
      styleTagPresent: document.getElementById('rhinelab-ui-style') !== null,
      bodyChildren: [...document.body.children].map((el) => ({ tag: el.tagName.toLowerCase(), id: el.id || null })),
      rootChildren: document.querySelector('#root')?.children.length ?? null,
      title: document.title,
    }
  })

  await page.screenshot({ path: resolve(outDir, 'probe-a-mounted.png'), fullPage: false })

  // Probe A removal: the disposer must remove exactly its own layer + style tag
  // and leave the native shell intact (hard constraint 3: uninstall = restore).
  report.removal = await page.evaluate(async () => {
    const before = {
      bodyChildren: document.body.children.length,
      styleTags: document.head.querySelectorAll('style').length,
      rootChildren: document.querySelector('#root')?.children.length ?? null,
    }
    globalThis.__RHINE_PROBE__.unmountA()
    globalThis.__RHINE_PROBE__.unmountB()
    await new Promise((resolve) => setTimeout(resolve, 300))
    const after = {
      bodyChildren: document.body.children.length,
      styleTags: document.head.querySelectorAll('style').length,
      rootChildren: document.querySelector('#root')?.children.length ?? null,
      layerPresent: document.getElementById('rhinelab-ui-root') !== null,
      stylePresent: document.getElementById('rhinelab-ui-style') !== null,
      slotEntryPresent: document.getElementById('rhinelab-ui-probe-b') !== null,
    }
    return {
      before,
      after,
      // Exactly our own layer and our own style tag disappear; the shell is untouched.
      restored:
        after.layerPresent === false &&
        after.stylePresent === false &&
        after.slotEntryPresent === false &&
        after.bodyChildren === before.bodyChildren - 1 &&
        after.styleTags === before.styleTags - 1 &&
        after.rootChildren === before.rootChildren,
      probeUnmounted: globalThis.__RHINE_PROBE__.probeA?.unmounted ?? null,
    }
  })

  await page.waitForTimeout(500)
  await page.screenshot({ path: resolve(outDir, 'probe-a-removed.png'), fullPage: false })

  report.consoleLines = consoleLines
  report.pageErrors = pageErrors
  report.finishedAt = new Date().toISOString()
} catch (error) {
  report.fatal = { message: String(error), stack: error.stack }
  report.consoleLines = consoleLines
  report.pageErrors = pageErrors
  try {
    await page.screenshot({ path: resolve(outDir, 'probe-fatal.png') })
  } catch {
    /* ignore */
  }
} finally {
  await browser.close()
}

writeFileSync(resolve(outDir, 'probe-report.json'), JSON.stringify(report, null, 2))

const probe = report.probe ?? {}
const verdict = {
  probeA: Boolean(probe.probeA?.coverage?.coversViewport),
  probeA_Restore: Boolean(report.removal?.restored) && report.removal?.after?.layerPresent === false,
  probeB_Registered: Boolean(probe.probeB?.registered),
  probeB_Rendered: Boolean(report.dom?.slotEntryPresent),
  probeB_Sessions: probe.probeB?.sessionTotal ?? probe.probeB?.total ?? null,
  probeC_Ok: Boolean(probe.probeC?.ok),
  probeC_Count: probe.probeC?.count ?? null,
  pageErrors: (report.pageErrors ?? []).length,
  rhineConsoleLines: (report.consoleLines ?? []).filter((line) => line.text.includes('[RHINE-')).length,
}
console.log(JSON.stringify({ verdict, reportFile: resolve(outDir, 'probe-report.json') }, null, 2))

const failed = []
if (!verdict.probeA) failed.push('probeA coverage')
if (!verdict.probeA_Restore) failed.push('probeA restore')
if (!verdict.probeB_Registered) failed.push('probeB register')
if (!verdict.probeB_Rendered) failed.push('probeB render')
if (!verdict.probeC_Ok) failed.push('probeC fetch')
if (report.fatal !== undefined) failed.push('fatal')
if (failed.length > 0) {
  console.error('P0 browser probe FAILED:', failed.join(', '))
  process.exit(1)
}
console.log('P0 browser probe PASSED')
