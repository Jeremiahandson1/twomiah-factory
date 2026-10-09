import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { snowContract, snowEvent, site, invoice, invoiceLineItem, company } from '../../db/schema.ts'
import { eq, and, desc, asc, isNull, inArray } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { insertInvoice, defaultTaxRateFrom, dueDateFromTerms, businessToday, companyTimeZone } from '../shared/index.ts'

// The same numbering as this CRM's invoices (routes/invoices.ts sets no numbering → the shared default INV-00001).
const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }

const app = new Hono()
app.use('*', authenticate)

const BILLING_MODES = ['per_push', 'per_event', 'per_inch', 'seasonal'] as const

// A rate/decimal column, coerced for storage. Blank optional fields arrive from the form as '' — which
// `?? default` does NOT catch, so it used to reach the numeric column verbatim and 500 the whole save
// with no field named. Treat ''/whitespace/non-numeric/negative as the default; otherwise store the
// number. A per_push contract legitimately leaves per_event/per_inch/seasonal/salt blank → they become 0.
const rate = (v: unknown, dflt = '0'): string => {
  const s = String(v ?? '').trim()
  if (s === '') return dflt
  const num = Number(s)
  return Number.isFinite(num) && num >= 0 ? String(num) : dflt
}

const RATE_FIELDS: Array<[string, string]> = [
  ['perPushRate', 'Per-push rate'], ['perEventRate', 'Per-event rate'], ['perInchRate', 'Per-inch rate'],
  ['seasonalRate', 'Seasonal rate'], ['saltRate', 'Salt rate'], ['triggerDepthInches', 'Trigger depth'],
]

/**
 * What a snow contract may be saved with. A blank optional field still means "not set" (per_push contracts leave the
 * other rates empty), but a value that isn't a number, or a billing mode that isn't one of ours, is refused with the
 * field named instead of being silently stored as 0 / per_push. (Landscaping T14 N1: "per_banana" was saved as
 * per_push and a rate of "abc" as 0.00, both 201)
 */
export function snowContractInputError(body: any, existing?: any): string | null {
  if (body.billingMode !== undefined && body.billingMode !== '' && !BILLING_MODES.includes(body.billingMode)) {
    return `Billing mode must be one of: ${BILLING_MODES.join(', ')}.`
  }
  for (const [key, label] of RATE_FIELDS) {
    const v = body[key]
    if (v === undefined || v === null || String(v).trim() === '') continue
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return `${label} must be a number from 0 to 1,000,000.`
  }
  if (body.status !== undefined && body.status !== '' && !['active', 'paused', 'ended'].includes(body.status)) {
    return 'Status must be one of: active, paused, ended.'
  }

  /**
   * THE RATE THE CONTRACT IS BILLED BY CANNOT BE THE BLANK ONE. (T41)
   *
   *   "A per-push contract saves with no per-push rate; PUT perInchRate '' sets the rate to 0.00."
   *
   * The rule above is right for the OTHER rates — a per_push contract leaves per_event, per_inch,
   * seasonal and salt empty and they become 0, which is what "not set" means for a rate nothing
   * uses. It is wrong for the one rate the billing mode actually multiplies by: a per_push contract
   * with no per-push rate charges $0.00 for every push of the whole season, and the shop finds out
   * when it bills. The blank reads as "not decided yet" and the invoice reads as "free".
   *
   * `existing` is passed on an edit, so clearing the live rate with '' is caught as well as never
   * setting it — the report found both, and the edit is the one somebody does by accident while
   * switching modes.
   */
  const MODE_RATE: Record<string, [string, string]> = {
    per_push: ['perPushRate', 'a per-push rate'],
    per_event: ['perEventRate', 'a per-event rate'],
    per_inch: ['perInchRate', 'a per-inch rate'],
    seasonal: ['seasonalRate', 'a seasonal fee'],
  }
  const mode = body.billingMode ?? existing?.billingMode
  const needed = mode ? MODE_RATE[mode] : undefined
  if (needed) {
    const [field, label] = needed
    // What the row will HOLD after this write: what was sent, else what is already there.
    const sent = body[field]
    const effective = sent !== undefined ? String(sent ?? '').trim() : String(existing?.[field] ?? '').trim()
    const n = Number(effective)
    if (effective === '' || !Number.isFinite(n) || n <= 0) {
      return `A ${String(mode).replace(/_/g, '-')} contract is billed by ${label}, so it needs one above zero. `
        + 'Set it, or change the billing mode to the one you meant.'
    }
  }
  return null
}

