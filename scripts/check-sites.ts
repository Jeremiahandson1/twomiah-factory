// CI guard: landscaping properties (sites) are a real, managed thing — listed, added and edited through /api/sites,
// company-scoped, with a property that is in use refusing to be deleted; and Snow Billing and Area Pricing pick one
// instead of asking for its internal id. (Landscaping T14 M7: both pages had a free-text "Site ID" box and nothing in
// the app could create or list a property — only the seed had any)
//   bun scripts/check-sites.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
// a missing file is a FAIL, not a crash (the guard must report what is absent)
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { fail(`${p} is missing`); return '' } }
const L = 'templates/crm-landscaping'
const r = read(`${L}/backend/src/routes/sites.ts`)
const idx = read(`${L}/backend/src/index.ts`)

if (!/app\.route\('\/api\/sites', sitesRoutes\)/.test(idx)) fail('index.ts must mount /api/sites')
for (const [method, path] of [["app.get('/'", 'list'], ["app.get('/:id'", 'read one'], ["app.post('/'", 'create'], ["app.put('/:id'", 'edit'], ["app.delete('/:id'", 'delete']] as const) {
  if (!r.includes(method)) fail(`sites route must support ${path}`)
}
if ((r.match(/eq\(site\.companyId, user\.companyId\)/g) || []).length < 5) fail('every sites query must be scoped to the company')
if (!/export function siteInputError/.test(r) || !/'Property name is required\.'/.test(r)) fail('a property must be validated (name required)')
// both the create and the edit must check the customer is this company's
if ((r.match(/eq\(contact\.id, String\(body\.contactId\)\), eq\(contact\.companyId, user\.companyId\)/g) || []).length < 2 || !/'Customer not found' \}, 404\)/.test(r)) fail("a property's customer must belong to the company (on create and on edit)")
if (!/\.from\(snowContract\)/.test(r) || !/if \(Number\(contracts\) > 0\) return c\.json\(/.test(r) || !/\}, 409\)/.test(r)) fail('deleting a property that has snow contracts must be refused (409), not cascade its visits away')

const picker = read(`${L}/frontend/src/pages/landscaping/SitePicker.tsx`)
if (!/api\.get\('\/api\/sites'\)/.test(picker) || !/api\.post\('\/api\/sites', form\)/.test(picker)) fail('the picker must list properties and be able to add one')
if (!/No properties yet — add one/.test(picker)) fail('the picker must say what to do when there are no properties yet')
for (const page of ['SnowBillingPage', 'AreaPricingPage']) {
  const src = read(`${L}/frontend/src/pages/landscaping/${page}.tsx`)
  if (!/<SitePicker\b/.test(src) || !/from '\.\/SitePicker'/.test(src)) fail(`${page} must pick the property with SitePicker`)
  if (/placeholder="Site ID"/.test(src)) fail(`${page} still asks for a typed Site ID`)
}
if (failed) { console.error(`\nsites: ${failed} check(s) FAILED`); process.exit(1) }
console.log('sites: properties are listed/added/edited through /api/sites and picked on both landscaping pages')
