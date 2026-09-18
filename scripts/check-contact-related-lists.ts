// CI guard: a contact page lists what it counts. The sidebar read "Invoices 4" over a body that showed a
// Quotes section and nothing else — the invoices were already in the payload with nothing rendering them,
// and the jobs were not in the payload at all (contractor T14 M6). An invoice row also derives "overdue"
// the way every other surface does, rather than printing the stored status (T14 H10/M17).
//   bun scripts/check-contact-related-lists.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// the payload
const contacts = read('packages/tenant-backend/src/contacts/contacts.ts')
if (!contacts) fail('packages/tenant-backend/src/contacts/contacts.ts is missing')
const rel = contacts.match(/export function standardRelations[\s\S]*?\n\}/)?.[0] || ''
if (!rel) fail('standardRelations is missing')
if (!/if \(t\.job\) out\.push\(\{ key: 'jobs'/.test(rel)) fail("a contact's jobs must travel with it — the page counted them and never had them")
for (const col of ['title: t.job.title', 'status: t.job.status', 'scheduledDate: t.job.scheduledDate']) {
  if (!rel.includes(col)) fail(`…including ${col.split(':')[0]}, or the row has nothing to show`)
}
for (const col of ['amountRefunded: t.invoice.amountRefunded', 'dueDate: t.invoice.dueDate']) {
  if (!rel.includes(col)) fail(`an invoice must carry ${col.split(':')[0]} so the page can show what is owed and derive overdue`)
}

// every template asks for it
const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']
for (const t of TEMPLATES) {
  const src = read(`templates/${t}/backend/src/routes/contacts.ts`)
  if (!src) { fail(`templates/${t}/backend/src/routes/contacts.ts is missing`); continue }
  if (!/standardRelations\(\{ project, quote, invoice, job \}\)/.test(src)) fail(`${t} does not pass its job table — its contact pages stay empty`)
}

// the page
const page = read('packages/tenant-ui/src/contacts/ContactDetailPage.tsx')
if (!/<RelatedList title="Invoices"/.test(page)) fail('the contact page must render an Invoices list, not only a count')
if (!/<RelatedList title="Jobs"/.test(page)) fail('…and a Jobs list')
if (!/const invoiceStatus = \(r: Related\) =>/.test(page)) fail('an invoice row must derive its status')
if (!/isPastDay\(r\.dueDate\)/.test(page)) fail('…from the due DAY, so it agrees with the rest of the product')
if (!/outstanding > 0\.005/.test(page)) fail('…and only call it overdue when money is actually owed')
if (!/\{money\(outstanding\)\} outstanding/.test(page)) fail('a row should say what is still owed')
if (!/showInvoices && invoices\.length > 0/.test(page)) fail('an empty section must not render')
if (!/jobs\.length > 0 &&/.test(page)) fail('…nor an empty Jobs section')

// The portal link was in the status payload all along and nothing rendered it, so the only way an owner could
// get it was out of the API. Emailing an invite is not always what you want — sometimes you read it out. (T14)
if (!/\{portalStatus\.portalUrl\}/.test(page)) fail('the portal panel must SHOW the link, not just offer to email it')
if (!/portalStatus\?\.enabled && portalStatus\?\.portalUrl/.test(page)) fail('…only when access is on and a token exists')
if (!/aria-label="Copy portal link"/.test(page)) fail('…with a way to copy it')
if (!/Could not copy — the link is shown above and can be selected/.test(page)) fail('…and a refused clipboard must say so rather than failing silently')
if (!/Resend Portal Invite/.test(page)) fail('the invite email must remain — the link is an addition, not a replacement')

if (failed) { console.error(`\ncontact related lists: ${failed} check(s) FAILED`); process.exit(1) }
console.log('contact related lists: the contact page lists the invoices and jobs it counts')
