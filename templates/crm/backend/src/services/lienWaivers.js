/**
 * Lien Waiver Service
 * 
 * Construction payment compliance:
 * - Conditional vs Unconditional waivers
 * - Track by subcontractor/vendor
 * - Link to payments/draws
 * - Compliance status per project
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Waiver types
export const WAIVER_TYPES = {
  CONDITIONAL_PARTIAL: 'conditional_partial',     // Conditional upon payment clearing - partial payment
  UNCONDITIONAL_PARTIAL: 'unconditional_partial', // Payment received - partial payment
  CONDITIONAL_FINAL: 'conditional_final',         // Conditional upon final payment clearing
  UNCONDITIONAL_FINAL: 'unconditional_final',     // Final payment received - project complete
};

export const WAIVER_STATUS = {
  DRAFT: 'draft',
  REQUESTED: 'requested',
  RECEIVED: 'received',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

// ============================================
// WAIVER MANAGEMENT
// ============================================

/**
 * Create lien waiver request
 */
export async function createWaiverRequest(companyId, data) {
  return prisma.lienWaiver.create({
    data: {
      companyId,
      projectId: data.projectId,
      
      // Who the waiver is from
      vendorId: data.vendorId, // Contact (subcontractor/vendor)
      vendorName: data.vendorName,
      vendorType: data.vendorType, // subcontractor, supplier, etc.
      
      // Waiver details
      waiverType: data.waiverType,
      
      // Amount covered
      throughDate: data.throughDate ? new Date(data.throughDate) : null,
      amountPrevious: data.amountPrevious || 0, // Previously paid
      amountCurrent: data.amountCurrent || 0, // Current payment
      amountTotal: (data.amountPrevious || 0) + (data.amountCurrent || 0),
      
      // Linked records
      invoiceId: data.invoiceId,
      drawId: data.drawId,
      
      status: 'requested',
      requestedAt: new Date(),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      
      notes: data.notes,
    },
    include: {
      vendor: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true, number: true } },
    },
  });
}

/**
 * Get waivers for a project
 */
export async function getProjectWaivers(projectId, companyId, { status, vendorId } = {}) {
  const where = { projectId, companyId };
  if (status) where.status = status;
  if (vendorId) where.vendorId = vendorId;

  return prisma.lienWaiver.findMany({
    where,
    include: {
      vendor: { select: { id: true, name: true, company: true } },
    },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
  });
}

/**
 * Get all waivers for a company
 */