/** What a logged visit may be saved with: whole pushes, real snowfall, a real date. */
export function snowEventInputError(body: any): string | null {
  if (body.pushes !== undefined && body.pushes !== null && String(body.pushes).trim() !== '') {
    const p = Number(body.pushes)
    if (!Number.isInteger(p) || p < 0 || p > 100) return 'Pushes must be a whole number from 0 to 100.'
  }
  if (body.snowfallInches !== undefined && body.snowfallInches !== null && String(body.snowfallInches).trim() !== '') {
    const i = Number(body.snowfallInches)
    if (!Number.isFinite(i) || i < 0 || i > 120) return 'Snowfall must be a number of inches from 0 to 120.'
  }
  if (body.servicedAt !== undefined && body.servicedAt !== null && String(body.servicedAt).trim() !== '' && isNaN(new Date(body.servicedAt).getTime())) {
    return 'Serviced date must be a valid date.'
  }
  return null
}

interface ContractRates {
  billingMode: string
  perPushRate: string | number
  perEventRate: string | number
  perInchRate: string | number
  seasonalRate: string | number
  saltRate: string | number
}

/**
 * Bill a single logged snow event against its contract.
 * per_push: pushes * perPushRate. per_event: flat perEventRate.
 * per_inch: snowfallInches * perInchRate. seasonal: 0 (covered by the seasonal contract fee).
 * Salt is added on top in every mode when applied.
 *
 * SALT ON A SEASONAL CONTRACT IS CHARGED. (T41 asked the question; this is the answer.)
 *
 *   "A seasonal visit with salt applied bills $40 — confirm whether a seasonal contract's salt
 *    should be extra."
 *
 * Yes. A seasonal fee is priced on ploughing a known lot a normal number of times; salt is a
 * consumable bought by the ton, and a bad ice year uses several times a good one, so folding it into
 * a fixed fee makes the contractor carry the weather. Every per-ton snow-and-ice contract the trade
 * writes does it this way. Salt is therefore extra in all four modes — which is also why a visit
 * with salt and no plough pass is a legitimate, chargeable visit (see snowEventChargeError).
 *
 * It is a per-contract figure, not a global one, so a shop that wants salt included prices the
 * seasonal fee accordingly and leaves saltRate at 0 — which costs nothing and is already possible.
 * The contract form says "Salt is charged on top in every mode" so the decision is visible where
 * the rates are set, instead of being discovered on an invoice.
 */
/**
 * BELOW THE TRIGGER DEPTH, PLOUGHING IS NOT AUTOMATICALLY BILLABLE. (T58d)
 *
 *   Owner: "visits below the trigger depth still bill."
 *
 * They did. Every contract carries `triggerDepthInches` — it is on the form, it defaults to 2.00,
 * it is `notNull` — and this function had never read it, so a half-inch push was charged the full
 * per-push rate. Measured on lndtest: 6 of 27 events are below their contract's trigger, $367.50
 * between them. A trigger depth is the threshold at which the contractor is obliged to turn out and
 * entitled to charge; below it, the work is not covered by the contract.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT DO.
 *
 * 1 · It does not apply when no snowfall was RECORDED. 8 of those 27 events have snowfallInches 0,
 *     which the schema default also produces — "nobody wrote it down" and "no snow fell" are the
 *     same value. Treating an unrecorded depth as below-trigger would silently zero legitimate
 *     charges, and a missing charge is never noticed, where a wrong one gets argued about. No
 *     measurement, no withholding.
 * 2 · It does not override the shop. `billBelowTrigger` charges it anyway, because a push below
 *     trigger genuinely happens — the customer rings, a drift forms, a freeze-thaw glazes a ramp.
 *     The trigger sets the default; the flag records the exception.
 * 3 · It does not touch salt. Salt is a consumable bought by the ton and a salt run with no plough
 *     pass is a legitimate visit — that was settled in the T41 note above, and a light glaze is
 *     exactly when salting happens. So salt is charged at any depth, including below trigger, and
 *     including when the base comes to nothing.
 *
 * Seasonal is unaffected: its base is already 0, the season being paid up front.
 */
