/**
 * Draw Schedules Service
 * 
 * AIA-style progress billing for construction loans:
 * - Schedule of Values (SOV)
 * - Draw requests with percent complete
 * - Retainage tracking
 * - G702/G703 document generation
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// SCHEDULE OF VALUES (SOV)
// ============================================

/**
 * Create Schedule of Values for a project
 */
export async function createScheduleOfValues(companyId, projectId, data) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
  });

  if (!project) throw new Error('Project not found');

  // Create SOV with line items
  const sov = await prisma.scheduleOfValues.create({
    data: {
      companyId,
      projectId,
      
      contractAmount: data.contractAmount,
      retainagePercent: data.retainagePercent || 10, // Default 10%
      
      status: 'draft',
      
      lineItems: {
        create: data.lineItems.map((item, index) => ({
          companyId,
          itemNumber: item.itemNumber || String(index + 1).padStart(3, '0'),
          description: item.description,
          scheduledValue: item.scheduledValue,
          sortOrder: index,
        })),
      },
    },
    include: {
      lineItems: { orderBy: { sortOrder: 'asc' } },
    },
  });

  return sov;
}

/**
 * Get Schedule of Values for a project
 */
export async function getScheduleOfValues(projectId, companyId) {
  const sov = await prisma.scheduleOfValues.findFirst({
    where: { projectId, companyId },
    include: {
      lineItems: {
        orderBy: { sortOrder: 'asc' },
      },
      draws: {
        orderBy: { drawNumber: 'asc' },
        include: {
          lineItems: true,
        },
      },
    },
  });

  if (!sov) return null;

  // Calculate totals for each line item
  const lineItemsWithProgress = sov.lineItems.map(item => {
    const draws = sov.draws.flatMap(d => 
      d.lineItems.filter(li => li.sovLineItemId === item.id)
    );

    const previouslyBilled = draws
      .filter(d => d.draw?.status === 'approved')
      .reduce((sum, d) => sum + Number(d.completedThisPeriod || 0), 0);

    const totalCompleted = draws.reduce(
      (sum, d) => sum + Number(d.completedThisPeriod || 0), 0
    );

    const percentComplete = Number(item.scheduledValue) > 0
      ? (totalCompleted / Number(item.scheduledValue)) * 100
      : 0;

    return {
      ...item,
      previouslyBilled,
      totalCompleted,
      percentComplete: Math.round(percentComplete * 10) / 10,
      remaining: Number(item.scheduledValue) - totalCompleted,
    };
  });

  // Calculate SOV totals
  const totals = {
    contractAmount: Number(sov.contractAmount),
    totalBilled: lineItemsWithProgress.reduce((sum, i) => sum + i.totalCompleted, 0),
    totalRemaining: lineItemsWithProgress.reduce((sum, i) => sum + i.remaining, 0),
    percentComplete: 0,
  };

  totals.percentComplete = totals.contractAmount > 0
    ? Math.round((totals.totalBilled / totals.contractAmount) * 1000) / 10
    : 0;

  return {
    ...sov,
    lineItems: lineItemsWithProgress,
    totals,
  };
}

/**
 * Update SOV line item
 */
export async function updateSOVLineItem(lineItemId, companyId, data) {
  return prisma.sOVLineItem.updateMany({
    where: { id: lineItemId, companyId },
    data,
  });
}

/**
 * Add line item to SOV
 */
export async function addSOVLineItem(sovId, companyId, data) {
  const sov = await prisma.scheduleOfValues.findFirst({
    where: { id: sovId, companyId },
    include: { lineItems: true },
  });

  if (!sov) throw new Error('SOV not found');

  const maxOrder = Math.max(...sov.lineItems.map(i => i.sortOrder), 0);

  return prisma.sOVLineItem.create({
    data: {
      companyId,
      scheduleOfValuesId: sovId,
      itemNumber: data.itemNumber || String(sov.lineItems.length + 1).padStart(3, '0'),
      description: data.description,
      scheduledValue: data.scheduledValue,
      sortOrder: maxOrder + 1,
    },
  });
}

// ============================================
// DRAW REQUESTS
// ============================================

/**
 * Create a new draw request
 */
export async function createDrawRequest(companyId, sovId, data) {
  const sov = await prisma.scheduleOfValues.findFirst({
    where: { id: sovId, companyId },
    include: {
      lineItems: true,
      draws: { orderBy: { drawNumber: 'desc' }, take: 1 },
    },
  });

  if (!sov) throw new Error('Schedule of Values not found');

  const nextDrawNumber = (sov.draws[0]?.drawNumber || 0) + 1;

  // Create draw with line item progress
  const draw = await prisma.drawRequest.create({
    data: {
      companyId,
      scheduleOfValuesId: sovId,
      projectId: sov.projectId,
      
      drawNumber: nextDrawNumber,
      periodFrom: data.periodFrom ? new Date(data.periodFrom) : null,
      periodTo: data.periodTo ? new Date(data.periodTo) : new Date(),
      
      status: 'draft',
      
      // Will be calculated
      grossAmount: 0,
      retainageAmount: 0,
      netAmount: 0,
      
      lineItems: {
        create: data.lineItems.map(item => ({
          companyId,
          sovLineItemId: item.sovLineItemId,
          completedThisPeriod: item.completedThisPeriod || 0,
        })),
      },
    },
    include: {
      lineItems: {
        include: {
          sovLineItem: true,
        },
      },
    },
  });

  // Calculate totals
  const totals = calculateDrawTotals(draw, sov.retainagePercent);

  // Update with calculated amounts
  await prisma.drawRequest.update({
    where: { id: draw.id },
    data: {
      grossAmount: totals.grossAmount,
      retainageAmount: totals.retainageAmount,
      netAmount: totals.netAmount,
    },
  });

  return { ...draw, ...totals };
}

