// CI guard: the Dispensary T21 lows — one home per value, one name per order, one word for a customer,
// a ceiling on a product name, and a marketplace shelf with something on it.
//
//   L1/L2 — taxRate, localTaxRate, exciseTaxRate, purchaseLimitOz and storeHours each had a real
//           COLUMN and a copy in the settings blob. The column is validated; the blob was validated by
//           nobody, so {settings:{taxRate:"abc"}} stored "abc" verbatim with a 200. Harmless only while
//           nothing reads it.
//   L3    — a dispensary calls its buyers CUSTOMERS, and POST /api/contacts refused type "customer".
//   L4    — one order answered to three names: "K-1075" at the kiosk, "#1075" in the list,
//           "ORD-MU8DGOWY" in the audit log, because the register stamped a base-36 timestamp and the
//           kiosk stamped a different prefix on the same sequence.
//   L7    — the Marketplace said "No integrations found" because integration_partners is a catalogue
//           table nothing ever populated. (The 404s in the report are paths the page never calls.)
//   L8    — POST /api/products accepted a 404-character name.
//   bun scripts/check-dispensary-lows.ts
import { readFileSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const B = 'templates/crm-dispensary/backend/src/'

// L1 + L2
const co = read(B + 'routes/company.ts')
if (!co) fail('the company routes are missing')
if (!/const SHADOWED = \['taxRate', 'localTaxRate', 'exciseTaxRate', 'purchaseLimitOz', 'storeHours'\] as const/.test(co)) fail('the fields that have a column must be named once')
if (!/code: 'SETTING_HAS_A_COLUMN'/.test(co)) fail('…and writing one of them into the settings blob must be refused, not stored unvalidated')
if (!/const shadowed = SHADOWED\.filter\(k => \(data\.settings as any\)\[k\] !== undefined\)/.test(co)) fail('…detected on the settings object actually being written')

// L3
const ct = read(B + 'routes/contacts.ts')
if (!ct) fail('the contacts routes are missing')
if (!/\(v\) => \(v === 'customer' \? 'client' : v\)/.test(ct)) fail('"customer" must be accepted — it is the word this product uses on every screen')
if (!/z\.enum\(\['lead', 'client', 'patient', 'vendor'\]\)/.test(ct)) fail('…and normalised into the existing stored vocabulary, which must not change')

// L4
const ord = read(B + 'routes/orders.ts')
if (!ord) fail('the orders routes are missing')
if (/const orderNumber = `ORD-\$\{Date\.now\(\)\.toString\(36\)\.toUpperCase\(\)\}`/.test(ord)) fail('an order code must not be a base-36 timestamp — nobody can cross-reference it against the list')
if (!/const orderNumber = `ORD-\$\{nextOrderNumber\}`/.test(ord)) fail('…it must come from the same sequence the Orders list shows')
const kiosk = read(B + 'routes/kiosk.ts')
if (/const orderCode = 'K-' \+ String\(nextNumber\)/.test(kiosk)) fail('the kiosk must not invent its own prefix for the same order')
if (!/const orderCode = 'ORD-' \+ String\(nextNumber\)/.test(kiosk)) fail('…both doors stamp the same code')

// L7
const cat = read(B + 'services/integrationCatalog.ts')
if (!cat) fail('services/integrationCatalog.ts is missing — the Marketplace shelf has to be stocked from somewhere')
if (!/export async function ensureIntegrationPartners\(\): Promise<number>/.test(cat)) fail('…with an idempotent seeder')
if (/ON CONFLICT \(slug\)/.test(cat)) fail('…that does not depend on a unique index a reconciled table may not carry')
if (!/SELECT id FROM integration_partners WHERE slug = \$\{e\.slug\} LIMIT 1/.test(cat)) fail('…matching on slug by hand instead')
const idx = read(B + 'index.ts')
if (!/ensureIntegrationPartners\(\)/.test(idx)) fail('the catalogue must be stocked at BOOT — a tenant-creation seed leaves every dispensary already running with the empty page this fixes')
// everything on the shelf must be something this template implements
const backing: Record<string, string> = {
  weedmaps: 'routes/menu-sync.ts', leafly: 'routes/menu-sync.ts', iheartjane: 'routes/menu-sync.ts',
  dutchie_marketplace: 'routes/menu-sync.ts', metrc: 'routes/metrc.ts', biotrack: 'routes/biotrack.ts',
  leaf_data: 'routes/leaf-data.ts',
}
for (const slug of cat.match(/slug: '([a-z_]+)'/g)?.map(s => s.replace(/slug: '|'/g, '')) || []) {
  const route = backing[slug]
  if (!route) fail(`the catalogue lists "${slug}", which is not one of the integrations this template implements`)
  else if (!existsSync(ROOT + B + route)) fail(`the catalogue lists "${slug}" but ${route} does not exist — an empty shelf beats a shelf of things that do not work`)
}

// L8
const pr = read(B + 'routes/products.ts')
if (!pr) fail('the products routes are missing')
if (!/const NAME_MAX = 200/.test(pr)) fail('a product name needs a ceiling — a 404-character name was accepted with a 201')
if (!/name: cleanText\(1, NAME_MAX\)/.test(pr)) fail('…applied on create')
if (!/name: z\.string\(\)\.min\(1\)\.max\(NAME_MAX\)/.test(pr)) fail('…and on the bulk import, which is the other door')

if (failed) { console.error(`\ndispensary lows: ${failed} check(s) FAILED`); process.exit(1) }
console.log('dispensary lows: one home per value, one name per order, "customer" understood, product names bounded, and a stocked marketplace shelf')
