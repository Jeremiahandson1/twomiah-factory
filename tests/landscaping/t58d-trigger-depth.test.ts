// T58d — "visits below the trigger depth still bill."
//
// They did. Every snow contract carries triggerDepthInches — on the form, notNull, default 2.00 —
// and computeSnowEventCharge had never read it, so a half-inch push was charged the full per-push
// rate. Measured on lndtest before the change: 6 of 27 events below their contract's trigger,
// $367.50 billed between them.
//
// The owner called this a product call, so here is the call, made executable:
//
//   · below the trigger, PLOUGHING is not charged — that is what a trigger depth means in a snow
//     contract: the threshold at which the contractor must turn out and may bill
//   · SALT is charged at any depth, including below trigger and including when the base is nothing.
//     It is a consumable bought by the ton, a salt run with no plough pass is a real visit (settled
//     in T41), and a light glaze is exactly when salting happens
//   · a push the customer ASKED for is still chargeable — billBelowTrigger records that decision
//   · and when NO depth was recorded, nothing is withheld. This is the one that would have cost the
//     shop money: snowfallInches defaults to '0', so "nobody wrote it down" and "no snow fell" are
//     the same value, and 8 of those 27 live events are in exactly that state. A missing charge is
//     never noticed; a wrong one gets argued about.
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, site, snowContract, snowEvent } = await import('./db/schema.ts')
const { eq } = await import('drizzle-orm')
const snow = await import('./src/routes/snowBilling.ts')
const { computeSnowEventCharge, isBelowTrigger } = snow as any

// ══════════ 1 · the rule, where the rule lives ═════════════════════════════════════════════════
console.log('\n══════════ what the trigger depth does to a charge ══════════')
{
  const rates = { perPushRate: '65.00', perEventRate: '180.00', perInchRate: '22.50', saltRate: '40.00', triggerDepthInches: '2.00' }
  const ev = (o: any = {}) => ({ pushes: 1, snowfallInches: 0, saltApplied: false, billBelowTrigger: false, ...o })
  const charge = (mode: string, o: any) => computeSnowEventCharge({ ...rates, billingMode: mode }, ev(o))

  check('per_push ABOVE the trigger charges: 3 pushes at $65 = $195',
    charge('per_push', { pushes: 3, snowfallInches: 4 }) === 195, charge('per_push', { pushes: 3, snowfallInches: 4 }))

  check('per_push BELOW the trigger charges nothing — 0.5in under a 2in trigger',
    charge('per_push', { pushes: 1, snowfallInches: 0.5 }) === 0, charge('per_push', { pushes: 1, snowfallInches: 0.5 }))

  check('per_inch below the trigger charges nothing',
    charge('per_inch', { snowfallInches: 1 }) === 0, charge('per_inch', { snowfallInches: 1 }))

  check('per_event below the trigger charges nothing',
    charge('per_event', { snowfallInches: 1 }) === 0, charge('per_event', { snowfallInches: 1 }))

  // THE ONE THAT PROTECTS THE SHOP.
  check('NO snowfall recorded is not "below trigger" — the push is still charged',
    charge('per_push', { pushes: 2, snowfallInches: 0 }) === 130, charge('per_push', { pushes: 2, snowfallInches: 0 }))

  check('a contract with no trigger set charges as before',
    computeSnowEventCharge({ ...rates, triggerDepthInches: '0', billingMode: 'per_push' }, ev({ pushes: 2, snowfallInches: 0.5 })) === 130)

  // SALT.
  check('salt IS charged below the trigger, even with nothing to plough for',
    charge('per_push', { pushes: 1, snowfallInches: 0.5, saltApplied: true }) === 40,
    charge('per_push', { pushes: 1, snowfallInches: 0.5, saltApplied: true }))

  // THE OVERRIDE.
  check('billBelowTrigger charges the push the customer asked for',
    charge('per_push', { pushes: 1, snowfallInches: 0.5, billBelowTrigger: true }) === 65,
    charge('per_push', { pushes: 1, snowfallInches: 0.5, billBelowTrigger: true }))
  check('…and still adds the salt on top',
    charge('per_push', { pushes: 1, snowfallInches: 0.5, saltApplied: true, billBelowTrigger: true }) === 105)

  // Exactly AT the trigger is not below it — a 2in fall on a 2in trigger is a chargeable storm.
  check('exactly at the trigger is chargeable',
    charge('per_push', { pushes: 1, snowfallInches: 2 }) === 65, charge('per_push', { pushes: 1, snowfallInches: 2 }))

  check('seasonal is unaffected either way — the season is paid up front',
    charge('seasonal', { pushes: 3, snowfallInches: 6 }) === 0 && charge('seasonal', { pushes: 3, snowfallInches: 0.5 }) === 0)

  // the predicate the screen reads
  check('isBelowTrigger: 0.5 under 2 is below', isBelowTrigger({ triggerDepthInches: '2' }, { snowfallInches: 0.5 }) === true)
  check('isBelowTrigger: an unrecorded depth is NOT below', isBelowTrigger({ triggerDepthInches: '2' }, { snowfallInches: 0 }) === false)
  check('isBelowTrigger: no trigger set is NOT below', isBelowTrigger({ triggerDepthInches: null }, { snowfallInches: 0.5 }) === false)
}

