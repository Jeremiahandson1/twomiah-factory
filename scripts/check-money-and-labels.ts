// CI guard: money the customer sees keeps its cents, a team rate is money, a count of one takes the singular label,
// and the Recurring Invoices tiles have their numbers. (Landscaping T14 L1, L2, L5, L6)
//   bun scripts/check-money-and-labels.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// The shared formatter (packages/tenant-ui/src/money.ts, a6b342dfa: one money() for every screen, the sign before the
// "$"). A page that hands its figure to it — with no digits of its own — shows what IT shows, so the rule is checked on
// what it prints, not on a toLocaleString the page no longer writes: cents always, thousands grouped.
const sharedMoney = (await import(ROOT + 'packages/tenant-ui/src/money.ts')).money as (n: unknown, digits?: number) => string
const SHARED_SHOWS_CENTS = sharedMoney(824.6) === '$824.60' && sharedMoney(1234.5) === '$1,234.50' && sharedMoney(-200) === '-$200.00'
if (!SHARED_SHOWS_CENTS) fail('the shared money() must show cents: $824.60, $1,234.50, -$200.00')
/** The page imports the shared money() (under `local`). */
const usesShared = (src: string, local: string) => src.includes(local === 'money' ? "import { money } from '../money'" : `import { money as ${local} } from '../money'`)

// L1 — the portal's money helpers both carry cents (moneyShort used to drop them: "$824.6")
const common = read('packages/tenant-ui/src/portal/common.tsx')
const portalOwn = /export const money = .*minimumFractionDigits: 2, maximumFractionDigits: 2/.test(common)
// …or the shared one, given the number alone (a second argument could ask for whole dollars).
const portalShared = usesShared(common, 'formatMoney') && common.includes('export const money = (n: unknown) => `${formatMoney(Number(n || 0))}`') && SHARED_SHOWS_CENTS
if (!portalOwn && !portalShared) fail('portal money() must show cents')
if (!/export const moneyShort = money\b/.test(common)) fail('portal moneyShort must show cents too (it is money)')
// L2 — a team rate is money
const team = read('packages/tenant-ui/src/people/TeamPage.tsx')
// Two decimals is the rule; `toFixed(2)` was only one way to get there. The Rate column now uses
// toLocaleString with minimumFractionDigits 2, which also groups thousands — so this accepts either
// formatter and still refuses a bare figure. (T41)
const TWO_DP = /\$\{Number\(v\)\.(?:toFixed\(2\)|toLocaleString\(undefined, \{ minimumFractionDigits: 2, maximumFractionDigits: 2 \}\))\}\/hr/
// …or the shared money(), given the number alone.
const teamShared = usesShared(team, 'money') && team.includes('`${money(Number(v))}/hr`') && SHARED_SHOWS_CENTS
if (!TWO_DP.test(team) && !teamShared) fail('the team Rate column must show 2 decimals')
// A login account's role is a PERMISSION role, and the Team page printed the stored slug — "field" and "user"
// on a page whose own Settings › Users calls both of them Staff. One vocabulary, one map. (T14 M10)
if (!/import \{ ROLE_LABELS \} from '\.\.\/shell\/types'/.test(team)) fail('the Team page must read the shared role vocabulary, not invent a second one')
if (!/row\._source === 'user' \? ROLE_LABELS\[String\(v\)\] \|\| v \|\| '-' : v \|\| '-'/.test(team)) fail("a login account's role must be shown as the word Settings uses, while a roster member's typed job title is left alone")
// A dialog echoes the button that opened it: "Add Contact" opened something headed "New Contact", and
// "Add Job" opened "New Job", while Quotes, Invoices, Expenses and Team already agreed with themselves. (T14 L3)
const contactsPage = read('packages/tenant-ui/src/contacts/ContactsPage.tsx')
// Since Bar Run 2 the noun is the vertical's (a bar's Guests page says "Add Guest"), so the rule is that the
// dialog and BOTH buttons read the same cfg.addLabel — never a literal that one of them could keep.
if (!/title=\{editing \? `Edit \$\{cfg\.addLabel\}` : `Add \$\{cfg\.addLabel\}`\}/.test(contactsPage)) fail('the contact dialog must say Add <noun> — the button that opens it')
if ((contactsPage.match(/\/>Add \{cfg\.addLabel\}<\/Button>/g) || []).length !== 2) fail('…and both Add buttons (header and empty list) must read cfg.addLabel')
if (/'(New|Add|Edit) Contact'|>Add Contact</.test(contactsPage)) fail('…and must not still hard-code the word Contact')
const jobsPage = read('packages/tenant-ui/src/jobs/JobsPage.tsx')
if (!/title=\{editing \? `Edit \$\{cfg\.labels\.singular\}` : cfg\.labels\.add\}/.test(jobsPage)) fail('the job dialog must reuse the button label, so a vertical that renames the button renames both')
if (/`New \$\{cfg\.labels\.singular\}`/.test(jobsPage)) fail('…and must not build its own "New X" title')

// One name per thing: the sidebar's "Email" item opened a page headed "Inbound Messages", while the SMS page
// next door was headed "Messages" like its own nav item — three names for two things. (T14 L2)
const inbox = read('packages/tenant-ui/src/settings/InboundMessagesPage.tsx')
// Its heading is its menu item's name (MenuName): "Email" in the templates' menus, "Email Inbox" in the unified one
// (store live test, 2026-10-26) — never a literal that one of those menus no longer says.
if (!/<h1 className="text-2xl font-bold mb-2"><MenuName fallback="Email" \/><\/h1>/.test(inbox)) fail('the inbound-email page must be headed by its menu item\'s name (<MenuName fallback="Email" />), as the templates\' menus say "Email"')
// rendered text only — the comment above the heading, and the component's own filename, both say the old name
if (/>Inbound Messages</.test(inbox)) fail('…and must not still render "Inbound Messages" as a heading')
if (!/The messages people sent to your business&rsquo;s email addresses/.test(inbox)) fail('…keeping the subtitle that explains what the page actually lists')
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
