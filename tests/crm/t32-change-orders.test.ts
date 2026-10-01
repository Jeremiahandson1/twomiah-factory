// T32 H2, H3, H4, H5 and L12 — change orders, which move the contract value and had no rules at all.
//
// H2  An approved change order's lines were edited to $99,999 and it stayed Approved. Approved →
//     Rejected → Approved went straight through. A draft was approved without being submitted. And
//     `approvedBy` came out of the request body, where the screen always put the string
//     "Current User" — so the one field recording who agreed to the money said nothing.
// H3  Approving one selection five times made FIVE $680 change orders. There was no state guard.
// H4  The project page summed EVERY change order it had been sent — drafts and pending ones — and
//     printed the total as contract money. And approving one moved nothing: +$2,877 and +3 days were
//     agreed and the project's value and end date stayed where they were.
// H5  A credit line (−$615) could not be typed on the screen, although the API accepted it.
// L12 Selection change orders were numbered CO-SEL-<epoch>, outside the project's CO-00x sequence,
//     in a status ('pending') the Change Orders screen does not draw.
import { Hono } from 'hono'
import { eq, sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const cents = (n: unknown) => Math.round(Number(n || 0) * 100)
const isMoney = (a: unknown, e: number) => cents(a) === cents(e)

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, project, changeOrder } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'CO Co', slug: 'co-co', email: 'co@test.local', state: 'OH', settings: {},
  enabledFeatures: ['change_orders', 'projects', 'selections'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-co@test.local', passwordHash: 'x', firstName: 'Pat', lastName: 'Ellery',
  role: 'owner', companyId: co.id, isActive: true,
} as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Rivera', type: 'customer' } as any).returning()

const END = new Date('2026-11-20T00:00:00Z')
const mkProject = async (number: string, value: number) => (await db.insert(project).values({
  companyId: co.id, contactId: client.id, name: `Site ${number}`, number, status: 'active',
  estimatedValue: value.toFixed(2), endDate: END,
} as any).returning())[0]

