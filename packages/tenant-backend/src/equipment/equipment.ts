/**
 * Equipment tracking — ONE implementation for every CRM that offers `equipment_tracking` (crm, crm-fieldservice,
 * crm-landscaping). Vendored into each template as ../shared; the template's routes/equipment.ts wires in db + tables
 * + middleware and sets `options` for the field-service extras.
 *
 * Track assets: HVAC/water heaters/appliances/tools, install + warranty dates, maintenance history, replacement.
 * The contractor `crm` build has a plain equipment table (name/model/serial/warranty/category). The field-service
 * build (fs/lnd) additionally links equipment to a contact, a service site, a location, and to jobs — those are
 * gated behind `options.contacts` / `options.sites` / `options.linkedJobs` so the shared code runs unchanged on a
 * template whose schema doesn't carry those columns/tables.
 */
import { Hono } from 'hono'
import { eq, and, lte, gte, count, asc, desc, ilike, or, sql } from 'drizzle-orm'

export interface EquipmentTables {
  equipment: any
  equipmentCategory: any
  equipmentMaintenance: any
  contact: any
  /** field-service only (options.linkedJobs) */
  job?: any
  user?: any
}
export interface EquipmentOptions {
  /** link equipment to a contact (contactId column). fs / landscaping. */
  contacts?: boolean
  /** service site + location linkage (siteId / locationId columns). fs / landscaping. */
  sites?: boolean
  /** show jobs linked to a piece of equipment (job.equipmentId). fs / landscaping. */
  linkedJobs?: boolean
}
export interface EquipmentServiceDeps { db: any; tables: EquipmentTables; options?: EquipmentOptions }
export interface EquipmentRoutesDeps {
  service: EquipmentService
  authenticate: any
  requirePermission: (permission: string) => any
}

