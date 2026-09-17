// CI guard: search only shows what the tenant can open. Each CRM's routes/search.ts carries TYPE_FEATURES — per
// result type, the features that unlock its module, or false when the module is not mounted — and it must agree
// with that CRM's index.ts: a family gated there (requireEnabledFeature, #167) is gated in search with the same
// features; a family not mounted there is false; a mounted, ungated family is not listed. Search, quick search
// and Recent all filter by it, and ?types= cannot ask for a hidden type. (events T18: jobs under Recent with
// Jobs switched off)
//   bun scripts/check-search-feature-gates.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']
// search result type → the API family whose page it links to
const FAMILY: Record<string, string> = { project: 'projects', job: 'jobs', quote: 'quotes', rfi: 'rfis' }

for (const t of TEMPLATES) {
  const r = read(`templates/${t}/backend/src/routes/search.ts`)
  const idx = read(`templates/${t}/backend/src/index.ts`)
  const svc = read(`templates/${t}/backend/src/services/search.ts`)
  if (!/import \{ enabledFeaturesFor \} from '\.\.\/middleware\/enabledFeature\.ts'/.test(r)) fail(`${t} search route must read the tenant's features through the enabled-feature gate`)
  const m = r.match(/const TYPE_FEATURES: Record<string, string\[\] \| false> = (\{[^\n]*\})/)
  if (!m) { fail(`${t} search route must declare TYPE_FEATURES`); continue }
  const gates: Record<string, string[] | false> = {}
  for (const [, k, v] of m[1].matchAll(/(\w+): (false|\[[^\]]*\])/g)) gates[k] = v === 'false' ? false : [...v.matchAll(/'([^']+)'/g)].map((x) => x[1])

  for (const [type, family] of Object.entries(FAMILY)) {
    if (!new RegExp(`searchTypes\\.includes\\('${type}'\\)`).test(svc)) continue // this search can't return the type
    const mounted = new RegExp(`app\\.route\\('/api/${family}',`).test(idx)
    const gate = idx.match(new RegExp(`app\\.use\\('/api/${family}', authenticate, requireEnabledFeature\\(([^)]*)\\)\\)`))
    const gateFeatures = gate ? [...gate[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null
    const listed = gates[type]
    if (!mounted) { if (listed !== false) fail(`${t}: /api/${family} is not mounted, so search must hide '${type}' (false)`) }
    else if (gateFeatures) { if (!Array.isArray(listed) || listed.join(',') !== gateFeatures.join(',')) fail(`${t}: /api/${family} is gated on ${gateFeatures.join('|')}, so search must gate '${type}' the same (found ${JSON.stringify(listed)})`) }
    else if (listed !== undefined) fail(`${t}: /api/${family} is mounted and ungated, so search must not hide '${type}'`)
  }

  const handler = (path: string) => r.slice(r.indexOf(`app.get('${path}'`), r.indexOf('app.get(', r.indexOf(`app.get('${path}'`) + 1) > 0 ? r.indexOf('app.get(', r.indexOf(`app.get('${path}'`) + 1) : undefined)
  if (!/types\.split\(','\)\.filter\(shown\)/.test(handler('/'))) fail(`${t} search: ?types= must be filtered to what the tenant can open`)
  if (!/const results = result\.results\.filter\(\(r: any\) => shown\(r\.type\)\)/.test(handler('/')) || !/results, count: results\.length/.test(handler('/'))) fail(`${t} search: results (and their count) must be filtered`)
  if (!/results\.filter\(\(r: any\) => shown\(r\.type\)\)/.test(handler('/quick'))) fail(`${t} quick search: results must be filtered`)
  if (!/results\.filter\(\(r: any\) => shown\(r\.type\)\)/.test(handler('/recent'))) fail(`${t} Recent: items must be filtered`)
}

if (failed) { console.error(`\nsearch feature gates: ${failed} check(s) FAILED`); process.exit(1) }
console.log('search feature gates: every CRM\'s search, quick search and Recent show only the modules its API serves to the tenant, in step with index.ts')
