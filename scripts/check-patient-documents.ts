// CI guard: a clinic files against the animal. Documents could only hang off a project, a contact, a job or
// an invoice, so an x-ray or a vaccination certificate landed under the OWNER — useless in a two-pet
// household — and the patient chart had no Documents tab at all (vet T12 M6). The shared route takes the
// extra link generically (options.links: column → table), so the vet's vocabulary stays in the vet template.
//   bun scripts/check-patient-documents.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// the shared seam
const docs = read('packages/tenant-backend/src/files/documents.ts')
if (!docs) fail('packages/tenant-backend/src/files/documents.ts is missing')
if (!/links\?: Record<string, any>/.test(docs)) fail('the shared documents route must accept extra link columns (options.links)')
if (!/const linkCols = Object\.keys\(links\)/.test(docs)) fail('…and read them')
if (!/for \(const col of linkCols\) if \(q\[col\]\) conditions\.push\(eq\(t\.document\[col\], q\[col\]\)\)/.test(docs)) fail('an extra link must be filterable, or a chart cannot ask for its own files')
if ((docs.match(/await linkValues\(companyId, body\)/g) || []).length < 3) fail('an extra link must be settable on upload, on bulk upload and on edit')
if (!/if \('error' in extra\) return c\.json\(\{ error: extra\.error \}, 404\)/.test(docs)) fail('…and an id that is not this company\'s must be refused, not stored')
if (!/if \(!row\) return \{ error: `That \$\{linkLabel\(col\)\} does not exist\.` \}/.test(docs)) fail('…which means actually looking the id up first')
if (!/\.\.\.extra\.values,\n      uploadedById: userId,/.test(docs)) fail('the resolved link values must reach the insert')
if (!/Object\.assign\(u, extra\.values\)/.test(docs)) fail('…and the update')

// the vet wiring
const vetRoute = read('templates/crm-vet/backend/src/routes/documents.ts')
if (!/options: \{ links: \{ patientId: patient \} \}/.test(vetRoute)) fail('crm-vet must file documents against the patient')
if (!/import \{ document, documentVersion, project, contact, user, patient \}/.test(vetRoute)) fail('…which means importing the patient table')

// the column
const schema = read('templates/crm-vet/backend/db/schema.ts')
const docTable = schema.match(/export const document = pgTable[\s\S]*?\n\]\)/)?.[0] || ''
if (!/patientId: text\('patient_id'\)\.references\(\(\) => patient\.id, \{ onDelete: 'set null' \}\)/.test(docTable)) fail('the document table must carry patient_id')
if (!/index\('document_patient_id_idx'\)\.on\(t\.patientId\)/.test(docTable)) fail('…indexed, because the chart filters on it every time it opens')
const migration = read('templates/crm-vet/backend/db/migrations/0024_document_patient.sql')
if (!/ALTER TABLE "document" ADD COLUMN IF NOT EXISTS "patient_id"/.test(migration)) fail('0024 must add the column to existing clinics')
if (!/CREATE INDEX IF NOT EXISTS "document_patient_id_idx"/.test(migration)) fail('…and the index')
if (!/"tag": "0024_document_patient"/.test(read('templates/crm-vet/backend/db/migrations/meta/_journal.json'))) fail('…and the journal must list it, or it never runs')

// the chart
const page = read('templates/crm-vet/frontend/src/pages/vet/PatientDetailPage.tsx')
if (!/'visits' \| 'vaccinations' \| 'prescriptions' \| 'labs' \| 'documents'/.test(page)) fail('the patient chart must have a Documents tab')
if (!/api\.get\(`\/api\/documents\?patientId=\$\{id\}/.test(page)) fail('…listing THIS animal\'s files, not the owner\'s')
if (!/fd\.append\('patientId', id\)/.test(page)) fail('…and filing an upload against it')
if (!/label: 'Documents'/.test(page)) fail('…and the tab must be labelled')

if (failed) { console.error(`\npatient documents: ${failed} check(s) FAILED`); process.exit(1) }
console.log('patient documents: a file is filed against the animal, and the chart can ask for its own')
