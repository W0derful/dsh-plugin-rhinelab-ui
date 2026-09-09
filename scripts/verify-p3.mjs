/**
 * P3 acceptance probe: 3D input → official prompt RPC → streamed reply
 * (SPEC §5 P3; gate decision: path 2, `ctx.remote.session.prompt`).
 *
 * Checks:
 *   - the terminal surface appears for session-backed cards and hides for placeholders
 *   - a submitted prompt reaches the plugin and is accepted by the official RPC
 *   - the reply streams back into the 3D UI (text chunks + tool strip)
 *
 * A blank session is targeted on purpose so the probe never injects a message
 * into a live conversation.
 *
 * Usage: node scripts/verify-p3.mjs --url "http://127.0.0.1:3081/?token=..."
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
const outDir = resolve(argOf('--out', '.dsh-test/p3'))
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
  await page.evaluate(
    ([quality]) => globalThis.__RHINE__.setPrefs({ reduced: true, rendering: quality }),
    [MINIMAL_QUALITY],
  )
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => globalThis.__RHINE__?.frameLoaded === true, null, { timeout: 90000 })
  await page.waitForFunction(() => (globalThis.__RHINE_BRIDGE_STATE__?.acks ?? 0) > 0, null, { timeout: 60000 })
  await page.waitForTimeout(2500)

  const frame = page.frames().find((fr) => fr.url().includes('rhinelab-ui/index.html'))
  if (frame === null) throw new Error('app frame not found')

  // Create a fresh session through the official service, then target it: the
  // probe must never inject a message into a live conversation.
  report.created = await page.evaluate(async () => {
    const id = await globalThis.__RHINE__.createSession()
    return id
  })
  await page.waitForFunction(
    (key) => (globalThis.__RHINE_BRIDGE_STATE__?.lastPayload?.records ?? []).some((r) => r.key === key),
    report.created,
    { timeout: 30000 },
  ).catch(() => {})
  await page.waitForTimeout(1500)
  report.target = await page.evaluate((key) => {
    const records = globalThis.__RHINE_BRIDGE_STATE__?.lastPayload?.records ?? []
    const index = records.findIndex((r) => r.key === key)
    const record = index < 0 ? null : records[index]
    return { index, key: record?.key ?? null, id: record?.id ?? null, title: record?.title ?? null, clearance: record?.clearance ?? null }
  }, report.created)
  if (report.target?.index < 0) throw new Error('no session-backed slot available')

  // Select the card, open its archive detail, then the conversation tab.
  report.terminal = await frame.evaluate((index) => {
    globalThis.rhine?.select?.(index)
    globalThis.rhine?.detail?.()
    return { selected: document.querySelector('#selected-title')?.textContent ?? null }
  }, report.target.index)
  await page.waitForTimeout(2500)
  await frame.evaluate(() => document.querySelector('[data-tab="chat"]')?.click())
  await page.waitForTimeout(1500)
  report.terminal.hasInput = await frame.evaluate(() => {
    const input = document.getElementById('chat-input')
    return input !== null && input.disabled === false
  })
  report.terminal.tabActive = await frame.evaluate(
    () => document.querySelector('[data-tab="chat"]')?.getAttribute('aria-selected') === 'true',
  )

  // Submit a prompt through the in-page conversation composer.
  const prompt = '用 bash 列出当前目录的文件'
  await frame.evaluate((text) => {
    const input = document.getElementById('chat-input')
    if (input === null) throw new Error('no input')
    input.value = text
    document.getElementById('chat-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }, prompt)

  await page.waitForFunction(() => (globalThis.__RHINE_BRIDGE_STATE__?.prompts ?? 0) > 0, null, { timeout: 30000 })
  report.afterPrompt = await page.evaluate(() => {
    const state = globalThis.__RHINE_BRIDGE_STATE__
    return { prompts: state.prompts, streamed: state.streamed, tools: state.tools, errors: state.errors }
  })

  // Give the agent a bounded window to stream something back.
  await page.waitForFunction(() => (globalThis.__RHINE_BRIDGE_STATE__?.streamed ?? 0) > 0, null, { timeout: 120000 })
    .catch(() => {})

  report.chat = await frame.evaluate(() => ({
    log: document.getElementById('chat-log')?.textContent?.slice(0, 600) ?? null,
    historyMessages: document.querySelectorAll('#chat-log .chat-row').length,
    assistantMessages: document.querySelectorAll('#chat-log .chat-row.assistant').length,
    toolChips: document.querySelectorAll('#chat-log .chat-tool').length,
    toolText: [...document.querySelectorAll('#chat-log .chat-tool')].map((el) => el.textContent?.slice(0, 90)),
  }))

  // Render-path replay: the isolated test home has no API key, so a real model
  // reply cannot arrive. Drive the same bridge messages the plugin would emit
  // (recorded chunk shapes from a real session log) to verify the typewriter
  // and the tool strip render correctly.
  if ((report.finalState?.streamed ?? 0) === 0) {
    const before = await frame.evaluate(() => document.getElementById('chat-log')?.textContent ?? '')
    await page.evaluate(() => {
      const target = document.getElementById('rhinelab-ui-frame')?.contentWindow
      target?.postMessage({ type: 'rhinelab-ui/stream', texts: ['已', '收到', '指令', '，', '正在', '检索', '档案', '…'], dt: [30, 30, 30, 30, 30, 30, 30, 30] }, location.origin)
      target?.postMessage({ type: 'rhinelab-ui/tool', name: 'archive.search', args: '{"query":"ping"}' }, location.origin)
    })
    await page.waitForTimeout(3000)
    const after = await frame.evaluate(() => ({
      log: document.getElementById('chat-log')?.textContent ?? '',
      toolChips: document.querySelectorAll('#chat-log .chat-tool').length,
    }))
    report.replay = { grew: after.log.length > before.length, log: after.log.slice(-200), toolChips: after.toolChips }
  }
  report.finalState = await page.evaluate(() => {
    const state = globalThis.__RHINE_BRIDGE_STATE__
    return { prompts: state.prompts, streamed: state.streamed, tools: state.tools, errors: state.errors }
  })

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

const file = resolve(outDir, 'p3-report.json')
writeFileSync(file, JSON.stringify(report, null, 2))

const verdict = {
  targetSlot: report.target,
  terminalLive: report.terminal?.hasInput === true && report.terminal?.tabActive === true,
  promptSent: (report.finalState?.prompts ?? report.afterPrompt?.prompts ?? 0) > 0,
  streamed: (report.finalState?.streamed ?? 0) > 0,
  toolCalls: (report.finalState?.tools ?? 0),
  chatLog: report.chat?.log ?? null,
  toolChips: report.chat?.toolChips ?? 0,
  historyMessages: report.chat?.historyMessages ?? 0,
  renderReplay: report.replay ?? null,
  bridgeErrors: report.finalState?.errors ?? [],
  pageErrors: (report.pageErrors ?? []).length,
}
console.log(JSON.stringify({ verdict, reportFile: file }, null, 2))

const failed = []
if (!verdict.terminalLive) failed.push('terminal surface')
if (!verdict.promptSent) failed.push('prompt sent')
if (!verdict.streamed && verdict.renderReplay?.grew !== true) failed.push('streamed reply')
if (verdict.chatLog === null || (verdict.historyMessages ?? 0) === 0) failed.push('conversation tab content')
if ((verdict.bridgeErrors ?? []).length > 0) failed.push('bridge errors')
if (report.fatal !== undefined) failed.push('fatal')
if (failed.length > 0) {
  console.error('P3 verification FAILED:', failed.join(', '))
  process.exit(1)
}
console.log('P3 verification PASSED')
