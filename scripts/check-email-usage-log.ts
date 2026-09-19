// CI guard: every email the product sends is recorded, so the usage counter means something.
//
// Settings › Integrations counts email_log for the month. The only writer was ever the marketing campaign
// sender, so a tenant who had emailed invoices all month still read "Usage this month: 0 emails" — the send
// happened and nothing recorded it. (Contractor T14 M23)
//
// The recorder is registered once per tenant and called from the email service's single send() choke point,
// so a new kind of email cannot be added and forgotten. Campaigns stay out of it: they go through sendRaw()
// and marketing.ts writes its own rows with the contact and campaign attached — recording them here too
// would double-count them.
//   bun scripts/check-email-usage-log.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const mod = read('packages/tenant-backend/src/emailLog.ts')
if (!mod) fail('packages/tenant-backend/src/emailLog.ts is missing — nothing records a send')
if (!/export function createEmailLogger/.test(mod)) fail('createEmailLogger must be exported')
if (!/export \{ createEmailLogger \} from '\.\/emailLog'/.test(read('packages/tenant-backend/src/index.ts'))) fail('…and re-exported, or a tenant cannot import it')
// recording is best-effort: the mail already went out
if (!/catch \(err\)/.test(mod) || !/logger\?\.warn/.test(mod)) fail('a logging failure must be swallowed — it must never turn a delivered email into a failed send')
if (!/if \(!t\?\.emailLog \|\| !t\?\.company\) return/.test(mod)) fail('a vertical without the table must be skipped rather than throwing')
if (!/sentAt: entry\.status === 'sent' \? new Date\(\) : null/.test(mod)) fail('only a sent email gets a sent time')
if (!/\.slice\(0, 500\)/.test(mod)) fail('the provider reason must be truncated before it is stored')

const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']
for (const t of TEMPLATES) {
  const email = read(`templates/${t}/backend/src/services/email.ts`)
  const index = read(`templates/${t}/backend/src/index.ts`)
  if (!email || !index) { fail(`templates/${t} is missing its email service or index`); continue }

  // the hook sits on the one choke point, on BOTH exits
  if (!/export function setEmailRecorder/.test(email)) fail(`${t}: the email service must accept a recorder`)
  if (!/void recordEmail\?\.\(\{ to, subject, status: 'sent' \}\)/.test(email)) fail(`${t}: a successful send must be recorded`)
  if (!/void recordEmail\?\.\(\{ to, subject, status: 'failed', errorMessage: \(error as Error\)\.message \}\)/.test(email)) fail(`${t}: a failed send must be recorded too — a bounce is still usage`)
  // …and the service stays provider-only, as its own header promises
  if (/from '\.\.\/\.\.\/db\//.test(email)) fail(`${t}: the email service must not reach for the database — the recorder is injected`)
  // campaigns must not be double-counted
  const sendRaw = email.match(/async function sendRaw[\s\S]*?\n\}/)?.[0] || ''
  if (/recordEmail/.test(sendRaw)) fail(`${t}: sendRaw must NOT record — marketing.ts already writes those rows, this would double-count campaigns`)

  // registered once, at startup
  if (!/setEmailRecorder\(createEmailLogger\(\{ db, tables: \{ emailLog, company \}, logger \}\)\)/.test(index)) fail(`${t}: the recorder must be registered at startup`)
  if (!/import \{ setEmailRecorder \} from '\.\/services\/email\.ts'/.test(index)) fail(`${t}: index must import the hook`)
  if (!/emailLog\b/.test(index.match(/^import \{[^}]*\} from '\.\.\/db\/schema\.ts'/m)?.[0] || '')) fail(`${t}: index must import the emailLog table`)
}

// the counter that reads it is still wired
const integrations = read('packages/tenant-backend/src/integrations/integrations.ts')
if (!/email: \{ enabled: settings\.emailEnabled !== false, usage: emailCount \}/.test(integrations)) fail('the integrations status must still report email usage')
if (!/gte\(t\.emailLog\.createdAt, startOfMonth\)/.test(integrations)) fail('…counted for this month')

if (failed) { console.error(`\nemail usage log: ${failed} check(s) FAILED`); process.exit(1) }
console.log('email usage log: every send is recorded once, and campaigns are not double-counted')
