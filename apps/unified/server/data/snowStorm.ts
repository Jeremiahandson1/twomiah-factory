// Storm mode for snow & ice (landscaping): the office starts a storm, dispatches every snow contract on a route or tag in
// one go (a job for the crew on "Today's route" per contract), the crew logs pushes, salt, hours and photos from the phone,
// and the storm is billed at the end. Nothing here prices a visit: the contracts' own rules do, imported from
// crm/landscaping/snowBilling.ts and used unchanged, so a storm visit costs exactly what the same visit logged on the Snow
// Billing page costs.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { insertInvoice, defaultTaxRateFrom, dueDateFromTerms, nextNumber } from '@twomiah/tenant-backend'
import {
  job, site, contact, company, invoice, invoiceLineItem,
  recurringRoute, recurringRouteStop, snowContract, snowEvent, snowStorm, snowStormStop,
} from '../db/schema/index.ts'
import {
  computeSnowEventCharge, isBelowTrigger, snowEventChargeError, snowEventInputError, snowEventLine,
} from '../crm/landscaping/snowBilling.ts'

const INVOICE_NUMBERING = { prefix: 'INV', pad: 5, seed: 0 }
const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
const money = (n: number) => Math.round(n * 100) / 100

/** Which contracts a storm goes to: those on a Route Board route, those whose customer carries a tag, a hand-picked list, or all. */
export interface StormTarget { routeId?: string | null; tag?: string | null; contractIds?: string[] | null; all?: boolean }

export interface StormContract {
  contract: any
  siteName: string | null
  siteAddress: string | null
  siteCity: string | null
  siteState: string | null
  siteZip: string | null
  /** Who is billed: the contract's own customer, else the site's. */
  contactId: string | null
}

/**
 * The ACTIVE contracts a target names, in the order the crew should drive them: a route's own stop order, otherwise by site
 * name. Paused and ended contracts are never dispatched. A target that names nothing is an error for the caller to raise
 * (`undefined` here), so "start a storm" can never quietly mean "everything".
 */
export async function stormContracts(db: any, companyId: string, target: StormTarget): Promise<{ rows: StormContract[]; routeCrewId: string | null } | { error: string }> {
  const routeId = target.routeId ? String(target.routeId) : null
  const tag = target.tag ? String(target.tag).trim().toLowerCase() : ''
  const ids = Array.isArray(target.contractIds) ? target.contractIds.map(String) : []
  if (!routeId && !tag && !ids.length && !target.all) return { error: 'Pick what the storm goes to: a route, a tag, some contracts, or everything.' }

  const base = () => db.select({
    contract: snowContract, siteName: site.name, siteAddress: site.address, siteCity: site.city, siteState: site.state, siteZip: site.zip,
    siteContactId: site.contactId,
  }).from(snowContract).innerJoin(site, eq(snowContract.siteId, site.id))

  let routeCrewId: string | null = null
  let order = new Map<string, number>()
  let wanted: any[] = await base().where(and(eq(snowContract.companyId, companyId), eq(snowContract.status, 'active')))

  if (routeId) {
    const [route] = await db.select().from(recurringRoute).where(and(eq(recurringRoute.id, routeId), eq(recurringRoute.companyId, companyId))).limit(1)
    if (!route) return { error: 'Route not found' }
    routeCrewId = route.assignedToId ?? null
    const stops: any[] = await db.select({ siteId: recurringRouteStop.siteId, sortOrder: recurringRouteStop.sortOrder })
      .from(recurringRouteStop).where(and(eq(recurringRouteStop.recurringRouteId, routeId), eq(recurringRouteStop.companyId, companyId)))
      .orderBy(asc(recurringRouteStop.sortOrder), asc(recurringRouteStop.createdAt))
    stops.forEach((s, i) => { if (!order.has(s.siteId)) order.set(s.siteId, i) })
    wanted = wanted.filter((r) => order.has(r.contract.siteId))
  }
  if (tag) {
    const cs: any[] = await db.select({ id: contact.id, tags: contact.tags }).from(contact).where(eq(contact.companyId, companyId))
    const tagged = new Set(cs.filter((c) => Array.isArray(c.tags) && c.tags.some((t: any) => String(t).trim().toLowerCase() === tag)).map((c) => c.id))
    wanted = wanted.filter((r) => tagged.has(r.contract.contactId ?? r.siteContactId))
  }
  if (ids.length) {
    const set = new Set(ids)
    wanted = wanted.filter((r) => set.has(r.contract.id))
  }
  wanted.sort((a, b) => {
    const oa = order.get(a.contract.siteId), ob = order.get(b.contract.siteId)
    if (oa != null && ob != null && oa !== ob) return oa - ob
    return String(a.siteName || '').localeCompare(String(b.siteName || ''))
  })
  return {
    routeCrewId,
    rows: wanted.map((r) => ({
      contract: r.contract, siteName: r.siteName, siteAddress: r.siteAddress, siteCity: r.siteCity, siteState: r.siteState, siteZip: r.siteZip,
      contactId: r.contract.contactId ?? r.siteContactId ?? null,
    })),
  }
}

