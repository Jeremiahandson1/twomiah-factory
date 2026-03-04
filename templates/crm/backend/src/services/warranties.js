/**
 * Warranty Management Service
 * 
 * Post-construction warranty tracking:
 * - Warranty periods per project/item
 * - Warranty claims/requests
 * - Service scheduling for warranty work
 * - Expiration tracking and notifications
 * - Warranty documentation
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// WARRANTY TEMPLATES
// ============================================

/**
 * Create warranty template
 */
export async function createWarrantyTemplate(companyId, data) {
  return prisma.warrantyTemplate.create({
    data: {
      companyId,
      name: data.name,
      description: data.description,
      category: data.category, // workmanship, materials, systems, structural
      durationMonths: data.durationMonths || 12,
      coverageDetails: data.coverageDetails,
      exclusions: data.exclusions,
      active: true,
    },
  });
}

/**
 * Get warranty templates
 */
export async function getWarrantyTemplates(companyId) {
  return prisma.warrantyTemplate.findMany({
    where: { companyId, active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });
}

/**
 * Seed default warranty templates
 */
export async function seedDefaultTemplates(companyId) {
  const defaults = [
    {
      name: '1-Year Workmanship Warranty',
      category: 'workmanship',
      durationMonths: 12,
      coverageDetails: 'Covers defects in workmanship for all work performed by contractor.',
      exclusions: 'Normal wear and tear, customer modifications, acts of God.',
    },
    {
      name: '2-Year Systems Warranty',
      category: 'systems',
      durationMonths: 24,
      coverageDetails: 'Covers HVAC, plumbing, and electrical systems installed by contractor.',
      exclusions: 'Manufacturer defects (covered under manufacturer warranty), improper use.',
    },
    {
      name: '10-Year Structural Warranty',
      category: 'structural',
      durationMonths: 120,
      coverageDetails: 'Covers major structural defects including foundation, load-bearing walls, and roof structure.',
      exclusions: 'Settlement within normal tolerance, cosmetic cracks, landscaping effects.',
    },
    {
      name: 'Manufacturer Warranty Pass-Through',
      category: 'materials',
      durationMonths: 0, // Varies by product
      coverageDetails: 'Coverage as provided by product manufacturer. See product documentation.',
      exclusions: 'Per manufacturer terms.',
    },
  ];

  for (const template of defaults) {
    await prisma.warrantyTemplate.upsert({
      where: {
        companyId_name: { companyId, name: template.name },
      },
      create: { companyId, ...template, active: true },
      update: {},
    });
  }
}

// ============================================
// PROJECT WARRANTIES
// ============================================

/**
 * Create warranty for a project
 */
export async function createProjectWarranty(companyId, data) {
  const startDate = data.startDate ? new Date(data.startDate) : new Date();
  const expiresAt = new Date(startDate);
  expiresAt.setMonth(expiresAt.getMonth() + (data.durationMonths || 12));

  return prisma.projectWarranty.create({
    data: {
      companyId,
      projectId: data.projectId,
      contactId: data.contactId,
      templateId: data.templateId,
      
      name: data.name,
      category: data.category,
      description: data.description,
      coverageDetails: data.coverageDetails,
      exclusions: data.exclusions,
      
      startDate,
      durationMonths: data.durationMonths || 12,
      expiresAt,
      
      // Documentation
      documentUrl: data.documentUrl,
      
      status: 'active', // active, expired, voided
    },
    include: {
      project: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true } },
    },
  });
}

/**
 * Create warranties from templates for a project
 */
export async function createWarrantiesFromTemplates(companyId, projectId, contactId, startDate, templateIds) {
  const warranties = [];

  for (const templateId of templateIds) {
    const template = await prisma.warrantyTemplate.findUnique({
      where: { id: templateId },
    });

    if (template) {
      const warranty = await createProjectWarranty(companyId, {
        projectId,
        contactId,
        templateId,
        name: template.name,
        category: template.category,
        description: template.description,
        coverageDetails: template.coverageDetails,
        exclusions: template.exclusions,
        durationMonths: template.durationMonths,
        startDate,
      });
      warranties.push(warranty);
    }
  }

  return warranties;
}

/**
 * Get warranties for a project
 */
