/**
 * GUARD #209 — a link that carries a query parameter must land on a screen that reads it.
 *
 * T51, contractor: "View All ignores the project."
 *
 * ProjectDetailPage has linked to `/crm/change-orders?projectId=<id>` since the panel was written,
 * and ChangeOrdersPage never called useSearchParams. So View All showed every change order in the
 * company — the one list it could not give you was the project you had clicked out of. The same
 * omission was on the Jobs panel and the RFIs panel beside it, and the five "Create X" quick actions
 * all sent `&new=true` to pages that ignored it, so each of those links did nothing whatsoever.
 *
 * Every one of those parameters was already supported by the API. The links were right and the
 * screens never asked, which is exactly the shape nothing catches: no error, no 404, no console
 * warning — just the wrong list, and a reader who assumes a short list means little work.
 *
 * WHAT THIS CHECKS
 *   For every `<Link to="/path?x=…">` and `navigate('/path?x=…')` in a template's frontend and in
 *   packages/tenant-ui, resolve the destination through that template's App.tsx route table and
 *   require the destination component to read `x` — `searchParams.get('x')` or any `.get('x')` off a
 *   URLSearchParams. A thin template page that delegates to packages/tenant-ui is followed one hop,
 *   because that is where most of these screens actually live.
 *
 * WHAT IT DOES NOT CHECK
 *   Targets built from a variable, external URLs, and hash-only links — there is nothing static to
 *   resolve. A route this walk cannot resolve is reported as unresolved and fails, rather than
 *   passing quietly: an allow-list that excuses a file is how #201 stayed green over a live token
 *   leak.
 */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = process.argv[2] || process.cwd()
const TEMPLATES_DIR = path.join(ROOT, 'templates')
const SHARED_DIR = path.join(ROOT, 'packages', 'tenant-ui', 'src')

/** Parked; not generated for any tenant. */
const SKIP_TEMPLATES = new Set(['crm-automotive'])

/**
 * Parameters a destination is NOT required to read, with the reason. Each is a parameter whose
 * meaning is entirely on the SENDING side — not a screen that was let off.
 */
const NOT_A_DESTINATION_CONCERN: Record<string, string> = {
  // The portal's own bearer token: read by the api client / route guard, not by a page.
  token: 'carried for the API client, not a screen',
  // Set by the shell to force a reload past the service worker.
  v: 'cache-buster',
}

const read = (f: string) => { try { return fs.readFileSync(f, 'utf8') } catch { return '' } }
const exists = (f: string) => { try { return fs.statSync(f).isFile() } catch { return false } }

/** Files that make up one screen: the file itself, plus a shared page it delegates to. */
function screenSources(file: string): string[] {
  const src = read(file)
  if (!src) return []
  const out = [src]
  // import { XPage as SharedXPage } from '../shared'  /  from '../shared/...'
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'[^']*shared[^']*'/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.split(/\s+as\s+/)[0].trim()
      if (!/^[A-Z]/.test(name)) continue
      for (const cand of sharedFiles) {
        if (path.basename(cand, '.tsx') === name) { out.push(read(cand)); break }
      }
    }
  }
  return out
}

/** Every .tsx under packages/tenant-ui, so a delegated page can be found by component name. */
const sharedFiles: string[] = []
;(function walk(dir: string) {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.tsx')) sharedFiles.push(p)
  }
})(SHARED_DIR)

interface Finding { template: string; from: string; target: string; param: string; why: string }
const findings: Finding[] = []
let linksChecked = 0, paramsChecked = 0

const templates = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('crm') && !SKIP_TEMPLATES.has(e.name))
  .map((e) => e.name)