export function computeSnowEventCharge(
  contract: ContractRates,
  ev: { pushes: number; snowfallInches: number; saltApplied: boolean; billBelowTrigger?: boolean },
) {
  const n = (v: string | number) => Number(v) || 0
  let base = 0
  switch (contract.billingMode) {
    case 'per_push': base = n(ev.pushes) * n(contract.perPushRate); break
    case 'per_event': base = n(contract.perEventRate); break
    case 'per_inch': base = n(ev.snowfallInches) * n(contract.perInchRate); break
    case 'seasonal': base = 0; break
  }
  if (isBelowTrigger(contract, ev) && !ev.billBelowTrigger) base = 0
  const salt = ev.saltApplied ? n(contract.saltRate) : 0
  return Math.round((base + salt) * 100) / 100
}

/**
 * Was this visit below the contract's trigger depth?
 *
 * Exported because the SCREEN has to be able to say so — a $0 visit with no explanation is the
 * fault this is meant to fix, not a smaller version of it. `false` when no depth was recorded, for
 * the reason in point 1 above, and `false` when the contract has no trigger set.
 */
export function isBelowTrigger(
  contract: { triggerDepthInches?: string | number | null },
  ev: { snowfallInches: number | string },
): boolean {
  const trigger = Number(contract?.triggerDepthInches)
  const snow = Number(ev?.snowfallInches)
  if (!Number.isFinite(trigger) || trigger <= 0) return false
  if (!Number.isFinite(snow) || snow <= 0) return false
  return snow < trigger
}

/**
 * A LOGGED VISIT THAT CANNOT BE CHARGED FOR. (T41)
 *
 *   "pushes 0 creates a $0 visit."
 *
 * `pushes: 0` on a per-push contract, or no snowfall on a per-inch one, is accepted and stored with
 * billableAmount 0.00. It then sits in the unbilled list for ever: POST /contracts/:id/bill filters
 * on `Number(e.billableAmount) > 0` and skips it, and the message the biller gets back says the
 * visits are "covered by the seasonal fee" — which on a per-push contract is simply untrue. The crew
 * recorded that they went out, the shop never charges for it, and nothing on the screen says why.
 *
 * So the measure the charge is calculated from has to be there. Salt alone is a real visit — a salt
 * run with no plough pass happens — so it is accepted, which is why this checks the base measure
 * rather than just the final total.
 *
 * per_event and seasonal need no measure: the charge is the flat rate, or nothing because the season
 * is paid up front. A ZERO per-event/seasonal rate is refused at the contract, not here.
 */
export function snowEventChargeError(
  billingMode: string,
  ev: { pushes: number; snowfallInches: number; saltApplied: boolean },
): string | null {
  if (ev.saltApplied) return null
  if (billingMode === 'per_push' && !(Number(ev.pushes) > 0)) {
    return 'This contract is billed per push, so a visit needs at least one push — or tick salt if that is all that was done.'
  }
  if (billingMode === 'per_inch' && !(Number(ev.snowfallInches) > 0)) {
    return 'This contract is billed per inch, so a visit needs the snowfall measured — or tick salt if that is all that was done.'
  }
  return null
}

// ---- Contracts ----

app.get('/contracts', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any
  const rows = await db.select({
    contract: snowContract,
    siteName: site.name,
    siteAddress: site.address,
  })
    .from(snowContract)
    .leftJoin(site, eq(snowContract.siteId, site.id))
    .where(eq(snowContract.companyId, user.companyId))
    .orderBy(desc(snowContract.createdAt))
  return c.json({ data: rows.map(r => ({ ...r.contract, siteName: r.siteName, siteAddress: r.siteAddress })) })
})

/**
 * WHICH CONTRACT — named by the site it covers. (T59)
 *
 *   Owner: "edit rows for snow contracts show 'Snow contract' instead of which contract."
 *
 * A snow contract has no name column, so the edit row's `contract.name` was always null and the screen
 * fell back to "Snow contract". The create and delete rows were no better: "per_push contract" is the
 * pricing mode, and every per-push contract a company has reads the same. What tells one contract from
 * another is the site it covers — one contract per site is how they are sold — so the audit names the
 * site, then the mode: "Oak Street Plaza — per push". Used for the visit rows too, which had the same
 * fault ("$95.63 (per_inch)" said nothing about where).
 */
