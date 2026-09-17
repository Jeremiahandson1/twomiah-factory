// CI guard: RV units that reach the marketplace feed have a real identity, edits are validated, and the public feed
// lists only units a buyer can buy. Create requires a known category, stock number, year, make and model and a
// well-formed VIN; edits parse through the same schema (partial); odd pricing is returned as warnings; the public
// feed lists available units only. (RV T19 M1: blank make/stock, category "banana", VIN "123" and pending units
// reached the public feed; edits wrote the body unchecked)
//   bun scripts/check-rv-unit-validation.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const u = read('templates/crm-rv/backend/src/routes/units.ts')
const schema = u.slice(u.indexOf('const unitSchema = z.object({'), u.indexOf('const unitUpdateSchema'))
if (!/category: z\.enum\(UNIT_CATEGORIES/.test(schema)) fail('category must be one of the known categories')
for (const [field, label] of [['stockNumber', 'Stock number'], ['make', 'Make'], ['modelName', 'Model']]) {
  if (!new RegExp(`${field}: requiredText\\('${label}'\\)`).test(schema)) fail(`${field} must be required (non-blank after stripping tags)`)
}
if (!/const requiredText = [\s\S]*?\.refine\(s => s\.length > 0/.test(u)) fail('requiredText must refuse blank values')
if (!/year: z\.number\(\{ required_error: 'Year is required'/.test(schema) || /year: z\.number\([^\n]*\.optional\(\)/.test(schema)) fail('year must be required')
if (!/\/\^\[A-HJ-NPR-Z0-9\]\{17\}\$\/\.test\(v\) \|\| \/\^\[A-Z0-9\]\{5,16\}\$\/\.test\(v\)/.test(schema)) fail('vin must be a 17-character VIN or a 5–16 character serial')
if (!/const unitUpdateSchema = unitSchema\.partial\(\)/.test(u)) fail('edits must use the same schema (partial)')
const put = u.slice(u.indexOf("app.put('/:id'"), u.indexOf("app.delete('/:id'"))
if (!/const body = unitUpdateSchema\.parse\(await c\.req\.json\(\)\)/.test(put)) fail('PUT /units/:id must validate the body before writing')
if (!/ne\(unit\.id, existing\.id\)/.test(put) || !/is already in use` \}, 409\)/.test(put)) fail('an edit to another unit\'s stock number must be refused (409)')
if (!/const warnings = priceWarnings\(created\)/.test(u) || !/const warnings = priceWarnings\(updated\)/.test(u)) fail('create and edit must return pricing warnings')

const s = read('templates/crm-rv/backend/src/routes/syndication.ts')
if (!/const LISTABLE = \['available'\]/.test(s)) fail('the public feed must list available units only')
if (!/const listings = await buildFeed\(comp\.id, LISTABLE\)/.test(s)) fail('the public token feed must use LISTABLE')
if (!/const EXPORTABLE = \['available', 'pending'\]/.test(s) || !/filter\(s => EXPORTABLE\.includes\(s\)\)/.test(s)) fail('the dealer export may include pending only when asked, and never sold')

if (!/if \(saved\?\.warnings\?\.length\) alert\(/.test(read('templates/crm-rv/frontend/src/pages/rv/InventoryPage.tsx'))) fail('the Inventory form must show pricing warnings after saving')

if (failed) { console.error(`\nrv unit validation: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv unit validation: units need category, stock number, year, make, model and a valid VIN; edits are validated; the public feed lists available units only')
