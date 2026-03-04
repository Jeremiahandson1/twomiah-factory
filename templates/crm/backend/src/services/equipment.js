/**
 * Equipment Tracking Service
 * 
 * Track customer equipment/assets:
 * - HVAC units, water heaters, appliances, etc.
 * - Installation dates and warranty info
 * - Service history
 * - Maintenance schedules
 * - Replacement recommendations
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// EQUIPMENT TYPES
// ============================================

/**
 * Create equipment type (template)
 */
export async function createEquipmentType(companyId, data) {
  return prisma.equipmentType.create({
    data: {
      companyId,
      name: data.name,
      category: data.category, // HVAC, Plumbing, Electrical, Appliance
      brand: data.brand,
      defaultWarrantyMonths: data.defaultWarrantyMonths || 12,
      defaultLifespanYears: data.defaultLifespanYears || 15,
      maintenanceIntervalMonths: data.maintenanceIntervalMonths || 12,
      fields: data.fields || [], // Custom fields for this type
      active: true,
    },
  });
}

/**
 * Get equipment types
 */
export async function getEquipmentTypes(companyId, { category, active = true } = {}) {
  return prisma.equipmentType.findMany({
    where: {
      companyId,
      ...(category ? { category } : {}),
      ...(active !== null ? { active } : {}),
    },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
}

// ============================================
// CUSTOMER EQUIPMENT
// ============================================

/**
 * Add equipment to a customer/property
 */
export async function createEquipment(companyId, data) {
  // Calculate warranty expiration
  const warrantyExpires = data.warrantyMonths
    ? new Date(data.installDate || Date.now())
    : null;
  if (warrantyExpires && data.warrantyMonths) {
    warrantyExpires.setMonth(warrantyExpires.getMonth() + data.warrantyMonths);
  }

  // Calculate next maintenance
  const nextMaintenance = data.maintenanceIntervalMonths
    ? new Date(data.lastMaintenanceDate || data.installDate || Date.now())
    : null;
  if (nextMaintenance && data.maintenanceIntervalMonths) {
    nextMaintenance.setMonth(nextMaintenance.getMonth() + data.maintenanceIntervalMonths);
  }

  return prisma.equipment.create({
    data: {
      companyId,
      contactId: data.contactId,
      propertyId: data.propertyId,
      equipmentTypeId: data.equipmentTypeId,
      
      // Basic Info
      name: data.name,
      category: data.category,
      brand: data.brand,
      model: data.model,
      serialNumber: data.serialNumber,
      
      // Location
      location: data.location, // "Basement", "Attic", "Garage", etc.
      
      // Dates
      installDate: data.installDate ? new Date(data.installDate) : null,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
      
      // Warranty
      warrantyMonths: data.warrantyMonths || 0,
      warrantyExpires,
      warrantyProvider: data.warrantyProvider,
      warrantyNotes: data.warrantyNotes,
      
      // Maintenance
      maintenanceIntervalMonths: data.maintenanceIntervalMonths || 12,
      lastMaintenanceDate: data.lastMaintenanceDate ? new Date(data.lastMaintenanceDate) : null,
      nextMaintenanceDate: nextMaintenance,
      
      // Specs
      specifications: data.specifications || {},
      
      // Status
      status: 'active', // active, needs_repair, replaced, removed
      condition: data.condition || 'good', // excellent, good, fair, poor
      
      notes: data.notes,
      imageUrl: data.imageUrl,
    },
    include: {
      contact: { select: { id: true, name: true } },
      equipmentType: true,
    },
  });
}

/**
 * Get equipment list
 */
export async function getEquipment(companyId, {
  contactId,
  propertyId,
  category,
  status,
  needsMaintenance,
  warrantyExpiring,
  search,
  page = 1,
  limit = 50,
} = {}) {
  const where = { companyId };

  if (contactId) where.contactId = contactId;
  if (propertyId) where.propertyId = propertyId;
  if (category) where.category = category;
  if (status) where.status = status;

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { brand: { contains: search, mode: 'insensitive' } },
      { model: { contains: search, mode: 'insensitive' } },
      { serialNumber: { contains: search, mode: 'insensitive' } },
    ];
  }

  // Equipment needing maintenance soon
  if (needsMaintenance) {
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    where.nextMaintenanceDate = { lte: thirtyDays };
    where.status = 'active';
  }

  // Warranty expiring soon
  if (warrantyExpiring) {
    const sixtyDays = new Date();
    sixtyDays.setDate(sixtyDays.getDate() + 60);
    where.warrantyExpires = { lte: sixtyDays, gte: new Date() };
  }

  const [data, total] = await Promise.all([
    prisma.equipment.findMany({
      where,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        equipmentType: { select: { id: true, name: true } },
        _count: { select: { serviceHistory: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.equipment.count({ where }),
  ]);

  // Add computed fields
  const enriched = data.map(eq => ({
    ...eq,
    warrantyActive: eq.warrantyExpires ? new Date(eq.warrantyExpires) > new Date() : false,
    maintenanceDue: eq.nextMaintenanceDate ? new Date(eq.nextMaintenanceDate) <= new Date() : false,
    age: eq.installDate 
      ? Math.floor((Date.now() - new Date(eq.installDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
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
export async function getEquipmentDetails(equipmentId, companyId) {
  return prisma.equipment.findFirst({
    where: { id: equipmentId, companyId },
    include: {
      contact: true,
      equipmentType: true,
      serviceHistory: {
        orderBy: { serviceDate: 'desc' },
        include: {
          job: { select: { id: true, title: true, number: true } },
          technician: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  });
}

/**
 * Update equipment
 */
export async function updateEquipment(equipmentId, companyId, data) {
  // Recalculate dates if relevant fields changed
  const updates = { ...data };

  if (data.warrantyMonths !== undefined && data.installDate) {
    const warrantyExpires = new Date(data.installDate);
    warrantyExpires.setMonth(warrantyExpires.getMonth() + data.warrantyMonths);
    updates.warrantyExpires = warrantyExpires;
  }

  return prisma.equipment.updateMany({
    where: { id: equipmentId, companyId },
    data: updates,
  });
}

/**
 * Mark equipment as needing repair
 */
export async function markNeedsRepair(equipmentId, companyId, notes) {
  return prisma.equipment.updateMany({
    where: { id: equipmentId, companyId },
    data: {
      status: 'needs_repair',
      condition: 'poor',
      notes,
    },
  });
}

/**
 * Mark equipment as replaced
 */
export async function markReplaced(equipmentId, companyId, { replacementId, notes }) {
  return prisma.equipment.updateMany({
    where: { id: equipmentId, companyId },
    data: {
      status: 'replaced',
      replacedById: replacementId,
      replacedDate: new Date(),
      notes,
    },
  });
}

// ============================================
// SERVICE HISTORY
// ============================================

/**
 * Add service record
 */
export async function addServiceRecord(equipmentId, companyId, data) {
  const record = await prisma.equipmentServiceRecord.create({
    data: {
      equipmentId,
      companyId,
      jobId: data.jobId,
      technicianId: data.technicianId,
      
      serviceDate: data.serviceDate ? new Date(data.serviceDate) : new Date(),
      serviceType: data.serviceType, // maintenance, repair, inspection, installation
      description: data.description,
      findings: data.findings,
      recommendations: data.recommendations,
      
      partsUsed: data.partsUsed || [],
      laborHours: data.laborHours || 0,
      cost: data.cost || 0,
      
      conditionBefore: data.conditionBefore,
      conditionAfter: data.conditionAfter,
    },
  });

  // Update equipment
  const updates = {
    lastMaintenanceDate: record.serviceDate,
  };

  if (data.conditionAfter) {
    updates.condition = data.conditionAfter;
  }

  // Calculate next maintenance
  const equipment = await prisma.equipment.findUnique({ where: { id: equipmentId } });
  if (equipment?.maintenanceIntervalMonths) {
    const nextMaintenance = new Date(record.serviceDate);
    nextMaintenance.setMonth(nextMaintenance.getMonth() + equipment.maintenanceIntervalMonths);
    updates.nextMaintenanceDate = nextMaintenance;
  }

  await prisma.equipment.update({
    where: { id: equipmentId },
    data: updates,
  });

  return record;
}

/**
 * Get service history
 */
export async function getServiceHistory(equipmentId, companyId) {
  return prisma.equipmentServiceRecord.findMany({
    where: { equipmentId, companyId },
    include: {
      job: { select: { id: true, title: true, number: true } },
      technician: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { serviceDate: 'desc' },
  });
}

// ============================================
// REPORTS & ALERTS
// ============================================

/**
 * Get equipment due for maintenance
 */
export async function getMaintenanceDue(companyId, { days = 30 } = {}) {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  return prisma.equipment.findMany({
    where: {
      companyId,
      status: 'active',
      nextMaintenanceDate: { lte: dueDate },
    },
    include: {
      contact: { select: { id: true, name: true, phone: true, email: true } },
    },
    orderBy: { nextMaintenanceDate: 'asc' },
  });
}

/**
 * Get equipment with expiring warranties
 */
export async function getWarrantyExpiring(companyId, { days = 60 } = {}) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);

  return prisma.equipment.findMany({
    where: {
      companyId,
      status: 'active',
      warrantyExpires: {
        gte: new Date(),
        lte: expiryDate,
      },
    },
    include: {
      contact: { select: { id: true, name: true, phone: true, email: true } },
    },
    orderBy: { warrantyExpires: 'asc' },
  });
}

/**
 * Get aging equipment (replacement opportunities)
 */
export async function getAgingEquipment(companyId, { minAgeYears = 10 } = {}) {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - minAgeYears);

  return prisma.equipment.findMany({
    where: {
      companyId,
      status: 'active',
      installDate: { lte: cutoffDate },
    },
    include: {
      contact: { select: { id: true, name: true, phone: true, email: true } },
      equipmentType: { select: { defaultLifespanYears: true } },
    },
    orderBy: { installDate: 'asc' },
  });
}

/**
 * Get equipment stats
 */
export async function getEquipmentStats(companyId) {
  const now = new Date();
  const thirtyDays = new Date(now);
  thirtyDays.setDate(thirtyDays.getDate() + 30);

  const [total, needsMaintenance, warrantyExpiring, needsRepair] = await Promise.all([
    prisma.equipment.count({ where: { companyId, status: 'active' } }),
    prisma.equipment.count({
      where: {
        companyId,
        status: 'active',
        nextMaintenanceDate: { lte: thirtyDays },
      },
    }),
    prisma.equipment.count({
      where: {
        companyId,
        status: 'active',
        warrantyExpires: { gte: now, lte: thirtyDays },
      },
    }),
    prisma.equipment.count({
      where: { companyId, status: 'needs_repair' },
    }),
  ]);

  // Get by category
  const byCategory = await prisma.equipment.groupBy({
    by: ['category'],
    where: { companyId, status: 'active' },
    _count: true,
  });

  return {
    total,
    needsMaintenance,
    warrantyExpiring,
    needsRepair,
    byCategory: byCategory.reduce((acc, c) => {
      acc[c.category] = c._count;
      return acc;
    }, {}),
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