async function contractLabel(companyId: string, siteId: string | null | undefined, billingMode: string): Promise<string> {
  const mode = String(billingMode || '').replace(/_/g, ' ')
  if (!siteId) return `${mode} contract`
  try {
    const [s] = await db.select({ name: site.name, address: site.address }).from(site)
      .where(and(eq(site.id, siteId), eq(site.companyId, companyId))).limit(1)
    const where = String(s?.name || s?.address || '').trim()
    return where ? `${where} — ${mode}` : `${mode} contract`
  } catch {
    return `${mode} contract`
  }
}

app.post('/contracts', requirePermission('invoices:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  if (!body.siteId) return c.json({ error: 'Pick the site this contract covers.' }, 400)
  const bad = snowContractInputError(body)
  if (bad) return c.json({ error: bad }, 400)
  const [siteRow] = await db.select({ id: site.id, contactId: site.contactId }).from(site).where(and(eq(site.id, String(body.siteId)), eq(site.companyId, user.companyId))).limit(1)
  if (!siteRow) return c.json({ error: 'Site not found' }, 404)
  const billingMode = BILLING_MODES.includes(body.billingMode) ? body.billingMode : 'per_push'
  const [contract] = await db.insert(snowContract).values({
    companyId: user.companyId,
    siteId: String(body.siteId),
    /**
     * WHO IS BILLED IS WRITTEN DOWN, NOT LEFT TO BE RE-DERIVED. (T41)
     *
     *   "Snow contracts save contactId null even when the site has a customer
     *    (the invoice still resolves correctly)."
     *
     * The billing route falls back to the site's customer (`row.contract.contactId || row.siteContactId`),
     * which is why the invoice came out right and this looked cosmetic. It is not: the contract row is
     * what the contracts list, the summary and anything later reads, and it says the contract has no
     * customer. Worse, the fallback is evaluated at BILLING time — reassign the site to a new customer
     * mid-season and last month's unbilled visits invoice to the new one.
     *
     * The form does not ask for a customer (the site carries it), so the site's customer is the answer
     * at the moment the contract is signed, and it is stored. An explicitly sent contactId still wins,
     * for a site billed to someone other than its owner.
     */
    contactId: body.contactId ?? siteRow.contactId ?? null,
    billingMode,
    perPushRate: rate(body.perPushRate),
    perEventRate: rate(body.perEventRate),
    perInchRate: rate(body.perInchRate),
    seasonalRate: rate(body.seasonalRate),
    triggerDepthInches: rate(body.triggerDepthInches, '2'),
    saltRate: rate(body.saltRate),
    status: body.status ?? 'active',
    notes: body.notes ?? null,
  }).returning()
  audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'snow_contract', entityId: contract.id, entityName: await contractLabel(user.companyId, contract.siteId, billingMode), userId: user.userId, companyId: user.companyId })
  return c.json(contract, 201)
})

