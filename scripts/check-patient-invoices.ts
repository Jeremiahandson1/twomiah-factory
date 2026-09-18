// CI guard: the owner pays the bill, but the bill is FOR an animal. Invoices carried only a contact, so in a
// multi-pet household nothing said which pet the charges were for, and a chart could not show what that
// animal had cost (vet T12 M6). The shared invoice route takes the extra link generically (options.links:
// column → table), the same seam the documents route uses, so vet vocabulary stays in the vet template.
//   bun scripts/check-patient-invoices.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// the shared seam
const inv = read('packages/tenant-backend/src/invoicing/invoices.ts')
if (!inv) fail('packages/tenant-backend/src/invoicing/invoices.ts is missing')
if (!/links\?: Record<string, any>/.test(inv)) fail('the shared invoice route must accept extra link columns (options.links)')
if (!/for \(const col of linkCols\) \{ const v = c\.req\.query\(col\); if \(v\) conditions\.push\(eq\(t\.invoice\[col\], v\)\) \}/.test(inv)) fail('an extra link must be filterable, or a chart cannot ask what an animal cost')
if ((inv.match(/await linkValues\(cid, raw\)/g) || []).length < 2) fail('an extra link must be settable on create AND on edit')
if (!/const raw = await c\.req\.json\(\)/.test(inv)) fail('…read from the RAW body, because the zod schema drops what it does not name')
if (!/if \(!row\) return \{ error: `That \$\{linkLabel\(col\)\} does not exist\.` \}/.test(inv)) fail('…and an id that is not this company\'s must be looked up and refused')
if ((inv.match(/if \('error' in extra\) return c\.json\(\{ error: extra\.error \}, 404\)/g) || []).length < 2) fail('…on both paths')
if (!/extra: extra\.values,/.test(inv)) fail('the resolved link values must reach the insert')
if (!/\.\.\.\(v\.extra \|\| \{\}\),/.test(inv)) fail('…and insertInvoice must actually spread them')
if (!/Object\.assign\(update, extra\.values\)/.test(inv)) fail('…and the update')

// the vet wiring
const vetInvoices = read('templates/crm-vet/backend/src/routes/invoices.ts')
if (!/links: \{ patientId: patient \}/.test(vetInvoices)) fail('crm-vet must raise invoices against the patient')
if (!/minLineItems: 1/.test(vetInvoices)) fail('…without losing the minimum-line rule it already had')
const visits = read('templates/crm-vet/backend/src/routes/visits.ts')
if (!/patientId: v\.patientId,/.test(visits)) fail('billing a visit must bill the animal that was seen, not just its owner')

// the column
const schema = read('templates/crm-vet/backend/db/schema.ts')
const invTable = schema.match(/export const invoice = pgTable[\s\S]*?\n\]\)/)?.[0] || ''
if (!/patientId: text\('patient_id'\)\.references\(\(\) => patient\.id, \{ onDelete: 'set null' \}\)/.test(invTable)) fail('the invoice table must carry patient_id')
if (!/index\('invoice_patient_id_idx'\)\.on\(t\.patientId\)/.test(invTable)) fail('…indexed, because the chart filters on it')
const migration = read('templates/crm-vet/backend/db/migrations/0025_invoice_patient.sql')
if (!/ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "patient_id"/.test(migration)) fail('0025 must add the column to existing clinics')
if (!/"tag": "0025_invoice_patient"/.test(read('templates/crm-vet/backend/db/migrations/meta/_journal.json'))) fail('…and the journal must list it, or it never runs')

// the chart
const page = read('templates/crm-vet/frontend/src/pages/vet/PatientDetailPage.tsx')
if (!/\| 'documents' \| 'invoices'/.test(page)) fail('the patient chart must have an Invoices tab')
if (!/api\.get\(`\/api\/invoices\?patientId=\$\{id\}/.test(page)) fail('…showing THIS animal\'s invoices')
if (!/label: 'Invoices'/.test(page)) fail('…and the tab must be labelled')

if (failed) { console.error(`\npatient invoices: ${failed} check(s) FAILED`); process.exit(1) }
console.log('patient invoices: the bill names the animal it is for, and the chart can ask what it cost')
