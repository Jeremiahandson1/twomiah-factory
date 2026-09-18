// CI guard: a reminder leaves a trace. Chasing a due vaccination sent the text and changed nothing — the due
// list looked identical the next morning, so nobody could tell what had already been done and the same client
// could be texted about the same shot every day (vet T12 M9). The stamp lands on the SHOT being chased and on
// the client, only for messages that actually went out.
//   bun scripts/check-reminder-state.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// the columns
const schema = read('templates/crm-vet/backend/db/schema.ts')
const vax = schema.match(/export const vaccination = pgTable[\s\S]*?\n\]\)/)?.[0] || ''
if (!/lastRemindedAt: timestamp\('last_reminded_at'\)/.test(vax)) fail('a vaccination must record when it was last chased')
if (!/reminderCount: integer\('reminder_count'\)\.default\(0\)\.notNull\(\)/.test(vax)) fail('…and how many times')
const ct = schema.match(/export const contact = pgTable[\s\S]*?\n\]\)/)?.[0] || ''
if (!/lastRemindedAt: timestamp\('last_reminded_at'\)/.test(ct)) fail('a client must record when they were last chased — the win-back list needs it too')
const migration = read('templates/crm-vet/backend/db/migrations/0026_reminder_sent_state.sql')
if (!/ALTER TABLE "vaccination" ADD COLUMN IF NOT EXISTS "last_reminded_at"/.test(migration)) fail('0026 must add the vaccination stamp to existing clinics')
if (!/ALTER TABLE "vaccination" ADD COLUMN IF NOT EXISTS "reminder_count"/.test(migration)) fail('…and the count')
if (!/ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "last_reminded_at"/.test(migration)) fail('…and the client stamp')
if (!/"tag": "0026_reminder_sent_state"/.test(read('templates/crm-vet/backend/db/migrations/meta/_journal.json'))) fail('…and the journal must list it, or it never runs')

// the route
const r = read('templates/crm-vet/backend/src/routes/reminders.ts')
if (!/lastRemindedAt: vaccination\.lastRemindedAt, reminderCount: vaccination\.reminderCount/.test(r)) fail('the due list must report what chasing has been done')
if (!/const REMINDED_RECENTLY_DAYS = 7/.test(r)) fail('…and what "recently" means')
if (!/remindedRecently: !!r\.lastRemindedAt && new Date\(r\.lastRemindedAt\)\.getTime\(\) >= recentCutoff/.test(r)) fail('…per row')
if (!/remindedRecently: data\.filter\(d => d\.remindedRecently\)\.length/.test(r)) fail('…and in the summary')
if (!/lastRemindedAt: contact\.lastRemindedAt/.test(r)) fail('the lapsed list must report it too')

const send = r.match(/app\.post\('\/send'[\s\S]*?\n\}\)/)?.[0] || ''
if (!send) fail('the send route is missing')
if (!/const vaccinationIds: string\[\] = Array\.isArray\(body\.vaccinationIds\)/.test(send)) fail('a send must be able to say WHICH shots it is about')
if (!/reached\.push\(ct\.id\)/.test(send)) fail('…and track who was actually reached')
if (!/if \(reached\.length\) \{/.test(send)) fail('…stamping only when something went out')
if (!/inArray\(patient\.ownerId, reached\)/.test(send)) fail('a shot is only chased if ITS owner was one of the people texted')
if (!/reminderCount: sql`\$\{vaccination\.reminderCount\} \+ 1`/.test(send)) fail('the count must increment, not reset')
if (!/set\(\{ lastRemindedAt: now, updatedAt: now \}\)/.test(send)) fail('the client must be stamped as well')
if (!/remindersRecorded: stamped/.test(send)) fail('the response must say what it recorded')

// the page
const page = read('templates/crm-vet/frontend/src/pages/vet/RemindersPage.tsx')
if ((page.match(/<th className="px-4 py-3 font-medium">Reminded<\/th>/g) || []).length < 2) fail('both tabs must show a Reminded column')
if (!/function ago\(s\?: string \| null\): string/.test(page)) fail('…in a form somebody can read at a glance')
if (!/vaccinationIds=\{tab === 'due' \? Array\.from\(selected\) : \[\]\}/.test(page)) fail('the due tab must tell the API which shots it is chasing')
if (!/vaccinationIds, message: message\.trim\(\)/.test(page)) fail('…and send them')
if (!/if \(tab === 'due'\) loadDue\(\); else loadLapsed\(\);/.test(page)) fail('the list must reload after a send, or the new stamp is invisible until a refresh')

if (failed) { console.error(`\nreminder state: ${failed} check(s) FAILED`); process.exit(1) }
console.log('reminder state: chasing a reminder is recorded against the shot and the client, and only when it is sent')