app.put('/contracts/:id', requirePermission('invoices:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  // The stored row is read BEFORE validating, because the rule "the billing mode's own rate must be
  // set" is about what the contract will hold after this write — a PATCH that only sends
  // `perInchRate: ''` says nothing about the mode, and a PATCH that only switches the mode says
  // nothing about the rates. Either one alone can leave the contract billing by a zero.
  const [before] = await db.select().from(snowContract)
    .where(and(eq(snowContract.id, id), eq(snowContract.companyId, user.companyId))).limit(1)
  if (!before) return c.json({ error: 'Contract not found' }, 404)
  const bad = snowContractInputError(body, before)
  if (bad) return c.json({ error: bad }, 400)
  const patch: Record<string, unknown> = { updatedAt: new Date() }
  for (const k of ['perPushRate', 'perEventRate', 'perInchRate', 'seasonalRate', 'triggerDepthInches', 'saltRate']) {
    if (body[k] !== undefined) patch[k] = rate(body[k], k === 'triggerDepthInches' ? '2' : '0')
  }
  if (body.billingMode && BILLING_MODES.includes(body.billingMode)) patch.billingMode = body.billingMode
  if (body.status) patch.status = body.status
  if (body.notes != null) patch.notes = body.notes
  const [contract] = await db.update(snowContract).set(patch)
    .where(and(eq(snowContract.id, id), eq(snowContract.companyId, user.companyId)))
    .returning()
  if (!contract) return c.json({ error: 'Contract not found' }, 404)
  /**
   * EDITING A SNOW CONTRACT IS AUDITED. (T58k)
   *
   *   owner: "Landscaping: edits to snow contracts and routes aren't audited (creates and deletes are)."
   *
   * Creating one and deleting one were both logged, and the EDIT — the one that changes what a
   * customer is billed — was not. This is the contract's rates and its trigger depth: moving
   * `perInchRate` or `triggerDepthInches` changes every invoice raised from it afterwards, and
   * nothing recorded who moved it. The diff is carried because here the VALUES are the point; with
   * `before` already loaded for validation, there was nothing to work out.
   */
  audit.log({
    req: c,
    action: audit.ACTIONS.UPDATE,
    entity: 'snow_contract',
    entityId: contract.id,
    entityName: await contractLabel(user.companyId, contract.siteId, contract.billingMode),
    changes: audit.diff(before as any, contract as any),
  })
  return c.json(contract)
})

app.delete('/contracts/:id', requirePermission('invoices:delete'), async (c) => {
  const user = c.get('user') as any
  /**
   * A DELETE LEAVES A TRACE. (T58d)
   *
   *   Owner: "Deleting a snow contract or a route writes no audit row."
   *
   * It did not — and a deletion is the single event an audit log exists for. Creating a contract was
   * logged; removing one, along with every visit on it (the row cascades), was not. Afterwards there
   * was nothing to say the contract had ever existed, let alone who removed it.
   *
   * `.returning()` so the row can be NAMED in the log — "per_push contract" rather than an id
   * nobody can resolve, because the record it points at is gone by the time anyone reads the entry.
   * Still 204 either way: deleting something already deleted is not an error, and a client retrying
   * must not start seeing failures. Logged only when something was actually removed.
   */
  const [gone] = await db.delete(snowContract)
    .where(and(eq(snowContract.id, c.req.param('id')), eq(snowContract.companyId, user.companyId)))
    .returning()
  if (gone) {
    audit.log({
      req: c, action: audit.ACTIONS.DELETE, entity: 'snow_contract', entityId: gone.id,
      entityName: await contractLabel(user.companyId, gone.siteId, gone.billingMode), userId: user.userId, companyId: user.companyId,
    })
  }
  return c.body(null, 204)
})

// ---- Events ----

app.get('/events', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any
  const contractId = c.req.query('contractId')
  const where = contractId
    ? and(eq(snowEvent.companyId, user.companyId), eq(snowEvent.snowContractId, contractId))
    : eq(snowEvent.companyId, user.companyId)
  const events = await db.select().from(snowEvent).where(where).orderBy(desc(snowEvent.servicedAt))
  /**
   * Each row says whether it fell below its contract's trigger depth. (T58d)
   *
   * Derived here against the trigger IN FORCE NOW rather than stored on the event, so changing a
   * contract's trigger re-describes its history correctly instead of leaving a stale flag. Without
   * it the list shows a $0 visit with no explanation, which is the fault this work exists to fix —
   * the old behaviour at least charged something.
   */
  const contracts = await db.select().from(snowContract).where(eq(snowContract.companyId, user.companyId))
  const triggerFor = new Map(contracts.map((k: any) => [k.id, k.triggerDepthInches]))
  return c.json({
    data: events.map((e: any) => {
      const triggerDepthInches = triggerFor.get(e.snowContractId) ?? null
      return { ...e, triggerDepthInches, belowTrigger: isBelowTrigger({ triggerDepthInches }, e) }
    }),
  })
})

