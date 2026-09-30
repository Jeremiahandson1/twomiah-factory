// crm-salon — a pay period is whole SHOP days, and it includes its last one.
//
// Found by sweeping the dispensary's store-day family across the other templates. salon, vet and
// fieldservice all carried the identical line:
//
//     gte(timeEntry.date, new Date(startDate)),
//     lte(timeEntry.date, new Date(endDate)),
//
// time_entry.date is a TIMESTAMP; startDate/endDate are 'YYYY-MM-DD'. Two faults in one where-clause:
//
//   1. `new Date('2026-09-21')` is UTC MIDNIGHT, so a shift worked on the evening of the 21st in
//      Ohio (01:30Z on the 22nd) fell outside a period that starts on the 21st.
//   2. Worse, and nothing to do with time zones: the END bound is the last day's UTC midnight, so
//      a period ending Friday counted only the single instant Friday began. THE WHOLE LAST DAY OF
//      EVERY PAY PERIOD WAS MISSING — eight hours of somebody's week, every week.
//
// Fault 2 is why this file exists even though the salon test tenant is not in a cannabis state:
// it is a plain arithmetic bug about wages that a timezone discussion would have walked past.
//
// Pinned to fixed instants, never to `now`.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, timeEntry } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

// Ohio — UTC-4 in September, so the shop's day ends at 04:00Z.
const [co] = await db.insert(company).values({
  name: 'Payroll Salon', slug: 'payroll-sal', email: 'pay@test.local', state: 'OH',
  enabledFeatures: ['salon_booking'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-pay@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()
const [stylist] = await db.insert(user).values({
  email: 'stylist-pay@test.local', passwordHash: 'x', firstName: 'Sam', lastName: 'Stylist', role: 'staff', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/payroll', (await import('./src/routes/payroll.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// A shift on each of three days. The middle one is an EVENING shift whose UTC timestamp has already
// rolled into the next day; the last one is on the closing day of the period.
const shift = async (id: string, at: string, hours: string) => {
  await db.insert(timeEntry).values({
    id, companyId: co.id, userId: stylist.id, date: new Date(at), hours, hourlyRate: '20.00',
  } as any)
}
await shift('pp-mon-morning', '2026-09-21T14:00:00.000Z', '4')   // Mon 21st, 10am Ohio
await shift('pp-mon-evening', '2026-09-22T01:30:00.000Z', '3')   // Mon 21st, 9:30pm Ohio — 22nd in UTC
await shift('pp-fri-closing', '2026-09-25T18:00:00.000Z', '6')   // Fri 25th, 2pm Ohio — the last day

// Two boundary shifts that belong to NEITHER end of the 21st–25th period. Both exist because a
// mutation run went green without them: a wrong bound that includes too much is just as much a
// payroll error as one that includes too little, and the first draft of this file could only
// detect the latter.
await shift('pp-sun-evening', '2026-09-21T01:30:00.000Z', '5')   // Sun 20th, 9:30pm Ohio — 21st in UTC
await shift('pp-sat-midnight', '2026-09-26T04:00:00.000Z', '9')  // Sat 26th, 00:00 exactly, Ohio

const summary = await api('/api/payroll/summary?startDate=2026-09-21&endDate=2026-09-25')
check('the payroll summary answers', summary.status === 200, { status: summary.status, body: summary.json })

// The summary answers { payPeriodStart, payPeriodEnd, users: [...] }.
const rowsOf = (r: any) => (r.json?.users || []) as any[]
const mine = rowsOf(summary).find((u: any) => u?.user?.id === stylist.id)
check('…with a row for the stylist', !!mine, rowsOf(summary))

// 4 + 3 + 6 = 13. Any hours short of that is somebody's pay missing.
check('every hour worked in the period is paid — including the LAST day, which used to be cut off',
  Number(mine?.totalHours) === 13, { totalHours: mine?.totalHours, want: 13 })
check('…and the entry count agrees', Number(mine?.entryCount) === 3, { entryCount: mine?.entryCount })
check('…and the pay follows the hours at £/$20', Number(mine?.totalPay) === 260, { totalPay: mine?.totalPay })

// …and NOT the Sunday evening before it, nor the shift that starts the Saturday after. A bound
// that reaches too far pays somebody twice across two periods, which is the same defect wearing
// the other face.
check('…and not the previous evening\'s shift, which belongs to the period before',
  Number(mine?.entryCount) === 3, { entryCount: mine?.entryCount, want: 3 })

// The period before owns the Sunday evening shift, in full.
const earlier = await api('/api/payroll/summary?startDate=2026-09-14&endDate=2026-09-20')
const before = rowsOf(earlier).find((u: any) => u?.user?.id === stylist.id)
check('the previous period owns the Sunday evening shift', Number(before?.totalHours) === 5,
  { totalHours: before?.totalHours, want: 5 })
check('…and none of the 21st', Number(before?.entryCount) === 1, { entryCount: before?.entryCount })

// The period after owns the shift that begins exactly at midnight — the half-open boundary. An
// inclusive end would put it in BOTH periods.
const after = await api('/api/payroll/summary?startDate=2026-09-26&endDate=2026-09-26')
const nextP = rowsOf(after).find((u: any) => u?.user?.id === stylist.id)
check('the shift starting exactly at midnight belongs to the NEXT period', Number(nextP?.totalHours) === 9,
  { totalHours: nextP?.totalHours, want: 9 })

// …and a single-day period is a real day, not an empty instant.
const oneDay = await api('/api/payroll/summary?startDate=2026-09-21&endDate=2026-09-21')
const day = rowsOf(oneDay).find((u: any) => u?.user?.id === stylist.id)
check('a one-day period holds that whole day — both its shifts, morning and evening',
  Number(day?.totalHours) === 7, { totalHours: day?.totalHours, want: 7 })

// The closing day on its own, which is the case that used to return nothing at all.
const lastDay = await api('/api/payroll/summary?startDate=2026-09-25&endDate=2026-09-25')
const last = rowsOf(lastDay).find((u: any) => u?.user?.id === stylist.id)
check('…and a period that is only the closing day is not empty', Number(last?.totalHours) === 6,
  { totalHours: last?.totalHours, want: 6 })

// ══════════ …and the hours can actually be RECORDED ═════════════════════════════════════════════
//
// The point of the report above is that somebody gets paid, and until now nothing in the salon
// could write a time entry: no clock-in, no entry form, no screen. /api/payroll/summary was a
// report on a table that was always empty. The shared time module — mounted by crm, crm-basic,
// crm-fieldservice and crm-landscaping for a long time — is now mounted here too, so the entries
// the summary reads have a way to exist. (rule 3: a server feature an owner is meant to use has a
// screen)
{
  const timeApi = new Hono()
  timeApi.route('/api/time', (await import('./src/routes/time.ts')).default)
  timeApi.route('/api/payroll', (await import('./src/routes/payroll.ts')).default)
  timeApi.onError((await import('./src/utils/errors.ts')).errorHandler)
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await timeApi.request(path, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j }
  }

  const listed = await call('GET', '/api/time')
  check('the time module answers at all — there was no /api/time on this vertical', listed.status === 200, { status: listed.status, body: listed.json })

  // An evening hour in Ohio: 2026-09-11 21:00 local is 2026-09-12T01:00Z — a day that has happened,
  // which the module rightly insists on, and well clear of the pay period asserted above.
  const made = await call('POST', '/api/time', {
    userId: stylist.id, date: '2026-09-12T01:00:00.000Z', hours: 2, description: 'Late colour correction',
  })
  check('an hour can be RECORDED — nothing in this product could write one before',
    made.status === 200 || made.status === 201, { status: made.status, body: made.json })

  const future = await call('POST', '/api/time', {
    userId: stylist.id, date: '2027-01-01T12:00:00.000Z', hours: 2,
  })
  check('…and an hour cannot be logged for a day that has not happened', future.status === 400, future.status)

  const after = await call('GET', '/api/payroll/summary?startDate=2026-09-11&endDate=2026-09-11')
  const row = (after.json?.users || []).find((u: any) => u?.user?.id === stylist.id)
  check('…and the payroll summary now reports it, so the report is of something real',
    Number(row?.totalHours) === 2, { totalHours: row?.totalHours, want: 2 })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
