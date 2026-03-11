/**
 * Equipment Tracking Service (Drizzle)
 *
 * Track customer equipment/assets:
 * - HVAC units, water heaters, appliances, etc.
 * - Installation dates and warranty info
 * - Service history
 * - Maintenance schedules
 * - Replacement recommendations
 */

import { db } from '../../db/index.ts';
import {
  equipment,
  equipmentCategory,
  equipmentMaintenance,
  contact,
  job,
  user,
} from '../../db/schema.ts';
import { eq, and, lte, gte, count, asc, desc, ilike, or, sql } from 'drizzle-orm';

// ============================================
// EQUIPMENT CATEGORIES (replaces equipmentType)
// ============================================

/**
 * Create equipment category
 */
export async function createEquipmentType(companyId: string, data: {
  name: string;
}) {
  const [result] = await db.insert(equipmentCategory).values({
    companyId,
    name: data.name,
  }).returning();
  return result;
}

/**
 * Get equipment categories
 */
export async function getEquipmentTypes(companyId: string) {
  return db.select()
    .from(equipmentCategory)
    .where(eq(equipmentCategory.companyId, companyId))
    .orderBy(asc(equipmentCategory.name));
}

// ============================================
// CUSTOMER EQUIPMENT
// ============================================

/**
 * Add equipment to a customer/property
 */
export async function createEquipment(companyId: string, data: {
  name: string;
  serialNumber?: string;
  model?: string;
  manufacturer?: string;
  location?: string;
  purchaseDate?: string;
  warrantyExpiry?: string;
  notes?: string;
  categoryId?: string;
  contactId?: string;
  locationId?: string;
}) {
  const [result] = await db.insert(equipment).values({
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
    contactId: data.contactId || null,
    locationId: data.locationId || null,
    status: 'active',
  }).returning();
  return result;
}

/**
 * Get equipment list
 */
export async function getEquipment(companyId: string, {
  contactId,
  status,
  search,
  page = 1,
  limit = 50,
}: {
  contactId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
} = {}) {
  const conditions = [eq(equipment.companyId, companyId)];

  if (contactId) conditions.push(eq(equipment.contactId, contactId));
  if (status) conditions.push(eq(equipment.status, status));

  if (search) {
    conditions.push(or(
      ilike(equipment.name, `%${search}%`),
      ilike(equipment.model, `%${search}%`),
      ilike(equipment.serialNumber, `%${search}%`),
    )!);
  }

  const whereClause = and(...conditions);

  const [data, [{ value: total }]] = await Promise.all([
    db.select()
      .from(equipment)
      .where(whereClause)
      .orderBy(desc(equipment.createdAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() })
      .from(equipment)
      .where(whereClause),
  ]);

  // Fetch contact names for equipment with contactId
  const contactIds = [...new Set(data.filter(e => e.contactId).map(e => e.contactId!))];
  const contacts = contactIds.length
    ? await db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.companyId, companyId))
    : [];
  const contactMap = Object.fromEntries(contacts.map(c => [c.id, c]));

  // Add computed fields
  const enriched = data.map(eq_item => ({
    ...eq_item,
    contact: eq_item.contactId ? contactMap[eq_item.contactId] || null : null,
    warrantyActive: eq_item.warrantyExpiry ? new Date(eq_item.warrantyExpiry) > new Date() : false,
    age: eq_item.purchaseDate
      ? Math.floor((Date.now() - new Date(eq_item.purchaseDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : null,
  }));

  return {
    data: enriched,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single equipment with full history
 */
export async function getEquipmentDetails(equipmentId: string, companyId: string) {
  const [result] = await db.select()
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId)))
    .limit(1);

  if (!result) return null;

  // Fetch maintenance history, category, linked contact, and linked jobs in parallel
  const [maintenanceHistory, categoryResult, contactResult, linkedJobs] = await Promise.all([
    db.select()
      .from(equipmentMaintenance)
      .where(eq(equipmentMaintenance.equipmentId, equipmentId))
      .orderBy(desc(equipmentMaintenance.performedAt)),
    result.categoryId
      ? db.select().from(equipmentCategory).where(eq(equipmentCategory.id, result.categoryId)).limit(1)
      : Promise.resolve([]),
    result.contactId
      ? db.select({ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email }).from(contact).where(eq(contact.id, result.contactId)).limit(1)
      : Promise.resolve([]),
    db.select({
      id: job.id,
      number: job.number,
      title: job.title,
      status: job.status,
      jobType: job.jobType,
      scheduledDate: job.scheduledDate,
      completedAt: job.completedAt,
      assignedToId: job.assignedToId,
    }).from(job)
      .where(and(eq(job.equipmentId, equipmentId), eq(job.companyId, companyId)))
      .orderBy(desc(job.scheduledDate)),
  ]);

  // Fetch assigned tech names for linked jobs
  const techIds = [...new Set(linkedJobs.filter(j => j.assignedToId).map(j => j.assignedToId!))];
  const techs = techIds.length
    ? await db.select({ id: user.id, firstName: user.firstName, lastName: user.lastName }).from(user).where(eq(user.companyId, companyId))
    : [];
  const techMap = Object.fromEntries(techs.map(t => [t.id, t]));

  const jobsWithTechs = linkedJobs.map(j => ({
    ...j,
    assignedTo: j.assignedToId ? techMap[j.assignedToId] || null : null,
  }));

  return {
    ...result,
    category: categoryResult[0] || null,
    contact: contactResult[0] || null,
    maintenanceHistory,
    linkedJobs: jobsWithTechs,
  };
}

/**
 * Update equipment
 */
export async function updateEquipment(equipmentId: string, companyId: string, data: Record<string, unknown>) {
  return db.update(equipment)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId)))
    .returning();
}

