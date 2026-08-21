/**
 * Warranty Management Service (Drizzle)
 *
 * Post-construction warranty tracking:
 * - Warranty periods per project/item
 * - Warranty claims/requests
 * - Service scheduling for warranty work
 * - Expiration tracking and notifications
 * - Warranty documentation
 */

import { db } from '../../db/index.ts';
import {
  warrantyTemplate,
  projectWarranty,
  warrantyClaim,
  activity,
  jobAssignment,
  job,
  project,
  contact,
} from '../../db/schema.ts';
import { eq, and, or, count, desc, asc, gte, lte, lt, gt, inArray, sql } from 'drizzle-orm';

// ============================================
// WARRANTY TEMPLATES
// ============================================

/**
 * Create warranty template
 */
export async function createWarrantyTemplate(companyId: string, data: {
  name: string;
  description?: string;
  category?: string;
  durationMonths?: number;
  coverageDetails?: string;
  exclusions?: string;
}) {
  const [template] = await db.insert(warrantyTemplate).values({
    companyId,
    name: data.name,
    description: data.description ?? null,
    category: data.category ?? 'workmanship',
    durationMonths: data.durationMonths ?? 12,
    coverageDetails: data.coverageDetails ?? null,
    exclusions: data.exclusions ?? null,
    active: true,
  }).returning();

  return template;
}

/**
 * Get warranty templates
 */
export async function getWarrantyTemplates(companyId: string) {
  return db.select().from(warrantyTemplate)
    .where(and(eq(warrantyTemplate.companyId, companyId), eq(warrantyTemplate.active, true)))
    .orderBy(asc(warrantyTemplate.category), asc(warrantyTemplate.name));
}

/**
 * Seed default warranty templates
 */
export async function seedDefaultTemplates(companyId: string) {
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
      durationMonths: 0,
      coverageDetails: 'Coverage as provided by product manufacturer. See product documentation.',
      exclusions: 'Per manufacturer terms.',
    },
  ];

  for (const template of defaults) {
    const [existing] = await db.select({ id: warrantyTemplate.id })
      .from(warrantyTemplate)
      .where(and(eq(warrantyTemplate.companyId, companyId), eq(warrantyTemplate.name, template.name)))
      .limit(1);

    if (!existing) {
      await db.insert(warrantyTemplate).values({
        companyId,
        ...template,
        active: true,
      });
    }
  }
}

// ============================================
// PROJECT WARRANTIES
// ============================================

/**
 * Create warranty for a project
 */
export async function createProjectWarranty(companyId: string, data: {
  projectId: string;
  contactId?: string;
  templateId?: string;
  name: string;
  category?: string;
  description?: string;
  coverageDetails?: string;
  exclusions?: string;
  startDate?: string;
  durationMonths?: number;
  documentUrl?: string;
}) {
  const startDate = data.startDate ? new Date(data.startDate) : new Date();
  const expiresAt = new Date(startDate);
  expiresAt.setMonth(expiresAt.getMonth() + (data.durationMonths || 12));

  const [warranty] = await db.insert(projectWarranty).values({
    companyId,
    projectId: data.projectId,
    contactId: data.contactId ?? null,
    templateId: data.templateId ?? null,
    name: data.name,
    category: data.category ?? null,
    description: data.description ?? null,
    coverageDetails: data.coverageDetails ?? null,
    exclusions: data.exclusions ?? null,
    startDate,
    durationMonths: data.durationMonths ?? 12,
    expiresAt,
    documentUrl: data.documentUrl ?? null,
    status: 'active',
  }).returning();

  // Fetch related project and contact
  let projectData = null;
  let contactData = null;

  if (warranty.projectId) {
    const [p] = await db.select({ id: project.id, name: project.name })
      .from(project).where(eq(project.id, warranty.projectId)).limit(1);
    projectData = p ?? null;
  }
  if (warranty.contactId) {
    const [c] = await db.select({ id: contact.id, name: contact.name })
      .from(contact).where(eq(contact.id, warranty.contactId)).limit(1);
    contactData = c ?? null;
  }

  return { ...warranty, project: projectData, contact: contactData };
}

/**
 * Create warranties from templates for a project
 */