/**
 * Update draw request line items
 */
export async function updateDrawRequest(drawId, companyId, data) {
  const draw = await prisma.drawRequest.findFirst({
    where: { id: drawId, companyId },
    include: {
      scheduleOfValues: true,
      lineItems: true,
    },
  });

  if (!draw) throw new Error('Draw request not found');
  if (draw.status === 'approved') throw new Error('Cannot modify approved draw');

  // Update line items
  for (const item of data.lineItems || []) {
    await prisma.drawLineItem.updateMany({
      where: { id: item.id, companyId },
      data: { completedThisPeriod: item.completedThisPeriod },
    });
  }

  // Recalculate totals
  const updatedDraw = await prisma.drawRequest.findFirst({
    where: { id: drawId },
    include: { lineItems: true, scheduleOfValues: true },
  });

  const totals = calculateDrawTotals(updatedDraw, updatedDraw.scheduleOfValues.retainagePercent);

  await prisma.drawRequest.update({
    where: { id: drawId },
    data: {
      grossAmount: totals.grossAmount,
      retainageAmount: totals.retainageAmount,
      netAmount: totals.netAmount,
      periodFrom: data.periodFrom ? new Date(data.periodFrom) : draw.periodFrom,
      periodTo: data.periodTo ? new Date(data.periodTo) : draw.periodTo,
    },
  });

  return { success: true };
}

/**
 * Calculate draw totals
 */
function calculateDrawTotals(draw, retainagePercent) {
  const grossAmount = draw.lineItems.reduce(
    (sum, item) => sum + Number(item.completedThisPeriod || 0), 0
  );

  const retainageRate = Number(retainagePercent || 10) / 100;
  const retainageAmount = grossAmount * retainageRate;
  const netAmount = grossAmount - retainageAmount;

  return {
    grossAmount: Math.round(grossAmount * 100) / 100,
    retainageAmount: Math.round(retainageAmount * 100) / 100,
    netAmount: Math.round(netAmount * 100) / 100,
  };
}

/**
 * Submit draw for approval
 */
export async function submitDrawRequest(drawId, companyId) {
  const draw = await prisma.drawRequest.findFirst({
    where: { id: drawId, companyId, status: 'draft' },
  });

  if (!draw) throw new Error('Draw not found or already submitted');

  return prisma.drawRequest.update({
    where: { id: drawId },
    data: {
      status: 'submitted',
      submittedAt: new Date(),
    },
  });
}

/**
 * Approve draw request
 */
export async function approveDrawRequest(drawId, companyId, { approvedById, notes }) {
  const draw = await prisma.drawRequest.findFirst({
    where: { id: drawId, companyId, status: 'submitted' },
  });

  if (!draw) throw new Error('Draw not found or not submitted');

  return prisma.drawRequest.update({
    where: { id: drawId },
    data: {
      status: 'approved',
      approvedAt: new Date(),
      approvedById,
      approvalNotes: notes,
    },
  });
}

/**
 * Reject draw request
 */
export async function rejectDrawRequest(drawId, companyId, { rejectedById, reason }) {
  return prisma.drawRequest.updateMany({
    where: { id: drawId, companyId },
    data: {
      status: 'rejected',
      rejectedAt: new Date(),
      rejectedById,
      rejectionReason: reason,
    },
  });
}

/**
 * Get all draws for a project
 */
export async function getProjectDraws(projectId, companyId) {
  return prisma.drawRequest.findMany({
    where: { projectId, companyId },
    orderBy: { drawNumber: 'asc' },
    include: {
      lineItems: {
        include: {
          sovLineItem: { select: { itemNumber: true, description: true } },
        },
      },
    },
  });
}

/**
 * Get single draw with full details
 */
export async function getDrawRequest(drawId, companyId) {
  return prisma.drawRequest.findFirst({
    where: { id: drawId, companyId },
    include: {
      scheduleOfValues: {
        include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
      },
      lineItems: {
        include: {
          sovLineItem: true,
        },
      },
      project: { select: { id: true, name: true, number: true, address: true } },
    },
  });
}

// ============================================
// G702/G703 GENERATION
// ============================================

/**
 * Generate G702 (Application and Certificate for Payment) data
 */