export async function getAllWaivers(companyId, { status, projectId, page = 1, limit = 50 } = {}) {
  const where = { companyId };
  if (status) where.status = status;
  if (projectId) where.projectId = projectId;

  const [waivers, total] = await Promise.all([
    prisma.lienWaiver.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, number: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.lienWaiver.count({ where }),
  ]);

  return {
    data: waivers,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Upload signed waiver
 */
export async function uploadSignedWaiver(waiverId, companyId, { documentUrl, signedDate, notarized = false }) {
  return prisma.lienWaiver.updateMany({
    where: { id: waiverId, companyId },
    data: {
      documentUrl,
      signedDate: signedDate ? new Date(signedDate) : new Date(),
      notarized,
      status: 'received',
      receivedAt: new Date(),
    },
  });
}

/**
 * Approve waiver
 */
export async function approveWaiver(waiverId, companyId, { approvedById, notes }) {
  return prisma.lienWaiver.updateMany({
    where: { id: waiverId, companyId, status: 'received' },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedById,
      approvalNotes: notes,
    },
  });
}

/**
 * Reject waiver
 */
export async function rejectWaiver(waiverId, companyId, { rejectedById, reason }) {
  return prisma.lienWaiver.updateMany({
    where: { id: waiverId, companyId },
    data: {
      status: 'rejected',
      rejectedAt: new Date(),
      rejectedById,
      rejectionReason: reason,
    },
  });
}

// ============================================
// COMPLIANCE TRACKING
// ============================================

/**
 * Get compliance status for a project
 */
export async function getProjectCompliance(projectId, companyId) {
  const waivers = await prisma.lienWaiver.findMany({
    where: { projectId, companyId },
    include: {
      vendor: { select: { id: true, name: true } },
    },
  });

  // Group by vendor
  const byVendor = {};
  
  for (const waiver of waivers) {
    const vendorKey = waiver.vendorId || waiver.vendorName;
    if (!byVendor[vendorKey]) {
      byVendor[vendorKey] = {
        vendorId: waiver.vendorId,
        vendorName: waiver.vendor?.name || waiver.vendorName,
        waivers: [],
        totalPaid: 0,
        totalWaived: 0,
        hasOutstanding: false,
        hasFinal: false,
      };
    }
    
    byVendor[vendorKey].waivers.push(waiver);
    
    if (waiver.status === 'approved') {
      byVendor[vendorKey].totalWaived += Number(waiver.amountTotal);
    }
    
    if (['requested', 'received'].includes(waiver.status)) {
      byVendor[vendorKey].hasOutstanding = true;
    }
    
    if (waiver.waiverType.includes('final') && waiver.status === 'approved') {
      byVendor[vendorKey].hasFinal = true;
    }
  }

  const vendors = Object.values(byVendor);
  
  // Summary stats
  const summary = {
    totalWaivers: waivers.length,
    approved: waivers.filter(w => w.status === 'approved').length,
    pending: waivers.filter(w => ['requested', 'received'].includes(w.status)).length,
    rejected: waivers.filter(w => w.status === 'rejected').length,
    
    vendorCount: vendors.length,
    vendorsComplete: vendors.filter(v => v.hasFinal).length,
    vendorsWithOutstanding: vendors.filter(v => v.hasOutstanding).length,
    
    isCompliant: vendors.every(v => !v.hasOutstanding),
    canClose: vendors.every(v => v.hasFinal && !v.hasOutstanding),
  };

  return { vendors, summary, waivers };
}

/**
 * Get outstanding waivers (overdue)
 */
export async function getOutstandingWaivers(companyId, { projectId } = {}) {
  const where = {
    companyId,
    status: { in: ['requested'] },
    dueDate: { lt: new Date() },
  };
  if (projectId) where.projectId = projectId;

  return prisma.lienWaiver.findMany({
    where,
    include: {
      vendor: { select: { id: true, name: true, email: true, phone: true } },
      project: { select: { id: true, name: true, number: true } },
    },
    orderBy: { dueDate: 'asc' },
  });
}

/**
 * Generate waiver document (PDF content)
 */
export function generateWaiverContent(waiver, company) {
  const isFinal = waiver.waiverType.includes('final');
  const isConditional = waiver.waiverType.includes('conditional');
  
  return {
    title: isConditional 
      ? `Conditional ${isFinal ? 'Final' : 'Partial'} Lien Waiver`
      : `Unconditional ${isFinal ? 'Final' : 'Partial'} Lien Waiver`,
    
    projectName: waiver.project?.name,
    projectAddress: waiver.project?.address,
    
    claimantName: waiver.vendor?.name || waiver.vendorName,
    
    throughDate: waiver.throughDate,
    amountPrevious: waiver.amountPrevious,
    amountCurrent: waiver.amountCurrent,
    amountTotal: waiver.amountTotal,
    
    isConditional,
    isFinal,
    
    legalText: isConditional
      ? `Upon receipt of payment in the sum of $${waiver.amountCurrent}, the undersigned waives and releases any and all lien or claim of lien against the above-described property.`
      : `The undersigned has received payment in full for all labor, services, equipment, or material furnished to the above-described property and hereby waives and releases any and all lien or claim of lien.`,
  };
}

export default {
  WAIVER_TYPES,
  WAIVER_STATUS,
  createWaiverRequest,
  getProjectWaivers,
  getAllWaivers,
  uploadSignedWaiver,
  approveWaiver,
  rejectWaiver,
  getProjectCompliance,
  getOutstandingWaivers,
  generateWaiverContent,
};