app.post('/events', requirePermission('invoices:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  if (!body.snowContractId) return c.json({ error: 'Pick the contract this visit is for.' }, 400)
  const badEvent = snowEventInputError(body)
  if (badEvent) return c.json({ error: badEvent }, 400)

  const [contract] = await db.select().from(snowContract)
    .where(and(eq(snowContract.id, body.snowContractId), eq(snowContract.companyId, user.companyId)))
  if (!contract) return c.json({ error: 'Contract not found' }, 404)

  const ev = {
    pushes: parseInt(body.pushes ?? '1', 10),
    snowfallInches: Number(body.snowfallInches ?? 0),
    saltApplied: !!body.saltApplied,
    billBelowTrigger: !!body.billBelowTrigger,
  }
  const badCharge = snowEventChargeError(contract.billingMode, ev)
  if (badCharge) return c.json({ error: badCharge }, 400)
  const billableAmount = computeSnowEventCharge(contract as any, ev)
  const belowTrigger = isBelowTrigger(contract as any, ev)

  const [event] = await db.insert(snowEvent).values({
    companyId: user.companyId,
    snowContractId: contract.id,
    siteId: contract.siteId,
    servicedAt: body.servicedAt ? new Date(body.servicedAt) : new Date(),
    pushes: ev.pushes,
    snowfallInches: String(ev.snowfallInches),
    saltApplied: ev.saltApplied,
    billBelowTrigger: ev.billBelowTrigger,
    billableAmount: String(billableAmount),
    billingMode: contract.billingMode,
    assignedToId: body.assignedToId ?? user.userId ?? null,
    notes: body.notes ?? null,
  }).returning()
  // The audit line says WHY it came to nothing, so "logged a visit, charged $0" is not something
  // anyone has to reconstruct later from the contract's trigger depth.
  const why = belowTrigger && !ev.billBelowTrigger
    ? ` — below the ${Number(contract.triggerDepthInches)}in trigger, not charged`
    : belowTrigger ? ` — below trigger, charged on request` : ''
  audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'snow_event', entityId: event.id, entityName: `$${billableAmount} — ${await contractLabel(user.companyId, contract.siteId, contract.billingMode)}${why}`, userId: user.userId, companyId: user.companyId })
  // `belowTrigger` is derived, not stored — the contract's trigger can be changed later and this
  // must always reflect the one in force. The screen needs it to explain a $0 line.
  return c.json({ ...event, belowTrigger, triggerDepthInches: contract.triggerDepthInches }, 201)
})

app.delete('/events/:id', requirePermission('invoices:delete'), async (c) => {
  const user = c.get('user') as any
  // Same as the contract delete above: a removed visit is money that was going to be charged and
  // then was not, so it leaves a row saying what it was worth and who removed it.
  const [gone] = await db.delete(snowEvent)
    .where(and(eq(snowEvent.id, c.req.param('id')), eq(snowEvent.companyId, user.companyId)))
    .returning()
  if (gone) {
    audit.log({
      req: c, action: audit.ACTIONS.DELETE, entity: 'snow_event', entityId: gone.id,
      entityName: `$${gone.billableAmount} — ${await contractLabel(user.companyId, gone.siteId, gone.billingMode)}`, userId: user.userId, companyId: user.companyId,
    })
  }
  return c.body(null, 204)
})

// ---- Billing: unbilled visits → one invoice ----

/** An invoice line for a logged visit: the date and what was charged for (pushes / event / inches, salt). */
export function snowEventLine(ev: { servicedAt: Date | string; pushes: number; snowfallInches: string | number; saltApplied: boolean; billingMode: string; billableAmount: string | number }) {
  const day = new Date(ev.servicedAt).toISOString().slice(0, 10)
  const work = ev.billingMode === 'per_push' ? `${ev.pushes} push${Number(ev.pushes) === 1 ? '' : 'es'}`
    : ev.billingMode === 'per_inch' ? `${Number(ev.snowfallInches)}" snowfall`
    : ev.billingMode === 'per_event' ? 'snow event' : 'seasonal visit'
  // A salt-only run (no plough pass) reads as "salt", not "0 pushes + salt" — the customer reads this line.
  const saltOnly = ev.saltApplied
    && (ev.billingMode === 'per_push' ? !(Number(ev.pushes) > 0) : ev.billingMode === 'per_inch' ? !(Number(ev.snowfallInches) > 0) : false)
  if (saltOnly) return { description: `Snow & ice service ${day} — salt`, quantity: 1, unitPrice: Number(ev.billableAmount) }
  return { description: `Snow & ice service ${day} — ${work}${ev.saltApplied ? ' + salt' : ''}`, quantity: 1, unitPrice: Number(ev.billableAmount) }
}

