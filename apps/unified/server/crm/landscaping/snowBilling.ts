// Snow & ice billing: per-site contracts (per push, per event, per inch or seasonal, salt on top), the storm visits
// logged against them, and billing the unbilled visits onto one draft invoice. Moved from
// templates/crm-landscaping/backend/src/routes/snowBilling.ts. The registry signs the person in and applies the
// 'snow_billing' gate. The billing rules below are the template's, unchanged, and exported: the suite asserts them
// where they live.
import { Hono } from 'hono'
import { eq, and, desc, asc, isNull, inArray } from 'drizzle-orm'
import { insertInvoice, defaultTaxRateFrom, dueDateFromTerms, businessToday, companyTimeZone } from '@twomiah/tenant-backend'
import { snowContract, snowEvent, site, invoice, invoiceLineItem, company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'

// The same numbering as the CRM's invoices (the shared default INV-00001).
const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }

const BILLING_MODES = ['per_push', 'per_event', 'per_inch', 'seasonal', 'hourly'] as const

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
  ['seasonalRate', 'Seasonal rate'], ['hourlyRate', 'Hourly rate'], ['saltRate', 'Salt rate'], ['triggerDepthInches', 'Trigger depth'],
]

/**
 * What a snow contract may be saved with. A blank optional field still means "not set" (per_push contracts leave the
 * other rates empty), but a value that isn't a number, or a billing mode that isn't one of ours, is refused with the
 * field named instead of being silently stored as 0 / per_push. (Landscaping T14 N1: "per_banana" was saved as
 * per_push and a rate of "abc" as 0.00, both 201)
 */
/** Rows 22–25 (snow_tools, not ready): the contract fields only that switch offers. */
export const SNOW_TOOLS = 'snow_tools'
export const SNOW_TOOL_FIELDS = ['depthBands', 'requirePhotos', 'saltUnit', 'saltPerUnitRate', 'saltUnitCost', 'materialMarkupPct', 'baseMinutes', 'minutesPerInch'] as const
export const SALT_UNITS = ['tons', 'bags', 'lbs', 'yards'] as const