for (const tpl of templates) {
  const srcDir = path.join(TEMPLATES_DIR, tpl, 'frontend', 'src')
  const appFile = path.join(srcDir, 'App.tsx')
  if (!exists(appFile)) continue
  const app = read(appFile)

  // component name -> file, from App.tsx's own imports
  const compFile = new Map<string, string>()
  for (const m of app.matchAll(/import\s+(\w+)\s+from\s+'(\.[^']+)'/g)) {
    const f = path.join(srcDir, m[2])
    for (const cand of [`${f}.tsx`, `${f}.ts`, path.join(f, 'index.tsx')]) {
      if (exists(cand)) { compFile.set(m[1], cand); break }
    }
  }
  /**
   * FULL route path -> the page component, built by walking the nesting.
   *
   * Matching a route by its last segment is not good enough: every template has a customer-portal
   * tree with `<Route path="equipment">` under `/portal`, so a tail match resolved /crm/equipment to
   * PortalEquipment and then reported the CRM screen as broken. The guard's walk being wrong is the
   * same bug as the code being wrong, and harder to see.
   *
   * `<Route path=…>` with children pushes a prefix, `</Route>` pops it, a self-closing Route is a
   * leaf at the current prefix. The page is the INNERMOST component of the element expression that
   * App.tsx imports — `element={<FeatureGate><QuotesPage /></FeatureGate>}` is QuotesPage, and
   * `element={<ProtectedRoute><AppLayout /></ProtectedRoute>}` is the layout, not the guard.
   */
  const routeComp = new Map<string, string>()
  {
    const stack: string[] = []
    const join = (base: string, p: string) =>
      p.startsWith('/') ? p : `${base.replace(/\/$/, '')}/${p}`.replace(/\/{2,}/g, '/')
    // One token per <Route …>, </Route>, so the nesting can be tracked in order.
    const tokens = app.matchAll(/<Route\b([^>]*?)(\/)?>|<\/Route>/g)
    for (const t of tokens) {
      if (t[0] === '</Route>') { stack.pop(); continue }
      const attrs = t[1] || ''
      const selfClosing = !!t[2]
      const pm = attrs.match(/path="([^"]+)"/)
      const base = stack.length ? stack[stack.length - 1] : '/'
      const full = pm ? join(base, pm[1]) : base // `index` routes carry the parent's path
      const names = [...attrs.matchAll(/<(\w+)/g)].map((x) => x[1])
      const page = [...names].reverse().find((n) => compFile.has(n))
      if (page && !routeComp.has(full)) routeComp.set(full, page)
      if (!selfClosing) stack.push(full)
    }
  }

  /** Files that might contain a link: this template's frontend, plus the shared pages it ships. */
  const files: string[] = []
  ;(function walk(dir: string) {
    let entries: fs.Dirent[] = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'shared' && e.name !== 'node_modules') walk(p) }
      else if (e.name.endsWith('.tsx')) files.push(p)
    }
  })(srcDir)

  /**
   * A shared page is only this template's problem if this template RENDERS it.
   *
   * packages/tenant-ui ships to every vertical, but a vertical mounts only the screens it has:
   * ContactDetailPage links to /crm/equipment, and the dispensary has no equipment module and no
   * such route. Judging every shared file against every template reported that as a broken link in
   * six templates that never show it — the guard's walk being wrong, not the code.
   *
   * "Renders it" = some file under this template's frontend/src names the component. That is how the
   * thin template pages delegate (`<SharedContactsPage …/>`), so it is the same evidence the app
   * itself uses.
   */
  const templateText = files.map(read).join('\n')
  /**
   * …and the template's OWN file of that name wins.
   *
   * crm-roof has its own pages/roofing/JobDetailPage.tsx, which does not carry the shared one's
   * `?edit=` link at all. Matching the shared file by component name alone said "roofing renders
   * JobDetailPage", attributed the shared file's links to it, and reported a link roofing never
   * shows. Two files, one name, and the vertical's own is the one that ships.
   */
  const ownBasenames = new Set(files.map((f) => path.basename(f, '.tsx')))
  const reachable = (f: string) => {
    const name = path.basename(f, '.tsx')
    if (ownBasenames.has(name)) return false
    return new RegExp(`\\b${name}\\b`).test(templateText)
  }

  for (const file of [...files, ...sharedFiles.filter(reachable)]) {
    const src = read(file)
    if (!src) continue
    // to={`/crm/jobs?projectId=${id}`}  |  to="/crm/jobs?x=1"  |  navigate(`/crm/jobs?x=${y}`)
    for (const m of src.matchAll(/(?:to=\{?|navigate\()\s*[`'"](\/[A-Za-z0-9/_-]+\?[^`'"]+)[`'"]/g)) {
      const target = m[1]
      const [rawPath, query] = target.split('?')
      // Only parameters with a literal NAME; the value may be an interpolation.
      const names = [...query.matchAll(/(?:^|&)([A-Za-z][A-Za-z0-9_]*)=/g)].map((x) => x[1])
      if (!names.length) continue
      linksChecked++

      const comp = routeComp.get(rawPath.replace(/\/$/, '') || '/')
      if (!comp) {
        /**
         * The link points at a path this template does not route. That IS a defect — a dead link —
         * but a different one, and the shared pages carry links for modules a given vertical may
         * not mount at all. Out of this guard's scope; #194's sibling covers nav/route agreement.
         */
        continue
      }
      const dest = compFile.get(comp)
      if (!dest) continue
      const destSrc = screenSources(dest).join('\n')
      for (const p of names) {
        if (NOT_A_DESTINATION_CONCERN[p]) continue
        paramsChecked++
        const reads = new RegExp(`\\.get\\(\\s*['"\`]${p}['"\`]\\s*\\)`).test(destSrc)
        if (!reads) {
          findings.push({
            template: tpl, from: path.relative(ROOT, file), target, param: p,
            why: `<${comp}> (${path.relative(ROOT, dest)}) never reads it`,
          })
        }
      }
    }
  }
}

if (findings.length) {
  console.error(`\ncheck-link-params-are-read: ${findings.length} link(s) carry a parameter the destination ignores\n`)
  // One line per finding, grouped, so a sweep of one page does not bury the rest.
  const seen = new Set<string>()
  for (const f of findings) {
    const key = `${f.template}|${f.target}|${f.param}|${f.why}`
    if (seen.has(key)) continue
    seen.add(key)
    console.error(`  ${f.template.padEnd(18)} ${f.target}`)
    console.error(`  ${''.padEnd(18)}   ?${f.param} — ${f.why}`)
    console.error(`  ${''.padEnd(18)}   linked from ${f.from}`)
  }
  console.error(`\nA link that sends a parameter nobody reads is a link that silently does the wrong thing:`)
  console.error(`either read it on the destination, or stop sending it.\n`)
  process.exit(1)
}

console.log(`check-link-params-are-read: ok — ${paramsChecked} parameter(s) across ${linksChecked} link(s) in ${templates.length} template(s)`)
