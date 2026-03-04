/**
 * Service Agreements / Memberships Service
 * 
 * Recurring maintenance agreements:
 * - HVAC tune-ups, plumbing inspections, etc.
 * - Automatic renewal
 * - Visit scheduling
 * - Member discounts
 * - Revenue tracking
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// AGREEMENT PLANS (Templates)
// ============================================

/**
 * Create agreement plan template
 */
export async function createPlan(companyId, data) {
  return prisma.agreementPlan.create({
    data: {
      companyId,
      name: data.name,
      description: data.description,
      
      // Pricing
      price: data.price,
      billingFrequency: data.billingFrequency || 'annual', // monthly, quarterly, annual
      
      // Benefits
      visitsIncluded: data.visitsIncluded || 0,
      discountPercent: data.discountPercent || 0,
      priorityService: data.priorityService || false,
      
      // Renewal
      durationMonths: data.durationMonths || 12,
      autoRenew: data.autoRenew ?? true,
      
      // Services included
      includedServices: data.includedServices, // JSON array of pricebook item IDs
      
      active: true,
    },
  });
}

/**
 * Get all plans
 */
export async function getPlans(companyId, { active = true } = {}) {
  const where = { companyId };
  if (active !== null) where.active = active;

  return prisma.agreementPlan.findMany({
    where,
    include: {
      _count: { select: { agreements: true } },
    },
    orderBy: { price: 'asc' },
  });
}

/**
 * Update plan
 */
export async function updatePlan(planId, companyId, data) {
  return prisma.agreementPlan.updateMany({
    where: { id: planId, companyId },
    data,
  });
}

// ============================================
// CUSTOMER AGREEMENTS
// ============================================

/**
 * Create agreement for customer
 */
export async function createAgreement(companyId, data) {
  const plan = await prisma.agreementPlan.findFirst({
    where: { id: data.planId, companyId },
  });

  if (!plan) throw new Error('Plan not found');

  // Calculate dates
  const startDate = data.startDate ? new Date(data.startDate) : new Date();
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + plan.durationMonths);

  // Calculate next billing date
  const nextBillingDate = new Date(startDate);
  if (plan.billingFrequency === 'monthly') {
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
  } else if (plan.billingFrequency === 'quarterly') {
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
  } else {
    nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
  }

  const agreement = await prisma.serviceAgreement.create({
    data: {
      companyId,
      planId: plan.id,
      contactId: data.contactId,
      propertyId: data.propertyId,
      
      // Dates
      startDate,
      endDate,
      nextBillingDate,
      
      // Pricing (copy from plan, can be overridden)
      price: data.price || plan.price,
      billingFrequency: plan.billingFrequency,
      
      // Benefits
      visitsRemaining: plan.visitsIncluded,
      discountPercent: data.discountPercent || plan.discountPercent,
      
      // Status
      status: 'active',
      autoRenew: data.autoRenew ?? plan.autoRenew,
      
      // Payment
      paymentMethod: data.paymentMethod,
      stripeSubscriptionId: data.stripeSubscriptionId,
    },
    include: {
      plan: true,
      contact: true,
    },
  });

  return agreement;
}

/**
 * Get agreements
 */