export function createEquipmentService(deps: EquipmentServiceDeps) {
  const { db, tables } = deps
  const { equipment, equipmentCategory, equipmentMaintenance, contact, job, user } = tables
  const opt = { contacts: !!deps.options?.contacts, sites: !!deps.options?.sites, linkedJobs: !!deps.options?.linkedJobs }

  // ---- categories ----
  async function createEquipmentType(companyId: string, data: { name: string }) {
    const [result] = await db.insert(equipmentCategory).values({ companyId, name: data.name }).returning()
    return result
  }
  async function getEquipmentTypes(companyId: string) {
    return db.select().from(equipmentCategory).where(eq(equipmentCategory.companyId, companyId)).orderBy(asc(equipmentCategory.name))
  }

  // ---- equipment ----
  async function createEquipment(companyId: string, data: any) {
    const values: Record<string, any> = {
      companyId,
      name: data.name,
      serialNumber: data.serialNumber || null,
      model: data.model || null,
      manufacturer: data.manufacturer || null,
      location: data.location || null,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
      warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : null,
      notes: data.notes || null,
      categoryId: data.categoryId || null,
      status: 'active',
    }
    if (opt.contacts) values.contactId = data.contactId || null
    if (opt.sites) { values.locationId = data.locationId || null; values.siteId = data.siteId || null }
    const [result] = await db.insert(equipment).values(values).returning()
    return result
  }

  async function getEquipment(companyId: string, {
    status, search, contactId, page = 1, limit = 50,
  }: { status?: string; search?: string; contactId?: string; page?: number; limit?: number } = {}) {
    const conditions = [eq(equipment.companyId, companyId)]
    if (status) conditions.push(eq(equipment.status, status))
    if (opt.contacts && contactId) conditions.push(eq(equipment.contactId, contactId))
    if (search) {
      conditions.push(or(
        ilike(equipment.name, `%${search}%`),
        ilike(equipment.model, `%${search}%`),
        ilike(equipment.serialNumber, `%${search}%`),
      )!)
    }
    const whereClause = and(...conditions)

    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(equipment).where(whereClause).orderBy(desc(equipment.createdAt)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(equipment).where(whereClause),
    ])

    // contact names (fs / landscaping)
    let contactMap: Record<string, any> = {}
    if (opt.contacts) {
      const contactIds = [...new Set((data as any[]).filter((e) => e.contactId).map((e) => e.contactId as string))]
      const contacts = contactIds.length
        ? await db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.companyId, companyId))
        : []
      contactMap = Object.fromEntries((contacts as any[]).map((c) => [c.id, c]))
    }

    const enriched = (data as any[]).map((eq_item) => ({
      ...eq_item,
      warrantyActive: eq_item.warrantyExpiry ? new Date(eq_item.warrantyExpiry) > new Date() : false,
      age: eq_item.purchaseDate
        ? Math.floor((Date.now() - new Date(eq_item.purchaseDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null,
      ...(opt.contacts ? { contact: eq_item.contactId ? contactMap[eq_item.contactId] || null : null } : {}),
    }))

    return { data: enriched, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }
  }

  async function getEquipmentDetails(equipmentId: string, companyId: string) {
    const [result] = await db.select().from(equipment)
      .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId))).limit(1)
    if (!result) return null

    const [maintenanceHistory, categoryResult, contactResult, linkedJobs] = await Promise.all([
      db.select().from(equipmentMaintenance).where(eq(equipmentMaintenance.equipmentId, equipmentId)).orderBy(desc(equipmentMaintenance.performedAt)),
      result.categoryId
        ? db.select().from(equipmentCategory).where(eq(equipmentCategory.id, result.categoryId)).limit(1)
        : Promise.resolve([]),
      opt.contacts && result.contactId
        ? db.select({ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email }).from(contact).where(eq(contact.id, result.contactId)).limit(1)
        : Promise.resolve([]),
      opt.linkedJobs
        ? db.select({
            id: job.id, number: job.number, title: job.title, status: job.status, jobType: job.jobType,
            scheduledDate: job.scheduledDate, completedAt: job.completedAt, assignedToId: job.assignedToId,
          }).from(job).where(and(eq(job.equipmentId, equipmentId), eq(job.companyId, companyId))).orderBy(desc(job.scheduledDate))
        : Promise.resolve([]),
    ])

    let jobsWithTechs: any[] = []
    if (opt.linkedJobs) {
      const techIds = [...new Set((linkedJobs as any[]).filter((j) => j.assignedToId).map((j) => j.assignedToId as string))]
      const techs = techIds.length
        ? await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName }).from(user).where(eq(user.companyId, companyId))
        : []
      const techMap = Object.fromEntries((techs as any[]).map((t) => [t.id, t]))
      jobsWithTechs = (linkedJobs as any[]).map((j) => ({ ...j, assignedTo: j.assignedToId ? techMap[j.assignedToId] || null : null }))
    }

    return {
      ...result,
      category: (categoryResult as any[])[0] || null,
      maintenanceHistory,
      ...(opt.contacts ? { contact: (contactResult as any[])[0] || null } : {}),
      ...(opt.linkedJobs ? { linkedJobs: jobsWithTechs } : {}),
    }
  }

  async function updateEquipment(equipmentId: string, companyId: string, data: Record<string, unknown>) {
    return db.update(equipment).set({ ...data, updatedAt: new Date() })
      .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId))).returning()
  }

  async function markNeedsRepair(equipmentId: string, companyId: string, notes?: string) {
    return db.update(equipment).set({ status: 'needs_repair', notes: notes || null, updatedAt: new Date() })
      .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId))).returning()
  }

  async function markReplaced(equipmentId: string, companyId: string, { notes }: { replacementId?: string; notes?: string }) {
    return db.update(equipment).set({ status: 'replaced', notes: notes || null, updatedAt: new Date() })
      .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId))).returning()
  }

  // ---- service history ----
  async function addServiceRecord(equipmentId: string, _companyId: string, data: { type: string; description?: string; cost?: number; nextDueDate?: string }) {
    const [record] = await db.insert(equipmentMaintenance).values({
      equipmentId,
      type: data.type,
      description: data.description || null,
      cost: data.cost ? String(data.cost) : null,
      performedAt: new Date(),
      nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
    }).returning()
    return record
  }
  async function getServiceHistory(equipmentId: string) {
    return db.select().from(equipmentMaintenance).where(eq(equipmentMaintenance.equipmentId, equipmentId)).orderBy(desc(equipmentMaintenance.performedAt))
  }

  // ---- reports & alerts ----
  async function getMaintenanceDue(companyId: string, { days = 30 }: { days?: number } = {}) {
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + days)
    const result = await db.execute(sql`
      SELECT e.*, em.next_due_date
      FROM equipment e
      JOIN equipment_maintenance em ON em.equipment_id = e.id
      WHERE e.company_id = ${companyId}
        AND e.status = 'active'
        AND em.next_due_date IS NOT NULL
        AND em.next_due_date <= ${dueDate}
      ORDER BY em.next_due_date ASC
    `)
    return (result as any).rows || result
  }

  async function getWarrantyExpiring(companyId: string, { days = 60 }: { days?: number } = {}) {
    const expiryDate = new Date(); expiryDate.setDate(expiryDate.getDate() + days)
    return db.select().from(equipment).where(and(
      eq(equipment.companyId, companyId),
      eq(equipment.status, 'active'),
      gte(equipment.warrantyExpiry, new Date()),
      lte(equipment.warrantyExpiry, expiryDate),
    )).orderBy(asc(equipment.warrantyExpiry))
  }

  async function getAgingEquipment(companyId: string, { minAgeYears = 10 }: { minAgeYears?: number } = {}) {
    const cutoffDate = new Date(); cutoffDate.setFullYear(cutoffDate.getFullYear() - minAgeYears)
    return db.select().from(equipment).where(and(
      eq(equipment.companyId, companyId),
      eq(equipment.status, 'active'),
      lte(equipment.purchaseDate, cutoffDate),
    )).orderBy(asc(equipment.purchaseDate))
  }

  async function getEquipmentStats(companyId: string) {
    const now = new Date()
    const thirtyDays = new Date(now); thirtyDays.setDate(thirtyDays.getDate() + 30)
    const [[{ value: total }], [{ value: needsRepair }], [{ value: warrantyExpiring }]] = await Promise.all([
      db.select({ value: count() }).from(equipment).where(and(eq(equipment.companyId, companyId), eq(equipment.status, 'active'))),
      db.select({ value: count() }).from(equipment).where(and(eq(equipment.companyId, companyId), eq(equipment.status, 'needs_repair'))),
      db.select({ value: count() }).from(equipment).where(and(
        eq(equipment.companyId, companyId),
        eq(equipment.status, 'active'),
        gte(equipment.warrantyExpiry, now),
        lte(equipment.warrantyExpiry, thirtyDays),
      )),
    ])
    return { total, needsRepair, warrantyExpiring }
  }

  async function deleteEquipment(id: string, companyId: string) {
    return db.delete(equipment).where(and(eq(equipment.id, id), eq(equipment.companyId, companyId)))
  }

  return {
    createEquipmentType, getEquipmentTypes,
    createEquipment, getEquipment, getEquipmentDetails, updateEquipment,
    markNeedsRepair, markReplaced,
    addServiceRecord, getServiceHistory,
    getMaintenanceDue, getWarrantyExpiring, getAgingEquipment, getEquipmentStats,
    deleteEquipment,
  }
}

