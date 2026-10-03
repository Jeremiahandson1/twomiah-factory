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
import { eq, and, ne, lte, gte, count, countDistinct, asc, desc, ilike, or, sql } from 'drizzle-orm'

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

/**
 * How near is "expiring"? ONE answer. (T32 H9)
 *
 * getEquipmentStats counted a 30-day window and getWarrantyExpiring listed a 60-day one, so the
 * tile and the list it opened disagreed by construction — the same fault as the two labour rates in
 * job costing (T32 B3). 60 days is the one kept: it is what the dedicated endpoint and the screen's
 * filter already used, and it is long enough to be worth acting on.
 */
export const WARRANTY_WINDOW_DAYS = 60

/**
 * The one status that means the machine is GONE. 'active' and 'needs_repair' are both still in the
 * yard; `markReplaced` sets this one.
 *
 * Every report below used to filter `status = 'active'`, which quietly made a machine disappear the
 * moment somebody marked it broken: it dropped off Maintenance Due, off Warranty Expiring, off the
 * aging list, and out of the "Total Equipment" count — while the Needs Repair tile counted it
 * separately, so a yard of 12 with 2 broken read "Total Equipment 10, Needs Repair 2". A broken
 * machine is the one you most need on the maintenance list and the one whose warranty matters most.
 * (T41, landscaping + field service — one shared module, so one fix.)
 *
 * Written as "not replaced" rather than "active or needs_repair" so a status added later counts as
 * owned by default. Losing a machine from a report is the expensive direction.
 */
const RETIRED = 'replaced'

