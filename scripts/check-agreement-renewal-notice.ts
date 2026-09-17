// CI guard: customers are emailed before an auto-renew service agreement renews (crm, crm-fieldservice,
// crm-landscaping). One notice per term, claimed on the row before sending and released if the email fails; sent by
// the worker / billing run only, never on a page read; the email says what renews, when, for how much and how to cancel.
//   bun scripts/check-agreement-renewal-notice.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const s = read('packages/tenant-backend/src/agreements/agreements.ts')
const fn = (name: string) => { const i = s.indexOf(`async function ${name}(`); if (i < 0) return ''; const j = s.indexOf('\n  async function ', i + 1); return s.slice(i, j < 0 ? undefined : j) }

if (!/return termMonths >= 12 \? 30 : termMonths >= 3 \? 14 : 0/.test(s)) fail('renewalNoticeDays must be 30 (yearly+), 14 (3–11 months), 0 (shorter)')
const notices = fn('sendRenewalNotices')
if (!notices) fail('sendRenewalNotices is missing')
if (!/eq\(serviceAgreement\.status, 'active'\), eq\(serviceAgreement\.renewalType, 'auto'\)/.test(notices)) fail('notices go to active auto-renew agreements only')
const claimRe = /\.set\(\{ renewalNoticeSentFor: end \}\)\.where\(and\(\s*eq\(serviceAgreement\.id, agr\.id\), eq\(serviceAgreement\.status, 'active'\),\s*sql`\(\$\{serviceAgreement\.renewalNoticeSentFor\} IS NULL OR \$\{serviceAgreement\.renewalNoticeSentFor\} <> \$\{serviceAgreement\.endDate\}\)`/
if (!claimRe.test(notices) || !/if \(!claimed\) continue/.test(notices)) fail('a notice must be claimed on the row (not yet sent for this end date) before sending')
if (!/\.set\(\{ renewalNoticeSentFor: agr\.renewalNoticeSentFor \?\? null \}\)/.test(notices)) fail('a failed email must release the claim so the next run retries')
if (notices.indexOf('await sendRenewalNotice(ct.email') < notices.indexOf('if (!claimed) continue')) fail('the email must be sent only after the claim')
if (!/eq\(contact\.id, agr\.contactId\), eq\(contact\.companyId, agr\.companyId\)/.test(notices)) fail("the customer must be loaded from the agreement's own company")
if (!/audit\?\.log\(\{ action: 'renewal_notice'/.test(notices)) fail('renewal notices must be audited')
if (!/await settleEndedAgreements\(companyId\)\s*const renewalNotices = await sendRenewalNotices\(companyId\)/.test(fn('processDueAgreements'))) fail('the billing run must settle ended agreements, then send renewal notices')
if ((s.match(/sendRenewalNotices\(/g) || []).length !== 2) fail('sendRenewalNotices must only be called from the billing run (never from a page read)')

for (const [t, tag] of [['crm', '0023_agreement_renewal_notice'], ['crm-fieldservice', '0017_agreement_renewal_notice'], ['crm-landscaping', '0018_agreement_renewal_notice']]) {
  const B = `templates/${t}/backend`
  if (!existsSync(join(ROOT, `${B}/db/migrations/${tag}.sql`)) || !/ALTER TABLE "service_agreement" ADD COLUMN IF NOT EXISTS "renewal_notice_sent_for" timestamp;/.test(read(`${B}/db/migrations/${tag}.sql`))) fail(`${t}: migration ${tag} must add renewal_notice_sent_for`)
  if (!JSON.parse(read(`${B}/db/migrations/meta/_journal.json`)).entries.some((e: any) => e.tag === tag)) fail(`${t}: ${tag} must be in the migration journal`)
  if (!/renewalNoticeSentFor: timestamp\('renewal_notice_sent_for'\)/.test(read(`${B}/db/schema.ts`))) fail(`${t}: schema must declare renewalNoticeSentFor`)
  const glue = read(`${B}/src/services/agreements.ts`)
  if (!/invoiceLineItem, company \}/.test(glue) || !/sendRenewalNotice: \(to: string, data: Record<string, unknown>\) => emailService\.send\(to, 'agreementRenewalNotice', data\)/.test(glue)) fail(`${t}: the agreements service must get the company table and sendRenewalNotice`)
  const email = read(`${B}/src/services/email.ts`)
  const tpl = email.slice(email.indexOf('agreementRenewalNotice: (data) =>'), email.indexOf('\n  }),', email.indexOf('agreementRenewalNotice: (data) =>')))
  if (!tpl.startsWith('agreementRenewalNotice')) fail(`${t}: email template agreementRenewalNotice is missing`)
  else {
    if (!/subject: `Your \$\{data\.agreementName\} renews on \$\{data\.renewalDate\}`/.test(tpl)) fail(`${t}: the notice subject must name the agreement and renewal date`)
    if (!tpl.includes('<strong>Amount:</strong> $${Number(data.amount)') || !tpl.includes('at $${data.amount} ${data.billingFrequency}')) fail(`${t}: the notice must show the amount with its dollar sign`)
    if (!/If you don't want it to renew, reply to this email or contact us/.test(tpl) || !/To cancel, reply to this email/.test(tpl)) fail(`${t}: the notice must say how to cancel`)
  }
}
if (failed) { console.error(`\nagreement renewal notice: ${failed} check(s) FAILED`); process.exit(1) }
console.log('agreement renewal notice: one claimed notice per term before auto-renewal, worker-only, with amount and how to cancel')