export async function getProjectWarranties(projectId, companyId) {
  const warranties = await prisma.projectWarranty.findMany({
    where: { projectId, companyId },
    include: {
      _count: { select: { claims: true } },
    },
    orderBy: { expiresAt: 'asc' },
  });

  const now = new Date();
  return warranties.map(w => ({
    ...w,
    isExpired: w.expiresAt < now,
    daysRemaining: Math.max(0, Math.ceil((w.expiresAt - now) / (1000 * 60 * 60 * 24))),
    isExpiringSoon: w.expiresAt > now && w.expiresAt < new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  }));
}

/**
 * Get all active warranties
 */
export async function getActiveWarranties(companyId, { expiringSoon, contactId, page = 1, limit = 50 } = {}) {
  const where = { companyId, status: 'active' };

  if (contactId) where.contactId = contactId;

  if (expiringSoon) {
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    where.expiresAt = {
      gte: new Date(),
      lte: thirtyDays,
    };
  }

  const [data, total] = await Promise.all([
    prisma.projectWarranty.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, phone: true, email: true } },
        _count: { select: { claims: true } },
      },
      orderBy: { expiresAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.projectWarranty.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Get expiring warranties for notifications
 */
export async function getExpiringWarranties(companyId, { days = 30 } = {}) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);

  return prisma.projectWarranty.findMany({
    where: {
      companyId,
      status: 'active',
      expiresAt: {
        gte: new Date(),
        lte: expiryDate,
      },
    },
    include: {
      project: { select: { id: true, name: true, address: true } },
      contact: { select: { id: true, name: true, phone: true, email: true } },
    },
    orderBy: { expiresAt: 'asc' },
  });
}

/**
 * Check and update expired warranties
 */
export async function processExpiredWarranties() {
  const result = await prisma.projectWarranty.updateMany({
    where: {
      status: 'active',
      expiresAt: { lt: new Date() },
    },
    data: {
      status: 'expired',
    },
  });
  
  return result.count;
}

// ============================================
// WARRANTY CLAIMS
// ============================================

/**
 * Create warranty claim
 */
export async function createClaim(companyId, data) {
  // Verify warranty is valid
  const warranty = await prisma.projectWarranty.findFirst({
    where: { id: data.warrantyId, companyId },
  });

  if (!warranty) throw new Error('Warranty not found');
  if (warranty.status === 'expired') throw new Error('Warranty has expired');
  if (warranty.status === 'voided') throw new Error('Warranty has been voided');

  const claim = await prisma.warrantyClaim.create({
    data: {
      companyId,
      warrantyId: data.warrantyId,
      projectId: warranty.projectId,
      contactId: warranty.contactId,
      
      title: data.title,
      description: data.description,
      location: data.location,
      
      // Reported info
      reportedDate: new Date(),
      reportedBy: data.reportedBy,
      reportedMethod: data.reportedMethod || 'phone', // phone, email, portal, in-person
      
      // Priority
      priority: data.priority || 'normal', // low, normal, high, urgent
      
      // Status
      status: 'open', // open, scheduled, in_progress, completed, denied
      
      // Photos
      photos: data.photos || [],
    },
    include: {
      warranty: true,
      project: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true } },
    },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      companyId,
      entityType: 'warranty_claim',
      entityId: claim.id,
      action: 'created',
      description: `Warranty claim created: ${claim.title}`,
    },
  });

  return claim;
}

/**
 * Get claims
 */