export async function generateG702Data(drawId, companyId) {
  const draw = await getDrawRequest(drawId, companyId);
  if (!draw) throw new Error('Draw not found');

  const sov = draw.scheduleOfValues;
  const project = draw.project;

  // Get all previous draws
  const allDraws = await prisma.drawRequest.findMany({
    where: {
      scheduleOfValuesId: sov.id,
      drawNumber: { lt: draw.drawNumber },
      status: 'approved',
    },
    include: { lineItems: true },
  });

  // Calculate previous totals
  const previousGross = allDraws.reduce((sum, d) => sum + Number(d.grossAmount || 0), 0);
  const previousRetainage = allDraws.reduce((sum, d) => sum + Number(d.retainageAmount || 0), 0);
  const previousNet = allDraws.reduce((sum, d) => sum + Number(d.netAmount || 0), 0);

  return {
    applicationNumber: draw.drawNumber,
    periodTo: draw.periodTo,
    projectName: project?.name,
    projectAddress: project?.address,
    
    originalContractSum: Number(sov.contractAmount),
    netChangeByChangeOrders: 0, // TODO: link to change orders
    contractSumToDate: Number(sov.contractAmount),
    
    totalCompletedAndStored: previousGross + Number(draw.grossAmount),
    retainagePercent: Number(sov.retainagePercent),
    totalRetainage: previousRetainage + Number(draw.retainageAmount),
    
    totalEarnedLessRetainage: (previousGross + Number(draw.grossAmount)) - (previousRetainage + Number(draw.retainageAmount)),
    lessPreviousCertificates: previousNet,
    currentPaymentDue: Number(draw.netAmount),
    
    balanceToFinish: Number(sov.contractAmount) - (previousGross + Number(draw.grossAmount)),
  };
}

/**
 * Generate G703 (Continuation Sheet) data
 */
export async function generateG703Data(drawId, companyId) {
  const draw = await getDrawRequest(drawId, companyId);
  if (!draw) throw new Error('Draw not found');

  const sov = draw.scheduleOfValues;

  // Get all approved draws for calculating previous work
  const previousDraws = await prisma.drawRequest.findMany({
    where: {
      scheduleOfValuesId: sov.id,
      drawNumber: { lt: draw.drawNumber },
      status: 'approved',
    },
    include: { lineItems: true },
  });

  // Build continuation sheet data
  const lineItems = sov.lineItems.map(sovItem => {
    // Previous work completed
    const previousWork = previousDraws.reduce((sum, d) => {
      const lineItem = d.lineItems.find(li => li.sovLineItemId === sovItem.id);
      return sum + Number(lineItem?.completedThisPeriod || 0);
    }, 0);

    // This period
    const currentItem = draw.lineItems.find(li => li.sovLineItemId === sovItem.id);
    const thisPeriod = Number(currentItem?.completedThisPeriod || 0);

    // Totals
    const totalCompleted = previousWork + thisPeriod;
    const scheduledValue = Number(sovItem.scheduledValue);
    const percentComplete = scheduledValue > 0 ? (totalCompleted / scheduledValue) * 100 : 0;
    const balanceToFinish = scheduledValue - totalCompleted;

    return {
      itemNumber: sovItem.itemNumber,
      description: sovItem.description,
      scheduledValue,
      previousWork,
      thisPeriod,
      materialsStored: 0, // TODO: support materials presently stored
      totalCompleted,
      percentComplete: Math.round(percentComplete * 10) / 10,
      balanceToFinish,
      retainage: totalCompleted * (Number(sov.retainagePercent) / 100),
    };
  });

  // Grand totals
  const grandTotals = lineItems.reduce((totals, item) => ({
    scheduledValue: totals.scheduledValue + item.scheduledValue,
    previousWork: totals.previousWork + item.previousWork,
    thisPeriod: totals.thisPeriod + item.thisPeriod,
    materialsStored: totals.materialsStored + item.materialsStored,
    totalCompleted: totals.totalCompleted + item.totalCompleted,
    balanceToFinish: totals.balanceToFinish + item.balanceToFinish,
    retainage: totals.retainage + item.retainage,
  }), {
    scheduledValue: 0, previousWork: 0, thisPeriod: 0, materialsStored: 0,
    totalCompleted: 0, balanceToFinish: 0, retainage: 0,
  });

  grandTotals.percentComplete = grandTotals.scheduledValue > 0
    ? Math.round((grandTotals.totalCompleted / grandTotals.scheduledValue) * 1000) / 10
    : 0;

  return {
    applicationNumber: draw.drawNumber,
    periodTo: draw.periodTo,
    lineItems,
    grandTotals,
  };
}

export default {
  createScheduleOfValues,
  getScheduleOfValues,
  updateSOVLineItem,
  addSOVLineItem,
  createDrawRequest,
  updateDrawRequest,
  submitDrawRequest,
  approveDrawRequest,
  rejectDrawRequest,
  getProjectDraws,
  getDrawRequest,
  generateG702Data,
  generateG703Data,
};
