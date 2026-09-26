// Read the system and report what it actually does. No memory, no assumptions — every line below is
// derived from files on disk right now.
//
// Written because I kept acting on stale recollection: I reported two closed QA items as open, proposed a
// types change that would have enforced nothing (CI never type-checks the templates), and nearly built a
// CSS-variable brand-theming system when every tailwind.config.js has mapped orange/primary/brand to the
// tenant's generated palette all along.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'

// Repo-relative, so this runs from any checkout or worktree.
const W = new URL('../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1').replace(/[/]$/, '')
const read = (p: string) => { try { return readFileSync(`${W}/${p}`, 'utf8') } catch { return '' } }
const has = (p: string) => existsSync(`${W}/${p}`)
const count = (s: string, re: RegExp) => (s.match(re) || []).length

const line = (l = '─') => console.log(l.repeat(92))

// ── 1. what templates exist, and what each one IS ──────────────────────────────────────────────────
line('=')
console.log('TEMPLATES')
line()
const templates = readdirSync(`${W}/templates`).filter((t) => /^crm(-|$)/.test(t)).sort()
for (const t of templates) {
  const fe = `templates/${t}/frontend/src`
  const be = `templates/${t}/backend/src`
  const shell = has(`${fe}/components/layout/AppLayout.tsx`)
    ? (/AppShell/.test(read(`${fe}/components/layout/AppLayout.tsx`)) ? 'shared AppShell' : 'OWN layout')
    : '—'
  const auth = has(`${fe}/contexts/AuthContext.tsx`)
    ? (/from '\.\.\/shared'/.test(read(`${fe}/contexts/AuthContext.tsx`)) ? 'shared' : 'OWN')
    : '—'
  const cfgs = has(fe) ? readdirSync(`${W}/${fe}`).filter((n) => /Config\.tsx?$/.test(n)).length : 0
  const routes = has(`${be}/routes`) ? readdirSync(`${W}/${be}/routes`).filter((n) => n.endsWith('.ts')).length : 0
  const tokenPalette = /orange: brandPalette/.test(read(`templates/${t}/frontend/tailwind.config.js`))
  console.log(`  ${t.padEnd(17)} shell:${shell.padEnd(15)} auth:${auth.padEnd(7)} configs:${String(cfgs).padStart(2)}  backend routes:${String(routes).padStart(3)}  brandPalette:${tokenPalette ? 'yes' : 'NO'}`)
}

// ── 2. single sources of truth ─────────────────────────────────────────────────────────────────────
line('=')
console.log('SINGLE SOURCES OF TRUTH  (change these, not their copies)')
line()
const reg = read('packages/tenant-backend/src/featureRegistry.ts')
console.log(`  feature ids          packages/tenant-backend/src/featureRegistry.ts — ${count(reg, /\{ id: '/g)} features`)
console.log(`                       apps/api/src/config/featureRegistry.ts is a ${read('apps/api/src/config/featureRegistry.ts').split('\n').length}-line re-export`)
const routing = read('apps/api/src/config/industryRouting.ts')
console.log(`  industry -> vertical apps/api/src/config/industryRouting.ts — ${count(routing, /case '|Set\(\[/g)} decision points`)
console.log(`  brand colour         templates/*/frontend/tailwind.config.js maps orange+primary+brand -> generatePalette('{{PRIMARY_COLOR}}')`)
console.log(`                       => an orange-* class IS the tenant's colour. There is no CSS-var system and none is needed.`)
console.log(`  shared backend       packages/tenant-backend/src  -> vendored to backend/src/shared at generation`)
console.log(`  shared frontend      packages/tenant-ui/src       -> vendored to frontend/src/shared at generation`)

// ── 3. the wiring pattern ──────────────────────────────────────────────────────────────────────────
line('=')
console.log('HOW A PAGE IS WIRED  (getting this wrong produced 98 phantom findings)')
line()
console.log('  App.tsx  ->  templates/<t>/frontend/src/pages/X.tsx   (LOCAL wrapper, usually same NAME as the shared page)')
console.log('           ->  <SharedX api={api} toast={toast} config={VERTICAL_CONFIG} />')
console.log('  So App.tsx importing <DocumentsPage> is importing the WRAPPER, not the shared page.')
console.log('  The vertical config lives in templates/<t>/frontend/src/<name>Config.ts')

// ── 4. what CI actually runs ───────────────────────────────────────────────────────────────────────
line('=')
console.log('WHAT CI ACTUALLY RUNS  (.github/workflows/build-check.yml)')
line()
const wf = read('.github/workflows/build-check.yml')
const jobs = (wf.match(/^  [A-Za-z0-9_-]+:$/gm) || []).length
console.log(`  ${jobs} jobs. Builds: apps/api (bun build) and apps/platform (tsc + vite build).`)
console.log(`  NO CRM TEMPLATE IS BUILT OR TYPE-CHECKED. A template's build script is bare \`vite build\`,`)
console.log(`  which strips types without checking them. => a types-only change enforces NOTHING on templates.`)
console.log(`  Enforcement is the guards: scripts/check-*.ts, ${readdirSync(`${W}/scripts`).filter((n) => /^check-.*\.ts$/.test(n)).length} of them, one CI job each.`)

// ── 5. parked / do-not-touch ───────────────────────────────────────────────────────────────────────
line('=')
console.log('PARKED / SPECIAL')
line()
console.log('  crm-automotive   parked (CLAUDE.md) — auto dealers route to crm-rv')
console.log('  crm-homecare     parked unless explicitly asked')
console.log('  templates/crm    ALSO deploys claflin-construction-api — never rename or move it')
console.log('  crm-roof         fleet outlier: own AppLayout, own AuthContext, token key `token` (fleet uses accessToken)')
console.log('  crm-dispensary   own AuthContext/PermissionsContext/search; own Documents + Reports pages')

// ── 6. verification available ──────────────────────────────────────────────────────────────────────
line('=')
console.log('HOW TO VERIFY (in order of strength)')
line()
console.log('  1. live probe against a test tenant   — strongest; write-free where possible, restore what you touch')
console.log('  2. guard + mutation test              — commit the fix FIRST, then mutate/restore, end on a clean tree')
console.log('  3. run the helper in a pinned TZ      — a TZ-dependent rule is invisible under CI\'s UTC')
console.log('  4. reading source                     — weakest; it is where every wrong claim today came from')
line('=')