export async function getAgreements(companyId, {
  status,
  contactId,
  expiringSoon,
  page = 1,
  limit = 50,
} = {}) {
  const where = { companyId };

  if (status) where.status = status;
  if (contactId) where.contactId = contactId;
  if (expiringSoon) {
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    where.endDate = { lte: thirtyDays };
    where.status = 'active';
  }

  const [data, total] = await Promise.all([
    prisma.serviceAgreement.findMany({
      where,
      include: {
        plan: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, email: true, phone: true } },
        _count: { select: { visits: true } },
      },
      orderBy: { endDate: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.serviceAgreement.count({ where }),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single agreement with full details
 */
export async function getAgreement(agreementId, companyId) {
  return prisma.serviceAgreement.findFirst({
    where: { id: agreementId, companyId },
    include: {
      plan: true,
      contact: true,
      visits: {
        include: {
          job: { select: { id: true, title: true, number: true, status: true } },
        },
        orderBy: { scheduledDate: 'desc' },
      },
      invoices: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
}

/**
 * Update agreement
 */
export async function updateAgreement(agreementId, companyId, data) {
  return prisma.serviceAgreement.updateMany({
    where: { id: agreementId, companyId },
    data,
  });
}

/**
 * Cancel agreement
 */
export async function cancelAgreement(agreementId, companyId, reason) {
  // TODO: Cancel Stripe subscription if exists
  
  return prisma.serviceAgreement.updateMany({
    where: { id: agreementId, companyId },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelReason: reason,
      autoRenew: false,
    },
  });
}

/**
 * Renew agreement
 */
export async function renewAgreement(agreementId, companyId) {
  const agreement = await getAgreement(agreementId, companyId);
  if (!agreement) throw new Error('Agreement not found');

  const plan = agreement.plan;
  
  // Calculate new dates
  const startDate = new Date(agreement.endDate);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + plan.durationMonths);

  // Create renewal
  return prisma.serviceAgreement.update({
    where: { id: agreementId },
    data: {
      startDate,
      endDate,
      status: 'active',
      visitsRemaining: plan.visitsIncluded,
      renewedAt: new Date(),
      renewalCount: { increment: 1 },
    },
  });
}

// ============================================
// VISITS
// ============================================

/**
 * Schedule visit for agreement
 */
export async function scheduleVisit(agreementId, companyId, data) {
  const agreement = await getAgreement(agreementId, companyId);
  if (!agreement) throw new Error('Agreement not found');

  if (agreement.visitsRemaining <= 0) {
    throw new Error('No visits remaining on this agreement');
  }

  // Create visit record
  const visit = await prisma.agreementVisit.create({
    data: {
      agreementId,
      scheduledDate: new Date(data.scheduledDate),
      serviceType: data.serviceType,
      notes: data.notes,
      status: 'scheduled',
    },
  });

  // Create job for the visit
  if (data.createJob) {
    const job = await prisma.job.create({
      data: {
        companyId,
        contactId: agreement.contactId,
        title: `${agreement.plan.name} - ${data.serviceType || 'Maintenance Visit'}`,
        scheduledDate: new Date(data.scheduledDate),
        status: 'scheduled',
        agreementVisitId: visit.id,
        // Apply member discount
        notes: `Service Agreement: ${agreement.plan.name}\nMember Discount: ${agreement.discountPercent}%`,
      },
    });

    // Link job to visit
    await prisma.agreementVisit.update({
      where: { id: visit.id },
      data: { jobId: job.id },
    });
  }

  // Decrement visits remaining
  await prisma.serviceAgreement.update({
    where: { id: agreementId },
    data: { visitsRemaining: { decrement: 1 } },
  });

  return visit;
}

/**
 * Complete visit
 */
export async function completeVisit(visitId, companyId, data) {
  const visit = await prisma.agreementVisit.findFirst({
    where: { id: visitId },
    include: { agreement: true },
  });

  if (!visit || visit.agreement.companyId !== companyId) {
    throw new Error('Visit not found');
  }

  return prisma.agreementVisit.update({
    where: { id: visitId },
    data: {
      status: 'completed',
      completedDate: new Date(),
      technicianNotes: data.technicianNotes,
    },
  });
}

/**
 * Get upcoming visits (for scheduling)
 */
export async function getUpcomingVisits(companyId, { days = 30 } = {}) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);

  return prisma.agreementVisit.findMany({
    where: {
      agreement: { companyId },
      status: 'scheduled',
      scheduledDate: { lte: endDate },
    },
    include: {
      agreement: {
        include: {
          contact: { select: { name: true, phone: true } },
          plan: { select: { name: true } },
        },
      },
    },
    orderBy: { scheduledDate: 'asc' },
  });
}

// ============================================
// BILLING
// ============================================

/**
 * Get agreements due for billing
 */
export async function getAgreementsDueForBilling(companyId) {
  const today = new Date();
  
  return prisma.serviceAgreement.findMany({
    where: {
      companyId,
      status: 'active',
      nextBillingDate: { lte: today },
    },
    include: {
      plan: true,
      contact: true,
    },
  });
}

/**
 * Process billing for agreement
 */
export async function processAgreementBilling(agreementId, companyId) {
  const agreement = await getAgreement(agreementId, companyId);
  if (!agreement) throw new Error('Agreement not found');

  // Create invoice
  const invoice = await prisma.invoice.create({
    data: {
      companyId,
      contactId: agreement.contactId,
      agreementId,
      status: 'sent',
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      subtotal: agreement.price,
      total: agreement.price,
      items: {
        create: [{
          description: `${agreement.plan.name} - ${agreement.billingFrequency} billing`,
          quantity: 1,
          unitPrice: agreement.price,
          total: agreement.price,
        }],
      },
    },
  });

  // Calculate next billing date
  const nextBillingDate = new Date(agreement.nextBillingDate);
  if (agreement.billingFrequency === 'monthly') {
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
  } else if (agreement.billingFrequency === 'quarterly') {
    nextBillingDate.setMonth(nextBillingDate.getMonth() + 3);
  } else {
    nextBillingDate.setFullYear(nextBillingDate.getFullYear() + 1);
  }

  // Update agreement
  await prisma.serviceAgreement.update({
    where: { id: agreementId },
    data: {
      nextBillingDate,
      lastBilledAt: new Date(),
    },
  });

  return invoice;
}

// ============================================
// REPORTS
// ============================================

/**
 * Get agreement stats
 */
export async function getAgreementStats(companyId) {
  const [active, expiring, mrr, renewalRate] = await Promise.all([
    prisma.serviceAgreement.count({
      where: { companyId, status: 'active' },
    }),
    prisma.serviceAgreement.count({
      where: {
        companyId,
        status: 'active',
        endDate: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.serviceAgreement.aggregate({
      where: { companyId, status: 'active' },
      _sum: { price: true },
    }),
    // Simplified renewal rate calculation
    prisma.serviceAgreement.groupBy({
      by: ['status'],
      where: { companyId },
      _count: true,
    }),
  ]);

  // Calculate MRR (normalize all to monthly)
  const agreements = await prisma.serviceAgreement.findMany({
    where: { companyId, status: 'active' },
    select: { price: true, billingFrequency: true },
  });

  let monthlyRecurring = 0;
  for (const a of agreements) {
    const price = Number(a.price);
    if (a.billingFrequency === 'monthly') {
      monthlyRecurring += price;
    } else if (a.billingFrequency === 'quarterly') {
      monthlyRecurring += price / 3;
    } else {
      monthlyRecurring += price / 12;
    }
  }

  return {
    activeAgreements: active,
    expiringIn30Days: expiring,
    monthlyRecurringRevenue: Math.round(monthlyRecurring * 100) / 100,
    annualRecurringRevenue: Math.round(monthlyRecurring * 12 * 100) / 100,
  };
}

/**
 * Get expiring agreements for outreach
 */
export async function getExpiringAgreements(companyId, daysAhead = 60) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysAhead);

  return prisma.serviceAgreement.findMany({
    where: {
      companyId,
      status: 'active',
      endDate: { lte: endDate },
      autoRenew: false,
    },
    include: {
      plan: true,
      contact: true,
    },
    orderBy: { endDate: 'asc' },
  });
}

export default {
  createPlan,
  getPlans,
  updatePlan,
  createAgreement,
  getAgreements,
  getAgreement,
  updateAgreement,
  cancelAgreement,
  renewAgreement,
  scheduleVisit,
  completeVisit,
  getUpcomingVisits,
  getAgreementsDueForBilling,
  processAgreementBilling,
  getAgreementStats,
  getExpiringAgreements,
};
