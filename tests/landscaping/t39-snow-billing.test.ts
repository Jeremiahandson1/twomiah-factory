// crm-landscaping — snow and ice billing, the module that pays for the winter. (T39)
//
// WHY THIS SUITE EXISTS AT ALL. crm-landscaping had 189 endpoint declarations and ZERO
// vertical-specific tests: only the shared contract test, which proves two fleet-wide invariants and
// nothing about plowing a car park. The Evergreen round closed roughly 22 mediums and lows and none
// of it has been pinned since.
//
// Snow billing is the hardest money in this vertical because the SAME visit is worth different
// amounts depending on the contract: per push, flat per event, per inch of snowfall, or nothing at
// all because the customer pays a seasonal fee. Salt is extra in every mode. Get that wrong and the
// invoice is wrong in a way the customer will notice and the crew cannot explain.
//
// WHAT IS PINNED, and each was a real finding:
//
//   T14 N1  "per_banana" was accepted and stored as per_push, and a rate of "abc" was stored as
//           0.00 — both answering 201. A billing mode that is not one of ours, or a rate that is not
//           a number, is now refused with the field named.
//   The ''  trap: a per_push contract legitimately leaves the other rates blank, and '' does NOT
//           satisfy `?? default`, so a blank reached the numeric column and 500'd the whole save
//           with no field named. Blank now means "not set" → 0.
//   Billing twice: a visit already on an invoice is not billed again, and a seasonal contract's
//           visits say so rather than raising a $0 invoice.
//
// THE ARITHMETIC IS ASSERTED WHERE THE RULE LIVES. computeSnowEventCharge is exported, so the four
// modes are checked directly as well as through HTTP — a money rule read through four layers is a
// money rule nobody can review.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, site, snowContract, snowEvent } = await import('./db/schema.ts')
const snow = await import('./src/routes/snowBilling.ts')
const { computeSnowEventCharge, snowContractInputError, snowEventInputError } = snow as any

// ══════════ 1 · the four modes, asserted where the rule lives ════════════════════════════════
console.log('\n══════════ what a visit is worth ══════════')
{
  const rates = { perPushRate: '65.00', perEventRate: '180.00', perInchRate: '22.50', saltRate: '40.00' }
  const ev = (o: Partial<{ pushes: number; snowfallInches: number; saltApplied: boolean }> = {}) =>
    ({ pushes: 1, snowfallInches: 0, saltApplied: false, ...o })

  check('per_push: three pushes at $65 is $195',
    computeSnowEventCharge({ ...rates, billingMode: 'per_push' }, ev({ pushes: 3 })) === 195,
    computeSnowEventCharge({ ...rates, billingMode: 'per_push' }, ev({ pushes: 3 })))

  check('per_event: a flat $180 however many pushes',
    computeSnowEventCharge({ ...rates, billingMode: 'per_event' }, ev({ pushes: 4 })) === 180,
    computeSnowEventCharge({ ...rates, billingMode: 'per_event' }, ev({ pushes: 4 })))

  // 4.25 inches × 22.50 = 95.625 → 95.63, the kind of figure that exposes a truncating round.
  check('per_inch: 4.25in at $22.50 is $95.63, not $95.62',
    computeSnowEventCharge({ ...rates, billingMode: 'per_inch' }, ev({ snowfallInches: 4.25 })) === 95.63,
    computeSnowEventCharge({ ...rates, billingMode: 'per_inch' }, ev({ snowfallInches: 4.25 })))

  check('seasonal: the visit is $0 — the season fee already covers it',
    computeSnowEventCharge({ ...rates, billingMode: 'seasonal' }, ev({ pushes: 3, snowfallInches: 6 })) === 0,
    computeSnowEventCharge({ ...rates, billingMode: 'seasonal' }, ev({ pushes: 3, snowfallInches: 6 })))

  // Salt is on top in EVERY mode, including seasonal — that is the one people get wrong.
  check('salt is added on top of a per_push visit: 195 + 40 = 235',
    computeSnowEventCharge({ ...rates, billingMode: 'per_push' }, ev({ pushes: 3, saltApplied: true })) === 235,
    computeSnowEventCharge({ ...rates, billingMode: 'per_push' }, ev({ pushes: 3, saltApplied: true })))
  check('…and on top of a SEASONAL visit, which is otherwise $0: 0 + 40 = 40',
    computeSnowEventCharge({ ...rates, billingMode: 'seasonal' }, ev({ pushes: 2, saltApplied: true })) === 40,
    computeSnowEventCharge({ ...rates, billingMode: 'seasonal' }, ev({ pushes: 2, saltApplied: true })))
  check('…and no salt when none was applied',
    computeSnowEventCharge({ ...rates, billingMode: 'per_event' }, ev({ saltApplied: false })) === 180,
    computeSnowEventCharge({ ...rates, billingMode: 'per_event' }, ev({ saltApplied: false })))

  // A blank rate is 0, not NaN — a per_push contract leaves the others empty.
  check('a blank rate contributes 0, never NaN',
    computeSnowEventCharge({ billingMode: 'per_inch', perPushRate: '', perEventRate: '', perInchRate: '', saltRate: '' } as any,
      ev({ snowfallInches: 3 })) === 0,
    computeSnowEventCharge({ billingMode: 'per_inch', perPushRate: '', perEventRate: '', perInchRate: '', saltRate: '' } as any, ev({ snowfallInches: 3 })))
}

