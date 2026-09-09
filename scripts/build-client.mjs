/**
 * Bundle src/client/index.cjs into plugin/client.js.
 *
 * The output must be a browser bundle that registers itself with the Harness
 * client module loader, exactly like the verified reference implementation
 * (see SPEC-DEVIATIONS.md D-3): the bundle is a lazy CJS factory that receives
 * the loader's `require`, so React and every other platform seed word stay
 * external and shared with the shell.
 *
 * Usage:
 *   node scripts/build-client.mjs           build
 *   node scripts/build-client.mjs --check   fail when the output is stale
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, 'src/client/index.cjs')
const target = resolve(root, 'plugin/client.js')
const check = process.argv.includes('--check')
/**
 * Bundle id MUST equal the package name: the client module loader keys graph
 * rows by package name and treats `factories.has(row.id)` as "already arrived".
 * A mismatched id makes the row look unloaded, so the loader re-fetches the
 * whole batch and every bundle executes twice — the second `register()` throws
 * `duplicate factory registration`. Verified against the shell in P0
 * (see SPEC-DEVIATIONS.md D-10).
 */
const PACKAGE_ID = 'dsh-plugin-rhinelab-ui'

/** Platform seed words supplied by the shell; never bundled. */
const EXTERNAL = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  external: EXTERNAL,
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
})

const bundled = result.outputFiles[0].text
const banner = `// GENERATED from src/client/index.cjs by scripts/build-client.mjs — do not edit.\n`
const output = `${banner}window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {\n\tvar module = { exports: {} };\n\tvar exports = module.exports;\n${bundled}\n\treturn module.exports;\n}});\n`

if (check) {
  let current = ''
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    current = ''
  }
  if (current !== output) {
    console.error('plugin/client.js is stale; run: npm run build')
    process.exit(1)
  }
  console.log('plugin/client.js is up to date.')
} else {
  writeFileSync(target, output)
  console.log(`plugin/client.js written (${output.length} bytes).`)
}
