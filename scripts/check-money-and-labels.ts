// CI guard: money the customer sees keeps its cents, a team rate is money, a count of one takes the singular label,
// and the Recurring Invoices tiles have their numbers. (Landscaping T14 L1, L2, L5, L6)
//   bun scripts/check-money-and-labels.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// L1 — the portal's money helpers both carry cents (moneyShort used to drop them: "$824.6")
const common = read('packages/tenant-ui/src/portal/common.tsx')
if (!/export const money = .*minimumFractionDigits: 2, maximumFractionDigits: 2/.test(common)) fail('portal money() must show cents')
if (!/export const moneyShort = money\b/.test(common)) fail('portal moneyShort must show cents too (it is money)')
// L2 — a team rate is money
const team = read('packages/tenant-ui/src/people/TeamPage.tsx')
if (!/\$\$\{Number\(v\)\.toFixed\(2\)\}\/hr/.test(team.replace(/\$\{/g, '$${')) && !/\$\{Number\(v\)\.toFixed\(2\)\}\/hr/.test(team)) fail('the team Rate column must show 2 decimals')
// A login account's role is a PERMISSION role, and the Team page printed the stored slug — "field" and "user"
// on a page whose own Settings › Users calls both of them Staff. One vocabulary, one map. (T14 M10)
if (!/import \{ ROLE_LABELS \} from '\.\.\/shell\/types'/.test(team)) fail('the Team page must read the shared role vocabulary, not invent a second one')
if (!/row\._source === 'user' \? ROLE_LABELS\[String\(v\)\] \|\| v \|\| '-' : v \|\| '-'/.test(team)) fail("a login account's role must be shown as the word Settings uses, while a roster member's typed job title is left alone")
// A dialog echoes the button that opened it: "Add Contact" opened something headed "New Contact", and
// "Add Job" opened "New Job", while Quotes, Invoices, Expenses and Team already agreed with themselves. (T14 L3)
const contactsPage = read('packages/tenant-ui/src/contacts/ContactsPage.tsx')
if (!/title=\{editing \? 'Edit Contact' : 'Add Contact'\}/.test(contactsPage)) fail('the contact dialog must say Add Contact — that is the button that opens it')
if (/'New Contact'/.test(contactsPage)) fail('…and must not still say New Contact')
const jobsPage = read('packages/tenant-ui/src/jobs/JobsPage.tsx')
if (!/title=\{editing \? `Edit \$\{cfg\.labels\.singular\}` : cfg\.labels\.add\}/.test(jobsPage)) fail('the job dialog must reuse the button label, so a vertical that renames the button renames both')
if (/`New \$\{cfg\.labels\.singular\}`/.test(jobsPage)) fail('…and must not build its own "New X" title')

// One name per thing: the sidebar's "Email" item opened a page headed "Inbound Messages", while the SMS page
// next door was headed "Messages" like its own nav item — three names for two things. (T14 L2)
const inbox = read('packages/tenant-ui/src/settings/InboundMessagesPage.tsx')
if (!/<h1 className="text-2xl font-bold mb-2">Email<\/h1>/.test(inbox)) fail('the inbound-email page must be headed "Email", the name of the nav item that opens it')
// rendered text only — the comment above the heading, and the component's own filename, both say the old name
if (/>Inbound Messages</.test(inbox)) fail('…and must not still render "Inbound Messages" as a heading')
if (!/Emails received on your "route into CRM" aliases/.test(inbox)) fail('…keeping the subtitle that explains what the page actually lists')
const sms = read('packages/tenant-ui/src/marketing/MessagesPage.tsx')
if (!/>Messages<\/h1>/.test(sms)) fail('the SMS page must stay headed "Messages", matching its own nav item')
for (const t of ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']) {
  const shell = read(`templates/${t}/frontend/src/shellConfig.ts`)
  if (!shell) continue
  if (/label: 'Email'/.test(shell) && !/to: '\/crm\/email', icon: Mail, label: 'Email'/.test(shell)) fail(`${t}: the Email nav item changed shape — the page heading is matched to it`)
}

const labels = read('packages/tenant-ui/src/shell/types.ts')
for (const [slug, word] of [['field', 'Staff'], ['user', 'Staff'], ['manager', 'Manager'], ['owner', 'Owner']]) {
  if (!new RegExp(`${slug}: '${word}'`).test(labels)) fail(`ROLE_LABELS must map ${slug} → ${word}`)
}
// L6 — one job is not "1 jobs"
const reports = read('packages/tenant-ui/src/reporting/ReportsPage.tsx')
if (!/const labelFor = \(n: number\) => \(n === 1 \? cfg\.jobsLabel\.replace\(\/s\$\/, ''\) : cfg\.jobsLabel\)\.toLowerCase\(\)/.test(reports)) fail('Reports must pick the singular label for a count of one')
// The team panel's count is optional now — a salon reports services and takings rather than hours and
// jobs (T28 M6) — so the call carries a default. It is still labelFor, on both counts.
if (!/\$\{labelFor\(jobs\.total\)\} in this period/.test(reports) || !/\{labelFor\(m\.jobsCompleted[^)]*\)\} completed/.test(reports)) fail('both job counts must use labelFor')
if (/\$\{cfg\.jobsLabel\.toLowerCase\(\)\} in this period/.test(reports) || /\{cfg\.jobsLabel\.toLowerCase\(\)\} completed/.test(reports)) fail('a job count still uses the plural label unconditionally')
// L5 — the Recurring Invoices tiles have numbers
const rec = read('packages/tenant-backend/src/recurring/recurring.ts')
const stats = rec.slice(rec.indexOf('async function getRecurringStats('), rec.indexOf('async function updateRecurringStatus('))
if (!/total: rows\(totalRes\)\[0\]\?\.count \|\| 0/.test(stats) || !/monthlyRecurringRevenue: Math\.round\(monthly \* 100\) \/ 100/.test(stats)) fail('recurring stats must return total and monthlyRecurringRevenue')
if (!/status = 'active'`\),\s*\]\)/.test(stats) || !/const perMonth = \(frequency: string\)/.test(stats)) fail('monthly revenue must come from the active schedules, by frequency')

if (failed) { console.error(`\nmoney and labels: ${failed} check(s) FAILED`); process.exit(1) }
console.log('money and labels: portal cents, team rate, singular job label, recurring totals')
