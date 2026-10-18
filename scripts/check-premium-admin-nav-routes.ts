// CI guard: every item in a premium website admin's sidebar opens its page.
//
// The Email item (AdminLayout NAV { to: '/email' }) shipped on 08/07 with EmailPage.tsx but no
// <Route path="/email"> in App.tsx; on 09/08 the "unrouted" page was deleted as an orphan and the
// nav item stayed. For two months the owner's click on Email landed on Pages — App.tsx's catch-all
// (<Route path="*" element={<Navigate to="/pages" />}>) turns a missing route into a silent redirect,
// so nothing ever errored. This holds every NAV `to:` in every premium AdminLayout to:
//   1. a <Route path> with exactly that path in the same template's App.tsx,
//   2. which renders a page, not a <Navigate> (a redirect is the same silent bounce),
//   3. whose component is imported from a file that exists and exports it.
// One template is one door: the walk covers every templates/website-premium-* directory.
//   bun scripts/check-premium-admin-nav-routes.ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { stripSource as strip } from './lib/stripComments.ts'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0, checked = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const templates = readdirSync(join(ROOT, 'templates')).filter((n) => n.startsWith('website-premium-')).sort()
for (const t of templates) {
  const base = `templates/${t}/admin/src`
  const layoutPath = join(ROOT, base, 'components/AdminLayout.tsx')
  const appPath = join(ROOT, base, 'App.tsx')
  if (!existsSync(layoutPath) || !existsSync(appPath)) { fail(`${t}: admin/src/components/AdminLayout.tsx or admin/src/App.tsx is missing — this walk expects every premium template to have both`); continue }
  const layout = strip(readFileSync(layoutPath, 'utf8'))
  const app = strip(readFileSync(appPath, 'utf8'))

  const nav = layout.match(/const NAV\b[^=]*=\s*\[([\s\S]*?)\n\]/)?.[1]
  if (!nav) { fail(`${t}: AdminLayout.tsx has no \`const NAV = [ … ]\` — the sidebar moved; re-point this guard`); continue }
  const tos = [...nav.matchAll(/\bto:\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2])
  const items = (nav.match(/\{\s*to:/g) || []).length
  if (tos.length !== items) fail(`${t}: ${items} NAV items but ${tos.length} literal \`to:\` paths — a computed path cannot be checked; keep them literal`)
  if (tos.length < 10) fail(`${t}: only ${tos.length} NAV items found — the sidebar or this parse broke`)

  const routes = new Map<string, string>()
  for (const m of app.matchAll(/<Route\s+path=(['"])([^'"]+)\1\s+element=\{([\s\S]*?)\}\s*\/>/g)) routes.set(m[2], m[3])

  for (const to of tos) {
    checked++
    const element = routes.get(to)
    if (element === undefined) { fail(`${t}: NAV item '${to}' has no <Route path="${to}"> in App.tsx — the catch-all silently sends the owner elsewhere`); continue }
    if (/<Navigate\b/.test(element)) { fail(`${t}: NAV item '${to}' routes to a <Navigate> — a redirect, not a page`); continue }
    const comp = element.match(/<([A-Z]\w*)/)?.[1]
    if (!comp) { fail(`${t}: <Route path="${to}"> renders no component`); continue }
    const from = app.match(new RegExp(`import\\s*\\{[^}]*\\b${comp}\\b[^}]*\\}\\s*from\\s*['"](\\.[^'"]+)['"]`))?.[1]
    if (!from) { fail(`${t}: <Route path="${to}"> renders ${comp}, which App.tsx does not import`); continue }
    const file = ['.tsx', '.ts'].map((ext) => join(ROOT, base, from + ext)).find(existsSync)
    if (!file) { fail(`${t}: ${comp} is imported from '${from}', which does not exist`); continue }
    if (!new RegExp(`export\\s+(function|const)\\s+${comp}\\b`).test(strip(readFileSync(file, 'utf8')))) fail(`${t}: ${file.replace(ROOT, '')} does not export ${comp}`)
  }
}
if (templates.length < 11) fail(`expected all 11 premium templates, found ${templates.length} — a template was removed or this walk broke`)

if (failed) { console.error(`\npremium admin nav → routes: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`premium admin nav → routes: ${checked} sidebar items across ${templates.length} templates each open a routed, imported page`)
