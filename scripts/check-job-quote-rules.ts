// CI guard: completing a job records when (whichever way it is completed), a quote needs a line and an expiry that
// hasn't passed, and the quote edit reads its lines inside its own transaction (going back to the pool mid-transaction
// deadlocks when the pool is busy). (Landscaping T14 L13, L14 + the hang found while testing them)
//   bun scripts/check-job-quote-rules.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const jobs = read('packages/tenant-backend/src/jobs/jobs.ts')
if (!/const completedAt = data\.status === undefined \|\| data\.status === existing\.status \? undefined\s*\n\s*: data\.status === 'completed' \? \(existing\.completedAt \?\? new Date\(\)\)\s*\n\s*: existing\.completedAt \? null : undefined/.test(jobs)) fail('editing a job to completed must stamp completedAt (and clear it when it leaves completed)')
if (!/\.\.\.\(completedAt !== undefined \? \{ completedAt \} : \{\}\),/.test(jobs)) fail('the job update must write that stamp')
if (!/transition\('complete', 'completed', \(\) => o\.onComplete, \(\) => \(\{ completedAt: new Date\(\) \}\)\)/.test(jobs)) fail('the Complete action must still stamp completedAt')
// …and the lifecycle buttons follow the same rule as the dropdown: Start and Dispatch only wrote the status, so
// reopening a finished job left the old completion time on it and "Completed today" kept counting it (T26 M1).
if (!/\.\.\.\(status === 'completed' \? \{\} : \{ completedAt: null \}\),/.test(jobs)) fail('Start and Dispatch must clear the completion time — a reopened job must not still claim it was finished')
// …and a BULK status change follows the same rule: it stamped on completion but never cleared, so a job bulk-moved
// back out of completed still claimed it was finished, and re-completing overwrote the original time.
const bulk = read('packages/tenant-backend/src/bulk/bulk.ts')
const fromBulkStatus = bulk.slice(bulk.indexOf('async function bulkUpdateJobStatus('))
const bulkStatus = fromBulkStatus.slice(0, fromBulkStatus.indexOf('\n  async function', 1) + 1 || undefined)
if (!/updates\.completedAt = sql`COALESCE\(\$\{job\.completedAt\}, \$\{new Date\(\)\}\)`/.test(bulkStatus)) fail('a bulk complete must keep the original completion time when the job was already completed')
if (!/\} else \{\s*\n\s*updates\.completedAt = null;/.test(bulkStatus)) fail('a bulk status change away from completed must clear the completion time')