export function snowContractInputError(body: any, existing?: any, tools = false): string | null {
  const modes: readonly string[] = tools ? [...BILLING_MODES, 'depth_band'] : BILLING_MODES
  if (body.billingMode !== undefined && body.billingMode !== '' && !modes.includes(body.billingMode)) {
    return `Billing mode must be one of: ${modes.join(', ')}.`
  }
  if (tools) {
    if ((body.billingMode ?? existing?.billingMode) === 'depth_band') {
      const bad = depthBandsError(body.depthBands !== undefined ? body.depthBands : existing?.depthBands)
      if (bad) return bad
    }
    if (body.requirePhotos !== undefined && typeof body.requirePhotos !== 'boolean') return 'Say whether photos are required (yes or no).'
    if (body.saltUnit !== undefined && body.saltUnit !== null && body.saltUnit !== '' && !(SALT_UNITS as readonly string[]).includes(body.saltUnit)) return `Salt is counted in ${SALT_UNITS.join(', ')}.`
    for (const [k, label, most] of [['saltPerUnitRate', 'Price per unit of salt', 100_000], ['saltUnitCost', 'Our cost per unit of salt', 100_000], ['materialMarkupPct', 'Material markup', 1000], ['minutesPerInch', 'Minutes per inch', 120]] as const) {
      const v = body[k]
      if (v === undefined || v === null || String(v).trim() === '') continue
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0 || n > most) return `${label} must be a number from 0 to ${most.toLocaleString('en-US')}.`
    }
    if (body.baseMinutes !== undefined && body.baseMinutes !== null && String(body.baseMinutes).trim() !== '') {
      const n = Number(body.baseMinutes)
      if (!Number.isInteger(n) || n < 1 || n > 600) return 'Base minutes must be a whole number from 1 to 600.'
    }
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
    hourly: ['hourlyRate', 'an hourly rate'],
    // depth_band is priced by its table, checked above.
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
  if (body.hours !== undefined && body.hours !== null && String(body.hours).trim() !== '') {
    const h = Number(body.hours)
    if (!Number.isFinite(h) || h < 0 || h > 48) return 'Hours must be a number from 0 to 48.'
  }
  if (body.saltQuantity !== undefined && body.saltQuantity !== null && String(body.saltQuantity).trim() !== '') {
    const q = Number(body.saltQuantity)
    if (!Number.isFinite(q) || q < 0 || q > 10_000) return 'Salt put down must be an amount from 0 to 10,000.'
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
  hourlyRate?: string | number
  saltRate: string | number
  // Read by isBelowTrigger (T58d); typed here for strict TypeScript, the template left it implicit.
  triggerDepthInches?: string | number | null
  // Rows 22 and 24–25 (snow_tools): the depth-band table, and salt by quantity.
  depthBands?: unknown
  saltPerUnitRate?: string | number | null
  saltUnitCost?: string | number | null
  materialMarkupPct?: string | number | null
}

/** A depth-band table as stored: [{ from, to|null, amount }] in inches and dollars, lowest first; anything else is no table. */
export function readDepthBands(raw: unknown): Array<{ from: number; to: number | null; amount: number }> {
  if (!Array.isArray(raw)) return []
  return raw.map((b: any) => ({ from: Number(b?.from), to: b?.to === null || b?.to === undefined || b?.to === '' ? null : Number(b.to), amount: Number(b?.amount) }))
    .filter((b) => Number.isFinite(b.from) && b.from >= 0 && Number.isFinite(b.amount) && b.amount >= 0 && (b.to === null || (Number.isFinite(b.to) && b.to > b.from)))
    .sort((a, b) => a.from - b.from)
}

/** Why a depth-band table cannot be saved, or null: bands in order, not overlapping, only the last open-ended. */
export function depthBandsError(raw: unknown): string | null {
  if (!Array.isArray(raw) || !raw.length) return 'Add at least one depth band: from, to and the price.'
  if (raw.length > 12) return 'A contract has 12 depth bands at most.'
  const bands = readDepthBands(raw)
  if (bands.length !== raw.length) return 'Each band needs a depth from, a depth to (higher, or blank for "and over") and a price of 0 or more.'
  for (let i = 1; i < bands.length; i++) {
    if (bands[i - 1].to === null) return 'Only the last band can be "and over".'
    if (bands[i].from < bands[i - 1].to!) return 'The depth bands overlap.'
  }
  return null
}

/** The band a snowfall falls in (from is included, to is not), or null. */
export const bandFor = (bands: Array<{ from: number; to: number | null; amount: number }>, inches: number) =>
  bands.find((b) => inches >= b.from && (b.to === null || inches < b.to)) ?? null

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
  ev: { pushes: number; snowfallInches: number; saltApplied: boolean; billBelowTrigger?: boolean; hours?: number; saltQuantity?: number | null },
) {
  const n = (v: string | number | null | undefined) => Number(v) || 0
  let base = 0
  switch (contract.billingMode) {
    // Row 22 (Aspire contract approaches): the price of the band the snowfall falls in.
    case 'depth_band': base = bandFor(readDepthBands(contract.depthBands), n(ev.snowfallInches))?.amount ?? 0; break
    case 'per_push': base = n(ev.pushes) * n(contract.perPushRate); break
    case 'per_event': base = n(contract.perEventRate); break
    case 'per_inch': base = n(ev.snowfallInches) * n(contract.perInchRate); break
    case 'seasonal': base = 0; break
    // Hourly: the crew's hours on site times the contract's hourly rate (storm mode keeps the clock).
    case 'hourly': base = n(ev.hours ?? 0) * n(contract.hourlyRate ?? 0); break
  }
  if (isBelowTrigger(contract, ev) && !ev.billBelowTrigger) base = 0
  // Salt by quantity (row 24): the amount put down at the contract's price per unit — or, time and materials (hourly), our cost per
  // unit marked up (row 25, Aspire T&M). No quantity, or no unit price: the flat salt rate when salt was put down, as before.
  const qty = n(ev.saltQuantity)
  const perUnit = n(contract.saltPerUnitRate) > 0 ? n(contract.saltPerUnitRate)
    : contract.billingMode === 'hourly' && n(contract.saltUnitCost) > 0 ? n(contract.saltUnitCost) * (1 + n(contract.materialMarkupPct) / 100) : 0
  const salt = qty > 0 && perUnit > 0 ? qty * perUnit : ev.saltApplied || qty > 0 ? n(contract.saltRate) : 0
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
  ev: { pushes: number; snowfallInches: number; saltApplied: boolean; hours?: number },
): string | null {
  if (ev.saltApplied) return null
  if (billingMode === 'hourly' && !(Number(ev.hours) > 0)) {
    return 'This contract is billed by the hour, so a visit needs the hours worked — or tick salt if that is all that was done.'
  }
  if (billingMode === 'per_push' && !(Number(ev.pushes) > 0)) {
    return 'This contract is billed per push, so a visit needs at least one push — or tick salt if that is all that was done.'
  }
  if (billingMode === 'per_inch' && !(Number(ev.snowfallInches) > 0)) {
    return 'This contract is billed per inch, so a visit needs the snowfall measured — or tick salt if that is all that was done.'
  }
  return null
}