// ══════════ 2 · T14 N1 · what the contract form refuses ══════════════════════════════════════
console.log('\n══════════ "per_banana" is not a billing mode ══════════')
{
  check('a billing mode that is not ours is refused, and named',
    /billing/i.test(String(snowContractInputError({ billingMode: 'per_banana' }))),
    snowContractInputError({ billingMode: 'per_banana' }))
  check('…and a rate of "abc" is refused rather than stored as 0.00',
    !!snowContractInputError({ billingMode: 'per_push', perPushRate: 'abc' }),
    snowContractInputError({ billingMode: 'per_push', perPushRate: 'abc' }))
  check('a valid per_push contract with the other rates BLANK is accepted — they mean "not set"',
    snowContractInputError({ billingMode: 'per_push', perPushRate: '65', perEventRate: '', perInchRate: '', saltRate: '' }) === null,
    snowContractInputError({ billingMode: 'per_push', perPushRate: '65', perEventRate: '', perInchRate: '', saltRate: '' }))
  check('…and all four modes are accepted',
    ['per_push', 'per_event', 'per_inch', 'seasonal'].every((m) => snowContractInputError({ billingMode: m }) === null),
    ['per_push', 'per_event', 'per_inch', 'seasonal'].map((m) => [m, snowContractInputError({ billingMode: m })]))

  check('a negative snowfall on a logged visit is refused', !!snowEventInputError({ snowfallInches: -2 }),
    snowEventInputError({ snowfallInches: -2 }))
  check('…and a non-numeric push count', !!snowEventInputError({ pushes: 'three' }), snowEventInputError({ pushes: 'three' }))
}

