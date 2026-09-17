// CI guard: the RV AI Lead Responder never claims a message was sent unless it was. "Send text" posts to the CRM's
// real SMS send (POST /api/sms/send with the lead's contactId) and shows "Sent ✓" only after the server confirms;
// email opens the user's mail app (mailto) — there is no in-app email send, so nothing may say "Sent" for email.
// (found with RV T19 H3: both buttons flipped to "Sent ✓" without sending anything)
//   bun scripts/check-rv-ai-responder-send.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const page = read('templates/crm-rv/frontend/src/pages/rv/AILeadResponderPage.tsx')
const send = page.slice(page.indexOf('async function sendSms()'), page.indexOf('const mailto ='))
if (!send || !/await api\.post\('\/api\/sms\/send', \{ contactId: selected\.contactId, message: sms\.trim\(\) \}\);\s*setSmsSent\(true\);/.test(send)) fail('"Send text" must post to /api/sms/send and mark sent only after it succeeds')
if (!/catch \(e: any\) \{ setSmsError\(e\?\.message/.test(send)) fail('"Send text" must show the server\'s reason when the text is not sent')
if ((page.match(/setSmsSent\(true\)/g) || []).length !== 1) fail('only a confirmed send may set the text as sent')
if (/setSent\(|sent\.email|Send email|Live delivery sends/.test(page)) fail('no fake "sent" state or email send claim may remain')
if (!/href=\{mailto\(selected\.email\)\}/.test(page) || !/Open in email app/.test(page)) fail('email must open the mail app (mailto) rather than claim to send')
if (!/contactId: salesLead\.contactId/.test(read('templates/crm-rv/backend/src/routes/aiLeads.ts'))) fail('the lead inbox must return contactId for the text send')

if (failed) { console.error(`\nrv ai responder send: ${failed} check(s) FAILED`); process.exit(1) }
console.log('rv ai responder send: texts go through the real SMS send and show Sent only when confirmed; email opens the mail app')