export async function getClaims(companyId, { 
  warrantyId, 
  projectId, 
  status, 
  priority,
  page = 1, 
  limit = 50 
} = {}) {
  const where = { companyId };
  if (warrantyId) where.warrantyId = warrantyId;
  if (projectId) where.projectId = projectId;
  if (status) where.status = status;
  if (priority) where.priority = priority;

  const [data, total] = await Promise.all([
    prisma.warrantyClaim.findMany({
      where,
      include: {
        warranty: { select: { name: true, category: true } },
        project: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        job: { select: { id: true, title: true, status: true } },
      },
      orderBy: [{ priority: 'desc' }, { reportedDate: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.warrantyClaim.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Get single claim
 */
export async function getClaim(claimId, companyId) {
  return prisma.warrantyClaim.findFirst({
    where: { id: claimId, companyId },
    include: {
      warranty: true,
      project: true,
      contact: true,
      job: true,
    },
  });
}

/**
 * Update claim status
 */
export async function updateClaimStatus(claimId, companyId, { status, notes, userId }) {
  const claim = await prisma.warrantyClaim.update({
    where: { id: claimId },
    data: {
      status,
      ...(status === 'completed' ? { completedDate: new Date(), completedById: userId } : {}),
      ...(status === 'denied' ? { denialReason: notes } : {}),
    },
  });

  await prisma.activityLog.create({
    data: {
      companyId,
      entityType: 'warranty_claim',
      entityId: claimId,
      action: 'status_changed',
      description: `Claim status changed to ${status}`,
      userId,
    },
  });

  return claim;
}

/**
 * Schedule warranty work (creates job)
 */
export async function scheduleWarrantyWork(claimId, companyId, { scheduledDate, assignedTo, notes }) {
  const claim = await prisma.warrantyClaim.findFirst({
    where: { id: claimId, companyId },
    include: {
      warranty: true,
      project: true,
      contact: true,
    },
  });

  if (!claim) throw new Error('Claim not found');

  // Create job for warranty work
  const job = await prisma.job.create({
    data: {
      companyId,
      contactId: claim.contactId,
      projectId: claim.projectId,
      
      title: `Warranty: ${claim.title}`,
      description: `Warranty claim repair:\n\n${claim.description}\n\nLocation: ${claim.location || 'N/A'}\n\nNotes: ${notes || 'N/A'}`,
      
      type: 'warranty',
      status: 'scheduled',
      priority: claim.priority,
      
      scheduledDate: new Date(scheduledDate),
      
      address: claim.project?.address,
      
      // Link to claim
      warrantyClaimId: claimId,
    },
  });

  // Assign technician
  if (assignedTo) {
    await prisma.jobAssignment.create({
      data: {
        jobId: job.id,
        userId: assignedTo,
      },
    });
  }

  // Update claim
  await prisma.warrantyClaim.update({
    where: { id: claimId },
    data: {
      status: 'scheduled',
      jobId: job.id,
      scheduledDate: new Date(scheduledDate),
    },
  });

  return job;
}

/**
 * Deny claim
 */
export async function denyClaim(claimId, companyId, { reason, userId }) {
  return prisma.warrantyClaim.update({
    where: { id: claimId },
    data: {
      status: 'denied',
      denialReason: reason,
      deniedById: userId,
      deniedDate: new Date(),
    },
  });
}

// ============================================
// REPORTS
// ============================================

/**
 * Get warranty stats
 */
export async function getWarrantyStats(companyId) {
  const now = new Date();
  const thirtyDays = new Date(now);
  thirtyDays.setDate(thirtyDays.getDate() + 30);

  const [active, expiringSoon, openClaims, totalClaims] = await Promise.all([
    prisma.projectWarranty.count({
      where: { companyId, status: 'active', expiresAt: { gt: now } },
    }),
    prisma.projectWarranty.count({
      where: {
        companyId,
        status: 'active',
        expiresAt: { gte: now, lte: thirtyDays },
      },
    }),
    prisma.warrantyClaim.count({
      where: { companyId, status: { in: ['open', 'scheduled', 'in_progress'] } },
    }),
    prisma.warrantyClaim.count({ where: { companyId } }),
  ]);

  return {
    activeWarranties: active,
    expiringSoon,
    openClaims,
    totalClaims,
  };
}

/**
 * Get claims by category
 */
export async function getClaimsByCategory(companyId, { startDate, endDate } = {}) {
  const where = { companyId };
  if (startDate || endDate) {
    where.reportedDate = {};
    if (startDate) where.reportedDate.gte = new Date(startDate);
    if (endDate) where.reportedDate.lte = new Date(endDate);
  }

  const claims = await prisma.warrantyClaim.findMany({
    where,
    include: { warranty: { select: { category: true } } },
  });

  const byCategory = claims.reduce((acc, claim) => {
    const cat = claim.warranty?.category || 'unknown';
    if (!acc[cat]) acc[cat] = { total: 0, open: 0, completed: 0, denied: 0 };
    acc[cat].total++;
    acc[cat][claim.status] = (acc[cat][claim.status] || 0) + 1;
    return acc;
  }, {});

  return byCategory;
}

export default {
  createWarrantyTemplate,
  getWarrantyTemplates,
  seedDefaultTemplates,
  createProjectWarranty,
  createWarrantiesFromTemplates,
  getProjectWarranties,
  getActiveWarranties,
  getExpiringWarranties,
  processExpiredWarranties,
  createClaim,
  getClaims,
  getClaim,
  updateClaimStatus,
  scheduleWarrantyWork,
  denyClaim,
  getWarrantyStats,
  getClaimsByCategory,
};
