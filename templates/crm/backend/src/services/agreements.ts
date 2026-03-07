/**
 * Service Agreements / Memberships Service (Drizzle)
 *
 * Recurring maintenance agreements:
 * - HVAC tune-ups, plumbing inspections, etc.
 * - Automatic renewal
 * - Visit scheduling
 * - Member discounts
 * - Revenue tracking
 */

import { db } from '../../db/index.ts';
import {
  serviceAgreement,
  agreementVisit,
  agreementPlan,
  contact,
  job,
  invoice,
  invoiceLineItem,
} from '../../db/schema.ts';
import { eq, and, lte, gte, count, asc, desc, sql } from 'drizzle-orm';

// ============================================
// AGREEMENT PLANS (Templates)
// ============================================

export async function getPlans(companyId: string, { active }: { active?: boolean | null } = {}) {
  const conditions = [eq(agreementPlan.companyId, companyId)];
  if (active !== null && active !== undefined) {
    conditions.push(eq(agreementPlan.active, active));
  }
  return db.select().from(agreementPlan).where(and(...conditions)).orderBy(asc(agreementPlan.name));
}

export async function createPlan(companyId: string, data: {
  name: string;
  description?: string;
  price: number;
  billingFrequency?: string;
  visitsIncluded?: number;
  discountPercent?: number;
  priorityService?: boolean;
  durationMonths?: number;
  autoRenew?: boolean;
  includedServices?: any;
}) {
  const [plan] = await db.insert(agreementPlan).values({
    companyId,
    name: data.name,
    description: data.description,
    price: String(data.price),
    billingFrequency: data.billingFrequency || 'annual',
    visitsIncluded: data.visitsIncluded || 0,
    discountPercent: data.discountPercent ? String(data.discountPercent) : '0',
    priorityService: data.priorityService || false,
    durationMonths: data.durationMonths || 12,
    autoRenew: data.autoRenew !== false,
    includedServices: data.includedServices,
  }).returning();
  return plan;
}

export async function updatePlan(planId: string, companyId: string, data: Record<string, unknown>) {
  const [updated] = await db.update(agreementPlan)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(agreementPlan.id, planId), eq(agreementPlan.companyId, companyId)))
    .returning();
  return updated;
}

// ============================================
// CUSTOMER AGREEMENTS
// ============================================

/**
 * Create agreement for customer
 */
export async function createAgreement(companyId: string, data: {
  contactId: string;
  name: string;
  number: string;
  startDate?: string;
  endDate?: string;
  billingFrequency?: string;
  amount: number;
  renewalType?: string;
  terms?: string;
  notes?: string;
  planId?: string;
}) {
  const startDate = data.startDate ? new Date(data.startDate) : new Date();

  const [agreement] = await db.insert(serviceAgreement).values({
    companyId,
    contactId: data.contactId,
    name: data.name,
    number: data.number,
    startDate,
    endDate: data.endDate ? new Date(data.endDate) : null,
    billingFrequency: data.billingFrequency || 'monthly',
    amount: String(data.amount),
    renewalType: data.renewalType || 'auto',
    terms: data.terms,
    notes: data.notes,
    planId: data.planId,
    status: 'active',
  }).returning();

  return agreement;
}

/**
 * Get agreements
 */
export async function getAgreements(companyId: string, {
  status,
  contactId,
  expiringSoon,
  page = 1,
  limit = 50,
}: {
  status?: string;
  contactId?: string;
  expiringSoon?: boolean;
  page?: number;
  limit?: number;
} = {}) {
  const conditions = [eq(serviceAgreement.companyId, companyId)];

  if (status) conditions.push(eq(serviceAgreement.status, status));
  if (contactId) conditions.push(eq(serviceAgreement.contactId, contactId));
  if (expiringSoon) {
    const thirtyDays = new Date();
    thirtyDays.setDate(thirtyDays.getDate() + 30);
    conditions.push(lte(serviceAgreement.endDate, thirtyDays));
    conditions.push(eq(serviceAgreement.status, 'active'));
  }

  const whereClause = and(...conditions);

  const [data, [{ value: total }]] = await Promise.all([
    db.select()
      .from(serviceAgreement)
      .where(whereClause)
      .orderBy(asc(serviceAgreement.endDate))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() })
      .from(serviceAgreement)
      .where(whereClause),
  ]);

  return {
    data,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Get single agreement with full details
 */
export async function getAgreement(agreementId: string, companyId: string) {
  const [result] = await db.select()
    .from(serviceAgreement)
    .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId)))
    .limit(1);

  if (!result) return null;

  // Fetch related visits
  const visits = await db.select()
    .from(agreementVisit)
    .where(eq(agreementVisit.agreementId, agreementId))
    .orderBy(desc(agreementVisit.scheduledDate));

  // Fetch related contact
  const [relatedContact] = await db.select()
    .from(contact)
    .where(eq(contact.id, result.contactId))
    .limit(1);

  return {
    ...result,
    visits,
    contact: relatedContact || null,
  };
}

/**
 * Update agreement
 */
export async function updateAgreement(agreementId: string, companyId: string, data: Record<string, unknown>) {
  const result = await db.update(serviceAgreement)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId)))
    .returning();
  return result;
}

/**
 * Cancel agreement
 */
export async function cancelAgreement(agreementId: string, companyId: string, _reason?: string) {
  // TODO: Cancel Stripe subscription if exists

  return db.update(serviceAgreement)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(and(eq(serviceAgreement.id, agreementId), eq(serviceAgreement.companyId, companyId)))
    .returning();
}

/**
 * Renew agreement
 */
