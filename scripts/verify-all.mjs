/**
 * Run every acceptance probe against one isolated dsh instance and aggregate
 * the verdicts (SPEC §8 代理自验).
 *
 * Usage:
 *   node scripts/verify-all.mjs --url "http://127.0.0.1:3081/?token=..."
 *
 * Each probe is an independent process so one environment crash (software
 * WebGL is fragile in containers) cannot hide the other results.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argv = process.argv.slice(2)
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const url = argOf('--url', '')
if (url === '') {
  console.error('missing --url "http://127.0.0.1:3081/?token=..."')
  process.exit(2)
}
const outDir = resolve(argOf('--out', '.dsh-test/verify-all'))
mkdirSync(outDir, { recursive: true })

/** Probes in dependency order; P0 runs in probe-only mode. */
const PROBES = [
  { name: 'P0 三探针', script: 'scripts/probe-browser.mjs', args: ['--url', url] },
  { name: 'P1 接管与资产', script: 'scripts/verify-p1.mjs', args: ['--url', url, '--pass', 'archive'] },
  { name: 'P2 数据桥', script: 'scripts/verify-p2.mjs', args: ['--url', url] },
  { name: 'P3 输入与流式', script: 'scripts/verify-p3.mjs', args: ['--url', url] },
  { name: 'P4 检索/收藏/导出/查看器', script: 'scripts/verify-p4.mjs', args: ['--url', url] },
  { name: '低配 2D 降级', script: 'scripts/verify-2d.mjs', args: ['--url', url] },
]

/**
 * Run one probe and capture its verdict.
 * @param probe - probe descriptor.
 * @returns result row.
 */
function run(probe) {
  return new Promise((done) => {
    const started = Date.now()
    const child = spawn(process.execPath, [probe.script, ...probe.args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => {
      let verdict = null
      try {
        const start = stdout.indexOf('{')
        verdict = start < 0 ? null : JSON.parse(stdout.slice(start))
      } catch {
        verdict = null
      }
      done({
        name: probe.name,
        script: probe.script,
        code,
        passed: code === 0,
        ms: Date.now() - started,
        verdict: verdict?.verdict ?? null,
        tail: stderr.trim().split('\n').slice(-3).join(' | '),
      })
    })
  })
}

const results = []
for (const probe of PROBES) {
  process.stderr.write(`[verify-all] ${probe.name} …\n`)
  // eslint-disable-next-line no-await-in-loop -- sequential keeps one browser at a time
  results.push(await run(probe))
}

const summary = {
  at: new Date().toISOString(),
  url: url.replace(/token=[^&]*/, 'token=<redacted>'),
  passed: results.filter((r) => r.passed).length,
  total: results.length,
  results,
}
writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 2))

console.log(JSON.stringify({ passed: `${summary.passed}/${summary.total}`, results: results.map((r) => ({ name: r.name, passed: r.passed, ms: r.ms, tail: r.passed ? undefined : r.tail })) }, null, 2))

if (summary.passed !== summary.total) {
  console.error('ACCEPTANCE FAILED')
  process.exit(1)
}
console.log('ALL ACCEPTANCE PROBES PASSED')