// a date the calendar has (30 February rolled to 2 March), a title with a length, work assigned only to someone who
// can log in (with a message that says why), and '' on an edit meaning "clear it" (T21 M5, M6, L1)
if (!/const m = v\.match\(\/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\/\)/.test(jobs) || !/d\.getUTCFullYear\(\) === \+m\[1\] && d\.getUTCMonth\(\) \+ 1 === \+m\[2\] && d\.getUTCDate\(\) === \+m\[3\]/.test(jobs)) fail('a date-only value must round-trip its own year-month-day (30 February must be refused)')
if (!/title: cleanText\(1\)\.pipe\(z\.string\(\)\.max\(200, 'Title must be 200 characters or fewer'\)\)/.test(jobs)) fail('a job title must have a maximum length')
// Work is assigned to a login user OR a roster-only crew member — one resolver decides which, so a job never
// carries both, and the ids that are nobody (or another company's, or inactive) are still refused. (T21 M12, #223)
if (!/const resolveAssignee = async \(companyId: string, assignedToId: unknown, memberId\?: unknown\): Promise<Assignee>/.test(jobs)) fail('one resolver must decide who a job is assigned to')
if (!/if \(u\) return \{ assignedToId: u\.id, assignedToMemberId: null \}/.test(jobs) || !/if \(m && m\.active\) return \{ assignedToId: null, assignedToMemberId: m\.id \}/.test(jobs)) fail('a login user and a roster member must land in their own column, never both')
if (!/That crew member is marked inactive on the Team page/.test(jobs)) fail('an inactive crew member must be refused with a message that says why')
if (!/That person is not on your team\. Pick someone from the list, or add them on the Team page first\./.test(jobs)) fail('an id that is nobody must still be refused')
if (/Only team members with a login can be assigned/.test(jobs)) fail('the old "logins only" refusal must be gone — roster crew are assignable now')
if ((jobs.match(/who = await resolveAssignee\(currentUser\.companyId, data\.assignedToId, data\.assignedToMemberId\)/g) || []).length < 2) fail('both create and edit must resolve the assignee')
if ((jobs.match(/if \(who\.error\) return c\.json\(\{ error: who\.error \}, 400\)/g) || []).length < 2) fail('both create and edit must refuse when the resolver rejects the person (otherwise the assignee is silently dropped)')
{
  const resolver = jobs.slice(jobs.indexOf('const resolveAssignee'), jobs.indexOf('const assigneeIdOf'))
  if (!/db\.select\(\{ id: t\.user\.id \}\)\.from\(t\.user\)/.test(resolver)) fail('the resolver must look the person up among the login users')
  if (!/db\.select\(\{ id: t\.teamMember\.id, active: t\.teamMember\.active \}\)\.from\(t\.teamMember\)/.test(resolver)) fail('…and then among the roster')
}
if (!/assignedToId \? eq\(t\.job\.assignedToId, assignedToId\) : eq\(t\.job\.assignedToMemberId, memberId as string\)/.test(jobs)) fail('double-booking must be checked for a roster member too')
if (!/for \(const k of \['assignedToId', 'assignedToMemberId', 'contactId', 'projectId'\] as const\) \{\s*\n\s*if \(Object\.prototype\.hasOwnProperty\.call\(raw, k\) && \(raw\[k\] === '' \|\| raw\[k\] === null\)\) data\[k\] = null/.test(jobs)) fail("an edit sending '' for a link must clear it, including a roster assignee (Unassign did nothing)")
const jobsPage = read('packages/tenant-ui/src/jobs/JobsPage.tsx')
if (!/r\.contact \? r\.contact\.name : 'No customer'/.test(jobsPage)) fail('a job with no customer must say so in the list')
// …and the three surfaces that read the assignee must cope with a roster-only crew member (T21 M12)
if (!/assignedToId: item\.assignedToId \|\| item\.assignedToMemberId \|\| ''/.test(jobsPage)) fail('opening a crew-assigned job for editing must keep them selected (it reset to Unassigned, and saving unassigned them)')
if (!/a\.name \|\| `\$\{a\.firstName \|\| ''\} \$\{a\.lastName \|\| ''\}`\.trim\(\)/.test(jobsPage)) fail('the Assigned To column must show either kind of person')
const reporting = read('packages/tenant-backend/src/reporting/reporting.ts')
const byAssignee = reporting.slice(reporting.indexOf('async function jobsByAssignee('), reporting.indexOf('async function projectStats('))
if (!/hasRoster \? or\(isNotNull\(t\.job\.assignedToId\), isNotNull\(t\.job\.assignedToMemberId\)\) : isNotNull\(t\.job\.assignedToId\)/.test(byAssignee)) fail('team productivity must count jobs done by roster-only crew as well')
if (!/kind: 'member'/.test(byAssignee)) fail('…and say which kind of person each row is')
const sms = read('packages/tenant-backend/src/integrations/sms.ts')
if (!/else if \(jobRow\.assignedToMemberId && t\.teamMember\)/.test(sms)) fail('the "on the way" text must name a roster-only assignee (it said "Your technician")')

const quotes = read('packages/tenant-backend/src/invoicing/quotes.ts')
if (!/if \(!data\.lineItems\.length\) return c\.json\(\{ error: 'Add at least one line item\.' \}, 400\)/.test(quotes)) fail('a quote must have at least one line item')
if (!/if \(exp\.value && exp\.value < today\) return c\.json\(\{ error: 'Expiry date is in the past — pick today or later\.' \}, 400\)/.test(quotes)) fail('a quote must not be created with an expiry date in the past')
// …measured on the BUSINESS's calendar. This guard used to require `startOfToday()`, which is the UTC day:
// from 19:00 Central the server refused a quote expiring on the date the business was still living in, and
// the guard had that defect written into it as the rule. (T28 M4 family)
if (!/const today = businessToday\(await deps\.options\?\.timeZoneFor\?\.\(cid\)\)/.test(quotes)) fail('the expiry comparison must use the business day (businessToday), not the server clock')
// Read the CODE for this one, not the prose: the file explains in a comment why startOfToday is gone,
// and a bare search would fail the very file that carries the fix.
const quotesCode = quotes.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
if (/startOfToday/.test(quotesCode)) fail('startOfToday is the UTC day — it must not decide whether a quote has already expired')
const update = quotes.slice(quotes.indexOf("app.put('/:id'"), quotes.indexOf("app.delete('/:id'"))
if (/await lineRows\(id\)/.test(update.slice(update.indexOf('db.transaction')))) fail('the quote edit must not read lines through the pool inside its transaction (deadlock)')
if (!/items = await tx\.select\(\)\.from\(t\.quoteLineItem\)\.where\(eq\(t\.quoteLineItem\.quoteId, id\)\)/.test(update)) fail('the quote edit must read its lines on the transaction')

const page = read('packages/tenant-ui/src/invoicing/QuotesPage.tsx')
if (!/if \(linesForSave\.length === 0\) \{ toast\.error\('Add at least one line item'\); return \}/.test(page)) fail('the quote form must ask for a line item before saving')
if (!/form\.expiryDate < todayKey\(\)/.test(page)) fail('the quote form must refuse an expiry date in the past on a new quote')
// …against the VIEWER's own calendar; toISOString() is UTC and refused a date they were still living in.
if (/expiryDate < new Date\(\)\.toISOString/.test(page)) fail('the quote form must not measure "past" against the UTC day')
if (failed) { console.error(`\njob and quote rules: ${failed} check(s) FAILED`); process.exit(1) }
console.log('job and quote rules: completion is stamped, a quote needs a line and a live expiry, the edit stays on its transaction')