export async function createWarrantiesFromTemplates(
  companyId: string,
  projectId: string,
  contactId: string,
  startDate: string,
  templateIds: string[],
) {
  const warranties = [];

  for (const templateId of templateIds) {
    const [template] = await db.select().from(warrantyTemplate)
      .where(eq(warrantyTemplate.id, templateId)).limit(1);

    if (template) {
      const warranty = await createProjectWarranty(companyId, {
        projectId,
        contactId,
        templateId,
        name: template.name,
        category: template.category ?? undefined,
        description: template.description ?? undefined,
        coverageDetails: template.coverageDetails ?? undefined,
        exclusions: template.exclusions ?? undefined,
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
export async function getProjectWarranties(projectId: string, companyId: string) {
  const warranties = await db.select({
    warranty: projectWarranty,
    claimCount: count(warrantyClaim.id),
  })
    .from(projectWarranty)
    .leftJoin(warrantyClaim, eq(warrantyClaim.warrantyId, projectWarranty.id))
    .where(and(eq(projectWarranty.projectId, projectId), eq(projectWarranty.companyId, companyId)))
    .groupBy(projectWarranty.id)
    .orderBy(asc(projectWarranty.expiresAt));

  const now = new Date();
  return warranties.map(({ warranty: w, claimCount }) => ({
    ...w,
    _count: { claims: claimCount },
    isExpired: w.expiresAt ? w.expiresAt < now : false,
    daysRemaining: w.expiresAt
      ? Math.max(0, Math.ceil((w.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0,
    isExpiringSoon: w.expiresAt
      ? w.expiresAt > now && w.expiresAt < new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      : false,
  }));
}

/**
 * Get all active warranties
 */
export async function getActiveWarranties(
  companyId: string,
  { expiringSoon, contactId, page = 1, limit = 50 }: {
    expiringSoon?: boolean;
    contactId?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const conditions = [eq(projectWarranty.companyId, companyId), eq(projectWarranty.status, 'active')];

  if (contactId) conditions.push(eq(projectWarranty.contactId, contactId));
  if (expiringSoon) {
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    conditions.push(gte(projectWarranty.expiresAt, new Date()));
    conditions.push(lte(projectWarranty.expiresAt, thirtyDays));
  }

  const whereClause = and(...conditions);
  const offset = (page - 1) * limit;

  const data = await db.select({
    warranty: projectWarranty,
    project: { id: project.id, name: project.name },
    contact: { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email },
    claimCount: count(warrantyClaim.id),
  })
    .from(projectWarranty)
    .leftJoin(project, eq(project.id, projectWarranty.projectId))
    .leftJoin(contact, eq(contact.id, projectWarranty.contactId))
    .leftJoin(warrantyClaim, eq(warrantyClaim.warrantyId, projectWarranty.id))
    .where(whereClause)
    .groupBy(projectWarranty.id, project.id, project.name, contact.id, contact.name, contact.phone, contact.email)
    .orderBy(asc(projectWarranty.expiresAt))
    .limit(limit)
    .offset(offset);

  const [{ value: total }] = await db.select({ value: count() })
    .from(projectWarranty)
    .where(whereClause);

  const result = data.map(({ warranty: w, project: p, contact: c, claimCount }) => ({
    ...w,
    project: p,
    contact: c,
    _count: { claims: claimCount },
  }));

  return { data: result, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Get expiring warranties for notifications
 */
export async function getExpiringWarranties(companyId: string, { days = 30 }: { days?: number } = {}) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);

  const rows = await db.select({
    warranty: projectWarranty,
    project: { id: project.id, name: project.name, address: project.address },
    contact: { id: contact.id, name: contact.name, phone: contact.phone, email: contact.email },
  })
    .from(projectWarranty)
    .leftJoin(project, eq(project.id, projectWarranty.projectId))
    .leftJoin(contact, eq(contact.id, projectWarranty.contactId))
    .where(and(
      eq(projectWarranty.companyId, companyId),
      eq(projectWarranty.status, 'active'),
      gte(projectWarranty.expiresAt, new Date()),
      lte(projectWarranty.expiresAt, expiryDate),
    ))
    .orderBy(asc(projectWarranty.expiresAt));

  return rows.map(({ warranty: w, project: p, contact: c }) => ({
    ...w,
    project: p,
    contact: c,
  }));
}

/**
 * Check and update expired warranties
 */
export async function processExpiredWarranties(): Promise<number> {
  const result = await db.update(projectWarranty)
    .set({ status: 'expired' })
    .where(and(
      eq(projectWarranty.status, 'active'),
      lt(projectWarranty.expiresAt, new Date()),
    ))
    .returning({ id: projectWarranty.id });

  return result.length;
}

// ============================================
// WARRANTY CLAIMS
// ============================================

/**
 * Create warranty claim
 */
export async function createClaim(companyId: string, data: {
  warrantyId: string;
  title: string;
  description?: string;
  location?: string;
  reportedBy?: string;
  reportedMethod?: string;
  priority?: string;
  photos?: any[];
}) {
  // Verify warranty is valid
  const [warranty] = await db.select().from(projectWarranty)
    .where(and(eq(projectWarranty.id, data.warrantyId), eq(projectWarranty.companyId, companyId)))
    .limit(1);

  if (!warranty) throw new Error('Warranty not found');
  if (warranty.status === 'expired') throw new Error('Warranty has expired');
  if (warranty.status === 'voided') throw new Error('Warranty has been voided');

  const [claim] = await db.insert(warrantyClaim).values({
    companyId,
    warrantyId: data.warrantyId,
    description: data.title + (data.description ? ': ' + data.description : ''),
    status: 'open',
  }).returning();

  // Log activity
  await db.insert(activity).values({
    companyId,
    entityType: 'warranty_claim',
    entityId: claim.id,
    action: 'created',
    description: `Warranty claim created: ${data.title}`,
  });

  return claim;
}

/**
 * Get claims
 */
export async function getClaims(
  companyId: string,
  { warrantyId, projectId, status, priority, page = 1, limit = 50 }: {
    warrantyId?: string;
    projectId?: string;
    status?: string;
    priority?: string;
    page?: number;
    limit?: number;
  } = {},
) {
  const conditions = [eq(warrantyClaim.companyId, companyId)];
  if (warrantyId) conditions.push(eq(warrantyClaim.warrantyId, warrantyId));
  if (status) conditions.push(eq(warrantyClaim.status, status));

  const whereClause = and(...conditions);
  const offset = (page - 1) * limit;

  const data = await db.select({
    claim: warrantyClaim,
    warranty: { name: projectWarranty.name, category: projectWarranty.category },
    project: { id: project.id, name: project.name },
    contact: { id: contact.id, name: contact.name },
  })
    .from(warrantyClaim)
    .leftJoin(projectWarranty, eq(projectWarranty.id, warrantyClaim.warrantyId))
    .leftJoin(project, eq(project.id, projectWarranty.projectId))
    .leftJoin(contact, eq(contact.id, projectWarranty.contactId))
    .where(whereClause)
    .orderBy(desc(warrantyClaim.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ value: total }] = await db.select({ value: count() })
    .from(warrantyClaim)
    .where(whereClause);

  const result = data.map(({ claim: c, warranty: w, project: p, contact: ct }) => ({
    ...c,
    warranty: w,
    project: p,
    contact: ct,
  }));

  return { data: result, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Get single claim
 */
export async function getClaim(claimId: string, companyId: string) {
  const [row] = await db.select({
    claim: warrantyClaim,
    warranty: projectWarranty,
    project: project,
    contact: contact,
  })
    .from(warrantyClaim)
    .leftJoin(projectWarranty, eq(projectWarranty.id, warrantyClaim.warrantyId))
    .leftJoin(project, eq(project.id, projectWarranty.projectId))
    .leftJoin(contact, eq(contact.id, projectWarranty.contactId))
    .where(and(eq(warrantyClaim.id, claimId), eq(warrantyClaim.companyId, companyId)))
    .limit(1);

  if (!row) return null;

  return {
    ...row.claim,
    warranty: row.warranty,
    project: row.project,
    contact: row.contact,
  };
}

/**
 * Update claim status
 */
export async function updateClaimStatus(
  claimId: string,
  companyId: string,
  { status, notes, userId }: { status: string; notes?: string; userId?: string },
) {
  const updateData: Record<string, any> = { status };

  if (status === 'completed') {
    updateData.resolvedAt = new Date();
  }
  if (status === 'denied' && notes) {
    updateData.resolution = notes;
  }

  const [claim] = await db.update(warrantyClaim)
    .set(updateData)
    .where(eq(warrantyClaim.id, claimId))
    .returning();

  await db.insert(activity).values({
    companyId,
    entityType: 'warranty_claim',
    entityId: claimId,
    action: 'status_changed',
    description: `Claim status changed to ${status}`,
    userId: userId ?? null,
  });

  return claim;
}

/**
 * Schedule warranty work (creates job)
 */
export async function scheduleWarrantyWork(
  claimId: string,
  companyId: string,
  { scheduledDate, assignedTo, notes }: { scheduledDate: string; assignedTo?: string; notes?: string },
) {
  const [claimRow] = await db.select({
    claim: warrantyClaim,
    warranty: projectWarranty,
    project: project,
    contact: contact,
  })
    .from(warrantyClaim)
    .leftJoin(projectWarranty, eq(projectWarranty.id, warrantyClaim.warrantyId))
    .leftJoin(project, eq(project.id, projectWarranty.projectId))
    .leftJoin(contact, eq(contact.id, projectWarranty.contactId))
    .where(and(eq(warrantyClaim.id, claimId), eq(warrantyClaim.companyId, companyId)))
    .limit(1);

  if (!claimRow) throw new Error('Claim not found');

  const claim = claimRow.claim;
  const jobDescription = `Warranty claim repair:\n\n${claim.description || ''}\n\nNotes: ${notes || 'N/A'}`;

  // Create job for warranty work
  const [newJob] = await db.insert(job).values({
    companyId,
    contactId: claimRow.contact?.id ?? null,
    projectId: claimRow.project?.id ?? null,
    title: `Warranty: ${claim.description?.substring(0, 50) || 'Claim'}`,
    description: jobDescription,
    type: 'warranty',
    status: 'scheduled',
    priority: 'normal',
    scheduledDate: new Date(scheduledDate),
    address: claimRow.project?.address ?? null,
    number: `WC-${Date.now()}`,
    assignedToId: assignedTo ?? null,
  }).returning();

  // Assign technician
  if (assignedTo) {
    await db.insert(jobAssignment).values({
      jobId: newJob.id,
      userId: assignedTo,
    });
  }

  // Update claim status
  await db.update(warrantyClaim)
    .set({ status: 'scheduled' })
    .where(eq(warrantyClaim.id, claimId));

  return newJob;
}

/**
 * Deny claim
 */
export async function denyClaim(
  claimId: string,
  companyId: string,
  { reason, userId }: { reason: string; userId?: string },
) {
  const [claim] = await db.update(warrantyClaim)
    .set({
      status: 'denied',
      resolution: reason,
    })
    .where(and(eq(warrantyClaim.id, claimId), eq(warrantyClaim.companyId, companyId)))
    .returning();

  return claim;
}

// ============================================
// REPORTS
// ============================================

/**
 * Get warranty stats
 */
export async function getWarrantyStats(companyId: string) {
  const now = new Date();
  const thirtyDays = new Date(now);
  thirtyDays.setDate(thirtyDays.getDate() + 30);

  const [
    [{ value: active }],
    [{ value: expiringSoon }],
    [{ value: openClaims }],
    [{ value: totalClaims }],
  ] = await Promise.all([
    db.select({ value: count() }).from(projectWarranty)
      .where(and(eq(projectWarranty.companyId, companyId), eq(projectWarranty.status, 'active'), gt(projectWarranty.expiresAt, now))),
    db.select({ value: count() }).from(projectWarranty)
      .where(and(eq(projectWarranty.companyId, companyId), eq(projectWarranty.status, 'active'), gte(projectWarranty.expiresAt, now), lte(projectWarranty.expiresAt, thirtyDays))),
    db.select({ value: count() }).from(warrantyClaim)
      .where(and(eq(warrantyClaim.companyId, companyId), inArray(warrantyClaim.status, ['open', 'scheduled', 'in_progress']))),
    db.select({ value: count() }).from(warrantyClaim)
      .where(eq(warrantyClaim.companyId, companyId)),
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
export async function getClaimsByCategory(
  companyId: string,
  { startDate, endDate }: { startDate?: string; endDate?: string } = {},
) {
  const conditions = [eq(warrantyClaim.companyId, companyId)];
  if (startDate) conditions.push(gte(warrantyClaim.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(warrantyClaim.createdAt, new Date(endDate)));

  const claims = await db.select({
    status: warrantyClaim.status,
    category: projectWarranty.category,
  })
    .from(warrantyClaim)
    .leftJoin(projectWarranty, eq(projectWarranty.id, warrantyClaim.warrantyId))
    .where(and(...conditions));

  const byCategory: Record<string, Record<string, number>> = {};
  for (const claim of claims) {
    const cat = claim.category || 'unknown';
    if (!byCategory[cat]) byCategory[cat] = { total: 0, open: 0, completed: 0, denied: 0 };
    byCategory[cat].total++;
    byCategory[cat][claim.status] = (byCategory[cat][claim.status] || 0) + 1;
  }

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
