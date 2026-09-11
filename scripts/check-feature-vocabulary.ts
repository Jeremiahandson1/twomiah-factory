// CI guard: ONE feature vocabulary.
//
// The feature registry (packages/tenant-backend/src/featureRegistry.ts) is the only place feature ids
// may be defined. This script fails the build when a template gates on an id the registry does not
// know, when a template still carries a second catalog, when a tenant's CRM_TEMPLATE constant does
// not match its directory, when a feature-manifest key or a Factory plan tier names an unknown id, or
// when apps/api stops re-exporting the shared file.
//
// Ids that exist in the registry but are not offered to a template are reported as INFO, not errors:
// that is how unshipped or vertical-inapplicable modules stay dark in a cloned template.
//
//   bun run check:features
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'

const ROOT = path.resolve(import.meta.dir, '..')
const REG_FILE = path.join(ROOT, 'packages/tenant-backend/src/featureRegistry.ts')
const { FEATURE_REGISTRY, PLAN_TIERS } = await import(pathToFileURL(REG_FILE).href)
type Def = { id: string; templates: string[]; core: boolean; hidden?: boolean; category: string }
const registry = new Map<string, Def>((FEATURE_REGISTRY as Def[]).map((f) => [f.id, f]))

// Templates under the guard. crm-automotive and crm-homecare are parked; crm-store has no feature gating.
const ACTIVE = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-roof', 'crm-rv', 'crm-salon', 'crm-vet', 'crm-dispensary']
// The second half of the list is the tenant storefront: a tenant never sells plans or signs up
// companies itself — the Factory does (packages/tenant-backend/src/plans.ts is the one price list).
const FORBIDDEN = [
  'frontend/src/data/features.ts', 'frontend/src/data/featureAliases.ts', 'backend/src/config/featureRegistry.ts', 'backend/src/shared/plans.ts',
  'backend/src/config/pricing.ts', 'backend/src/services/billing.ts',
  'frontend/src/pages/public/SignupPage.tsx', 'frontend/src/pages/public/PricingPage.tsx', 'frontend/src/pages/public/SelfHostedPurchasePage.tsx', 'frontend/src/pages/settings/BillingSettingsPage.tsx',
]

const errors: string[] = [], infos: string[] = []
const err = (m: string) => errors.push(m), info = (m: string) => infos.push(m)

// ── registry sanity
{
  const seen = new Set<string>()
  for (const f of FEATURE_REGISTRY as Def[]) {
    if (seen.has(f.id)) err(`registry: duplicate id '${f.id}'`)
    seen.add(f.id)
    if (!/^[a-z][a-z0-9_]*$/.test(f.id)) err(`registry: id '${f.id}' is not snake_case`)
    for (const t of f.templates) if (!fs.existsSync(path.join(ROOT, 'templates', t))) err(`registry: '${f.id}' lists unknown template '${t}'`)
  }
  const api = fs.readFileSync(path.join(ROOT, 'apps/api/src/config/featureRegistry.ts'), 'utf8')
  if (!/export \* from '.*packages\/tenant-backend\/src\/featureRegistry\.ts'/.test(api) || api.includes('FEATURE_REGISTRY: FeatureDef[] = ['))
    err('apps/api/src/config/featureRegistry.ts must only re-export packages/tenant-backend/src/featureRegistry.ts')
  for (const [template, tiers] of Object.entries(PLAN_TIERS as Record<string, Record<string, string[]>>))
    for (const [tier, ids] of Object.entries(tiers))
      for (const id of ids) {
        const d = registry.get(id)
        if (!d) err(`registry PLAN_TIERS ${template}.${tier}: unknown id '${id}'`)
        else if (!d.templates.includes(template)) err(`registry PLAN_TIERS ${template}.${tier}: '${id}' is not offered to ${template} (templates: ${d.templates.join(', ') || 'none'})`)
      }
}

const walk = (d: string, out: string[] = []) => {
  if (!fs.existsSync(d)) return out
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (!['node_modules', 'shared', 'test', 'dist'].includes(e.name)) walk(p, out) }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

for (const t of ACTIVE) {
  const dir = path.join(ROOT, 'templates', t)
  if (!fs.existsSync(dir)) { err(`template dir missing: ${t}`); continue }
  for (const f of FORBIDDEN) if (fs.existsSync(path.join(dir, f))) err(`${t}: ${f} exists — a second feature vocabulary. Delete it; the registry is the only source.`)

  const constFile = path.join(dir, 'backend/src/config/template.ts')
  if (!fs.existsSync(constFile)) err(`${t}: backend/src/config/template.ts missing (CRM_TEMPLATE)`)
  else {
    const m = fs.readFileSync(constFile, 'utf8').match(/export const CRM_TEMPLATE = '([^']+)'/)
    if (!m) err(`${t}: CRM_TEMPLATE not found in backend/src/config/template.ts`)
    else if (m[1] !== t) err(`${t}: CRM_TEMPLATE is '${m[1]}' — must equal the directory name`)
  }

  // gate ids used by the code
  const uses = new Map<string, Set<string>>()
  const add = (id: string, where: string) => { if (!uses.has(id)) uses.set(id, new Set()); uses.get(id)!.add(where) }
  for (const f of [...walk(path.join(dir, 'frontend/src')), ...walk(path.join(dir, 'backend/src'))]) {
    const rel = path.relative(dir, f).split(path.sep).join('/')
    const src = fs.readFileSync(f, 'utf8')
    src.split('\n').forEach((line, i) => {
      const where = `${rel}:${i + 1}`
      if (/\bto:\s*['"]/.test(line)) {
        const arr = line.match(/features:\s*\[([^\]]*)\]/)
        if (arr) for (const m of arr[1].matchAll(/['"]([^'"]+)['"]/g)) add(m[1], where)
        const one = line.match(/\bfeature:\s*['"]([^'"]+)['"]/)
        if (one) add(one[1], where)
      }
      for (const m of line.matchAll(/\b(?:hasFeature|useFeature|requireFeature)\(['"]([^'"]+)['"]\)/g)) add(m[1], where)
      for (const m of line.matchAll(/\bfeatureKey:\s*['"]([^'"]+)['"]/g)) add(m[1], where)
    })
  }
  const notOffered: string[] = []
  for (const [id, where] of uses) {
    const d = registry.get(id)
    if (!d) err(`${t}: gate id '${id}' is not in the registry — ${[...where].slice(0, 3).join(', ')}`)
    else if (!d.templates.includes(t)) notOffered.push(id)
  }
  if (notOffered.length) info(`${t}: ${notOffered.length} gated id(s) not offered to this template (stay off): ${notOffered.sort().join(', ')}`)

  // manifest keys
  const mf = path.join(dir, 'feature-manifest.json')
  if (fs.existsSync(mf)) {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'))
    const notFor: string[] = []
    for (const k of Object.keys(m.features || {})) {
      const d = registry.get(k)
      if (!d) err(`${t}: feature-manifest.json key '${k}' is not in the registry`)
      else if (!d.templates.includes(t)) notFor.push(k)
    }
    if (notFor.length) info(`${t}: feature-manifest.json has ${notFor.length} key(s) not offered to this template: ${notFor.sort().join(', ')}`)
  }
}

for (const m of infos) console.log('INFO  ' + m)
for (const m of errors) console.log('ERROR ' + m)
console.log(`\nfeature vocabulary: ${registry.size} registry ids, ${ACTIVE.length} templates checked, ${errors.length} error(s), ${infos.length} info`)
if (errors.length) process.exit(1)
