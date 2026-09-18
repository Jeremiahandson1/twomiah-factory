// CI guard: the three things the T24 re-test found after the vet report was closed.
//   M9 — sendSMS REFUSES (wallet empty) or returns status 'failed' (carrier) instead of throwing, so the
//        send loop counted both as successes and stamped the row: the page said "reminded today" about a
//        text nobody received, on a tenant whose messaging is paused.
//   H6 — the portal's pets section has been mounted since #227, but the vet's clientNav never named it, so
//        an owner opened a BILLING portal: Invoices, Payment Method, Documents, Messages. The vaccinations
//        due and the next appointment were in the payload and nothing rendered them.
//   M11 residual — the page, tiles and appointment types spoke clinic, but each row's type chip still read
//        "client" / "Lead".
//   bun scripts/check-retest-t24.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// M9 — a send that did not happen is not a reminder
const r = read('templates/crm-vet/backend/src/routes/reminders.ts')
if (!r) fail('templates/crm-vet/backend/src/routes/reminders.ts is missing')
const send = r.match(/app\.post\('\/send'[\s\S]*?\n\}\)/)?.[0] || ''
if (!send) fail('the send route is missing')
if (!/if \(result\?\.refused \|\| result\?\.status === 'failed'\)/.test(send)) {
  fail('a refused or failed send must be counted as a failure — sendSMS does not throw for either')
}
if (!/const result: any = await sendSMS\(/.test(send)) fail('…which means looking at what sendSMS returned')
if (!/continue$/m.test(send) || !/failures\.push\(ct\.id\)\n\s*if \(result\?\.errorMessage/.test(send)) {
  fail('…and skipping the stamp for that owner, not merely noting it')
}
if (!/let blockedReason = ''/.test(r)) fail('the reason nothing went out must be carried back')
if (!/\.\.\.\(sent === 0 && blockedReason \? \{ error: blockedReason \} : \{\}\)/.test(send)) {
  fail('…and returned when nothing was sent, so the page can say why')
}
const page = read('templates/crm-vet/frontend/src/pages/vet/RemindersPage.tsx')
if (!/\{\(result\.sent \|\| 0\) > 0 \? \(/.test(page)) fail('"0 reminders sent" must not be reported as a success in green')
if (!/\{result\.error \|\| 'Nothing was sent\.'\}/.test(page)) fail('…the page must show the reason instead')

// H6 — the vet portal leads with the pets
const portal = read('templates/crm-vet/frontend/src/portalConfig.ts')
const nav = portal.match(/clientNav: \[([^\]]*)\]/)?.[1] || ''
if (!/'pets'/.test(nav)) fail('the clinic portal must offer the pets section — the backend has mounted it since #227')
if (!/^\s*'pets'/.test(nav)) fail('…first: an owner comes to the portal for the animals, not the invoices')
for (const s of ['invoices', 'paymentMethods', 'sharedDocuments', 'messages']) {
  if (!new RegExp(`'${s}'`).test(nav)) fail(`…without losing ${s}`)
}
const dash = read('packages/tenant-ui/src/portal/PortalDashboard.tsx')
if (!/key: 'vaccinationsDue'/.test(dash)) fail('the portal home must show what is due — it was in the payload and nothing rendered it')
if (!/key: 'nextAppointment'/.test(dash)) fail('…and when the animal is next seen')
if (!/if \(summary\?\.nextAppointment\) \{/.test(dash)) fail('…with no empty tile when nothing is booked')
if (!/if \(s === 'pets'\) \{/.test(dash)) fail('…and only for a vertical that has pets at all')

// M11 residual — the chip says what the vertical calls it
const badge = read('packages/tenant-ui/src/invoicing/ui.tsx')
if (!/export function StatusBadge\(\{ status, label \}: \{ status: string; label\?: string \}\)/.test(badge)) {
  fail('a status badge must accept the vertical\'s own word for the value')
}
if (!/\{\(label \|\| status\)\.replace\(/.test(badge)) fail('…and print it')
const list = read('packages/tenant-ui/src/contacts/ContactsPage.tsx')
if (!/<StatusBadge status=\{String\(val \|\| ''\)\} label=\{typeLabel\(String\(val \|\| ''\)\)\} \/>/.test(list)) {
  fail('the contacts list must label the type chip — a clinic\'s row read "client"')
}
if (!/const plural = \(s: string\)/.test(list)) fail('the stat cards must pluralise the vertical\'s noun ("Enquiries", not "Enquirys")')
if (!/\{plural\(t\.label\)\}/.test(list)) fail('…and use it')
const detail = read('packages/tenant-ui/src/contacts/ContactDetailPage.tsx')
if (!/<StatusBadge status=\{contact\.type\} label=\{cfg\.types\.find\(\(t\) => t\.value === contact\.type\)\?\.label\} \/>/.test(detail)) {
  fail('the contact page header must label it too')
}

if (failed) { console.error(`\nT24 re-test: ${failed} check(s) FAILED`); process.exit(1) }
console.log('T24 re-test: a send that failed is not recorded, the vet portal leads with the pets, and a type chip says Owner')
