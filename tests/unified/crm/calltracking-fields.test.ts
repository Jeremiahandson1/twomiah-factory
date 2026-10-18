// ADAPTED COPY of tests/crm/calltracking-fields.test.ts, for the unified app (tests/unified/crm/harness/run.ts). Unchanged except the
// 1 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/harness/unified-divergences.ts names the assertions this copy stands in for.
// The call-tracking screen is answered under the names it reads. (Launch list, 10/17; crm-bar/crm-basic T57)
//
// The service read call_log and tracking_number with raw SQL and handed the snake_case rows straight out, while
// CallTrackingPage.tsx reads camelCase — so the caller, number, time, recording and first-time flag, and the tracking
// numbers' Phone Number, Forward To and call count, rendered blank. The field names are taken from the PAGE, so a
// field the page starts reading tomorrow is checked too.
import { Hono } from 'hono'
import { readFileSync, existsSync } from 'node:fs'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S: any = await import('./db/schema.ts')
const [co] = await db.insert(S.company).values({ name: 'Call Co', slug: 'call-co', email: 'o@call.test', settings: {}, enabledFeatures: ['call_tracking'] } as any).returning()
const [owner] = await db.insert(S.user).values({ email: 'o@call.test', passwordHash: 'x', firstName: 'O', lastName: 'W', role: 'owner', companyId: co.id, isActive: true } as any).returning()
const [tn] = await db.insert(S.trackingNumber).values({ phoneNumber: '+17155550100', forwardTo: '+17155550199', name: 'Google Ads', source: 'google', companyId: co.id } as any).returning()
await db.insert(S.callLog).values({ companyId: co.id, trackingNumberId: tn.id, callerNumber: '+17155550142', callerName: 'Jo Caller', source: 'google', duration: 95, status: 'completed', startTime: new Date('2026-10-17T15:00:00Z'), recordingUrl: 'https://rec.example/1.mp3', firstTimeCaller: true } as any)

const app = new Hono()
app.route('/api/calltracking', (await import('./src/routes/calltracking.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// The page this sandbox was built from (the runner passes FACTORY_ROOT; the template is the suite's own).
const root = process.env.FACTORY_ROOT
const pagePath = root ? `${root}/templates/crm/frontend/src/pages/calltracking/CallTrackingPage.tsx` : ''
check('the page is found', !!pagePath && existsSync(pagePath), pagePath)
const page = pagePath && existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : ''
const reads = (v: string) => [...new Set([...page.matchAll(new RegExp(`\\b${v}\\.(\\w+)`, 'g'))].map((m) => m[1]))]

const calls = await get('/api/calltracking/calls')
const call = calls.json?.data?.[0]
check(`the call list answers (${calls.status})`, calls.status === 200 && !!call, calls.json)
const callKeys = reads('call')
check('the page reads at least the caller, number, time and recording', ['callerName', 'callerNumber', 'startTime', 'recordingUrl', 'firstTimeCaller'].every((k) => callKeys.includes(k)), callKeys)
for (const k of callKeys) check(`a call carries "${k}", which the page reads`, !!call && k in call, call && Object.keys(call))
check('…with the stored values', call?.callerName === 'Jo Caller' && call?.callerNumber === '+17155550142' && call?.firstTimeCaller === true && call?.recordingUrl === 'https://rec.example/1.mp3')
check('…and no snake_case copies left over', !!call && !('caller_number' in call) && !('start_time' in call), call && Object.keys(call))

const nums = await get('/api/calltracking/numbers')
const num = nums.json?.data?.[0] ?? null /* unified: the numbers are a list reply */
check(`the tracking numbers answer (${nums.status})`, nums.status === 200 && !!num, nums.json)
const numKeys = reads('num').filter((k) => k !== 'id')
for (const k of numKeys) check(`a tracking number carries "${k}", which the page reads`, !!num && k in num, num && Object.keys(num))
check('…its number, forward-to and call count', num?.phoneNumber === '+17155550100' && num?.forwardTo === '+17155550199' && Number(num?.callCount) === 1, num)
check('the page reads the count the API sends, not a Prisma _count', !/_count/.test(page) && numKeys.includes('callCount'))

const one = await get(`/api/calltracking/calls/${call?.id}`)
check(`one call opens under the same names (${one.status})`, one.status === 200 && one.json?.callerNumber === '+17155550142', one.json)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
