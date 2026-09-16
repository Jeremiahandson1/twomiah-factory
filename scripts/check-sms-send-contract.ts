// CI guard: every sender of a text speaks the ONE contract POST /api/sms/send accepts —
// { contactId | toPhone, message }. The Messages "New Message" form sent { to, body } from the day it was
// written and every send died with "Message is required" (events T15 H2); the contact page and the thread
// reply were right all along. Form and route are pinned to each other here. (#161)
//   bun scripts/check-sms-send-contract.ts
import { readFileSync } from 'node:fs'
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const read = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'))

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// the route
const sms = read('packages/tenant-backend/src/integrations/sms.ts')
const route = sms.slice(sms.indexOf("app.post('/send'"), sms.indexOf("app.post('/conversations/:id/reply'"))
if (!/const \{ contactId, toPhone, message, jobId, templateId \} = await c\.req\.json\(\)/.test(route)) fail('POST /api/sms/send must read { contactId, toPhone, message, jobId, templateId }')
if (!/if \(!message\) return c\.json\(\{ error: 'Message is required' \}, 400\)/.test(route)) fail('POST /api/sms/send must require message')
if (!/if \(!contactId && !toPhone\) return c\.json/.test(route)) fail('POST /api/sms/send must require contactId or toPhone')

// every frontend sender in the shared UI
const senders: Array<[string, RegExp]> = [
  ['packages/tenant-ui/src/marketing/MessagesPage.tsx', /api\.post\('\/api\/sms\/send', \{ toPhone: to, \.\.\.\(contactId \? \{ contactId \} : \{\}\), message: body\.trim\(\) \}\)/],
  ['packages/tenant-ui/src/contacts/ContactDetailPage.tsx', /api\.post\('\/api\/sms\/send', \{ contactId: id, message: smsInput \}\)/],
]
for (const [p, re] of senders) {
  const src = read(p)
  if (!re.test(src)) fail(`${p} must post { contactId | toPhone, message } to /api/sms/send`)
  const calls = src.match(/api\.post\('\/api\/sms\/send'[^)]*\)/g) || []
  for (const call of calls) if (/\bto:|\bbody:/.test(call)) fail(`${p} sends the old { to, body } payload: ${call}`)
}
// the New Message modal links the thread to the picked contact and opens the thread the route answered with
const page = read('packages/tenant-ui/src/marketing/MessagesPage.tsx')
if (!/setContactId\(c\.id\)/.test(page) || !/setTo\(v\); setContactId\(null\)/.test(page)) fail('NewMessageModal must remember the picked contact and drop it when the destination is retyped')
if (!/onSent\(r\?\.conversationId \? \{ id: r\.conversationId \} : null\)/.test(page)) fail('NewMessageModal must open the thread by the conversationId the route returns')

if (failed) { console.error(`\nsms send contract: ${failed} check(s) FAILED`); process.exit(1) }
console.log('sms send contract: the Messages form, the contact page and POST /api/sms/send agree on { contactId | toPhone, message }')
