// Storm lead generation: storm events from the NOAA feed, and leads from the company's own contacts in the storm's
// zips. Moved from templates/crm-roof/backend/src/services/stormData.ts.
//
// Changes from the template:
//   · a job's address is the CRM's `job.address` (roofing's property_address, decision 2);
//   · the service area: the template read company.settings.serviceAreaZips, which its seed filled with the company's
//     own zip. The unified app's provisioning writes no such setting, so a company that has never set its service area
//     is served by its own zip (serviceAreaZips below) — an explicitly emptied list stays empty;
//   · the feed is reached through `fetch` handed in (tests stub it; nothing here calls out at import);
//   · a storm event that has a drawn path (storm_event.path, set through /api/storm-map) matches the company's customers by
//     where they are — their pin inside the shape — and by zip only for a customer with no pin (customerGeo.ts); an event
//     with no path is matched by zip as before;
//   · runStormCheck(companyId) is the owner's "check NOAA now" (POST /api/storm-map/noaa-check): one company, on demand.
//   · runDailyStormCheck (the template's, with auto-leads) is still NOT scheduled: the template never called it either.
//   · Owner, 2026-10-30: a DAILY check of the same kind as "check NOAA now" — events onto the storm board, no leads — runs at
//     5 am on each company's clock (runScheduledNoaaCheck, started by startNoaaSchedule through the CRM's addJob, so never in
//     tests), but ONLY for a company that has the hidden `storm_customer_map` switch on. That switch is not ready and no plan,
//     owner or Factory save can turn it on, so today it checks nobody. Row 25 (11/06): the feed is now NOAA's SPC daily report
//     files, parsed and tested on REAL recorded files (tests/fixtures/spc-250520-*.csv), so the daily check can be offered —
//     the owner turns the switch on after a live look.
//   · A report the feed gave on an earlier check is not added again (a two-day window means a daily check sees each report
//     twice): same company, source, type, place and size, within the window.
import { and, count, eq, gte, inArray, or } from 'drizzle-orm'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { zip5Of } from '../../../data/zip5.ts'
import { company, contact, job, stormEvent, stormLead } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { customersInArea } from './customerGeo.ts'
import { pathOf, zipSet, type StormPath } from './geo.ts'
import { parseSpc, spcDay, spcUrl, milesBetween, type SpcKind, type SpcReport } from '../../../data/spcReports.ts'
import { businessPoint } from '../../../data/weatherForecast.ts'

// NOAA's storm reports: the Storm Prediction Center's daily CSVs (data/spcReports.ts — free, public, no key). The old Storm Events
// address (www.ncdc.noaa.gov/stormevents/csv) answers an HTML page now (checked 11/06, roofing parity row 25), so it is not used.
/** How far from the business a report may be and still be put on its storm board (miles; a company may set its own). */
export const DEFAULT_STORM_RADIUS_MILES = 30
/** The circle drawn around a report so customers are matched by where they are (miles). */
export const REPORT_CIRCLE_MILES = 3

/** The hour of the company's day (24-hour clock) the scheduled check runs in. */
export const NOAA_CHECK_HOUR = 5
/** The switch the scheduled check requires — hidden (not ready), so no real company has it. */
export const NOAA_SCHEDULE_FEATURE = 'storm_customer_map'
const hourIn = (now: Date, tz: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now))

/**
 * The zips a company's storm work covers: what it set in Settings, or — never having set any — its own zip. The
 * template's seed wrote the company's zip into serviceAreaZips at provisioning; the unified app does not, so this is
 * where that default lives.
 */
export function serviceAreaZips(co: { zip?: string | null; settings?: unknown } | null | undefined): string[] {
  const settings = (co?.settings as any) || {}
  if (Array.isArray(settings.serviceAreaZips)) return settings.serviceAreaZips.map((z: unknown) => String(z ?? '').trim()).filter(Boolean)
  const own = String(co?.zip ?? '').trim()
  return own ? [own] : []
}

/** A storm's zips as five-digit zips (54701-1234 → 54701); anything that is not a zip is dropped. */
export function zip5s(zips: unknown[]): string[] {
  return [...new Set(zips.map((z) => /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(String(z ?? ''))?.[1]).filter((z): z is string => !!z))]
}

