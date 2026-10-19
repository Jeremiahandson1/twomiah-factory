// Storm lead generation: storm events from the NOAA feed, and leads from the company's own contacts in the storm's
// zips. Moved from templates/crm-roof/backend/src/services/stormData.ts.
//
// Changes from the template:
//   · a job's address is the CRM's `job.address` (roofing's property_address, decision 2);
//   · the service area: the template read company.settings.serviceAreaZips, which its seed filled with the company's
//     own zip. The unified app's provisioning writes no such setting, so a company that has never set its service area
//     is served by its own zip (serviceAreaZips below) — an explicitly emptied list stays empty;
//   · the feed is reached through `fetch` handed in (tests stub it; nothing here calls out at import);
//   · runDailyStormCheck is NOT scheduled. The template defined it and never called it (no caller anywhere in
//     templates/crm-roof), so no roofer's storm board has ever been filled by it; starting it is a new behaviour that
//     writes storm events from a feed whose CSV shape is not verified, and waits for the owner's yes.
import { and, eq, inArray } from 'drizzle-orm'
import { company, contact, job, stormEvent, stormLead } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'

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

export function createStormData(d: CrmDeps, opts: { fetch?: typeof fetch } = {}) {
  const { db, logger } = d
  const fetchFn = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  async function fetchStormEvents(companyId: string, zipCodes: string[], dateFrom: Date, dateTo: Date) {
    const events: any[] = []
    try {
      const url = `${NOAA_BASE}?beginDate_mm=${String(dateFrom.getMonth() + 1).padStart(2, '0')}&beginDate_dd=${String(dateFrom.getDate()).padStart(2, '0')}&beginDate_yyyy=${dateFrom.getFullYear()}&endDate_mm=${String(dateTo.getMonth() + 1).padStart(2, '0')}&endDate_dd=${String(dateTo.getDate()).padStart(2, '0')}&endDate_yyyy=${dateTo.getFullYear()}&eventType=Hail&eventType=Thunderstorm+Wind&eventType=Tornado`
      const res = await fetchFn(url, { signal: AbortSignal.timeout(15000) }).catch(() => null)
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
   * not configured), skipping an address that already has a job and a contact already leaded for this storm.
   */
  async function generateStormLeads(companyId: string, stormEventId: string, zipCodes: string[]) {
    const existingJobs = await db.select({ address: job.address, zip: job.zip }).from(job)
      .where(and(eq(job.companyId, companyId), inArray(job.zip, zipCodes)))
    const existingAddresses = new Set(existingJobs.map((j: any) => `${j.address}|${j.zip}`))

    const contactsInZips = await db.select({ id: contact.id, address: contact.address, city: contact.city, state: contact.state, zip: contact.zip })
      .from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.zip, zipCodes)))

    const priorLeads = await db.select({ contactId: stormLead.contactId }).from(stormLead)
      .where(and(eq(stormLead.companyId, companyId), eq(stormLead.stormEventId, stormEventId)))
    const alreadyLeaded = new Set(priorLeads.map((l: any) => l.contactId).filter(Boolean))

    const leads: any[] = []
    for (const ct of contactsInZips as any[]) {
      if (!ct.address || !ct.zip) continue
      if (alreadyLeaded.has(ct.id)) continue
      if (existingAddresses.has(`${ct.address}|${ct.zip}`)) continue // already has a job
      leads.push({
        companyId, stormEventId, contactId: ct.id, address: ct.address, city: ct.city || '', state: ct.state || '', zip: ct.zip,
        status: 'new', estimatedDamage: null,
        notes: 'Existing contact in a storm-affected ZIP — confirm damage on inspection.',
      })
    }
    for (let i = 0; i < leads.length; i += 100) await db.insert(stormLead).values(leads.slice(i, i + 100))

    await db.update(stormEvent).set({ leadCount: leads.length, status: 'leads_generated' } as any)
      .where(and(eq(stormEvent.id, stormEventId), eq(stormEvent.companyId, companyId)))
    return leads.length
  }

  async function checkExistingCustomers(companyId: string, stormEventId: string) {
    const [event] = await db.select().from(stormEvent).where(and(eq(stormEvent.id, stormEventId), eq(stormEvent.companyId, companyId))).limit(1)
    if (!event) return []
    const zipCodes = (event.affectedZipCodes as string[]) || []
    if (zipCodes.length === 0) return []
    return db.select().from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.zip, zipCodes)))
  }

  /** Every company with storm_lead_gen: the last 48 hours from the feed, and leads where it auto-generates. Not scheduled (header). */
  async function runDailyStormCheck() {
    logger.info('Running daily storm check...')
    const companies = await db.select().from(company)
    for (const comp of companies as any[]) {
      const features = (comp.enabledFeatures as string[]) || []
      if (!features.includes('storm_lead_gen') && !features.includes('all')) continue
      const settings = (comp.settings as any) || {}
      const zips = serviceAreaZips(comp)
      if (zips.length === 0) continue
      const dateTo = new Date()
      const dateFrom = new Date(Date.now() - 48 * 60 * 60 * 1000)
      try {
        const events = await fetchStormEvents(comp.id, zips, dateFrom, dateTo)
        if (events.length > 0 && settings.stormAutoGenerate) {
          for (const evt of events) await generateStormLeads(comp.id, evt.id, zips)
        }
        if (events.length > 0) logger.info(`Storm check: found ${events.length} events for ${comp.name}`)
      } catch (err) {
        logger.error(`Storm check failed for ${comp.name}`, { error: (err as Error).message })
      }
    }
  }

  return { fetchStormEvents, generateStormLeads, checkExistingCustomers, runDailyStormCheck }
}

export type StormData = ReturnType<typeof createStormData>
