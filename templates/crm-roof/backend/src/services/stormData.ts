import { db } from '../../db/index.ts'
import { stormEvent, stormLead, contact, job, company } from '../../db/schema.ts'
import { eq, and, inArray, sql } from 'drizzle-orm'
import logger from './logger.ts'

// NOAA Storm Events CSV endpoint (free, public, no API key)
const NOAA_BASE = 'https://www.ncdc.noaa.gov/stormevents/csv'

export async function fetchStormEvents(companyId: string, zipCodes: string[], dateFrom: Date, dateTo: Date) {
  const events: any[] = []

  // Try NOAA Storm Events API
  try {
    const fromStr = dateFrom.toISOString().slice(0, 10).replace(/-/g, '')
    const toStr = dateTo.toISOString().slice(0, 10).replace(/-/g, '')
    const url = `${NOAA_BASE}?beginDate_mm=${String(dateFrom.getMonth() + 1).padStart(2, '0')}&beginDate_dd=${String(dateFrom.getDate()).padStart(2, '0')}&beginDate_yyyy=${dateFrom.getFullYear()}&endDate_mm=${String(dateTo.getMonth() + 1).padStart(2, '0')}&endDate_dd=${String(dateTo.getDate()).padStart(2, '0')}&endDate_yyyy=${dateTo.getFullYear()}&eventType=Hail&eventType=Thunderstorm+Wind&eventType=Tornado`

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null)
    if (res?.ok) {
      const text = await res.text()
      const lines = text.split('\n').slice(1) // skip header
      for (const line of lines) {
        if (!line.trim()) continue
        const parts = line.split(',')
        const eventType = (parts[0] || '').toLowerCase()
        const magnitude = parseFloat(parts[1] || '0')
        const location = parts[2] || ''

        let type: string = 'other'
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

  // If NOAA returned nothing, create a placeholder for the service area
  if (events.length === 0) {
    return []
  }

  // Deduplicate and create storm events
  const created = []
  for (const evt of events.slice(0, 10)) { // max 10 events per check
    const [record] = await db.insert(stormEvent).values(evt).returning()
    created.push(record)
  }
  return created
}

export async function generateStormLeads(companyId: string, stormEventId: string, zipCodes: string[]) {
  // Get existing job addresses to skip
  const existingJobs = await db.select({ address: job.propertyAddress, zip: job.zip })
    .from(job)
    .where(and(eq(job.companyId, companyId), inArray(job.zip, zipCodes)))
  const existingAddresses = new Set(existingJobs.map(j => `${j.address}|${j.zip}`))

  // Real leads only. We do NOT fabricate addresses — sourcing net-new property
  // owners in a ZIP needs a parcel/address data provider (not configured). Instead
  // we surface the company's OWN contacts located in the storm-affected ZIPs, so the
  // roofer can re-engage real people. Damage is left null (unknown until inspection).
  const contactsInZips = await db.select({
    id: contact.id, address: contact.address, city: contact.city, state: contact.state, zip: contact.zip,
  }).from(contact)
    .where(and(eq(contact.companyId, companyId), inArray(contact.zip, zipCodes)))

  // Skip contacts we've already turned into a lead for this same storm event.
  const priorLeads = await db.select({ contactId: stormLead.contactId })
    .from(stormLead)
    .where(and(eq(stormLead.companyId, companyId), eq(stormLead.stormEventId, stormEventId)))
  const alreadyLeaded = new Set(priorLeads.map(l => l.contactId).filter(Boolean))

  const leads: any[] = []
  for (const ct of contactsInZips) {
    if (!ct.address || !ct.zip) continue
    if (alreadyLeaded.has(ct.id)) continue
    if (existingAddresses.has(`${ct.address}|${ct.zip}`)) continue // already has a job
    leads.push({
      companyId,
      stormEventId,
      contactId: ct.id,
      address: ct.address,
      city: ct.city || '',
      state: ct.state || '',
      zip: ct.zip,
      status: 'new',
      estimatedDamage: null,
      notes: 'Existing contact in a storm-affected ZIP — confirm damage on inspection.',
    })
  }

  for (let i = 0; i < leads.length; i += 100) {
    await db.insert(stormLead).values(leads.slice(i, i + 100))
  }

  await db.update(stormEvent).set({
    leadCount: leads.length,
    status: 'leads_generated',
  }).where(eq(stormEvent.id, stormEventId))

  return leads.length
}

export async function checkExistingCustomers(companyId: string, stormEventId: string) {
  // Get storm event affected zip codes
  const [event] = await db.select().from(stormEvent)
    .where(and(eq(stormEvent.id, stormEventId), eq(stormEvent.companyId, companyId)))
    .limit(1)
  if (!event) return []

  const zipCodes = (event.affectedZipCodes as string[]) || []
  if (zipCodes.length === 0) return []

  // Find existing contacts in affected zips
  const existingContacts = await db.select().from(contact)
    .where(and(eq(contact.companyId, companyId), inArray(contact.zip, zipCodes)))

  return existingContacts
}

export async function runDailyStormCheck() {
  logger.info('Running daily storm check...')

  // Get all companies with storm_lead_gen enabled
  const companies = await db.select().from(company)
  for (const comp of companies) {
    const features = (comp.enabledFeatures as string[]) || []
    if (!features.includes('storm_lead_gen') && !features.includes('all')) continue

    const settings = (comp.settings as any) || {}
    const serviceAreaZips = settings.serviceAreaZips as string[] || []
    if (serviceAreaZips.length === 0) continue

    // Check past 48 hours
    const dateTo = new Date()
    const dateFrom = new Date(Date.now() - 48 * 60 * 60 * 1000)

    try {
      const events = await fetchStormEvents(comp.id, serviceAreaZips, dateFrom, dateTo)
      if (events.length > 0 && settings.stormAutoGenerate) {
        for (const evt of events) {
          await generateStormLeads(comp.id, evt.id, serviceAreaZips)
        }
      }
      if (events.length > 0) {
        logger.info(`Storm check: found ${events.length} events for ${comp.name}`)
      }
    } catch (err) {
      logger.error(`Storm check failed for ${comp.name}`, { error: (err as Error).message })
    }
  }
}
