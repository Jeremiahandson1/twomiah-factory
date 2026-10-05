// crm-fieldservice — labour is priced from the rate the Team page actually writes. (T42)
//
// I owed the owner "set hourly rates on fstest's users so job costing shows real figures". Going to
// do it is how this was found: there is nowhere to set them.
//
//     jobCosting.ts   COALESCE(time_entry.hourly_rate, user.hourly_rate)
//
// `user.hourly_rate` is a real column in four templates and NOTHING in the worktree writes it — no
// route, no service, no screen. tenant-ui's Team page reports `hourlyRate: null` for every login row
// on purpose (team.ts:147). The rate a shop actually types goes to the ROSTER,
// `team_member.hourly_rate`, and time.ts prices the same hours off it, matching roster to login by
// email. So the two screens disagreed about the same labour: the time report gave a real figure and
// job costing said $0.00 with the hours marked "unrated".
//
// WHY THE SUITE WAS GREEN OVER IT. t32-job-costing sets `hourlyRate: '41.50'` straight onto the user
// row with a raw insert — something no caller in the product can do. The test proved the COALESCE
// worked; it could not notice that the column it was filling is unreachable. So this file goes the
// other way round: nothing writes user.hourly_rate here, and the rate is put where a person would
// actually put it.
//
// Four states, because the order of the fallback is the behaviour:
//
//   1 · an entry with its own stamped rate      → that rate wins, roster or no roster
//   2 · no stamped rate, a roster rate          → the roster rate prices it   ← the fix
//   3 · no stamped rate, a roster rate of 0     → still unrated: 0 is a blank, not "free"
//   4 · no stamped rate, nobody on the roster   → unrated, priced at nothing and REPORTED
//
// …and the per-row detail must agree with the grouped roll-up to the cent in every one of them,
// because they are two different queries and the whole point of the fix is that they resolve a rate
// the same way.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 340)) }
}
const isMoney = (got: unknown, want: number) => Math.abs(Number(got) - want) < 0.005

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const schema: any = await import('./db/schema.ts')
const { company, user, contact, job, timeEntry, teamMember } = schema

check('the roster table is the one the Team page writes, and it carries a rate',
  !!teamMember && 'hourlyRate' in teamMember, Object.keys(teamMember || {}).filter((k) => /rate/i.test(k)))

