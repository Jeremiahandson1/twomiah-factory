// Storm lead generation at /api/storms (storm_lead_gen): the storm board, a storm's leads, converting a lead into a
// homeowner and a roofing job, and the service area. Moved from templates/crm-roof/backend/src/routes/storms.ts. The
// registry signs the person in and applies the gate.
//
// Changes from the template:
//   · lists are { data, pagination }: GET /events (was a bare array);
//   · a converted lead's homeowner has one `name` (decision 3): the name given, trimmed — or "Storm Lead" — where the
//     template split it into first and last and filled a missing last name with "Lead" ("Jane" became "Jane Lead"),
//     because roofing's last_name was required; its lead_source is the CRM's `source`;
//   · a converted lead's job is made as roofing's job module makes one (./roofJob.ts): ROOF-nnnn from the shared
//     nextNumber (the template's text MAX issued ROOF-10000 twice), `title` and `address` the property address, the
//     converter as its creator — the contact, the job and the lead's link written together, and a lead converted twice
//     at once converts once;
//   · the service area of a company that never set one is its own zip (stormData.ts serviceAreaZips);
//   · an unreadable body or event date is a 400, not a 500.
import { Hono } from 'hono'
import { and, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { company, contact, stormEvent, stormLead } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, list, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { createStormData, serviceAreaZips, type StormData } from './stormData.ts'
import { homeownerName, insertHomeowner, insertRoofJob } from './roofJob.ts'
import { pathOf } from './geo.ts'

const body = async (c: any): Promise<any> => (await c.req.json().catch(() => null)) ?? {}

export function createStormRoutes(d: CrmDeps, storms: StormData = createStormData(d)) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  /**
   * GET /events — the storm board. DISMISSED events are not on it. (T58) Dismissing is how a storm is put away (there
   * is no delete: it is a record of weather), so the board leaves them off unless asked: `?status=dismissed` returns
   * them and `?includeDismissed=true` returns the lot.
   */
  app.get('/events', async (c) => {
    const { companyId } = c.get('user')
    const status = c.req.query('status')
    const includeDismissed = /^(1|true|yes)$/i.test(String(c.req.query('includeDismissed') || ''))
    const conditions: any[] = [eq(stormEvent.companyId, companyId)]
    if (status) conditions.push(eq(stormEvent.status, status))
    else if (!includeDismissed) conditions.push(ne(stormEvent.status, 'dismissed'))
    const events = await db.select().from(stormEvent).where(and(...conditions)).orderBy(desc(stormEvent.eventDate), desc(stormEvent.id))
    return listAll(c, events)
  })

  // POST /events — a storm entered by hand. An event with no affected zips cannot do its job (generate-leads matches
  // customer addresses against them), so it is refused, as the screen already refuses it. (T42)
  app.post('/events', requirePermission('storms:create'), async (c) => {
    const { companyId } = c.get('user')
    const b = await body(c)
    const zips = Array.isArray(b.affectedZipCodes) ? b.affectedZipCodes.filter((z: unknown) => String(z ?? '').trim()) : []
    if (zips.length === 0) return fail(c, 400, 'At least one affected zip code is required')
    const eventDate = b.eventDate ? new Date(b.eventDate) : new Date()
    if (Number.isNaN(eventDate.getTime())) return fail(c, 400, 'eventDate: Enter a valid date.')
    const [event] = await db.insert(stormEvent).values({
      companyId,
      eventDate,
      eventType: b.eventType || 'hail',
      affectedZipCodes: zips,
      hailSizeInches: b.hailSizeInches ? String(b.hailSizeInches) : null,
      windSpeedMph: b.windSpeedMph || null,
      description: b.description || null,
      status: 'detected',
      source: 'manual',
    } as any).returning()
    return one(c, event, 201)
  })

  // GET /events/:id — the event, its leads counted by status, and the twenty newest.
  app.get('/events/:id', async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const [event] = await db.select().from(stormEvent).where(and(eq(stormEvent.id, id), eq(stormEvent.companyId, companyId))).limit(1)
    if (!event) return fail(c, 404, 'Event not found')
    const mine = and(eq(stormLead.stormEventId, id), eq(stormLead.companyId, companyId))
    const [leadStats, sampleLeads] = await Promise.all([
      db.select({ status: stormLead.status, count: count() }).from(stormLead).where(mine).groupBy(stormLead.status),
      db.select().from(stormLead).where(mine).orderBy(desc(stormLead.createdAt), desc(stormLead.id)).limit(20),
    ])
    return one(c, { ...event, leadStats, sampleLeads })
  })

  // POST /events/:id/generate-leads — the company's own contacts in the storm's zips become its leads.
  app.post('/events/:id/generate-leads', requirePermission('storms:create'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const [event] = await db.select().from(stormEvent).where(and(eq(stormEvent.id, id), eq(stormEvent.companyId, companyId))).limit(1)
    if (!event) return fail(c, 404, 'Event not found')
    const zipCodes = (event.affectedZipCodes as string[]) || []
    if (zipCodes.length === 0) return fail(c, 400, 'No zip codes specified')
    const leadCount = await storms.generateStormLeads(companyId, id, zipCodes, { path: pathOf((event as any).path) })
    const existingCustomers = await storms.checkExistingCustomers(companyId, id)
    return one(c, { leadCount, existingCustomersFound: existingCustomers.length })
  })

  // POST /events/:id/dismiss — off the board (T58).
  app.post('/events/:id/dismiss', requirePermission('storms:create'), async (c) => {
    const { companyId } = c.get('user')
    const [updated] = await db.update(stormEvent).set({ status: 'dismissed' } as any)
      .where(and(eq(stormEvent.id, c.req.param('id')), eq(stormEvent.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Event not found')
    return one(c, updated)
  })

  // GET /events/:id/leads — a page of the storm's leads, each marked when it is already a customer's address.
  app.get('/events/:id/leads', async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
    const limit = Math.max(parseInt(c.req.query('limit') || '50') || 50, 1)
    const status = c.req.query('status')
    const conditions: any[] = [eq(stormLead.stormEventId, id), eq(stormLead.companyId, companyId)]
    if (status) conditions.push(eq(stormLead.status, status))
    const where = and(...conditions)
    const [leads, [{ value: total }]] = await Promise.all([
      db.select().from(stormLead).where(where).orderBy(desc(stormLead.createdAt), desc(stormLead.id)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(stormLead).where(where),
    ])
    const existingContacts = await db.select({ address: contact.address, zip: contact.zip }).from(contact).where(eq(contact.companyId, companyId))
    const existingSet = new Set(existingContacts.map((r: any) => `${r.address}|${r.zip}`))
    // An existing customer: a lead matched from one of the company's contacts, or at an address one of them has.
    const data = leads.map((l: any) => ({ ...l, isExistingCustomer: !!l.contactId || existingSet.has(`${l.address}|${l.zip}`) }))
    return list(c, data, { page, limit, total: Number(total) })
  })

  // PUT /leads/:id — a lead's status, notes or estimated damage. Sending none of them is the caller's 400, not an
  // empty SET clause's 500. (T42)
  app.put('/leads/:id', requirePermission('storms:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = await body(c)
    const updates: any = {}
    if (b.status !== undefined) updates.status = b.status
    if (b.notes !== undefined) updates.notes = b.notes
    if (b.estimatedDamage !== undefined) updates.estimatedDamage = b.estimatedDamage
    if (Object.keys(updates).length === 0) return fail(c, 400, 'Nothing to update — send status, notes or estimatedDamage')
    const [updated] = await db.update(stormLead).set(updates)
      .where(and(eq(stormLead.id, c.req.param('id')), eq(stormLead.companyId, companyId))).returning()
    if (!updated) return fail(c, 404, 'Lead not found')
    return one(c, updated)
  })

  // The job's note, as the template wrote it: one lead converted names the hail size; a bulk conversion does not.
  const stormNote = (event: any, withHail: boolean) => !event ? 'Storm lead'
    : withHail ? `Storm lead — ${event.eventType} ${event.hailSizeInches ? event.hailSizeInches + '" hail' : ''} on ${new Date(event.eventDate).toLocaleDateString()}`
    : `Storm lead — ${event.eventType} on ${new Date(event.eventDate).toLocaleDateString()}`

  /**
   * One lead → a homeowner and a roofing job at `lead`, in one transaction. The lead's link is written only while it
   * has none, so a lead converted twice at once converts once: the second gets null and makes nothing.
   */
  async function convert(companyId: string, userId: string, lead: any, who: { name: string; phone?: string | null; email?: string | null }, note: string) {
    return db.transaction(async (tx: any) => {
      const [claimed] = await tx.update(stormLead).set({ status: 'converted' } as any)
        .where(and(eq(stormLead.id, lead.id), eq(stormLead.companyId, companyId), isNull(stormLead.jobId))).returning({ id: stormLead.id })
      if (!claimed) return null
      // A lead matched from one of the company's own contacts is that contact's: the job is theirs, and no second
      // homeowner is made (live test 2026-10-22: storm leads now include existing customers, stormData.ts).
      const newContact = lead.contactId ? { id: lead.contactId as string } : await insertHomeowner(tx, companyId, {
        name: who.name, phone: who.phone, email: who.email, address: lead.address, city: lead.city, state: lead.state, zip: lead.zip, source: 'storm',
      })
      const newJob = await insertRoofJob(tx, companyId, userId, {
        contactId: newContact.id, jobType: 'insurance', address: lead.address || '', city: lead.city || '', state: lead.state || '', zip: lead.zip || '',
        source: 'storm', priority: 'high', notes: note,
      })
      await tx.update(stormLead).set({ jobId: newJob.id, contactId: newContact.id } as any)
        .where(and(eq(stormLead.id, lead.id), eq(stormLead.companyId, companyId)))
      return { jobId: newJob.id as string, contactId: newContact.id as string }
    })
  }
  const eventOf = async (companyId: string, lead: any) => lead.stormEventId
    ? (await db.select().from(stormEvent).where(and(eq(stormEvent.id, lead.stormEventId), eq(stormEvent.companyId, companyId))).limit(1))[0] || null
    : null

  // POST /leads/:id/convert — a storm lead becomes a homeowner and a roofing job.
  app.post('/leads/:id/convert', requirePermission('storms:create'), async (c) => {
    const { companyId, userId } = c.get('user')
    const b = await body(c)
    const [lead] = await db.select().from(stormLead).where(and(eq(stormLead.id, c.req.param('id')), eq(stormLead.companyId, companyId))).limit(1)
    if (!lead) return fail(c, 404, 'Lead not found')
    if (lead.jobId) return fail(c, 400, 'Lead already converted')
    const event = await eventOf(companyId, lead)
    const made = await convert(companyId, userId, lead, { name: homeownerName(b.name, 'Storm Lead'), phone: b.phone, email: b.email }, stormNote(event, true))
    if (!made) return fail(c, 400, 'Lead already converted')
    return one(c, made)
  })

  // POST /leads/bulk-convert — up to 50 at a time, each a "Storm Lead" homeowner; a lead that fails is skipped.
  app.post('/leads/bulk-convert', requirePermission('storms:create'), async (c) => {
    const { companyId, userId } = c.get('user')
    const { leadIds } = await body(c)
    if (!Array.isArray(leadIds) || leadIds.length === 0) return fail(c, 400, 'No leads specified')
    let converted = 0
    for (const leadId of leadIds.slice(0, 50)) {
      try {
        const [lead] = await db.select().from(stormLead).where(and(eq(stormLead.id, String(leadId)), eq(stormLead.companyId, companyId))).limit(1)
        if (!lead || lead.jobId) continue
        const event = await eventOf(companyId, lead)
        if (await convert(companyId, userId, lead, { name: 'Storm Lead' }, stormNote(event, false))) converted++
      } catch { /* one lead that can't convert never stops the rest */ }
    }
    return one(c, { converted })
  })

  // POST /leads/bulk-dismiss
  app.post('/leads/bulk-dismiss', requirePermission('storms:create'), async (c) => {
    const { companyId } = c.get('user')
    const { leadIds } = await body(c)
    if (!Array.isArray(leadIds)) return fail(c, 400, 'No leads specified')
    const ids = leadIds.map(String)
    const dismissed = ids.length
      ? (await db.update(stormLead).set({ status: 'dismissed' } as any)
        .where(and(eq(stormLead.companyId, companyId), inArray(stormLead.id, ids))).returning({ id: stormLead.id })).length
      : 0
    return one(c, { dismissed })
  })

  // GET /service-area — the zips storm work covers (the company's own when it never set any) and the storm switches.
  app.get('/service-area', async (c) => {
    const { companyId } = c.get('user')
    const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    const settings = (comp?.settings as any) || {}
    return one(c, {
      zipCodes: serviceAreaZips(comp),
      stormAlertEnabled: settings.stormAlertEnabled || false,
      minHailSize: settings.stormMinHailSize || 1.0,
      maxLeadsPerZip: settings.stormMaxLeadsPerZip || 200,
      autoGenerate: settings.stormAutoGenerate || false,
    })
  })

  // PUT /service-area
  app.put('/service-area', requirePermission('storms:update'), async (c) => {
    const { companyId } = c.get('user')
    const b = await body(c)
    const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
    if (!comp) return fail(c, 404, 'Company not found')
    const settings = { ...((comp.settings as any) || {}) }
    if (b.zipCodes !== undefined) settings.serviceAreaZips = b.zipCodes
    if (b.stormAlertEnabled !== undefined) settings.stormAlertEnabled = b.stormAlertEnabled
    if (b.minHailSize !== undefined) settings.stormMinHailSize = b.minHailSize
    if (b.maxLeadsPerZip !== undefined) settings.stormMaxLeadsPerZip = b.maxLeadsPerZip
    if (b.autoGenerate !== undefined) settings.stormAutoGenerate = b.autoGenerate
    await db.update(company).set({ settings, updatedAt: new Date() } as any).where(eq(company.id, companyId))
    return done(c)
  })

  return app
}