export function createStormData(d: CrmDeps, opts: { fetch?: typeof fetch } = {}) {
  const { db, logger } = d
  const fetchFn = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  /**
   * The storm reports near this business over [dateFrom, dateTo], from NOAA's daily report files (hail, wind, tornado), as storm
   * events: each report a small circle around where it was made (REPORT_CIRCLE_MILES), so the storm's customers are the ones there,
   * not the whole service area. "Near" is within the company's storm radius of its own place (its newest pinned job, else its
   * address); with no place known, reports in its own state. A file that does not answer (no reports that day is a 404 too) is
   * skipped; `reached` says whether any answered.
   */
  async function fetchStormEvents(companyId: string, zipCodes: string[], dateFrom: Date, dateTo: Date, onStatus?: (s: { reached: boolean; status: number | null }) => void) {
    void zipCodes
    const events: any[] = []
    const [co] = await db.select({ state: company.state, settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const radius = Number((co?.settings as any)?.stormRadiusMiles) > 0 ? Number((co?.settings as any).stormRadiusMiles) : DEFAULT_STORM_RADIUS_MILES
    const here = await businessPoint(db, companyId).catch(() => null)
    const state = String(co?.state || '').trim().toUpperCase()
    const near = (r: SpcReport) => (here ? milesBetween(here, r) <= radius : !!state && r.state === state)
    let reached = false, lastStatus: number | null = null
    const days: string[] = []
    for (let t = Date.UTC(dateFrom.getUTCFullYear(), dateFrom.getUTCMonth(), dateFrom.getUTCDate()); t <= dateTo.getTime(); t += 86_400_000) days.push(spcDay(new Date(t)))
    for (const day of days) {
      for (const kind of ['hail', 'wind', 'torn'] as SpcKind[]) {
        try {
          const res = await fetchFn(spcUrl(day, kind), { signal: AbortSignal.timeout(15000) }).catch(() => null)
          lastStatus = res ? res.status : lastStatus
          if (!res?.ok) continue
          reached = true
          const at = new Date(Date.UTC(2000 + Number(day.slice(0, 2)), Number(day.slice(2, 4)) - 1, Number(day.slice(4, 6)), 12))
          for (const r of parseSpc(kind, await res.text()).filter(near)) {
            const size = r.kind === 'hail' && r.hailInches ? `${r.hailInches.toFixed(2)} in hail` : r.kind === 'wind' ? (r.windMph ? `${r.windMph} mph wind` : 'damaging wind') : `tornado${r.rating ? ` (${r.rating})` : ''}`
            events.push({
              companyId, eventDate: at, eventType: r.kind,
              hailSizeInches: r.kind === 'hail' && r.hailInches ? String(r.hailInches) : null,
              windSpeedMph: r.kind === 'wind' ? r.windMph : null,
              description: `${size} at ${r.location}, ${r.county} County, ${r.state} (NOAA report ${r.time})`,
              affectedZipCodes: [], path: { kind: 'circle', lat: r.lat, lng: r.lng, radiusMiles: REPORT_CIRCLE_MILES },
              status: 'detected', source: 'noaa',
            })
          }
        } catch (err) {
          logger.warn('NOAA report file not read', { day, kind, error: (err as Error).message })
        }
      }
    }
    onStatus?.({ reached, status: reached ? 200 : lastStatus })
    if (events.length === 0) return []
    // Reports an earlier check already put on this board (created since the window began) are not added a second time.
    const known = await db.select({ eventType: stormEvent.eventType, description: stormEvent.description, hailSizeInches: stormEvent.hailSizeInches, windSpeedMph: stormEvent.windSpeedMph })
      .from(stormEvent).where(and(eq(stormEvent.companyId, companyId), eq(stormEvent.source, 'noaa'), gte(stormEvent.createdAt, dateFrom)))
    const keyOf = (e: any) => [e.eventType, e.description, e.hailSizeInches ?? '', e.windSpeedMph ?? ''].join('|')
    const seen = new Set<string>((known as any[]).map(keyOf))
    const created: any[] = []
    for (const evt of events.filter((e) => { const k = keyOf(e); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 25)) { // at most 25 a check
      const [record] = await db.insert(stormEvent).values(evt).returning()
      created.push(record)
    }
    return created
  }

  /**
   * Real leads only: the company's OWN contacts in the storm's zips (sourcing net-new owners needs a parcel provider,
   * not configured) — every one of them, once per storm, each linked to the contact it is: no second homeowner is made.
   *
   * Live test 2026-10-22 (roofing P4.7): a storm for 54701 made a lead but did not match Casey Customer, a client in
   * 54701. Two rules dropped existing customers: a contact whose address already had a job was skipped — but a storm is
   * new damage, and the business's own past customers are the first people it calls — and the zip was compared as text,
   * so a contact saved as 54701-1234 was never in 54701. Now the five-digit zip decides (zip5s), and a customer with a
   * job is matched and flagged: the lead links their newest job and its note says so.
   */
  async function generateStormLeads(companyId: string, stormEventId: string, zipCodes: string[], opts: { path?: StormPath | null } = {}) {
    const contactsInZips = await contactsInStorm(companyId, zipCodes, opts.path ?? null)

    // The jobs those contacts already have — theirs by the job's contact, or at their address — the lead links the
    // newest, and its note names it.
    const contactIds = (contactsInZips as any[]).map((c) => c.id)
    const zips = zip5s(zipCodes)
    const jobs = contactIds.length
      ? await db.select({ id: job.id, number: job.number, contactId: job.contactId, address: job.address, zip: job.zip, createdAt: job.createdAt }).from(job)
        .where(and(eq(job.companyId, companyId), or(inArray(job.contactId, contactIds), inArray(zip5Of(job.zip), zips))))
      : []
    const at = (address: unknown, zip: unknown) => `${String(address ?? '').trim().toLowerCase()}|${String(zip ?? '').trim().slice(0, 5)}`
    const newestFirst = [...(jobs as any[])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const jobOf = new Map<string, any>()
    for (const ct of contactsInZips as any[]) {
      const theirs = newestFirst.find((j) => j.contactId === ct.id)
        || (ct.address ? newestFirst.find((j) => !j.contactId && at(j.address, j.zip) === at(ct.address, ct.zip)) : undefined)
      if (theirs) jobOf.set(ct.id, theirs)
    }

    const priorLeads = await db.select({ contactId: stormLead.contactId }).from(stormLead)
      .where(and(eq(stormLead.companyId, companyId), eq(stormLead.stormEventId, stormEventId)))
    const alreadyLeaded = new Set(priorLeads.map((l: any) => l.contactId).filter(Boolean))

    const leads: any[] = []
    for (const ct of contactsInZips as any[]) {
      if (alreadyLeaded.has(ct.id)) continue
      const theirJob = jobOf.get(ct.id)
      leads.push({
        companyId, stormEventId, contactId: ct.id, jobId: theirJob?.id ?? null,
        address: ct.address || null, city: ct.city || '', state: ct.state || '', zip: ct.zip,
        status: 'new', estimatedDamage: null,
        notes: theirJob
          ? `Existing customer — ${theirJob.number ? `job ${theirJob.number}` : 'a job'} on file. Check the roof for new storm damage.`
          : ct.address
            ? 'Existing contact in a storm-affected ZIP — confirm damage on inspection.'
            : 'Existing contact in a storm-affected ZIP, with no street address on file — call to confirm damage.',
      })
    }
    for (let i = 0; i < leads.length; i += 100) await db.insert(stormLead).values(leads.slice(i, i + 100))

    // The storm's count is all its leads, not only this run's (a second run after adding a contact said "1 leads").
    const [{ value: total }] = await db.select({ value: count() }).from(stormLead)
      .where(and(eq(stormLead.companyId, companyId), eq(stormLead.stormEventId, stormEventId)))
    await db.update(stormEvent).set({ leadCount: Number(total), status: 'leads_generated' } as any)
      .where(and(eq(stormEvent.id, stormEventId), eq(stormEvent.companyId, companyId)))
    return leads.length
  }

  /**
   * The company's contacts the storm hit. With a drawn path: those whose pin is inside it, plus those with no pin whose zip
   * is one of the storm's. Without one: those whose zip is one of the storm's, by the five-digit zip.
   */
  async function contactsInStorm(companyId: string, zipCodes: string[], path: StormPath | null = null) {
    const zips = zip5s(zipCodes)
    if (path) {
      const found = await customersInArea(db, companyId, { path, zips: zipSet(zips) }, { scope: 'all' })
      return found.customers.map((c) => ({ id: c.contactId, name: c.name, address: c.address, city: c.city, state: c.state, zip: c.zip }))
    }
    if (!zips.length) return []
    return db.select({ id: contact.id, name: contact.name, address: contact.address, city: contact.city, state: contact.state, zip: contact.zip })
      .from(contact).where(and(eq(contact.companyId, companyId), inArray(zip5Of(contact.zip), zips)))
  }

  async function checkExistingCustomers(companyId: string, stormEventId: string) {
    const [event] = await db.select().from(stormEvent).where(and(eq(stormEvent.id, stormEventId), eq(stormEvent.companyId, companyId))).limit(1)
    if (!event) return []
    return contactsInStorm(companyId, (event.affectedZipCodes as string[]) || [], pathOf((event as any).path))
  }

  /** One company's check: the last `days` days from the feed into its storm board, and leads where it auto-generates. */
  async function checkCompany(comp: any, days = 2, auto = true) {
    const settings = (comp.settings as any) || {}
    const zips = serviceAreaZips(comp)
    if (zips.length === 0) return { skipped: 'no_service_area' as const, events: [] as any[], reached: false, status: null as number | null }
    const dateTo = new Date()
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    let feed: { reached: boolean; status: number | null } = { reached: false, status: null }
    const events = await fetchStormEvents(comp.id, zips, dateFrom, dateTo, (s) => { feed = s })
    if (auto && events.length > 0 && settings.stormAutoGenerate) {
      for (const evt of events) await generateStormLeads(comp.id, evt.id, zips)
    }
    return { skipped: null, events, ...feed }
  }

  /** Every company with storm_lead_gen: the last 48 hours from the feed, and leads where it auto-generates. Not scheduled (header). */
  async function runDailyStormCheck() {
    logger.info('Running daily storm check...')
    const companies = await db.select().from(company)
    for (const comp of companies as any[]) {
      const features = (comp.enabledFeatures as string[]) || []
      if (!features.includes('storm_lead_gen') && !features.includes('all')) continue
      try {
        const r = await checkCompany(comp)
        if (r.events.length > 0) logger.info(`Storm check: found ${r.events.length} events for ${comp.name}`)
      } catch (err) {
        logger.error(`Storm check failed for ${comp.name}`, { error: (err as Error).message })
      }
    }
  }

  /**
   * The owner's "check NOAA now": this company only, the last `days` days, events onto its storm board — no leads are made
   * (the owner decides what to do with an event). Runs only when the route asks; nothing calls it on a timer.
   */
  async function runStormCheck(companyId: string, days = 2) {
    const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    if (!comp) return { skipped: 'no_company' as const, events: [] as any[], reached: false, status: null as number | null }
    return checkCompany(comp, days, false)
  }

  /**
   * The scheduled check: every company with the (hidden) storm_customer_map switch on, once a day at NOAA_CHECK_HOUR on its
   * own clock — the same run as "check NOAA now" for that company (events onto the board, no leads). Called by the hourly
   * timer; `now` is a parameter so the hour can be proven without waiting for it. A failure for one company never stops the next.
   */
  async function runScheduledNoaaCheck(now: Date = new Date()) {
    const ran: Array<{ companyId: string; fetched: number; reached: boolean }> = []
    const companies = await db.select().from(company)
    for (const comp of companies as any[]) {
      try {
        if (!(await d.features.isFeatureEnabled(comp.id, NOAA_SCHEDULE_FEATURE))) continue
        if (hourIn(now, companyRowTimeZone(comp)) !== NOAA_CHECK_HOUR) continue
        const r = await runStormCheck(comp.id)
        if (r.skipped) continue
        ran.push({ companyId: comp.id, fetched: r.events.length, reached: r.reached })
        if (!r.reached) logger.warn('Scheduled NOAA check: the feed did not answer', { company: comp.name, status: r.status })
        else if (r.events.length > 0) logger.info(`Scheduled NOAA check: ${r.events.length} new storm reports for ${comp.name}`)
      } catch (err) {
        logger.error(`Scheduled NOAA check failed for ${comp.name}`, { error: (err as Error).message })
      }
    }
    return ran
  }

  /** The hourly timer for runScheduledNoaaCheck. Started once, at boot, through the CRM's addJob (never in tests). */
  function startNoaaSchedule() {
    const timer = setInterval(() => { void runScheduledNoaaCheck() }, 60 * 60_000)
    ;(timer as any).unref?.()
  }

  return { fetchStormEvents, generateStormLeads, checkExistingCustomers, runDailyStormCheck, runStormCheck, runScheduledNoaaCheck, startNoaaSchedule }
}

export type StormData = ReturnType<typeof createStormData>
