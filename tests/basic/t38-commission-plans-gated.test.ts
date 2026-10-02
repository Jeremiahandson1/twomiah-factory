// crm-basic — GET /commissions/plans had no gate, so anyone signed in read the pay structure. (T38)
//
// Found by driving every GET crm-basic declares against basictest as owner, manager AND a `user`
// seat — the role dimension, which no round on this template had ever had, because the tenant only
// had the owner login until this round.
//
// The file's own precedent is what made it stand out. In routes/commissions.ts:
//
//   POST   /plans           requirePermission('commissions:create')
//   PUT    /plans/:id       requirePermission('commissions:update')
//   DELETE /plans/:id       requirePermission('commissions:delete')
//   GET    /summary/by-user requirePermission('commissions:read')
//   GET    /                self-scopes — "Without commissions:read you see yourself"
//   GET    /plans           ← nothing
//
// Every write on the plans was gated and both sibling reads were handled. The one read that was
// missed returns each plan's name, type, flat rate, percentage, tier table and the role it applies
// to — the whole pay structure, to a coach on a gym's front desk or a labourer.
//
// NOTHING LEAKED ON THE TEST TENANT, because no plans existed yet. That is the same shape as the
// change-order signing record on the contractor: harmless until the feature is actually used, at
// which point it is live. So the fixture here CREATES a plan — a test that asserts a refusal over
// an empty table proves nothing about what is withheld.
//
// AND THE REFUSAL'S CALLER IS TESTED TOO. CommissionsPage loaded the records and the plans in one
// Promise.all with a catch that only logged, so gating /plans would have blanked the staff member's
// own earnings list as well and left them an empty table with no explanation — a correct refusal
// turned into a broken screen. The last block asserts the thing that makes the screen survive: the
// self-scoped earnings read still answers for someone who is refused the plans.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, commission, commissionPlan } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Showcase Gym', slug: 'showcase-gym-commissions', email: 'gym@test.local', state: 'OH',
  settings: {}, enabledFeatures: ['commission_tracking'],
} as any).returning()

const seat = async (email: string, role: string, firstName: string) => {
  const [u] = await db.insert(user).values({
    email, passwordHash: 'x', firstName, lastName: 'Seat', role, companyId: co.id, isActive: true,
  } as any).returning()
  return u
}
const owner = await seat('owner@gym.local', 'owner', 'Olive')
const manager = await seat('manager@gym.local', 'manager', 'Morgan')
const staff = await seat('staff@gym.local', 'user', 'Sam')

// THE PAY STRUCTURE. Without this row the refusal below would be indistinguishable from an empty
// table, which is exactly how the fault survived on the live tenant.
const [plan] = await db.insert(commissionPlan).values({
  companyId: co.id, name: 'Senior coach — 12% of invoice', planType: 'percent_of_invoice',
  percentRate: '12', appliesToRole: 'technician',
} as any).returning()

// One earning event each, so "you see yourself" can be told apart from "you see everything".
await db.insert(commission).values([
  { companyId: co.id, userId: staff.id, baseAmount: '400', commissionAmount: '48', status: 'pending' },
  { companyId: co.id, userId: manager.id, baseAmount: '900', commissionAmount: '108', status: 'pending' },
] as any)

const app = new Hono()
app.route('/api/commissions', (await import('./src/routes/commissions.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager), asStaff = as(staff)

// ══════════ GET /plans — the pay structure ════════════════════════════════════════════════════
{
  const o = await asOwner('GET', '/api/commissions/plans')
  check('the owner reads the plans', o.status === 200 && o.json?.data?.length === 1, { status: o.status, body: o.text?.slice(0, 160) })
  // percentRate is decimal(5,2), so Postgres hands back '12.00' — compared as a number, or the
  // assertion would be about the column's scale rather than the rate.
  check('…and the rate is in there, so the test is looking at real content',
    o.json?.data?.[0]?.name === 'Senior coach — 12% of invoice' && Number(o.json?.data?.[0]?.percentRate) === 12,
    o.json?.data?.[0])

  // manager holds commissions:read.
  const m = await asManager('GET', '/api/commissions/plans')
  check('a manager reads the plans — they hold commissions:read', m.status === 200 && m.json?.data?.length === 1, { status: m.status, body: m.text?.slice(0, 160) })

  // a `user` seat holds neither commissions:read nor commissions:*.
  const s = await asStaff('GET', '/api/commissions/plans')
  check('a `user` seat is REFUSED the plans', s.status === 403, { status: s.status, body: s.text?.slice(0, 200) })
  check('…and the rate is nowhere in what they got back', !/12|Senior coach/.test(s.text), s.text?.slice(0, 200))
}

// ══════════ GET /summary/by-user — gated before this round, still gated ══════════════════════
{
  const s = await asStaff('GET', '/api/commissions/summary/by-user')
  check('a `user` seat is still refused the per-person totals', s.status === 403, { status: s.status })
  const m = await asManager('GET', '/api/commissions/summary/by-user')
  check('…and a manager still gets them', m.status === 200, { status: m.status, body: m.text?.slice(0, 140) })
}

// ══════════ GET / — the screen survives the refusal ══════════════════════════════════════════
//
// This is the assertion that makes the gate safe to ship. The staff member must still be able to
// read their OWN earnings; if this went to 403 too, the fix would have taken the screen with it.
{
  const s = await asStaff('GET', '/api/commissions')
  check('a `user` seat still reads their own earnings', s.status === 200, { status: s.status, body: s.text?.slice(0, 160) })
  const rows = s.json?.data || []
  check('…exactly one row, their own', rows.length === 1 && rows[0]?.userId === staff.id, rows.map((r: any) => ({ userId: r.userId, amt: r.commissionAmount })))
  check('…and the manager\'s $108 is not in it', !rows.some((r: any) => String(r.commissionAmount) === '108.00' || String(r.commissionAmount) === '108'), rows)

  const o = await asOwner('GET', '/api/commissions')
  check('the owner sees both people\'s earnings', (o.json?.data || []).length === 2, (o.json?.data || []).length)
}

// ══════════ the writes were already gated — confirm the round did not loosen one ═════════════
{
  const s = await asStaff('POST', '/api/commissions/plans', { name: 'self-serve raise', planType: 'percent_of_invoice', percentRate: 99 })
  check('a `user` seat cannot create a plan', s.status === 403, { status: s.status, body: s.text?.slice(0, 160) })
  const u = await asStaff('PUT', `/api/commissions/plans/${plan.id}`, { name: 'nope', planType: 'percent_of_invoice', percentRate: 99 })
  check('…nor edit one', u.status === 403, { status: u.status })
  const d = await asStaff('DELETE', `/api/commissions/plans/${plan.id}`)
  check('…nor delete one', d.status === 403, { status: d.status })

  // And the plan is untouched after all that.
  const o = await asOwner('GET', '/api/commissions/plans')
  check('the plan survived the three refused writes',
    o.json?.data?.length === 1 && Number(o.json?.data?.[0]?.percentRate) === 12, o.json?.data)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
