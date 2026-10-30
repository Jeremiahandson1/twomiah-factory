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
//   · runDailyStormCheck is NOT scheduled. The template defined it and never called it (no caller anywhere in
//     templates/crm-roof), so no roofer's storm board has ever been filled by it; starting it is a new behaviour that
//     writes storm events from a feed whose CSV shape is not verified, and waits for the owner's yes.
import { and, count, eq, inArray, or } from 'drizzle-orm'
import { zip5Of } from '../../../data/zip5.ts'
import { company, contact, job, stormEvent, stormLead } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { customersInArea } from './customerGeo.ts'
import { pathOf, zipSet, type StormPath } from './geo.ts'

// NOAA Storm Events CSV endpoint (free, public, no API key)
const NOAA_BASE = 'https://www.ncdc.noaa.gov/stormevents/csv'

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

  async function fetchStormEvents(companyId: string, zipCodes: string[], dateFrom: Date, dateTo: Date, onStatus?: (s: { reached: boolean; status: number | null }) => void) {
    const events: any[] = []
    try {
      const url = `${NOAA_BASE}?beginDate_mm=${String(dateFrom.getMonth() + 1).padStart(2, '0')}&beginDate_dd=${String(dateFrom.getDate()).padStart(2, '0')}&beginDate_yyyy=${dateFrom.getFullYear()}&endDate_mm=${String(dateTo.getMonth() + 1).padStart(2, '0')}&endDate_dd=${String(dateTo.getDate()).padStart(2, '0')}&endDate_yyyy=${dateTo.getFullYear()}&eventType=Hail&eventType=Thunderstorm+Wind&eventType=Tornado`
      const res = await fetchFn(url, { signal: AbortSignal.timeout(15000) }).catch(() => null)
      onStatus?.({ reached: !!res?.ok, status: res ? res.status : null })
      if (res?.ok) {
        const text = await res.text()
        const lines = text.split('\n').slice(1) // skip header
        for (const line of lines) {
          if (!line.trim()) continue
          const parts = line.split(',')
          const eventType = (parts[0] || '').toLowerCase()
          const magnitude = parseFloat(parts[1] || '0')
          const location = parts[2] || ''
          let type = 'other'
          if (eventType.includes('hail')) type = 'hail'
          else if (eventType.includes('wind') || eventType.includes('thunderstorm')) type = 'wind'
          else if (eventType.includes('tornado')) type = 'tornado'
          events.push({
            companyId,
            eventDate: dateFrom,
            eventType: type,
            hailSizeInches: type === 'hail' ? String(magnitude || 1.0) : null,
            windSpeedMph: type === 'wind' ? Math.round(magnitude) : null,
            description: `${eventType} event near ${location}`.trim(),
            affectedZipCodes: zipCodes,
            status: 'detected',
            source: 'noaa',
          })
        }
      }
    } catch (err) {
      logger.warn('NOAA fetch failed, using manual entry fallback', { error: (err as Error).message })
    }
    if (events.length === 0) return []
    const created: any[] = []
    for (const evt of events.slice(0, 10)) { // max 10 events per check
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

  return { fetchStormEvents, generateStormLeads, checkExistingCustomers, runDailyStormCheck, runStormCheck }
}

export type StormData = ReturnType<typeof createStormData>