export type EquipmentService = ReturnType<typeof createEquipmentService>

export function createEquipmentRoutes(deps: EquipmentRoutesDeps) {
  const { service, authenticate, requirePermission } = deps
  const app = new Hono()
  app.use('*', authenticate)

  // ---- equipment types ----
  app.get('/types', async (c: any) => {
    const user = c.get('user')
    const types = await service.getEquipmentTypes(user.companyId)
    return c.json(types)
  })
  app.post('/types', requirePermission('equipment:create'), async (c: any) => {
    const user = c.get('user')
    const type = await service.createEquipmentType(user.companyId, await c.req.json())
    return c.json(type, 201)
  })

  // ---- equipment ----
  app.get('/', async (c: any) => {
    const user = c.get('user')
    const { contactId, category, status, needsMaintenance, warrantyExpiring, search, page, limit } = c.req.query()
    const data = await service.getEquipment(user.companyId, {
      contactId, status, search,
      page: parseInt(page) || 1, limit: parseInt(limit) || 50,
    })
    return c.json(data)
  })
  app.get('/stats', async (c: any) => c.json(await service.getEquipmentStats((c.get('user')).companyId)))
  app.get('/maintenance-due', async (c: any) => c.json(await service.getMaintenanceDue((c.get('user')).companyId, { days: parseInt(c.req.query('days')) || 30 })))
  app.get('/warranty-expiring', async (c: any) => c.json(await service.getWarrantyExpiring((c.get('user')).companyId, { days: parseInt(c.req.query('days')) || 60 })))
  app.get('/aging', async (c: any) => c.json(await service.getAgingEquipment((c.get('user')).companyId, { minAgeYears: parseInt(c.req.query('minAge')) || 10 })))

  app.get('/:id', async (c: any) => {
    const item = await service.getEquipmentDetails(c.req.param('id'), (c.get('user')).companyId)
    if (!item) return c.json({ error: 'Equipment not found' }, 404)
    return c.json(item)
  })

  app.post('/', requirePermission('equipment:create'), async (c: any) => {
    const user = c.get('user')
    const item = await service.createEquipment(user.companyId, await c.req.json())
    return c.json(item, 201)
  })

  app.put('/:id', requirePermission('equipment:update'), async (c: any) => {
    const user = c.get('user')
    const id = c.req.param('id')
    await service.updateEquipment(id, user.companyId, await c.req.json())
    return c.json(await service.getEquipmentDetails(id, user.companyId))
  })

  app.post('/:id/needs-repair', requirePermission('equipment:update'), async (c: any) => {
    const user = c.get('user')
    const { notes } = await c.req.json()
    await service.markNeedsRepair(c.req.param('id'), user.companyId, notes)
    return c.json({ success: true })
  })

  app.post('/:id/replaced', requirePermission('equipment:update'), async (c: any) => {
    const user = c.get('user')
    await service.markReplaced(c.req.param('id'), user.companyId, await c.req.json())
    return c.json({ success: true })
  })

  // ---- service history ----
  app.get('/:id/history', async (c: any) => c.json(await service.getServiceHistory(c.req.param('id'))))
  app.post('/:id/history', requirePermission('equipment:update'), async (c: any) => {
    const user = c.get('user')
    const body = await c.req.json()
    const record = await service.addServiceRecord(c.req.param('id'), user.companyId, { ...body, technicianId: body.technicianId || user.userId })
    return c.json(record, 201)
  })

  app.delete('/:id', requirePermission('equipment:delete'), async (c: any) => {
    await service.deleteEquipment(c.req.param('id'), (c.get('user')).companyId)
    return c.json({ success: true })
  })

  return app
}