const [co] = await db.insert(company).values({
  name: 'FS Roster Rate', slug: 'fs-roster-rate-t47', email: 'frr@test.local', state: 'OH', settings: {},
  enabledFeatures: ['job_costing', 'time_tracking', 'team'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-frr@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Reed',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()

/**
 * Four engineers, and NOT ONE of them has user.hourly_rate set — because nothing in the product can
 * set it. That is the whole premise: if this test passes while leaving that column null, the figure
 * is coming from somewhere a person can actually reach.
 */
const mkTech = async (tag: string) => (await db.insert(user).values({
  email: `${tag}-frr@test.local`, passwordHash: 'x', firstName: tag, lastName: 'Tech',
  role: 'field', companyId: co.id, isActive: true,
} as any).returning())[0]
const stamped = await mkTech('Stamped')
const rostered = await mkTech('Rostered')
const zeroRate = await mkTech('Zeroed')
const unknown = await mkTech('Unknown')

check('no login carries user.hourly_rate — the column nothing writes stays empty',
  [stamped, rostered, zeroRate, unknown].every((u: any) => u.hourlyRate == null),
  [stamped, rostered, zeroRate, unknown].map((u: any) => u.hourlyRate))

// The roster, as the Team page writes it: matched to the login by email.
await db.insert(teamMember).values({
  companyId: co.id, name: 'Rostered Tech', email: 'rostered-frr@test.local', role: 'Technician',
  active: true, hourlyRate: '38.00',
} as any)
await db.insert(teamMember).values({
  companyId: co.id, name: 'Zeroed Tech', email: 'zeroed-frr@test.local', role: 'Technician',
  active: true, hourlyRate: '0',
} as any)
// …and somebody on the roster with no email at all, who must not match anybody. A roster row like
// this is ordinary (crew with no login), and `lower(null) = lower(x)` is null, so it cannot join.
await db.insert(teamMember).values({
  companyId: co.id, name: 'No Email Crew', role: 'Labourer', active: true, hourlyRate: '99.00',
} as any)

const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Northgate Mill', type: 'customer' } as any).returning()
const DONE = new Date('2026-09-20T14:00:00Z')
const mkJob = async (number: string) => (await db.insert(job).values({
  companyId: co.id, contactId: client.id, number, title: `Call ${number}`,
  status: 'completed', completedAt: DONE,
} as any).returning())[0]

const jStamped = await mkJob('RR-1')
const jRoster = await mkJob('RR-2')
const jZero = await mkJob('RR-3')
const jUnknown = await mkJob('RR-4')

const hours = async (jobId: string, userId: string, h: string, rate?: string) => db.insert(timeEntry).values({
  companyId: co.id, userId, jobId, hours: h, date: DONE, description: 'On site',
  ...(rate === undefined ? {} : { hourlyRate: rate }),
} as any)
await hours(jStamped.id, stamped.id, '4.00', '52.00')   // 4 × 52 = 208.00
await hours(jRoster.id, rostered.id, '6.00')            // 6 × 38 = 228.00  ← the fix
await hours(jZero.id, zeroRate.id, '3.00')              // unrated
await hours(jUnknown.id, unknown.id, '5.00')            // unrated

const app = new Hono()
app.route('/api/job-costing', (await import('./src/routes/jobCosting.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const get = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

console.log('\n══════════ the grouped roll-up ══════════')
const s = await get('/api/job-costing/summary?limit=100')
check('the roll-up answers', s.status === 200, { status: s.status, body: s.text?.slice(0, 240) })
const row = (n: string) => (s.json?.jobs || []).find((x: any) => x.number === n)

check('a rate stamped on the entry still wins',
  isMoney(row('RR-1')?.laborCost, 208), { got: row('RR-1')?.laborCost, expected: 208 })

check('T42: no stamped rate → the ROSTER rate prices the labour (was $0.00)',
  isMoney(row('RR-2')?.laborCost, 228), { got: row('RR-2')?.laborCost, expected: 228, hours: row('RR-2')?.laborHours })
check('…and those hours are NOT reported as unrated any more',
  isMoney(row('RR-2')?.unratedLaborHours, 0), { unrated: row('RR-2')?.unratedLaborHours })

check('a roster rate of 0 is a blank, not "free" — still unrated',
  isMoney(row('RR-3')?.laborCost, 0) && isMoney(row('RR-3')?.unratedLaborHours, 3),
  { laborCost: row('RR-3')?.laborCost, unrated: row('RR-3')?.unratedLaborHours })

check('nobody on the roster → priced at nothing and REPORTED, not guessed',
  isMoney(row('RR-4')?.laborCost, 0) && isMoney(row('RR-4')?.unratedLaborHours, 5),
  { laborCost: row('RR-4')?.laborCost, unrated: row('RR-4')?.unratedLaborHours })

check('the hours themselves are never lost, rated or not',
  isMoney(row('RR-1')?.laborHours, 4) && isMoney(row('RR-2')?.laborHours, 6)
  && isMoney(row('RR-3')?.laborHours, 3) && isMoney(row('RR-4')?.laborHours, 5),
  ['RR-1', 'RR-2', 'RR-3', 'RR-4'].map((n) => row(n)?.laborHours))

console.log('\n══════════ …and the detail agrees to the cent ══════════')
for (const [n, j, want, rateKnown] of [
  ['RR-1', jStamped, 208, true],
  ['RR-2', jRoster, 228, true],
  ['RR-3', jZero, 0, false],
  ['RR-4', jUnknown, 0, false],
] as [string, any, number, boolean][]) {
  const d = await get(`/api/job-costing/job/${j.id}`)
  check(`${n}: the detail answers`, d.status === 200, { status: d.status, body: d.text?.slice(0, 200) })
  check(`${n}: …labour cost matches the roll-up`, isMoney(d.json?.actual?.laborCost, want),
    { detail: d.json?.actual?.laborCost, rollup: row(n)?.laborCost, expected: want })
  const line = (d.json?.laborDetail || [])[0]
  check(`${n}: …and the line says whether the rate is known rather than printing $0.00`,
    !!line && line.rateKnown === rateKnown, { rateKnown: line?.rateKnown, rate: line?.rate, expected: rateKnown })
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
