// CI guard: the UI findings from the events T16/T17 runs stay fixed.
//   L11 the header search button exists at every width (below 768px it was display:none — a phone or tablet,
//       which has no Ctrl+K, had no way to search)
//   M7  the Help page's headings and body text are readable on the light page (they were white); the seven
//       template copies stay identical
//   L12 the events pages use the tenant's brand colour (orange-* = brand palette), not a hard-coded teal
//   L16 no two features share a display name (Settings › Features listed "Google Reviews" twice)
//   L9  the collection / completion rate shows no up/down arrow (it is a rate, not a trend)
//   bun scripts/check-ui-consistency.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
const root = new URL('../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// L11
const search = read('packages/tenant-ui/src/shell/GlobalSearch.tsx')
if (/aria-label="Search \(Ctrl\+K\)"/.test(search) && /className="hidden md:flex[^"]*"[^>]*aria-label="Search \(Ctrl\+K\)"/.test(search)) fail('GlobalSearch: the header search button must not be hidden below md')
if (!/<button type="button" onClick=\{\(\) => setIsOpen\(true\)\} className="flex items-center/.test(search)) fail('GlobalSearch: the header search button must render at every width')

// M7
const HELP = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']
const helpHashes = new Set(HELP.map((t) => createHash('sha1').update(readFileSync(new URL(`templates/${t}/frontend/src/pages/help/HelpPage.tsx`, root))).digest('hex')))
if (helpHashes.size !== 1) fail(`HelpPage.tsx must stay identical across ${HELP.join(', ')} (found ${helpHashes.size} versions)`)
const help = read('templates/crm/frontend/src/pages/help/HelpPage.tsx')
for (const h of ['Help Center', 'Manage Help Articles']) if (!new RegExp(`text-gray-900 dark:text-white">${h}</h1>`).test(help)) fail(`HelpPage: the "${h}" heading must be dark on the light page (text-gray-900 dark:text-white)`)
if (/className="text-xl font-bold text-white mb-4"/.test(help)) fail('HelpPage: the article title must not be white on the light page')
if (/<div className="text-gray-300 text-sm whitespace-pre-wrap/.test(help)) fail('HelpPage: the article body must not be light grey on the light page')

// L12
const walk = (dir: string): string[] => readdirSync(new URL(dir, root)).flatMap((n) => {
  const p = `${dir}/${n}`
  return statSync(new URL(p, root)).isDirectory() ? (n === 'shared' || n === 'node_modules' ? [] : walk(p)) : /\.(tsx?|jsx?)$/.test(n) ? [p] : []
})
for (const f of walk('templates/crm-restaurant/frontend/src')) if (/\bteal-\d/.test(read(f))) fail(`${f}: use the brand colour (orange-*), not a hard-coded teal`)

// L16
const registry = read('packages/tenant-backend/src/featureRegistry.ts')
// Per CRM: one template's Settings › Features page lists its features by name, so two of them sharing a name
// there is the bug. The same name on different templates (automotive vs RV "Sales Pipeline") is never shown together.
const names = [...registry.matchAll(/\{ id: '([^']+)', name: '([^']+)'[^\n]*templates: \[([^\]]*)\]/g)].map((m) => ({ id: m[1], name: m[2], templates: m[3].replace(/['\s]/g, '').split(',').filter(Boolean) }))
const seen = new Map<string, string>()
for (const f of names) for (const t of f.templates) {
  const key = `${t}::${f.name}`
  if (seen.has(key)) fail(`featureRegistry: on ${t}, "${f.name}" is the display name of both ${seen.get(key)} and ${f.id} — each feature needs its own name`)
  else seen.set(key, f.id)
}
if (/pipeline and calendar/.test(registry)) fail('featureRegistry: event_bookings must not promise a calendar view the events CRM does not have')

// L9
const reports = read('packages/tenant-ui/src/reporting/ReportsPage.tsx')
if (/TrendingUp|TrendingDown/.test(reports)) fail('ReportsPage: a rate for the period must not show an up/down trend arrow')

if (failed) { console.error(`\nui consistency: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`ui consistency: search button at every width; Help page readable and identical in ${HELP.length} templates; events pages on the brand colour; ${names.length} features, no shared display names; rates without trend arrows`)