export async function renewAgreement(agreementId: string, companyId: string) {
  const agreement = await getAgreement(agreementId, companyId);
  if (!agreement) throw new Error('Agreement not found');

  const startDate = agreement.endDate ? new Date(agreement.endDate) : new Date();
  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 1);

  const [renewed] = await db.update(serviceAgreement)
    .set({
      startDate,
      endDate,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(eq(serviceAgreement.id, agreementId))
    .returning();

  return renewed;
}

// ============================================
// VISITS
// ============================================

/**
 * Schedule visit for agreement
 */
export async function scheduleVisit(agreementId: string, companyId: string, data: {
  scheduledDate: string;
  serviceType?: string;
  notes?: string;
  createJob?: boolean;
}) {
  const agreement = await getAgreement(agreementId, companyId);
  if (!agreement) throw new Error('Agreement not found');

  const [visit] = await db.insert(agreementVisit).values({
    agreementId,
    scheduledDate: new Date(data.scheduledDate),
    notes: data.notes,
    status: 'scheduled',
  }).returning();

  // Create job for the visit
  if (data.createJob) {
    await db.insert(job).values({
      companyId,
      contactId: agreement.contactId,
      number: `JOB-AGR-${Date.now()}`,
      title: `${agreement.name} - ${data.serviceType || 'Maintenance Visit'}`,
      scheduledDate: new Date(data.scheduledDate),
      status: 'scheduled',
      notes: `Service Agreement: ${agreement.name}`,
    });
  }

  return visit;
}

/**
 * Complete visit
 */
export async function completeVisit(visitId: string, companyId: string, _data: {
  technicianNotes?: string;
}) {
  // Verify the visit belongs to this company's agreement
  const [visit] = await db.select()
    .from(agreementVisit)
    .where(eq(agreementVisit.id, visitId))
    .limit(1);

  if (!visit) throw new Error('Visit not found');

  const [agr] = await db.select()
    .from(serviceAgreement)
    .where(and(eq(serviceAgreement.id, visit.agreementId), eq(serviceAgreement.companyId, companyId)))
    .limit(1);

  if (!agr) throw new Error('Visit not found');

  const [updated] = await db.update(agreementVisit)
    .set({
      status: 'completed',
      completedAt: new Date(),
    })
    .where(eq(agreementVisit.id, visitId))
    .returning();

  return updated;
}

/**
 * Get upcoming visits (for scheduling)
 */
export async function getUpcomingVisits(companyId: string, { days = 30 }: { days?: number } = {}) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);

  // Get agreement IDs for this company
  const agreements = await db.select({ id: serviceAgreement.id })
    .from(serviceAgreement)
    .where(eq(serviceAgreement.companyId, companyId));

  const agreementIds = agreements.map(a => a.id);
  if (agreementIds.length === 0) return [];

  const visits = await db.select()
    .from(agreementVisit)
    .where(and(
      eq(agreementVisit.status, 'scheduled'),
      lte(agreementVisit.scheduledDate, endDate),
      sql`${agreementVisit.agreementId} = ANY(${agreementIds})`,
    ))
    .orderBy(asc(agreementVisit.scheduledDate));

  return visits;
}

// ============================================
// BILLING
// ============================================

/**
 * Get agreements due for billing
 */
export async function getAgreementsDueForBilling(companyId: string) {
  return db.select()
    .from(serviceAgreement)
    .where(and(
      eq(serviceAgreement.companyId, companyId),
      eq(serviceAgreement.status, 'active'),
    ));
}

/**
 * Process billing for agreement
 */
export async function processAgreementBilling(agreementId: string, companyId: string) {
  const agreement = await getAgreement(agreementId, companyId);
  if (!agreement) throw new Error('Agreement not found');

  // Create invoice
  const [inv] = await db.insert(invoice).values({
    companyId,
    contactId: agreement.contactId,
    number: `INV-AGR-${Date.now()}`,
    status: 'sent',
    issueDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    subtotal: String(agreement.amount),
    total: String(agreement.amount),
  }).returning();

  // Create line item
  await db.insert(invoiceLineItem).values({
    invoiceId: inv.id,
    description: `${agreement.name} - ${agreement.billingFrequency} billing`,
    quantity: '1',
    unitPrice: String(agreement.amount),
    total: String(agreement.amount),
  });

  return inv;
}

// ============================================
// REPORTS
// ============================================

/**
 * Get agreement stats
 */
export async function getAgreementStats(companyId: string) {
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const [
    [{ value: active }],
    [{ value: expiring }],
  ] = await Promise.all([
    db.select({ value: count() })
      .from(serviceAgreement)
      .where(and(eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active'))),
    db.select({ value: count() })
      .from(serviceAgreement)
      .where(and(
        eq(serviceAgreement.companyId, companyId),
        eq(serviceAgreement.status, 'active'),
        lte(serviceAgreement.endDate, thirtyDaysFromNow),
      )),
  ]);

  // Calculate MRR
  const agreements = await db.select({
    amount: serviceAgreement.amount,
    billingFrequency: serviceAgreement.billingFrequency,
  })
    .from(serviceAgreement)
    .where(and(eq(serviceAgreement.companyId, companyId), eq(serviceAgreement.status, 'active')));

  let monthlyRecurring = 0;
  for (const a of agreements) {
    const price = Number(a.amount);
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
export async function getExpiringAgreements(companyId: string, daysAhead = 60) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + daysAhead);

  return db.select()
    .from(serviceAgreement)
    .where(and(
      eq(serviceAgreement.companyId, companyId),
      eq(serviceAgreement.status, 'active'),
      lte(serviceAgreement.endDate, endDate),
      eq(serviceAgreement.renewalType, 'manual'),
    ))
    .orderBy(asc(serviceAgreement.endDate));
}

export default {
  getPlans,
  createPlan,
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
