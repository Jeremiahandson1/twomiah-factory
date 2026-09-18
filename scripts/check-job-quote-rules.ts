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

const quotes = read('packages/tenant-backend/src/invoicing/quotes.ts')
if (!/if \(!data\.lineItems\.length\) return c\.json\(\{ error: 'Add at least one line item\.' \}, 400\)/.test(quotes)) fail('a quote must have at least one line item')
if (!/if \(exp\.value && exp\.value < startOfToday\(\)\) return c\.json\(\{ error: 'Expiry date is in the past — pick today or later\.' \}, 400\)/.test(quotes)) fail('a quote must not be created with an expiry date in the past')
if (!/const startOfToday = \(\) =>/.test(quotes)) fail('startOfToday must compare on the UTC calendar day')
const update = quotes.slice(quotes.indexOf("app.put('/:id'"), quotes.indexOf("app.delete('/:id'"))
if (/await lineRows\(id\)/.test(update.slice(update.indexOf('db.transaction')))) fail('the quote edit must not read lines through the pool inside its transaction (deadlock)')
if (!/items = await tx\.select\(\)\.from\(t\.quoteLineItem\)\.where\(eq\(t\.quoteLineItem\.quoteId, id\)\)/.test(update)) fail('the quote edit must read its lines on the transaction')

const page = read('packages/tenant-ui/src/invoicing/QuotesPage.tsx')
if (!/if \(linesForSave\.length === 0\) \{ toast\.error\('Add at least one line item'\); return \}/.test(page)) fail('the quote form must ask for a line item before saving')
if (!/form\.expiryDate < new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/.test(page)) fail('the quote form must refuse an expiry date in the past on a new quote')
if (failed) { console.error(`\njob and quote rules: ${failed} check(s) FAILED`); process.exit(1) }
console.log('job and quote rules: completion is stamped, a quote needs a line and a live expiry, the edit stays on its transaction')