// ══════════ 2 · through the API, which is what the screen talks to ═════════════════════════════
console.log('\n══════════ the endpoint ══════════')
{
  const [co] = await db.insert(company).values({
    name: 'Drift Lawn & Snow', slug: 'drift-t58d', email: 't58d@test.local', state: 'OH',
    settings: {}, enabledFeatures: ['snow_billing', 'invoices'],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: 'owner-t58d@drift.local', passwordHash: 'x', firstName: 'O', lastName: 'U',
    role: 'owner', companyId: co.id, isActive: true,
  } as any).returning()
  // site.contact_id is notNull — a property belongs to whoever is paying for it.
  const [client] = await db.insert(contact).values({
    companyId: co.id, name: 'Mill Lane Holdings', email: 'mill-t58d@test.local',
  } as any).returning()
  const [property] = await db.insert(site).values({
    companyId: co.id, contactId: client.id, name: 'Mill Lane Plaza',
  } as any).returning()
  const [contract] = await db.insert(snowContract).values({
    companyId: co.id, siteId: property.id, billingMode: 'per_push',
    perPushRate: '65.00', perEventRate: '0', perInchRate: '0', seasonalRate: '0',
    saltRate: '40.00', triggerDepthInches: '2.00',
  } as any).returning()

  const app = new Hono()
  app.route('/api/snow', (await import('./src/routes/snowBilling.ts')).default)
  app.onError((err: any, c: any) => {
    const status = Number(err?.status || err?.statusCode || 0)
    if (status >= 400 && status < 500) return c.json({ error: err.message }, status)
    return c.json({ error: 'Internal server error', unexpected: String(err?.message || err) }, 500)
  })
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': owner.role },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const txt = await res.text(); let j: any = txt; try { j = JSON.parse(txt) } catch {}
    return { status: res.status, json: j, text: txt }
  }

  const low = await call('POST', '/api/snow/events', {
    snowContractId: contract.id, pushes: 1, snowfallInches: 0.5, saltApplied: false,
  })
  check('a below-trigger visit is still ACCEPTED — the crew did go out', low.status === 201, { status: low.status, body: low.text?.slice(0, 220) })
  check('…and is charged nothing', Number(low.json?.billableAmount) === 0, low.json?.billableAmount)
  check('…and the response SAYS it was below the trigger, so the screen can explain the $0',
    low.json?.belowTrigger === true, low.json)
  check('…and carries the trigger it was judged against', Number(low.json?.triggerDepthInches) === 2, low.json?.triggerDepthInches)

  const asked = await call('POST', '/api/snow/events', {
    snowContractId: contract.id, pushes: 1, snowfallInches: 0.5, saltApplied: false, billBelowTrigger: true,
  })
  check('the same visit, billed on request, charges the rate', Number(asked.json?.billableAmount) === 65, asked.json?.billableAmount)
  check('…and is still flagged as below trigger', asked.json?.belowTrigger === true, asked.json)
  check('…and the decision is stored, not just applied',
    (await db.select().from(snowEvent).where(eq(snowEvent.id, asked.json?.id)).limit(1))[0]?.billBelowTrigger === true)

  const real = await call('POST', '/api/snow/events', {
    snowContractId: contract.id, pushes: 2, snowfallInches: 5, saltApplied: false,
  })
  check('a real storm charges normally', Number(real.json?.billableAmount) === 130, real.json?.billableAmount)
  check('…and is not flagged', real.json?.belowTrigger === false, real.json?.belowTrigger)

  const list = await call('GET', `/api/snow/events?contractId=${contract.id}`)
  const rows: any[] = list.json?.data || []
  check('the list carries belowTrigger on every row', rows.length === 3 && rows.every(r => typeof r.belowTrigger === 'boolean'),
    { n: rows.length, flags: rows.map(r => r.belowTrigger) })
  check('…and the trigger each was judged against', rows.every(r => Number(r.triggerDepthInches) === 2))

  // The whole point: a below-trigger visit must not quietly join an invoice.
  const bill = await call('POST', `/api/snow/contracts/${contract.id}/bill`, {})
  const billed = Number(bill.json?.billedVisits ?? 0)
  check('billing the contract takes only the chargeable visits', billed === 2, { billedVisits: billed, status: bill.status, body: bill.text?.slice(0, 200) })
  const stillUnbilled = (await db.select().from(snowEvent).where(eq(snowEvent.snowContractId, contract.id)))
    .filter((e: any) => !e.invoiceId)
  check('…and the un-chargeable one is left behind, not invoiced at $0', stillUnbilled.length === 1 && Number(stillUnbilled[0].billableAmount) === 0,
    stillUnbilled.map((e: any) => ({ amt: e.billableAmount, inv: e.invoiceId })))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