const app = new Hono()
app.route('/api/change-orders', (await import('./src/routes/changeOrders.ts')).default)
app.route('/api/projects', (await import('./src/routes/projects.ts')).default)
app.route('/api/selections', (await import('./src/routes/selections.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const mkCO = async (projectId: string, title: string, lines: Array<{ description: string; quantity: number; unitPrice: number }>, daysAdded = 0) =>
  api('POST', '/api/change-orders', { title, projectId, daysAdded, lineItems: lines })
const statusOf = async (id: string) => (await db.select().from(changeOrder).where(eq(changeOrder.id, id)).limit(1))[0]

// ══════════ H2 · the lifecycle ═════════════════════════════════════════════════════════════════
{
  const proj = await mkProject('PRJ-CO-1', 100_000)
  const created = await mkCO(proj.id, 'Extra framing', [{ description: 'Studs', quantity: 100, unitPrice: 28.77 }], 3)
  check('a change order is created as a draft', created.status === 201 && created.json?.status === 'draft',
    { status: created.status, coStatus: created.json?.status })
  const id = created.json?.id

  const early = await api('POST', `/api/change-orders/${id}/approve`)
  check('a DRAFT cannot be approved — it was never submitted', early.status === 400, { status: early.status, body: early.text?.slice(0, 180) })
  check('…and the refusal says which states can be', /submitted/.test(JSON.stringify(early.json)), early.json)
  check('…and it is still a draft', (await statusOf(id))?.status === 'draft', await statusOf(id))

  const sub = await api('POST', `/api/change-orders/${id}/submit`)
  check('submitting a draft works', sub.status === 200 && sub.json?.status === 'submitted', { status: sub.status, coStatus: sub.json?.status })
  const resub = await api('POST', `/api/change-orders/${id}/submit`)
  check('…and submitting it twice is refused', resub.status === 400, { status: resub.status })

  const app1 = await api('POST', `/api/change-orders/${id}/approve`, { approvedBy: 'Current User' })
  check('approving a submitted change order works', app1.status === 200 && app1.json?.status === 'approved', { status: app1.status, coStatus: app1.json?.status })
  check('…and approvedBy is the SIGNED-IN person, not the "Current User" the body sent',
    app1.json?.approvedBy === 'Pat Ellery', { approvedBy: app1.json?.approvedBy })

  const edit = await api('PUT', `/api/change-orders/${id}`, { lineItems: [{ description: 'Studs', quantity: 1, unitPrice: 99_999 }] })
  check('an APPROVED change order cannot be edited', edit.status === 400, { status: edit.status, body: edit.text?.slice(0, 200) })
  check('…and the refusal points at the real remedy — another change order', /credit|another change order/i.test(JSON.stringify(edit.json)), edit.json)
  check('…and the amount did not move', isMoney((await statusOf(id))?.amount, 2877), (await statusOf(id))?.amount)

  const rej = await api('POST', `/api/change-orders/${id}/reject`)
  check('an APPROVED change order cannot be rejected', rej.status === 400, { status: rej.status })
  check('…so approved → rejected → approved is closed', (await statusOf(id))?.status === 'approved', await statusOf(id))

  const del = await api('DELETE', `/api/change-orders/${id}`)
  check('…and it cannot be deleted either (not in the report — the same hole as editing)', del.status === 400, { status: del.status })

  const sneak = await api('PUT', `/api/change-orders/${id}`, { status: 'draft' })
  check('…nor walked back to draft through PUT {status}', sneak.status === 400, { status: sneak.status })
}

// ══════════ H2b · PUT {status} is not a way round /approve ═════════════════════════════════════
{
  const proj = await mkProject('PRJ-CO-2', 50_000)
  const made = await mkCO(proj.id, 'Tiling', [{ description: 'Tile', quantity: 10, unitPrice: 50 }])
  const id = made.json?.id
  const jump = await api('PUT', `/api/change-orders/${id}`, { status: 'approved' })
  check('a change order cannot be APPROVED by editing it', jump.status === 400, { status: jump.status, body: jump.text?.slice(0, 200) })
  check('…and the refusal names the endpoint that does it properly', /approve/.test(JSON.stringify(jump.json)), jump.json)
  check('…nothing was approved', (await statusOf(id))?.status === 'draft', await statusOf(id))
  check('…and no approver was recorded', !(await statusOf(id))?.approvedBy, (await statusOf(id))?.approvedBy)
  // A draft CAN still be moved between the working states, which is why `status` was allowed through.
  const ok = await api('PUT', `/api/change-orders/${id}`, { status: 'submitted' })
  check('…but PUT can still move it between the working states', ok.status === 200 && ok.json?.status === 'submitted', { status: ok.status, coStatus: ok.json?.status })

  const no = await api('POST', `/api/change-orders/${id}/reject`)
  check('a submitted change order can be rejected', no.status === 200 && no.json?.status === 'rejected', { status: no.status, coStatus: no.json?.status })
  const again = await api('POST', `/api/change-orders/${id}/submit`)
  check('…and a rejected one can be reworked and resubmitted', again.status === 200 && again.json?.status === 'submitted', { status: again.status, coStatus: again.json?.status })
}

// ══════════ H4 · approval MOVES the contract ═══════════════════════════════════════════════════
{
  const proj = await mkProject('PRJ-CO-3', 200_000)
  const made = await mkCO(proj.id, 'Steelwork', [{ description: 'Beams', quantity: 1, unitPrice: 2877 }], 3)
  const id = made.json?.id
  await api('POST', `/api/change-orders/${id}/submit`)

  const before = await api('GET', `/api/projects/${proj.id}`)
  check('before approval the contract value is the original', isMoney(before.json?.financials?.revisedContractValue, 200_000), before.json?.financials)
  check('…and the change order shows as raised-not-agreed', isMoney(before.json?.financials?.pendingChangeOrders, 2877) && before.json?.financials?.pendingCount === 1, before.json?.financials)
  check('…with nothing in the approved line', isMoney(before.json?.financials?.approvedChangeOrders, 0), before.json?.financials)

  const ap = await api('POST', `/api/change-orders/${id}/approve`)
  check('approval answers 200', ap.status === 200, { status: ap.status, body: ap.text?.slice(0, 200) })

  const after = await api('GET', `/api/projects/${proj.id}`)
  check('the project value moved by the agreed amount', isMoney(after.json?.financials?.revisedContractValue, 202_877), after.json?.financials)
  check('…the approved line carries it', isMoney(after.json?.financials?.approvedChangeOrders, 2877), after.json?.financials)
  check('…the pending line is empty again', isMoney(after.json?.financials?.pendingChangeOrders, 0), after.json?.financials)
  check('…and the original value is still recoverable', isMoney(after.json?.financials?.originalValue, 200_000), after.json?.financials)
  const movedEnd = new Date(after.json?.endDate)
  check('…and the end date moved by the agreed days', movedEnd.getTime() === END.getTime() + 3 * 86_400_000,
    { endDate: after.json?.endDate, expected: new Date(END.getTime() + 3 * 86_400_000).toISOString() })
}

// ══════════ H4b · a draft is not contract money ════════════════════════════════════════════════
{
  const proj = await mkProject('PRJ-CO-4', 10_000)
  await mkCO(proj.id, 'Draft one', [{ description: 'x', quantity: 1, unitPrice: 1000 }])
  const two = await mkCO(proj.id, 'Submitted one', [{ description: 'y', quantity: 1, unitPrice: 500 }])
  await api('POST', `/api/change-orders/${two.json.id}/submit`)
  const three = await mkCO(proj.id, 'Approved one', [{ description: 'z', quantity: 1, unitPrice: 250 }])
  await api('POST', `/api/change-orders/${three.json.id}/submit`)
  await api('POST', `/api/change-orders/${three.json.id}/approve`)

  const r = await api('GET', `/api/projects/${proj.id}`)
  check('only the APPROVED change order is in the contract value',
    isMoney(r.json?.financials?.approvedChangeOrders, 250) && isMoney(r.json?.financials?.revisedContractValue, 10_250),
    r.json?.financials)
  check('…the draft and the submitted one are reported separately',
    isMoney(r.json?.financials?.pendingChangeOrders, 1500) && r.json?.financials?.pendingCount === 2,
    r.json?.financials)
  check('…so the old "+$1,750 all of them" figure is not reachable',
    !isMoney(r.json?.financials?.approvedChangeOrders, 1750), r.json?.financials?.approvedChangeOrders)
}

// ══════════ H5 · a credit is a negative line ═══════════════════════════════════════════════════
{
  const proj = await mkProject('PRJ-CO-5', 80_000)
  const credit = await mkCO(proj.id, 'Credit: laminate counter', [{ description: 'Credit: laminate counter', quantity: 1, unitPrice: -615 }])
  check('a deductive (credit) change order is accepted', credit.status === 201, { status: credit.status, body: credit.text?.slice(0, 200) })
  check('…and carries the negative amount', isMoney(credit.json?.amount, -615), credit.json?.amount)
  await api('POST', `/api/change-orders/${credit.json.id}/submit`)
  await api('POST', `/api/change-orders/${credit.json.id}/approve`)
  const r = await api('GET', `/api/projects/${proj.id}`)
  check('…and approving it takes the money OFF the contract', isMoney(r.json?.financials?.revisedContractValue, 79_385), r.json?.financials)

  // The sign belongs on the price. Two spellings of one credit is two rows that look different.
  const negQty = await mkCO(proj.id, 'Backwards credit', [{ description: 'x', quantity: -1, unitPrice: 615 }])
  check('a NEGATIVE QUANTITY is refused — the price carries the sign', negQty.status === 400, { status: negQty.status, body: negQty.text?.slice(0, 200) })
}

// ══════════ H3 + L12 · one selection, one change order ═════════════════════════════════════════
{
  const proj = await mkProject('PRJ-CO-6', 300_000)
  const cat = await api('POST', '/api/selections/categories', { name: 'Countertops' })
  check('a selection category is created', cat.status === 201 || cat.status === 200, { status: cat.status, body: cat.text?.slice(0, 160) })
  const opt = await api('POST', '/api/selections/options', {
    categoryId: cat.json?.id, name: 'Calacatta quartz', price: 3180,
  })
  check('an option is created', opt.status === 201 || opt.status === 200, { status: opt.status, body: opt.text?.slice(0, 160) })
  const sel = await api('POST', `/api/selections/project/${proj.id}`, {
    categoryId: cat.json?.id, name: 'Kitchen counter', allowance: 2500, quantity: 1, unit: 'each',
  })
  check('a project selection is created', sel.status === 201 || sel.status === 200, { status: sel.status, body: sel.text?.slice(0, 200) })
  const selId = sel.json?.id

  const picked = await api('POST', `/api/selections/${selId}/select`, { optionId: opt.json?.id })
  check('the client picks the upgrade', picked.status === 200, { status: picked.status, body: picked.text?.slice(0, 200) })

  const first = await api('POST', `/api/selections/${selId}/approve`, {})
  check('approving it raises ONE change order', first.status === 200 && !!first.json?.changeOrder?.id,
    { status: first.status, co: first.json?.changeOrder?.number })
  check('…for the price difference, $3,180 − $2,500', isMoney(first.json?.changeOrder?.amount, 680), first.json?.changeOrder?.amount)
  check('…numbered in the project\'s CO sequence, not CO-SEL-<epoch>',
    /^CO-\d{3}$/.test(String(first.json?.changeOrder?.number || '')), first.json?.changeOrder?.number)
  check('…in a status the Change Orders screen draws', first.json?.changeOrder?.status === 'submitted', first.json?.changeOrder?.status)

  for (let i = 0; i < 4; i++) await api('POST', `/api/selections/${selId}/approve`, {})
  const made: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM change_order WHERE project_id = ${proj.id}`)
  check('approving it four more times raises NO more change orders', Number((made.rows || made)[0]?.n) === 1,
    { changeOrders: (made.rows || made)[0]?.n, wasFive: 5 })
  const again = await api('POST', `/api/selections/${selId}/approve`, {})
  check('…and the repeat is refused, not silently ignored', again.status === 400, { status: again.status, body: again.text?.slice(0, 200) })
  check('…saying it is already approved', /already been approved/i.test(JSON.stringify(again.json)), again.json)

  // Re-selection is still a real thing: a new decision earns a new change order.
  const repick = await api('POST', `/api/selections/${selId}/select`, { optionId: opt.json?.id })
  if (repick.status === 200) {
    const second = await api('POST', `/api/selections/${selId}/approve`, {})
    check('…but picking again and re-approving DOES raise the next one', second.status === 200 && second.json?.changeOrder?.number === 'CO-002',
      { status: second.status, number: second.json?.changeOrder?.number })
  } else {
    check('…and re-picking is itself gated, which closes the same door', repick.status === 400, { status: repick.status })
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