/**
 * WHICH CONTRACT — named by the site it covers. (T59) A snow contract has no name column; what tells one contract from
 * another is the site it covers, so the audit names the site, then the mode: "Oak Street Plaza — per push".
 */
async function contractLabel(db: any, companyId: string, siteId: string | null | undefined, billingMode: string): Promise<string> {
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

/** An invoice line for a logged visit: the date and what was charged for (pushes / event / inches, salt). */
export function snowEventLine(ev: { servicedAt: Date | string; pushes: number; snowfallInches: string | number; saltApplied: boolean; billingMode: string; billableAmount: string | number; hours?: string | number }) {
  const day = new Date(ev.servicedAt).toISOString().slice(0, 10)
  const work = ev.billingMode === 'per_push' ? `${ev.pushes} push${Number(ev.pushes) === 1 ? '' : 'es'}`
    : ev.billingMode === 'per_inch' ? `${Number(ev.snowfallInches)}" snowfall`
    : ev.billingMode === 'per_event' ? 'snow event'
    : ev.billingMode === 'hourly' ? `${Number(ev.hours)} hour${Number(ev.hours) === 1 ? '' : 's'}` : 'seasonal visit'
  // A salt-only run (no plough pass) reads as "salt", not "0 pushes + salt" — the customer reads this line.
  const saltOnly = ev.saltApplied
    && (ev.billingMode === 'per_push' ? !(Number(ev.pushes) > 0) : ev.billingMode === 'per_inch' ? !(Number(ev.snowfallInches) > 0) : ev.billingMode === 'hourly' ? !(Number(ev.hours) > 0) : false)
  if (saltOnly) return { description: `Snow & ice service ${day} — salt`, quantity: 1, unitPrice: Number(ev.billableAmount) }
  return { description: `Snow & ice service ${day} — ${work}${ev.saltApplied ? ' + salt' : ''}`, quantity: 1, unitPrice: Number(ev.billableAmount) }
}

export function createSnowBillingRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  // ---- Contracts ----

  app.get('/contracts', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user')
    const rows = await db.select({ contract: snowContract, siteName: site.name, siteAddress: site.address })
      .from(snowContract)
      .leftJoin(site, eq(snowContract.siteId, site.id))
      .where(eq(snowContract.companyId, u.companyId))
      .orderBy(desc(snowContract.createdAt))
    const data = rows.map((r: any) => ({ ...r.contract, siteName: r.siteName, siteAddress: r.siteAddress }))
    return listAll(c, data)
  })

  const toolsOn = (companyId: string) => d.features.isFeatureEnabled(companyId, SNOW_TOOLS)
  /** The rows 22–25 fields a contract save carries (only with snow_tools on). */
  const toolFields = (body: any): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    if (body.depthBands !== undefined) out.depthBands = body.depthBands === null ? null : readDepthBands(body.depthBands)
    if (body.requirePhotos !== undefined) out.requirePhotos = !!body.requirePhotos
    if (body.saltUnit !== undefined) out.saltUnit = body.saltUnit || null
    for (const k of ['saltPerUnitRate', 'saltUnitCost', 'materialMarkupPct']) if (body[k] !== undefined) out[k] = rate(body[k])
    if (body.baseMinutes !== undefined) out.baseMinutes = body.baseMinutes === null || body.baseMinutes === '' ? null : Number(body.baseMinutes)
    if (body.minutesPerInch !== undefined) out.minutesPerInch = body.minutesPerInch === null || body.minutesPerInch === '' ? null : rate(body.minutesPerInch)
    return out
  }
  const usesTools = (body: any) => SNOW_TOOL_FIELDS.some((k) => body?.[k] !== undefined) || body?.billingMode === 'depth_band'

  app.post('/contracts', requirePermission('invoices:create'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json()
    if (!body.siteId) return fail(c, 400, 'Pick the site this contract covers.')
    const tools = await toolsOn(u.companyId)
    if (!tools && usesTools(body)) return fail(c, 403, 'This module is not enabled for your account.', 'FEATURE_NOT_ENABLED')
    const bad = snowContractInputError(body, undefined, tools)
    if (bad) return fail(c, 400, bad)
    const [siteRow] = await db.select({ id: site.id, contactId: site.contactId }).from(site)
      .where(and(eq(site.id, String(body.siteId)), eq(site.companyId, u.companyId))).limit(1)
    if (!siteRow) return fail(c, 404, 'Site not found')
    const billingMode = (BILLING_MODES as readonly string[]).includes(body.billingMode) || (tools && body.billingMode === 'depth_band') ? body.billingMode : 'per_push'
    const [contract] = await db.insert(snowContract).values({
      companyId: u.companyId,
      siteId: String(body.siteId),
      // Who is billed is written down at signing, not re-derived at billing time (T41): reassign the site mid-season
      // and last month's unbilled visits would otherwise invoice to the new customer. An explicit contactId still wins.
      contactId: body.contactId ?? siteRow.contactId ?? null,
      billingMode,
      perPushRate: rate(body.perPushRate),
      perEventRate: rate(body.perEventRate),
      perInchRate: rate(body.perInchRate),
      seasonalRate: rate(body.seasonalRate),
      hourlyRate: rate(body.hourlyRate),
      triggerDepthInches: rate(body.triggerDepthInches, '2'),
      saltRate: rate(body.saltRate),
      ...(tools ? toolFields(body) : {}),
      status: body.status ?? 'active',
      notes: body.notes ?? null,
    }).returning()
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'snow_contract', entityId: contract.id, entityName: await contractLabel(db, u.companyId, contract.siteId, billingMode), userId: u.userId, companyId: u.companyId })
    return one(c, contract, 201)
  })

  app.put('/contracts/:id', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const body = await c.req.json()
    // The stored row is read BEFORE validating: "the billing mode's own rate must be set" is about what the contract
    // will hold after this write, and a patch that sends only one of the mode and the rate says nothing of the other.
    const [before] = await db.select().from(snowContract)
      .where(and(eq(snowContract.id, id), eq(snowContract.companyId, u.companyId))).limit(1)
    if (!before) return fail(c, 404, 'Contract not found')
    const tools = await toolsOn(u.companyId)
    if (!tools && usesTools(body)) return fail(c, 403, 'This module is not enabled for your account.', 'FEATURE_NOT_ENABLED')
    const bad = snowContractInputError(body, before, tools)
    if (bad) return fail(c, 400, bad)
    const patch: Record<string, unknown> = { updatedAt: new Date() }
    for (const k of ['perPushRate', 'perEventRate', 'perInchRate', 'seasonalRate', 'hourlyRate', 'triggerDepthInches', 'saltRate']) {
      if (body[k] !== undefined) patch[k] = rate(body[k], k === 'triggerDepthInches' ? '2' : '0')
    }
    if (body.billingMode && ((BILLING_MODES as readonly string[]).includes(body.billingMode) || (tools && body.billingMode === 'depth_band'))) patch.billingMode = body.billingMode
    if (tools) Object.assign(patch, toolFields(body))
    if (body.status) patch.status = body.status
    if (body.notes != null) patch.notes = body.notes
    const [contract] = await db.update(snowContract).set(patch)
      .where(and(eq(snowContract.id, id), eq(snowContract.companyId, u.companyId)))
      .returning()
    if (!contract) return fail(c, 404, 'Contract not found')
    // Editing a snow contract is audited, with the diff: its rates and trigger change every invoice raised after. (T58k)
    audit.log({
      req: c, action: audit.ACTIONS.UPDATE, entity: 'snow_contract', entityId: contract.id,
      entityName: await contractLabel(db, u.companyId, contract.siteId, contract.billingMode),
      changes: audit.diff(before, contract),
    })
    return one(c, contract)
  })

  // A delete leaves a trace (T58d), named from the returned row. An id that is not this company's (or not there) is a
  // 404: it answered 204 "so a retry is fine", which also told a mistyped or another company's id it had been deleted
  // (live role check, 2026-10-23). A retry after a real delete reads 404, which the screen shows as already gone.
  app.delete('/contracts/:id', requirePermission('invoices:delete'), async (c) => {
    const u = c.get('user')
    const [gone] = await db.delete(snowContract)
      .where(and(eq(snowContract.id, c.req.param('id')), eq(snowContract.companyId, u.companyId)))
      .returning()
    if (!gone) return fail(c, 404, 'Contract not found')
    {
      audit.log({
        req: c, action: audit.ACTIONS.DELETE, entity: 'snow_contract', entityId: gone.id,
        entityName: await contractLabel(db, u.companyId, gone.siteId, gone.billingMode), userId: u.userId, companyId: u.companyId,
      })
    }
    return c.body(null, 204)
  })

  // ---- Events ----

  app.get('/events', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user')
    const contractId = c.req.query('contractId')
    const where = contractId
      ? and(eq(snowEvent.companyId, u.companyId), eq(snowEvent.snowContractId, contractId))
      : eq(snowEvent.companyId, u.companyId)
    const events = await db.select().from(snowEvent).where(where).orderBy(desc(snowEvent.servicedAt))
    // Each row says whether it fell below its contract's trigger IN FORCE NOW, so changing a contract's trigger
    // re-describes its history instead of leaving a stale flag. (T58d)
    const contracts = await db.select().from(snowContract).where(eq(snowContract.companyId, u.companyId))
    const triggerFor = new Map<string, string | number | null>(contracts.map((k: any) => [k.id, k.triggerDepthInches]))
    const data = events.map((e: any) => {
      const triggerDepthInches = triggerFor.get(e.snowContractId) ?? null
      return { ...e, triggerDepthInches, belowTrigger: isBelowTrigger({ triggerDepthInches }, e) }
    })
    return listAll(c, data)
  })

  app.post('/events', requirePermission('invoices:create'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json()
    if (!body.snowContractId) return fail(c, 400, 'Pick the contract this visit is for.')
    const badEvent = snowEventInputError(body)
    if (badEvent) return fail(c, 400, badEvent)

    const [contract] = await db.select().from(snowContract)
      .where(and(eq(snowContract.id, body.snowContractId), eq(snowContract.companyId, u.companyId)))
    if (!contract) return fail(c, 404, 'Contract not found')

    const ev = {
      // A blank box is one push and no snowfall, as the form starts (snowEventInputError has refused anything else).
      pushes: String(body.pushes ?? '').trim() === '' ? 1 : Number(body.pushes),
      snowfallInches: String(body.snowfallInches ?? '').trim() === '' ? 0 : Number(body.snowfallInches),
      saltApplied: !!body.saltApplied,
      billBelowTrigger: !!body.billBelowTrigger,
      hours: String(body.hours ?? '').trim() === '' ? 0 : Number(body.hours),
      // Salt by amount (row 24, snow_tools): bags, tons… at the contract's price per unit (landscaping re-check 11/08: the form sent
      // the bags and this route dropped them — "billed $50.00" where $66.00 was right).
      saltQuantity: (await toolsOn(u.companyId)) && String(body.saltQuantity ?? '').trim() !== '' ? Number(body.saltQuantity) : null,
    }
    const badCharge = snowEventChargeError(contract.billingMode, ev)
    if (badCharge) return fail(c, 400, badCharge)
    const billableAmount = computeSnowEventCharge(contract, ev)
    const belowTrigger = isBelowTrigger(contract, ev)

    const [event] = await db.insert(snowEvent).values({
      companyId: u.companyId,
      snowContractId: contract.id,
      siteId: contract.siteId,
      servicedAt: body.servicedAt ? new Date(body.servicedAt) : new Date(),
      pushes: ev.pushes,
      snowfallInches: String(ev.snowfallInches),
      saltApplied: ev.saltApplied,
      billBelowTrigger: ev.billBelowTrigger,
      hours: String(ev.hours),
      ...(ev.saltQuantity != null ? { saltQuantity: String(ev.saltQuantity), saltApplied: ev.saltApplied || ev.saltQuantity > 0 } : {}),
      billableAmount: String(billableAmount),
      billingMode: contract.billingMode,
      assignedToId: body.assignedToId ?? u.userId ?? null,
      notes: body.notes ?? null,
    }).returning()
    // The audit line says WHY it came to nothing, so "logged a visit, charged $0" needs no reconstructing later.
    const why = belowTrigger && !ev.billBelowTrigger
      ? ` — below the ${Number(contract.triggerDepthInches)}in trigger, not charged`
      : belowTrigger ? ' — below trigger, charged on request' : ''
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'snow_event', entityId: event.id, entityName: `$${billableAmount} — ${await contractLabel(db, u.companyId, contract.siteId, contract.billingMode)}${why}`, userId: u.userId, companyId: u.companyId })
    // `belowTrigger` is derived, not stored; the screen needs it to explain a $0 line.
    return one(c, { ...event, belowTrigger, triggerDepthInches: contract.triggerDepthInches }, 201)
  })

  // A removed visit is money that was going to be charged; it leaves a row saying what it was worth and who removed it.
  // Row 23 (Aspire; snow_tools): the office changes what a logged visit bills — with a reason, audited — before it is billed, instead
  // of deleting it and logging it again. The contract's own figure is kept beside it.
  app.put('/events/:id/price', requirePermission('invoices:update'), async (c) => {
    const u = c.get('user')
    if (!(await toolsOn(u.companyId))) return fail(c, 403, 'This module is not enabled for your account.', 'FEATURE_NOT_ENABLED')
    const b: any = await c.req.json().catch(() => ({}))
    const amount = Number(b?.amount)
    if (b?.amount === undefined || b?.amount === null || String(b.amount).trim() === '' || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return fail(c, 400, 'Give the amount to bill, 0 or more.', undefined, { amount: 'Required' })
    const reason = typeof b?.reason === 'string' ? b.reason.trim().slice(0, 300) : ''
    if (!reason) return fail(c, 400, 'Say why the price is changed (the customer and the next person will ask).', undefined, { reason: 'Required' })
    const [ev] = await db.select().from(snowEvent).where(and(eq(snowEvent.id, c.req.param('id')), eq(snowEvent.companyId, u.companyId))).limit(1)
    if (!ev) return fail(c, 404, 'Visit not found')
    if (ev.invoiceId) return fail(c, 409, 'This visit is billed already. Change the invoice instead.')
    const [row] = await db.update(snowEvent).set({
      billableAmount: String(Math.round(amount * 100) / 100), computedAmount: ev.computedAmount ?? ev.billableAmount,
      overrideReason: reason, overriddenById: u.userId, overriddenAt: new Date(),
    }).where(and(eq(snowEvent.id, ev.id), eq(snowEvent.companyId, u.companyId))).returning()
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'snow_event', entityId: ev.id, entityName: 'Snow visit price', userId: u.userId, companyId: u.companyId, changes: { billableAmount: { from: ev.billableAmount, to: row.billableAmount } }, metadata: { reason } })
    return one(c, row)
  })

  app.delete('/events/:id', requirePermission('invoices:delete'), async (c) => {
    const u = c.get('user')
    const [gone] = await db.delete(snowEvent)
      .where(and(eq(snowEvent.id, c.req.param('id')), eq(snowEvent.companyId, u.companyId)))
      .returning()
    // An id that is not this company's (or not there at all) is a 404, not a success that deleted nothing (live role check, 2026-10-23).
    if (!gone) return fail(c, 404, 'Visit not found')
    {
      audit.log({
        req: c, action: audit.ACTIONS.DELETE, entity: 'snow_event', entityId: gone.id,
        entityName: `$${gone.billableAmount} — ${await contractLabel(db, u.companyId, gone.siteId, gone.billingMode)}`, userId: u.userId, companyId: u.companyId,
      })
    }
    return c.body(null, 204)
  })

  // ---- Billing: unbilled visits → one invoice ----

  // POST /contracts/:id/bill puts every unbilled visit with a charge on ONE draft invoice to the contract's customer
  // (the site's customer when the contract has none), with the company's default tax rate and payment terms, and marks
  // those visits billed. The unbilled visits are locked while the invoice is created, so billing twice at once can't
  // invoice a visit twice. Visits with no charge (covered by a seasonal fee) are left as they are. (Landscaping T14 H5)
  app.post('/contracts/:id/bill', requirePermission('invoices:create'), async (c) => {
    const u = c.get('user')
    const cid = u.companyId
    const id = c.req.param('id')
    const [row] = await db.select({ contract: snowContract, siteName: site.name, siteContactId: site.contactId })
      .from(snowContract).leftJoin(site, eq(snowContract.siteId, site.id))
      .where(and(eq(snowContract.id, id), eq(snowContract.companyId, cid))).limit(1)
    if (!row) return fail(c, 404, 'Contract not found')
    const contactId = row.contract.contactId || row.siteContactId
    if (!contactId) return fail(c, 400, 'This contract has no customer to bill — set one on the site first.')
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, cid)).limit(1)
    const settings = (co?.settings as any) || {}
    // Today on the COMPANY's calendar (T59), read before the transaction opens.
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
      } as any, billable.map(snowEventLine))
      await tx.update(snowEvent).set({ invoiceId: created.id }).where(inArray(snowEvent.id, billable.map((e: any) => e.id)))
      return { invoice: created, billedVisits: billable.length }
    })
    if ('error' in result) return fail(c, 400, result.error)
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'invoice', entityId: result.invoice.id, entityName: result.invoice.number, userId: u.userId, companyId: cid, metadata: { source: 'snow_contract', snowContractId: id, visits: result.billedVisits } })
    return one(c, result, 201)
  })

  // ---- Summary: unbilled totals per contract ----

  app.get('/summary', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user')
    const contracts = await db.select().from(snowContract).where(eq(snowContract.companyId, u.companyId))
    const events = await db.select().from(snowEvent).where(eq(snowEvent.companyId, u.companyId))
    const sum = (arr: any[]) => arr.reduce((t, e) => t + Number(e.billableAmount), 0)
    const summary = contracts.map((ct: any) => {
      const ev = events.filter((e: any) => e.snowContractId === ct.id)
      const unbilled = ev.filter((e: any) => !e.invoiceId)
      return {
        contractId: ct.id, siteId: ct.siteId, billingMode: ct.billingMode,
        seasonalRate: Number(ct.seasonalRate),
        events: ev.length, unbilledEvents: unbilled.length,
        unbilledTotal: Math.round(sum(unbilled) * 100) / 100,
        lifetimeTotal: Math.round(sum(ev) * 100) / 100,
      }
    })
    return listAll(c, summary)
  })

  return app
}