export function createEquipmentService(deps: EquipmentServiceDeps) {
  const { db, tables } = deps
  const { equipment, equipmentCategory, equipmentMaintenance, contact, job, user } = tables
  /** Still in the yard: anything not marked replaced. See RETIRED above for why. */
  const stillOwned = () => ne(equipment.status, RETIRED)
  const opt = { contacts: !!deps.options?.contacts, sites: !!deps.options?.sites, linkedJobs: !!deps.options?.linkedJobs }

  // ---- categories ----
  /**
   * A CATEGORY THE SCREEN CAN NOW ACTUALLY CREATE. (T41)
   *
   * This endpoint had no caller until the Equipment page started building its Category control from
   * the company's own rows, so nothing had ever tested what it accepts: `{}` inserted a row whose
   * name was `undefined`, `{ name: '  ' }` inserted a blank one, and adding "Mowers" twice gave the
   * company two identical categories with different ids — which then split its equipment across
   * both in the filter. All three are now refused, and asking again for a name they already have
   * hands back the row they already have rather than a duplicate.
   */
  async function createEquipmentType(companyId: string, data: { name?: unknown }) {
    const name = String(data?.name ?? '').trim()
    if (!name) throw Object.assign(new Error('A category name is required'), { status: 400 })
    if (name.length > 80) throw Object.assign(new Error('A category name is at most 80 characters'), { status: 400 })
    const existing = await db.select().from(equipmentCategory)
      .where(and(eq(equipmentCategory.companyId, companyId), sql`lower(${equipmentCategory.name}) = lower(${name})`))
      .limit(1)
    if (existing[0]) return existing[0]
    const [result] = await db.insert(equipmentCategory).values({ companyId, name }).returning()
    return result
  }
  async function getEquipmentTypes(companyId: string) {
    return db.select().from(equipmentCategory).where(eq(equipmentCategory.companyId, companyId)).orderBy(asc(equipmentCategory.name))
  }

  // ---- equipment ----
  /**
   * THE SCREEN AND THE SERVICE SPOKE DIFFERENT LANGUAGES. (T32 H9)
   *
   * The Equipment form asks for an "Install date" and a "Warranty (months)" — which is the right way
   * to ask about a customer's furnace — and posts `installDate` and `warrantyMonths`. This service
   * read `purchaseDate` and `warrantyExpiry`. Nothing matched, nothing threw, and the record saved
   * with its name and nothing else: the report entered 20 Oct 2024 and 24 months and got
   * purchaseDate null, warrantyExpiry null.
   *
   * Four templates ship this module. All four dropped both fields.
   *
   * The translation lives HERE, in one function, rather than in the form, because the column names
   * (`purchase_date`, `warranty_expiry`) are what the filters and the stats tiles query, and the
   * form's words are what a person should see. Both directions: `shape()` below gives every read
   * back `installDate` and `warrantyMonths`, so the edit form round-trips instead of showing blanks
   * over stored values.
   */
  const asDate = (v: any): Date | null => {
    if (!v) return null
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const monthsLater = (from: Date, months: number) => {
    const d = new Date(from)
    const day = d.getUTCDate()
    d.setUTCDate(1)
    d.setUTCMonth(d.getUTCMonth() + months)
    // Clamp, so 24 months from 31 Jan is the 28th/29th and not 2 March. Same rule as the recurring
    // invoice schedule (T32 H7).
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    d.setUTCDate(Math.min(day, last))
    return d
  }
  /** The form's vocabulary and the column's, resolved to the columns. */
  const equipmentDates = (data: any, current?: { purchaseDate?: any; warrantyExpiry?: any }) => {
    const purchaseDate = data.purchaseDate !== undefined || data.installDate !== undefined
      ? asDate(data.purchaseDate ?? data.installDate)
      : (current ? asDate(current.purchaseDate) : null)

    let warrantyExpiry = data.warrantyExpiry !== undefined
      ? asDate(data.warrantyExpiry)
      : (current ? asDate(current.warrantyExpiry) : null)

    // Months are relative to the install date, so they can only be resolved once that is known.
    const months = Number(data.warrantyMonths)
    if (data.warrantyMonths !== undefined && data.warrantyMonths !== '' && Number.isFinite(months) && months > 0 && purchaseDate) {
      warrantyExpiry = monthsLater(purchaseDate, Math.round(months))
    }
    return { purchaseDate, warrantyExpiry }
  }
  /** What a read gives back: the columns, plus the words the form asks in. */
  const shape = (row: any) => {
    if (!row) return row
    const purchase = row.purchaseDate ? new Date(row.purchaseDate) : null
    const expiry = row.warrantyExpiry ? new Date(row.warrantyExpiry) : null
    let warrantyMonths: number | null = null
    if (purchase && expiry) {
      warrantyMonths = Math.max(0, Math.round(
        (expiry.getUTCFullYear() - purchase.getUTCFullYear()) * 12 + (expiry.getUTCMonth() - purchase.getUTCMonth()),
      ))
    }
    return {
      ...row,
      installDate: purchase ? purchase.toISOString() : null,
      warrantyMonths,
      warrantyActive: expiry ? expiry > new Date() : false,
    }
  }

  async function createEquipment(companyId: string, data: any) {
    const { purchaseDate, warrantyExpiry } = equipmentDates(data)
    const values: Record<string, any> = {
      companyId,
      name: data.name,
      serialNumber: data.serialNumber || null,
      model: data.model || null,
      manufacturer: data.manufacturer || null,
      location: data.location || null,
      purchaseDate,
      warrantyExpiry,
      notes: data.notes || null,
      categoryId: data.categoryId || null,
      status: 'active',
    }
    if (opt.contacts) values.contactId = data.contactId || null
    if (opt.sites) { values.locationId = data.locationId || null; values.siteId = data.siteId || null }
    const [result] = await db.insert(equipment).values(values).returning()
    return shape(result)
  }

  /**
   * THE FILTERS THE ROUTE WAS SENDING AND THIS FUNCTION NEVER TOOK. (T32 H9)
   *
   * `GET /api/equipment` destructured `warrantyExpiring`, `needsMaintenance` and `category` out of
   * the query string and then called this function with status / search / contactId only. So
   * `?warrantyExpiring=true` returned the WHOLE list — the report saw it return a record with no
   * warranty date at all, while the "Warranty Expiring" tile beside it said 0. The tile was right;
   * the filter was a no-op that looked like a filter.
   *
   * Worse, the tile and the dedicated /warranty-expiring endpoint used two different windows for the
   * same word: 30 days in getEquipmentStats and 60 in getWarrantyExpiring. One constant now, so the
   * tile, the filter and the endpoint cannot disagree.
   */
  async function getEquipment(companyId: string, {
    status, search, contactId, categoryId, needsMaintenance, warrantyExpiring, page = 1, limit = 50,
  }: {
    status?: string; search?: string; contactId?: string; categoryId?: string
    needsMaintenance?: boolean; warrantyExpiring?: boolean; page?: number; limit?: number
  } = {}) {
    const conditions = [eq(equipment.companyId, companyId)]
    if (status) conditions.push(eq(equipment.status, status))
    if (opt.contacts && contactId) conditions.push(eq(equipment.contactId, contactId))
    if (categoryId) conditions.push(eq(equipment.categoryId, categoryId))
    if (warrantyExpiring) {
      const until = new Date(); until.setDate(until.getDate() + WARRANTY_WINDOW_DAYS)
      conditions.push(gte(equipment.warrantyExpiry, new Date()))
      conditions.push(lte(equipment.warrantyExpiry, until))
    }
    if (needsMaintenance) {
      // Maintenance due = the next due date on its service history has passed. A piece of equipment
      // with no history has nothing due, which is why this is an EXISTS and not a left join.
      conditions.push(sql`EXISTS (
        SELECT 1 FROM ${equipmentMaintenance}
        WHERE ${equipmentMaintenance.equipmentId} = ${equipment.id}
          AND ${equipmentMaintenance.nextDueDate} IS NOT NULL
          AND ${equipmentMaintenance.nextDueDate} <= NOW()
      )` as any)
    }
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

    /**
     * THE CATEGORY NAME TRAVELS WITH THE ROW. (T41)
     *
     * The list returned `categoryId` and nothing else, while the Equipment page's Category column
     * read `row.category` — a key no list has ever carried — so that column was blank in every row
     * of every tenant, and the page had no way to show the filter's own vocabulary. The detail read
     * already returns `category` as the row, so the list now matches it rather than inventing a
     * second shape.
     */
    let categoryMap: Record<string, any> = {}
    if ((data as any[]).some((e) => e.categoryId)) {
      const cats = await db.select({ id: equipmentCategory.id, name: equipmentCategory.name })
        .from(equipmentCategory).where(eq(equipmentCategory.companyId, companyId))
      categoryMap = Object.fromEntries((cats as any[]).map((r) => [r.id, r]))
    }

    const enriched = (data as any[]).map((eq_item) => ({
      // `shape` adds installDate / warrantyMonths / warrantyActive — the words the form asks in, so
      // opening Edit shows the stored values instead of blanks over them.
      ...shape(eq_item),
      age: eq_item.purchaseDate
        ? Math.floor((Date.now() - new Date(eq_item.purchaseDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null,
      category: eq_item.categoryId ? categoryMap[eq_item.categoryId] || null : null,
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
      ...shape(result),
      category: (categoryResult as any[])[0] || null,
      maintenanceHistory,
      ...(opt.contacts ? { contact: (contactResult as any[])[0] || null } : {}),
      ...(opt.linkedJobs ? { linkedJobs: jobsWithTechs } : {}),
    }
  }

  /**
   * The same translation as createEquipment, for the same reason — and this one is worse, because it
   * spread the raw request body straight onto the row. `installDate` and `warrantyMonths` are not
   * columns, so an edit either dropped them (silently) or, on a Postgres that rejects unknown keys,
   * would have thrown. Either way the dates never changed.
   */
  async function updateEquipment(equipmentId: string, companyId: string, data: Record<string, unknown>) {
    const [current] = await db.select({ purchaseDate: equipment.purchaseDate, warrantyExpiry: equipment.warrantyExpiry })
      .from(equipment).where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId))).limit(1)
    if (!current) return []
    const { purchaseDate, warrantyExpiry } = equipmentDates(data, current)
    const set: Record<string, any> = { updatedAt: new Date(), purchaseDate, warrantyExpiry }
    // Only real columns, named — never a spread of whatever arrived.
    for (const k of ['name', 'serialNumber', 'model', 'manufacturer', 'location', 'notes', 'categoryId', 'status'] as const) {
      if (data[k] !== undefined) set[k] = data[k] === '' ? null : data[k]
    }
    if (opt.contacts && data.contactId !== undefined) set.contactId = data.contactId || null
    if (opt.sites) {
      if (data.locationId !== undefined) set.locationId = data.locationId || null
      if (data.siteId !== undefined) set.siteId = data.siteId || null
    }
    const rows = await db.update(equipment).set(set)
      .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId))).returning()
    return rows.map(shape)
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
  /**
   * SERVICE HISTORY CROSSED THE TENANT BOUNDARY, BOTH WAYS. (found while fixing T32 H1)
   *
   * `equipment_maintenance` has no company_id of its own — it belongs to a company only through its
   * equipment row. Both functions below took the equipment id and filtered on nothing else:
   * `addServiceRecord` was even handed the companyId and named the parameter `_companyId` to say it
   * was unused. So with an id from another tenant, GET /:id/history returned their service history
   * and what they paid for it, and POST /:id/history wrote a record onto their equipment.
   *
   * Every other function in this module takes companyId and uses it. These two are now the same: the
   * equipment row is resolved for THIS company first, and an id that is not theirs is indistinguishable
   * from one that does not exist — which is the right answer to give.
   */
  async function ownsEquipment(equipmentId: string, companyId: string) {
    const [row] = await db.select({ id: equipment.id }).from(equipment)
      .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId))).limit(1)
    return !!row
  }
  async function addServiceRecord(equipmentId: string, companyId: string, data: { type: string; description?: string; cost?: number; nextDueDate?: string }) {
    if (!(await ownsEquipment(equipmentId, companyId))) return null
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
  async function getServiceHistory(equipmentId: string, companyId: string) {
    if (!(await ownsEquipment(equipmentId, companyId))) return null
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
        AND e.status <> ${RETIRED}
        AND em.next_due_date IS NOT NULL
        AND em.next_due_date <= ${dueDate}
      ORDER BY em.next_due_date ASC
    `)
    return (result as any).rows || result
  }

  async function getWarrantyExpiring(companyId: string, { days = WARRANTY_WINDOW_DAYS }: { days?: number } = {}) {
    const expiryDate = new Date(); expiryDate.setDate(expiryDate.getDate() + days)
    return db.select().from(equipment).where(and(
      eq(equipment.companyId, companyId),
      stillOwned(),
      gte(equipment.warrantyExpiry, new Date()),
      lte(equipment.warrantyExpiry, expiryDate),
    )).orderBy(asc(equipment.warrantyExpiry))
  }

  async function getAgingEquipment(companyId: string, { minAgeYears = 10 }: { minAgeYears?: number } = {}) {
    const cutoffDate = new Date(); cutoffDate.setFullYear(cutoffDate.getFullYear() - minAgeYears)
    return db.select().from(equipment).where(and(
      eq(equipment.companyId, companyId),
      stillOwned(),
      lte(equipment.purchaseDate, cutoffDate),
    )).orderBy(asc(equipment.purchaseDate))
  }

  /**
   * The four tiles on the Equipment page. (T41)
   *
   * TWO THINGS WERE WRONG HERE, and the second one had hidden a whole tile for as long as it has
   * existed.
   *
   * 1. `total` counted `status = 'active'` under a tile labelled "Total Equipment", while the Needs
   *    Repair tile counted the broken ones separately. A yard of 12 machines with 2 broken read
   *    "Total Equipment 10 · Needs Repair 2" — the label says total and the number was not one. It
   *    now counts everything still owned.
   *
   * 2. The page renders a "Maintenance Due" tile from `stats.needsMaintenance`, and this function
   *    never returned that key. Its TypeScript interface declares it as required, but no template
   *    runs tsc, so nothing said so — and the page reads `stats.needsMaintenance ?? 0`, which turned
   *    the missing figure into a confident zero. The tile has therefore always shown 0, including on
   *    a yard with overdue machines. It is computed here now, mirroring getMaintenanceDue exactly
   *    (same window, same join) so the tile and the list it corresponds to cannot disagree.
   */
  async function getEquipmentStats(companyId: string) {
    const now = new Date()
    const window = new Date(now); window.setDate(window.getDate() + WARRANTY_WINDOW_DAYS)
    const maintenanceWindow = new Date(now); maintenanceWindow.setDate(maintenanceWindow.getDate() + 30)
    const [[{ value: total }], [{ value: needsRepair }], [{ value: warrantyExpiring }], [{ value: needsMaintenance }]] = await Promise.all([
      db.select({ value: count() }).from(equipment).where(and(eq(equipment.companyId, companyId), stillOwned())),
      db.select({ value: count() }).from(equipment).where(and(eq(equipment.companyId, companyId), eq(equipment.status, 'needs_repair'))),
      db.select({ value: count() }).from(equipment).where(and(
        eq(equipment.companyId, companyId),
        stillOwned(),
        gte(equipment.warrantyExpiry, now),
        lte(equipment.warrantyExpiry, window),
      )),
      // DISTINCT equipment, not maintenance rows: a machine with three overdue schedules is one
      // machine to go and look at.
      db.select({ value: countDistinct(equipment.id) }).from(equipment)
        .innerJoin(equipmentMaintenance, eq(equipmentMaintenance.equipmentId, equipment.id))
        .where(and(
          eq(equipment.companyId, companyId),
          stillOwned(),
          lte(equipmentMaintenance.nextDueDate, maintenanceWindow),
        )),
    ])
    return { total, needsRepair, warrantyExpiring, needsMaintenance }
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
    const { contactId, category, categoryId, status, needsMaintenance, warrantyExpiring, search, page, limit } = c.req.query()
    // These four were parsed out of the query string and then NOT passed, so every one of them was a
    // filter that did nothing. `category` is the screen's older name for the same thing. (T32 H9)
    const data = await service.getEquipment(user.companyId, {
      contactId, status, search,
      categoryId: categoryId || category,
      needsMaintenance: needsMaintenance === 'true',
      warrantyExpiring: warrantyExpiring === 'true',
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
  // Both of these used to take the equipment id and nothing else, so another tenant's id worked. The
  // service now resolves the equipment for THIS company and answers null when it is not theirs.
  app.get('/:id/history', async (c: any) => {
    const rows = await service.getServiceHistory(c.req.param('id'), c.get('user').companyId)
    if (rows === null) return c.json({ error: 'Equipment not found' }, 404)
    return c.json(rows)
  })
  app.post('/:id/history', requirePermission('equipment:update'), async (c: any) => {
    const user = c.get('user')
    const body = await c.req.json()
    const record = await service.addServiceRecord(c.req.param('id'), user.companyId, { ...body, technicianId: body.technicianId || user.userId })
    if (record === null) return c.json({ error: 'Equipment not found' }, 404)
    return c.json(record, 201)
  })

  app.delete('/:id', requirePermission('equipment:delete'), async (c: any) => {
    await service.deleteEquipment(c.req.param('id'), (c.get('user')).companyId)
    return c.json({ success: true })
  })

  return app
}