// ══════════ the fixture ══════════════════════════════════════════════════════════════════════
const [co] = await db.insert(company).values({
  name: 'A+ Services', slug: 'aplus-snow-t39', email: 'aplus@test.local', state: 'OH',
  settings: {}, enabledFeatures: ['snow_billing'],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@aplus.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const crew = await mkUser('field', 'crew')

const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Northgate Plaza' } as any).returning()
const [plaza] = await db.insert(site).values({
  companyId: co.id, contactId: client.id, name: 'Northgate Plaza — main lot',
} as any).returning()

const app = new Hono()
app.route('/api/snow', snow.default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asCrew = as(crew)
const one = async (q: any) => (((await db.execute(q)) as any).rows ?? [])[0]

// ══════════ 3 · the same refusals through HTTP ═══════════════════════════════════════════════
console.log('\n══════════ the contract endpoint ══════════')
let perPushId = ''
{
  const banana = await asOwner('POST', '/api/snow/contracts', { siteId: plaza.id, billingMode: 'per_banana', perPushRate: '65' })
  check('POST a "per_banana" contract is refused, not saved as per_push', banana.status === 400,
    { status: banana.status, body: banana.text?.slice(0, 160) })

  const abc = await asOwner('POST', '/api/snow/contracts', { siteId: plaza.id, billingMode: 'per_push', perPushRate: 'abc' })
  check('…and a rate of "abc" is refused, not stored as 0.00', abc.status === 400, { status: abc.status, body: abc.text?.slice(0, 160) })

  // The '' trap: this is the save that used to 500 with no field named.
  const made = await asOwner('POST', '/api/snow/contracts', {
    siteId: plaza.id, billingMode: 'per_push', perPushRate: '65', saltRate: '40',
    perEventRate: '', perInchRate: '', seasonalRate: '',
  })
  check('a per_push contract with the other rates BLANK saves — it used to 500', made.status === 201,
    { status: made.status, body: made.text?.slice(0, 200) })
  perPushId = made.json?.id ?? made.json?.contract?.id
  check('…and the blanks were stored as 0, not NaN or null',
    Number((await one(sql`SELECT per_event_rate FROM snow_contract WHERE id = ${perPushId}`))?.per_event_rate) === 0,
    await one(sql`SELECT per_event_rate, per_inch_rate FROM snow_contract WHERE id = ${perPushId}`))

  const n = await one(sql`SELECT COUNT(*)::int AS n FROM snow_contract WHERE company_id = ${co.id}`)
  check('…and the two refusals saved nothing', Number(n?.n) === 1, n)
}

// ══════════ 4 · logging visits and billing them once ═════════════════════════════════════════
console.log('\n══════════ billing the winter ══════════')
{
  // Two visits: 3 pushes with salt (195 + 40 = 235) and 1 push without (65). Total 300.
  const e1 = await asOwner('POST', '/api/snow/events', {
    snowContractId: perPushId, siteId: plaza.id, pushes: 3, saltApplied: true, servicedAt: '2027-01-08T06:00:00Z',
  })
  check('a crew visit is logged', e1.status === 201, { status: e1.status, body: e1.text?.slice(0, 180) })
  check('…and priced at 235.00 — 3 × 65 plus 40 of salt', Number(e1.json?.billableAmount) === 235, { billableAmount: e1.json?.billableAmount })

  const e2 = await asOwner('POST', '/api/snow/events', {
    snowContractId: perPushId, siteId: plaza.id, pushes: 1, saltApplied: false, servicedAt: '2027-01-11T05:30:00Z',
  })
  check('a second visit is priced on its own merits: 65.00', Number(e2.json?.billableAmount) === 65, { billableAmount: e2.json?.billableAmount })

  const billed = await asOwner('POST', `/api/snow/contracts/${perPushId}/bill`)
  check('the contract bills', billed.status === 201, { status: billed.status, body: billed.text?.slice(0, 200) })
  check('…for both visits', billed.json?.billedVisits === 2, { billedVisits: billed.json?.billedVisits })
  check('…and the invoice total is 300.00', Number(billed.json?.invoice?.total) === 300 || Number(billed.json?.invoice?.subtotal) === 300,
    { total: billed.json?.invoice?.total, subtotal: billed.json?.invoice?.subtotal })

  // Billing again must find nothing — the visits are on an invoice now.
  const again = await asOwner('POST', `/api/snow/contracts/${perPushId}/bill`)
  check('billing the same contract again raises no second invoice', again.status === 400, { status: again.status, body: again.text?.slice(0, 180) })
  check('…and says there is nothing unbilled', /no unbilled/i.test(String(again.json?.error)), again.json?.error)

  const inv = await one(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  check('…so exactly ONE invoice exists', Number(inv?.n) === 1, inv)
}

// ══════════ 5 · a seasonal contract's visits are not a $0 invoice ════════════════════════════
console.log('\n══════════ seasonal: nothing to bill is said, not invoiced ══════════')
{
  const made = await asOwner('POST', '/api/snow/contracts', {
    siteId: plaza.id, billingMode: 'seasonal', seasonalRate: '9000', perPushRate: '', perEventRate: '', perInchRate: '', saltRate: '',
  })
  check('a seasonal contract saves', made.status === 201, { status: made.status, body: made.text?.slice(0, 160) })
  const seasonalId = made.json?.id ?? made.json?.contract?.id

  const ev = await asOwner('POST', '/api/snow/events', {
    snowContractId: seasonalId, siteId: plaza.id, pushes: 4, saltApplied: false, servicedAt: '2027-01-14T06:00:00Z',
  })
  check('a seasonal visit is logged at 0.00 — the season fee covers it', Number(ev.json?.billableAmount) === 0,
    { billableAmount: ev.json?.billableAmount })

  const bill = await asOwner('POST', `/api/snow/contracts/${seasonalId}/bill`)
  check('billing it raises NO invoice', bill.status === 400, { status: bill.status, body: bill.text?.slice(0, 200) })
  check('…and explains that the seasonal fee covers the visits', /seasonal fee/i.test(String(bill.json?.error)), bill.json?.error)
  const inv = await one(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  check('…and there is still only the one invoice', Number(inv?.n) === 1, inv)
}

// ══════════ 6 · who may price and bill the winter ════════════════════════════════════════════
console.log('\n══════════ who may bill ══════════')
{
  const byCrew = await asOwner('POST', '/api/snow/events', {
    snowContractId: perPushId, siteId: plaza.id, pushes: 2, saltApplied: false, servicedAt: '2027-01-19T06:00:00Z',
  })
  check('a fresh unbilled visit exists for the next check', byCrew.status === 201, { status: byCrew.status })

  const crewBill = await asCrew('POST', `/api/snow/contracts/${perPushId}/bill`)
  check('a field crew member cannot raise the invoice', crewBill.status === 403, { status: crewBill.status, body: crewBill.text?.slice(0, 140) })
  const inv = await one(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  check('…and no invoice appeared', Number(inv?.n) === 1, inv)

  const crewContract = await asCrew('POST', '/api/snow/contracts', { siteId: plaza.id, billingMode: 'per_push', perPushRate: '999' })
  check('…nor set the rates', crewContract.status === 403, { status: crewContract.status })
}

// ══════════ 7 · another company's winter ═════════════════════════════════════════════════════
console.log('\n══════════ company scoping ══════════')
{
  const [other] = await db.insert(company).values({
    name: 'Rival Lawns', slug: 'rival-snow-t39', email: 'rival@test.local', state: 'OH', settings: {}, enabledFeatures: ['snow_billing'],
  } as any).returning()
  const [intruder] = await db.insert(user).values({
    email: 'intruder@rivallawns.local', passwordHash: 'x', firstName: 'I', lastName: 'R', role: 'owner', companyId: other.id, isActive: true,
  } as any).returning()

  const list = await as(intruder)('GET', '/api/snow/contracts')
  check('another company sees no contracts here', !/Northgate/.test(list.text), { status: list.status, body: list.text?.slice(0, 160) })
  const bill = await as(intruder)('POST', `/api/snow/contracts/${perPushId}/bill`)
  check('…and cannot bill this contract', bill.status === 404, { status: bill.status, body: bill.text?.slice(0, 140) })
  const inv = await one(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  check('…and raised nothing', Number(inv?.n) === 1, inv)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
