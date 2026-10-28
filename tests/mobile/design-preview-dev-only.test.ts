// The design mock-ups (apps/mobile/src/design/preview, route app/design-preview.tsx) are DEV ONLY: a store build cannot reach them.
//
//   bun run tests/mobile/design-preview-dev-only.test.ts            static checks
//   PHONE_EXPORT_DIR=<dir of `expo export --platform android`> bun run tests/mobile/design-preview-dev-only.test.ts   + the built bundle
//
// Proof in three layers: the route loads the preview only inside `if (__DEV__)` and by require() (so a production build drops it);
// nothing else in the app imports the preview folder; and — when an export is given — the exported bundle contains none of the
// preview's marker or sample names.
import fs from 'node:fs'
import path from 'node:path'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)) }
}
const root = path.resolve(import.meta.dir, '../../apps/mobile')
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

const route = noComments(read('app/design-preview.tsx'))
check('the route exists', fs.existsSync(path.join(root, 'app/design-preview.tsx')))
check('it loads the preview with require(), not an import', /require\(['"]\.\.\/src\/design\/preview\/PreviewApp['"]\)/.test(route) && !/^import .*design\/preview/m.test(route))
{
  const i = route.indexOf('if (__DEV__)'), j = route.indexOf("require('../src/design/preview/PreviewApp')"), k = route.indexOf('<Redirect')
  check('the require sits inside `if (__DEV__) {…}` and the fallback is a redirect home', i >= 0 && j > i && k > j && /if \(__DEV__\) \{[\s\S]*require[\s\S]*\}\s*return <Redirect/.test(route))
}
check('the root layout only skips sign-in for the preview behind __DEV__', /if \(__DEV__ && segments\[0\] === 'design-preview'\) return/.test(noComments(read('app/_layout.tsx'))))

// Nothing else reaches the preview.
const files: string[] = []
const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|js)$/.test(e.name)) files.push(p) } }
walk(path.join(root, 'app')); walk(path.join(root, 'src'))
const outside = files.filter((f) => !f.includes(path.join('src', 'design', 'preview')) && !f.endsWith(path.join('app', 'design-preview.tsx')) && !f.endsWith(path.join('app', '_layout.tsx'))).filter((f) => /design\/preview|design-preview/.test(noComments(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(root, f))
check('no other file imports or names the preview', outside.length === 0, outside)
const designCore = files.filter((f) => f.includes(path.join('src', 'design')) && !f.includes(path.join('design', 'preview')))
check('the design system itself does not import the preview', designCore.every((f) => !/\/preview/.test(noComments(fs.readFileSync(f, 'utf8')))), designCore.filter((f) => /\/preview/.test(fs.readFileSync(f, 'utf8'))))
check('the preview data carries the marker the bundle check looks for', /TWOMIAH-DESIGN-PREVIEW-DO-NOT-SHIP/.test(read('src/design/preview/sample.ts')))

// The built bundle, when given one.
const dir = process.env.PHONE_EXPORT_DIR
if (dir) {
  const bundles: string[] = []
  const w = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) w(p); else if (/\.(js|hbc)$/.test(e.name)) bundles.push(p) } }
  w(dir)
  check(`an exported bundle was found in ${dir}`, bundles.length > 0, bundles)
  const hits = bundles.filter((b) => { const s = fs.readFileSync(b).toString('latin1'); return ['TWOMIAH-DESIGN-PREVIEW-DO-NOT-SHIP', 'Sample Builders Co.', 'Placeholder Home Care'].some((m) => s.includes(m)) })
  check('the production bundle contains none of the preview (marker, sample company names)', hits.length === 0, hits)
} else console.log('  (no PHONE_EXPORT_DIR: bundle check skipped — run with an `expo export --platform android` folder)')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