// POST /contracts/:id/bill — puts every unbilled visit with a charge on ONE draft invoice to the contract's customer
// (the site's customer when the contract has none), with the company's default tax rate and payment terms, and marks
// those visits billed. The unbilled visits are locked while the invoice is created, so billing twice at once can't
// invoice a visit twice. Visits with no charge (covered by a seasonal fee) are left as they are.
// (Landscaping T14 H5: a logged storm visit sat "unbilled · $175" with no way to bill it)
app.post('/contracts/:id/bill', requirePermission('invoices:create'), async (c) => {
  const user = c.get('user') as any
  const cid = user.companyId
  const id = c.req.param('id')
  const [row] = await db.select({ contract: snowContract, siteName: site.name, siteContactId: site.contactId })
    .from(snowContract).leftJoin(site, eq(snowContract.siteId, site.id))
    .where(and(eq(snowContract.id, id), eq(snowContract.companyId, cid))).limit(1)
  if (!row) return c.json({ error: 'Contract not found' }, 404)
  const contactId = row.contract.contactId || row.siteContactId
  if (!contactId) return c.json({ error: 'This contract has no customer to bill — set one on the site first.' }, 400)
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, cid)).limit(1)
  const settings = (co?.settings as any) || {}
  // Today on the COMPANY's calendar — `new Date()` dated an evening invoice tomorrow on a UTC server,
  // the bug the vet owner caught on visit invoices (T59). Read before the transaction opens.
  const today = businessToday(await companyTimeZone(db, cid))

  const result = await db.transaction(async (tx: any) => {
    const unbilled = await tx.select().from(snowEvent)
      .where(and(eq(snowEvent.snowContractId, id), eq(snowEvent.companyId, cid), isNull(snowEvent.invoiceId)))
      .orderBy(asc(snowEvent.servicedAt)).for('update')
    const billable = unbilled.filter((e: any) => Number(e.billableAmount) > 0)
    if (!billable.length) {
      return { error: unbilled.length ? 'These visits have no charge (covered by the seasonal fee), so there is nothing to bill.' : 'There are no unbilled visits on this contract.' }
    }
    const created = await insertInvoice(tx, { invoice, invoiceLineItem } as any, INVOICE_NUMBERING, {
      companyId: cid, contactId, notes: `Snow & ice service — ${row.siteName || 'site'}`,
      dueDate: dueDateFromTerms(settings, today), issueDate: today, taxRate: defaultTaxRateFrom(settings),
    }, billable.map(snowEventLine))
    await tx.update(snowEvent).set({ invoiceId: created.id }).where(inArray(snowEvent.id, billable.map((e: any) => e.id)))
    return { invoice: created, billedVisits: billable.length }
  })
  if ('error' in result) return c.json({ error: result.error }, 400)
  audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'invoice', entityId: result.invoice.id, entityName: result.invoice.number, userId: user.userId, companyId: cid, metadata: { source: 'snow_contract', snowContractId: id, visits: result.billedVisits } })
  return c.json(result, 201)
})

// ---- Summary: unbilled totals per contract ----

app.get('/summary', requirePermission('invoices:read'), async (c) => {
  const user = c.get('user') as any
  const contracts = await db.select().from(snowContract)
    .where(eq(snowContract.companyId, user.companyId))
  const events = await db.select().from(snowEvent)
    .where(eq(snowEvent.companyId, user.companyId))
  const summary = contracts.map(ct => {
    const ev = events.filter(e => e.snowContractId === ct.id)
    const unbilled = ev.filter(e => !e.invoiceId)
    const sum = (arr: typeof ev) => arr.reduce((t, e) => t + Number(e.billableAmount), 0)
    return {
      contractId: ct.id, siteId: ct.siteId, billingMode: ct.billingMode,
      seasonalRate: Number(ct.seasonalRate),
      events: ev.length, unbilledEvents: unbilled.length,
      unbilledTotal: Math.round(sum(unbilled) * 100) / 100,
      lifetimeTotal: Math.round(sum(ev) * 100) / 100,
    }
  })
  return c.json({ data: summary })
})

export default app