/**
 * Mark equipment as needing repair
 */
export async function markNeedsRepair(equipmentId: string, companyId: string, notes?: string) {
  return db.update(equipment)
    .set({
      status: 'needs_repair',
      notes: notes || null,
      updatedAt: new Date(),
    })
    .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId)))
    .returning();
}

/**
 * Mark equipment as replaced
 */
export async function markReplaced(equipmentId: string, companyId: string, { notes }: { replacementId?: string; notes?: string }) {
  return db.update(equipment)
    .set({
      status: 'replaced',
      notes: notes || null,
      updatedAt: new Date(),
    })
    .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, companyId)))
    .returning();
}

// ============================================
// SERVICE HISTORY (maintenance records)
// ============================================

/**
 * Add service/maintenance record
 */
export async function addServiceRecord(equipmentId: string, _companyId: string, data: {
  type: string;
  description?: string;
  cost?: number;
  nextDueDate?: string;
}) {
  const [record] = await db.insert(equipmentMaintenance).values({
    equipmentId,
    type: data.type,
    description: data.description || null,
    cost: data.cost ? String(data.cost) : null,
    performedAt: new Date(),
    nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : null,
  }).returning();

  return record;
}

/**
 * Get service history
 */
export async function getServiceHistory(equipmentId: string) {
  return db.select()
    .from(equipmentMaintenance)
    .where(eq(equipmentMaintenance.equipmentId, equipmentId))
    .orderBy(desc(equipmentMaintenance.performedAt));
}

// ============================================
// REPORTS & ALERTS
// ============================================

/**
 * Get equipment due for maintenance
 */
export async function getMaintenanceDue(companyId: string, { days = 30 }: { days?: number } = {}) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  // Get equipment with maintenance due via the maintenance table
  const result = await db.execute(sql`
    SELECT e.*, em.next_due_date
    FROM equipment e
    JOIN equipment_maintenance em ON em.equipment_id = e.id
    WHERE e.company_id = ${companyId}
      AND e.status = 'active'
      AND em.next_due_date IS NOT NULL
      AND em.next_due_date <= ${dueDate}
    ORDER BY em.next_due_date ASC
  `);
  return (result as any).rows || result;
}

/**
 * Get equipment with expiring warranties
 */
export async function getWarrantyExpiring(companyId: string, { days = 60 }: { days?: number } = {}) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);

  return db.select()
    .from(equipment)
    .where(and(
      eq(equipment.companyId, companyId),
      eq(equipment.status, 'active'),
      gte(equipment.warrantyExpiry, new Date()),
      lte(equipment.warrantyExpiry, expiryDate),
    ))
    .orderBy(asc(equipment.warrantyExpiry));
}

/**
 * Get aging equipment (replacement opportunities)
 */
export async function getAgingEquipment(companyId: string, { minAgeYears = 10 }: { minAgeYears?: number } = {}) {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - minAgeYears);

  return db.select()
    .from(equipment)
    .where(and(
      eq(equipment.companyId, companyId),
      eq(equipment.status, 'active'),
      lte(equipment.purchaseDate, cutoffDate),
    ))
    .orderBy(asc(equipment.purchaseDate));
}

/**
 * Get equipment stats
 */
export async function getEquipmentStats(companyId: string) {
  const now = new Date();
  const thirtyDays = new Date(now);
  thirtyDays.setDate(thirtyDays.getDate() + 30);

  const [
    [{ value: total }],
    [{ value: needsRepair }],
    [{ value: warrantyExpiring }],
  ] = await Promise.all([
    db.select({ value: count() })
      .from(equipment)
      .where(and(eq(equipment.companyId, companyId), eq(equipment.status, 'active'))),
    db.select({ value: count() })
      .from(equipment)
      .where(and(eq(equipment.companyId, companyId), eq(equipment.status, 'needs_repair'))),
    db.select({ value: count() })
      .from(equipment)
      .where(and(
        eq(equipment.companyId, companyId),
        eq(equipment.status, 'active'),
        gte(equipment.warrantyExpiry, now),
        lte(equipment.warrantyExpiry, thirtyDays),
      )),
  ]);

  return {
    total,
    needsRepair,
    warrantyExpiring,
  };
}

export default {
  createEquipmentType,
  getEquipmentTypes,
  createEquipment,
  getEquipment,
  getEquipmentDetails,
  updateEquipment,
  markNeedsRepair,
  markReplaced,
  addServiceRecord,
  getServiceHistory,
  getMaintenanceDue,
  getWarrantyExpiring,
  getAgingEquipment,
  getEquipmentStats,
};