export async function startStorm(db: any, companyId: string, userId: string | null, input: { name: string; notes?: string | null }) {
  const [row] = await db.insert(snowStorm).values({ companyId, name: input.name, notes: input.notes ?? null, createdById: userId }).returning()
  return row
}

export async function getStorm(db: any, companyId: string, stormId: string) {
  const [row] = await db.select().from(snowStorm).where(and(eq(snowStorm.id, stormId), eq(snowStorm.companyId, companyId))).limit(1)
  return row ?? null
}

/**
 * Dispatch the storm to the target's contracts: one job and one storm stop per contract, in drive order, led by `assignedToId`
 * (else the route's crew). A contract already in this storm is left alone, so dispatching twice — or a route and then a tag that
 * overlaps it — never doubles a stop. Returns what was made and what was already there.
 */
export async function dispatchStorm(
  db: any, companyId: string, userId: string | null, storm: { id: string },
  target: StormTarget, opts: { date: string; assignedToId?: string | null },
): Promise<{ made: Array<{ stopId: string; jobId: string; contractId: string; siteName: string | null }>; alreadyThere: number; error?: string }> {
  const picked = await stormContracts(db, companyId, target)
  if ('error' in picked) return { made: [], alreadyThere: 0, error: picked.error }
  const crewId = opts.assignedToId === undefined ? picked.routeCrewId : opts.assignedToId

  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':job'}))`)
    const have: any[] = await tx.select({ contractId: snowStormStop.snowContractId }).from(snowStormStop)
      .where(and(eq(snowStormStop.stormId, storm.id), eq(snowStormStop.companyId, companyId)))
    const taken = new Set(have.map((h) => h.contractId))
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(snowStormStop).where(eq(snowStormStop.stormId, storm.id))
    let order = Number(n) || 0
    const made: Array<{ stopId: string; jobId: string; contractId: string; siteName: string | null }> = []
    let alreadyThere = 0
    for (const r of picked.rows) {
      if (taken.has(r.contract.id)) { alreadyThere++; continue }
      const number = await nextNumber(tx, job, job.number, job.companyId, companyId, { prefix: 'JOB', pad: 5 })
      const [j] = await tx.insert(job).values({
        companyId, createdById: userId, number,
        title: `Snow & ice — ${r.siteName || 'site'}`,
        status: 'scheduled',
        scheduledDate: dayDate(opts.date),
        contactId: r.contactId,
        siteId: r.contract.siteId,
        address: r.siteAddress, city: r.siteCity, state: r.siteState, zip: r.siteZip,
        assignedToId: crewId ?? null,
      }).returning()
      const [stop] = await tx.insert(snowStormStop).values({
        companyId, stormId: storm.id, snowContractId: r.contract.id, siteId: r.contract.siteId, jobId: j.id,
        assignedToId: crewId ?? null, sortOrder: order++,
      }).returning()
      made.push({ stopId: stop.id, jobId: j.id, contractId: r.contract.id, siteName: r.siteName })
    }
    return { made, alreadyThere }
  })
}

/** A storm stop with what the crew needs to read: the site, the contract's mode, and the visit logged (if any). */
export async function stormStops(db: any, companyId: string, stormId: string, opts: { assignedToId?: string | null } = {}) {
  const where = [eq(snowStormStop.stormId, stormId), eq(snowStormStop.companyId, companyId)]
  if (opts.assignedToId) where.push(eq(snowStormStop.assignedToId, opts.assignedToId))
  const rows: any[] = await db.select({
    stop: snowStormStop, siteName: site.name, address: site.address, city: site.city,
    billingMode: snowContract.billingMode, triggerDepthInches: snowContract.triggerDepthInches, contractStatus: snowContract.status,
    event: snowEvent,
  }).from(snowStormStop)
    .innerJoin(site, eq(snowStormStop.siteId, site.id))
    .innerJoin(snowContract, eq(snowStormStop.snowContractId, snowContract.id))
    .leftJoin(snowEvent, eq(snowStormStop.eventId, snowEvent.id))
    .where(and(...where))
    .orderBy(asc(snowStormStop.sortOrder), asc(snowStormStop.createdAt))
  return rows.map((r) => ({ ...r.stop, siteName: r.siteName, address: r.address, city: r.city, billingMode: r.billingMode, triggerDepthInches: r.triggerDepthInches, event: r.event ?? null }))
}

/** The crew's Start on a storm stop: the clock an hourly contract is billed by. Stamped once; a second Start changes nothing. */
export async function startStormStop(db: any, companyId: string, stopId: string, now = new Date()) {
  const [stop] = await db.select().from(snowStormStop).where(and(eq(snowStormStop.id, stopId), eq(snowStormStop.companyId, companyId))).limit(1)
  if (!stop) return null
  if (stop.status !== 'open') return { stop, job: null as any, started: false }
  const [upd] = await db.update(snowStormStop).set({ status: 'working', startedAt: now })
    .where(and(eq(snowStormStop.id, stopId), eq(snowStormStop.status, 'open'))).returning()
  let started: any = null
  if (stop.jobId && upd) {
    ;[started] = await db.update(job).set({ status: 'in_progress', startedAt: now, updatedAt: now })
      .where(and(eq(job.id, stop.jobId), eq(job.companyId, companyId), inArray(job.status, ['scheduled', 'pending', 'confirmed', 'dispatched']))).returning()
  }
  return { stop: upd ?? stop, job: started ?? null, started: !!upd }
}

export interface LogFigures {
  pushes?: unknown; snowfallInches?: unknown; saltApplied?: unknown; billBelowTrigger?: unknown; hours?: unknown; notes?: unknown; servicedAt?: unknown
}

/**
 * Log a storm stop's visit: the same event a crew would log on the Snow Billing page — priced by the contract's own rules —
 * tied to this storm, with the stop and its job closed off. Logging a stop that already has its visit returns that visit
 * (`alreadyLogged`) and changes nothing: a request replayed after a dropped connection must never bill a push twice.
 */
export async function logStormStop(
  db: any, companyId: string, userId: string | null, stopId: string, fig: LogFigures, now = new Date(),
): Promise<
  | { error: string; status: 400 | 404 | 409 }
  | { stop: any; event: any; job: any | null; belowTrigger: boolean; alreadyLogged: boolean }
> {
  const [stop] = await db.select().from(snowStormStop).where(and(eq(snowStormStop.id, stopId), eq(snowStormStop.companyId, companyId))).limit(1)
  if (!stop) return { error: 'Storm stop not found', status: 404 }
  if (stop.eventId) {
    const [event] = await db.select().from(snowEvent).where(eq(snowEvent.id, stop.eventId)).limit(1)
    const [was] = await db.select().from(snowContract).where(eq(snowContract.id, stop.snowContractId)).limit(1)
    if (event) return { stop, event, job: null, belowTrigger: !!was && isBelowTrigger(was, event), alreadyLogged: true }
  }
  if (stop.status === 'skipped') return { error: 'This stop was skipped. Put it back on the route before logging it.', status: 409 }
  const [storm] = await db.select().from(snowStorm).where(eq(snowStorm.id, stop.stormId)).limit(1)
  if (storm?.status === 'ended') return { error: 'This storm has ended.', status: 409 }
  const [contract] = await db.select().from(snowContract).where(and(eq(snowContract.id, stop.snowContractId), eq(snowContract.companyId, companyId))).limit(1)
  if (!contract) return { error: 'Contract not found', status: 404 }

  const bad = snowEventInputError(fig)
  if (bad) return { error: bad, status: 400 }
  const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === ''
  let hours = blank(fig.hours) ? 0 : Number(fig.hours)
  // An hourly visit with no typed hours is the clock: from the crew's Start to now, to the hundredth of an hour.
  if (contract.billingMode === 'hourly' && !(hours > 0) && stop.startedAt) {
    hours = Math.min(48, Math.round(((now.getTime() - new Date(stop.startedAt).getTime()) / 3_600_000) * 100) / 100)
  }
  const ev = {
    pushes: blank(fig.pushes) ? 1 : Number(fig.pushes),
    snowfallInches: blank(fig.snowfallInches) ? 0 : Number(fig.snowfallInches),
    saltApplied: !!fig.saltApplied,
    billBelowTrigger: !!fig.billBelowTrigger,
    hours,
  }
  const badCharge = snowEventChargeError(contract.billingMode, ev)
  if (badCharge) return { error: badCharge, status: 400 }
  const billableAmount = computeSnowEventCharge(contract, ev)
  const belowTrigger = isBelowTrigger(contract, ev)

  return db.transaction(async (tx: any) => {
    // Claim the stop first: of two logs racing for it, the second finds it taken and returns the first's visit.
    const [claimed] = await tx.update(snowStormStop).set({ status: 'done', doneAt: now, note: blank(fig.notes) ? stop.note : String(fig.notes) })
      .where(and(eq(snowStormStop.id, stopId), isNull(snowStormStop.eventId), inArray(snowStormStop.status, ['open', 'working']))).returning()
    if (!claimed) {
      const [again] = await tx.select().from(snowStormStop).where(eq(snowStormStop.id, stopId)).limit(1)
      const [event] = again?.eventId ? await tx.select().from(snowEvent).where(eq(snowEvent.id, again.eventId)).limit(1) : []
      return event ? { stop: again, event, job: null, belowTrigger, alreadyLogged: true } : { error: 'This stop is not open.', status: 409 as const }
    }
    const [event] = await tx.insert(snowEvent).values({
      companyId, snowContractId: contract.id, siteId: contract.siteId,
      servicedAt: blank(fig.servicedAt) ? now : new Date(String(fig.servicedAt)),
      pushes: ev.pushes, snowfallInches: String(ev.snowfallInches), saltApplied: ev.saltApplied, billBelowTrigger: ev.billBelowTrigger,
      hours: String(ev.hours), stormId: stop.stormId, billableAmount: String(billableAmount), billingMode: contract.billingMode,
      assignedToId: stop.assignedToId ?? userId, notes: blank(fig.notes) ? null : String(fig.notes),
    }).returning()
    const [done] = await tx.update(snowStormStop).set({ eventId: event.id }).where(eq(snowStormStop.id, stopId)).returning()
    let finished: any = null
    if (stop.jobId) {
      ;[finished] = await tx.update(job).set({
        status: 'completed', completedAt: now, updatedAt: now,
        ...(ev.hours > 0 ? { actualHours: String(Math.min(999, ev.hours)) } : {}),
      }).where(and(eq(job.id, stop.jobId), eq(job.companyId, companyId), inArray(job.status, ['scheduled', 'pending', 'confirmed', 'dispatched', 'in_progress', 'on_hold']))).returning()
    }
    return { stop: done, event, job: finished ?? null, belowTrigger, alreadyLogged: false }
  })
}

/**
 * Log every open stop of a storm with the same figures ("1 push, 3 inches, no salt" for the whole route). A stop that cannot be
 * logged with them (an hourly contract with no clock, say) is reported with the reason and left open; the rest are logged.
 */
export async function logAllStormStops(db: any, companyId: string, userId: string | null, stormId: string, fig: LogFigures, only?: string[]) {
  const stops = (await stormStops(db, companyId, stormId)).filter((s) => (s.status === 'open' || s.status === 'working') && (!only || only.includes(s.id)))
  const logged: Array<{ stopId: string; eventId: string; jobId: string | null; amount: number }> = []
  const failed: Array<{ stopId: string; siteName: string | null; reason: string }> = []
  const jobs: any[] = []
  for (const s of stops) {
    const r = await logStormStop(db, companyId, userId, s.id, fig)
    if ('error' in r) { failed.push({ stopId: s.id, siteName: s.siteName, reason: r.error }); continue }
    logged.push({ stopId: s.id, eventId: r.event.id, jobId: s.jobId ?? null, amount: Number(r.event.billableAmount) })
    if (r.job) jobs.push(r.job)
  }
  return { logged, failed, jobs }
}

/** Skip a stop (no service needed at this site this storm): its job is cancelled while it is still just scheduled. */
export async function skipStormStop(db: any, companyId: string, stopId: string, note?: string | null) {
  const [stop] = await db.select().from(snowStormStop).where(and(eq(snowStormStop.id, stopId), eq(snowStormStop.companyId, companyId))).limit(1)
  if (!stop) return { error: 'Storm stop not found', status: 404 as const }
  if (stop.eventId || stop.status === 'done') return { error: 'This stop already has its visit logged.', status: 409 as const }
  const [upd] = await db.update(snowStormStop).set({ status: 'skipped', note: note ?? stop.note }).where(eq(snowStormStop.id, stopId)).returning()
  if (stop.jobId) await db.update(job).set({ status: 'cancelled', updatedAt: new Date() }).where(and(eq(job.id, stop.jobId), eq(job.companyId, companyId), inArray(job.status, ['scheduled', 'pending', 'confirmed', 'dispatched'])))
  return { stop: upd }
}

/** End the storm: stops still open are skipped (their still-scheduled jobs cancelled) so they leave the crews' lists. */
export async function endStorm(db: any, companyId: string, stormId: string, now = new Date()) {
  const storm = await getStorm(db, companyId, stormId)
  if (!storm) return null
  if (storm.status === 'ended') return { storm, skipped: 0 }
  const open: any[] = await db.select().from(snowStormStop).where(and(eq(snowStormStop.stormId, stormId), inArray(snowStormStop.status, ['open', 'working']), isNull(snowStormStop.eventId)))
  for (const s of open) await skipStormStop(db, companyId, s.id)
  const [upd] = await db.update(snowStorm).set({ status: 'ended', endedAt: now }).where(eq(snowStorm.id, stormId)).returning()
  return { storm: upd, skipped: open.length }
}

export interface StormBillLine {
  contractId: string
  siteName: string | null
  contactId: string | null
  visits: number
  total: number
  /** Why this contract is not billed (or is left out of the run), when it is not. */
  skip?: string
  invoiceId?: string
  invoiceNumber?: string
}

/**
 * Bill the storm: every contract with unbilled, charged visits LOGGED IN THIS STORM gets one draft invoice to its customer — the
 * same invoice the contract's own "bill" makes, but holding only this storm's visits (earlier unbilled ones stay for the
 * contract's own run). `confirm` false only reports what would happen. Each contract bills in its own transaction with its
 * visits locked, so a second run (or two at once) finds nothing left, and one contract with no customer never holds up the rest.
 * Deleting a draft puts its visits back to unbilled (the invoice link is cleared when the invoice goes).
 */
export async function billStorm(db: any, companyId: string, stormId: string, opts: { confirm: boolean; today: Date }): Promise<{ lines: StormBillLine[]; invoices: number; total: number }> {
  const rows: any[] = await db.select({ ev: snowEvent, siteName: site.name, siteContactId: site.contactId, contractContactId: snowContract.contactId })
    .from(snowEvent)
    .innerJoin(snowContract, eq(snowEvent.snowContractId, snowContract.id))
    .innerJoin(site, eq(snowEvent.siteId, site.id))
    .where(and(eq(snowEvent.stormId, stormId), eq(snowEvent.companyId, companyId), isNull(snowEvent.invoiceId)))
    .orderBy(asc(snowEvent.servicedAt))
  const byContract = new Map<string, { siteName: string | null; contactId: string | null; events: any[] }>()
  for (const r of rows) {
    const g = byContract.get(r.ev.snowContractId) ?? { siteName: r.siteName, contactId: r.contractContactId ?? r.siteContactId ?? null, events: [] }
    g.events.push(r.ev)
    byContract.set(r.ev.snowContractId, g)
  }
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const settings = (co?.settings as any) || {}

  const lines: StormBillLine[] = []
  for (const [contractId, g] of byContract) {
    const charged = g.events.filter((e) => Number(e.billableAmount) > 0)
    const line: StormBillLine = { contractId, siteName: g.siteName, contactId: g.contactId, visits: charged.length, total: money(charged.reduce((t, e) => t + Number(e.billableAmount), 0)) }
    if (!charged.length) { line.skip = 'No charge on these visits (covered by the seasonal fee).'; lines.push(line); continue }
    if (!g.contactId) { line.skip = 'No customer to bill — set one on the site first.'; lines.push(line); continue }
    if (opts.confirm) {
      const made = await db.transaction(async (tx: any) => {
        const locked: any[] = await tx.select().from(snowEvent)
          .where(and(eq(snowEvent.snowContractId, contractId), eq(snowEvent.stormId, stormId), eq(snowEvent.companyId, companyId), isNull(snowEvent.invoiceId)))
          .orderBy(asc(snowEvent.servicedAt)).for('update')
        const billable = locked.filter((e) => Number(e.billableAmount) > 0)
        if (!billable.length) return null
        const created = await insertInvoice(tx, { invoice, invoiceLineItem } as any, INVOICE_NUMBERING, {
          companyId, contactId: g.contactId, notes: `Snow & ice service — ${g.siteName || 'site'}`,
          dueDate: dueDateFromTerms(settings, opts.today), issueDate: opts.today, taxRate: defaultTaxRateFrom(settings),
        } as any, billable.map(snowEventLine))
        await tx.update(snowEvent).set({ invoiceId: created.id }).where(inArray(snowEvent.id, billable.map((e: any) => e.id)))
        return { created, count: billable.length }
      })
      if (!made) { line.skip = 'Already billed.'; line.visits = 0; line.total = 0; lines.push(line); continue }
      line.invoiceId = made.created.id; line.invoiceNumber = made.created.number; line.visits = made.count
    }
    lines.push(line)
  }
  const billed = lines.filter((l) => !l.skip)
  return { lines, invoices: opts.confirm ? billed.filter((l) => l.invoiceId).length : billed.length, total: money(billed.reduce((t, l) => t + l.total, 0)) }
}
