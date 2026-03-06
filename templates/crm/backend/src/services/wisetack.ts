/**
 * Wisetack Consumer Financing Service (Drizzle)
 *
 * Integration with Wisetack for consumer financing:
 * - Create loan applications
 * - Check loan status
 * - Handle webhooks for approvals
 * - Embed financing widget in quotes/invoices
 *
 * API Docs: https://docs.wisetack.com
 */

import { db } from '../../db/index.ts';
import {
  company,
  contact,
  financingApplication,
  invoice,
  oauthState,
} from '../../db/schema.ts';
import { eq, and, or, desc } from 'drizzle-orm';
import crypto from 'crypto';

const WISETACK_API_URL = process.env.WISETACK_API_URL || 'https://api.wisetack.com/v1';
const WISETACK_PARTNER_ID = process.env.WISETACK_PARTNER_ID;
const WISETACK_API_KEY = process.env.WISETACK_API_KEY;
const WISETACK_WEBHOOK_SECRET = process.env.WISETACK_WEBHOOK_SECRET;

/**
 * Make authenticated request to Wisetack API
 */
async function wisetackRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${WISETACK_API_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WISETACK_API_KEY}`,
      'X-Partner-ID': WISETACK_PARTNER_ID || '',
      ...(options.headers as Record<string, string>),
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || `Wisetack API error: ${response.status}`);
  }

  return data;
}

/**
 * Create a loan application (pre-qualification)
 */
export async function createLoanApplication({
  companyId,
  quoteId,
  invoiceId,
  contactId,
  amount,
  customerInfo,
}: {
  companyId: string;
  quoteId?: string;
  invoiceId?: string;
  contactId: string;
  amount: number;
  customerInfo?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
}) {
  // Get company's Wisetack merchant ID from settings JSON
  const [companyRow] = await db.select({ settings: company.settings, name: company.name })
    .from(company).where(eq(company.id, companyId)).limit(1);

  const settings = (companyRow?.settings as any) || {};
  if (!settings.wisetackMerchantId) {
    throw new Error('Company not connected to Wisetack');
  }

  // Get contact info
  const [contactRow] = await db.select().from(contact)
    .where(eq(contact.id, contactId)).limit(1);

  // Create application with Wisetack
  const application = await wisetackRequest('/applications', {
    method: 'POST',
    body: JSON.stringify({
      merchant_id: settings.wisetackMerchantId,
      amount: Math.round(amount * 100), // Convert to cents
      customer: {
        first_name: customerInfo?.firstName || contactRow?.name?.split(' ')[0] || '',
        last_name: customerInfo?.lastName || contactRow?.name?.split(' ').slice(1).join(' ') || '',
        email: customerInfo?.email || contactRow?.email,
        phone: customerInfo?.phone || contactRow?.phone,
        address: {
          street: customerInfo?.address || contactRow?.address,
          city: customerInfo?.city || contactRow?.city,
          state: customerInfo?.state || contactRow?.state,
          zip: customerInfo?.zip || contactRow?.zip,
        },
      },
      metadata: {
        company_id: companyId,
        quote_id: quoteId,
        invoice_id: invoiceId,
        contact_id: contactId,
      },
    }),
  });

  // Save application to database
  const [savedApp] = await db.insert(financingApplication).values({
    companyId,
    contactId,
    externalId: application.id,
    amount: String(amount),
    status: application.status || 'pending',
    applicationUrl: application.application_url,
  }).returning();

  return {
    id: savedApp.id,
    applicationId: application.id,
    applicationUrl: application.application_url,
    status: application.status,
    expiresAt: application.expires_at,
  };
}

/**
 * Get loan application status
 */
export async function getApplicationStatus(applicationId: string) {
  // Try to find by id or externalId
  const [appById] = await db.select().from(financingApplication)
    .where(eq(financingApplication.id, applicationId)).limit(1);

  let appRow = appById;
  if (!appRow) {
    const [appByExternal] = await db.select().from(financingApplication)
      .where(eq(financingApplication.externalId, applicationId)).limit(1);
    appRow = appByExternal;
  }

  if (!appRow) {
    throw new Error('Application not found');
  }

  // Fetch latest status from Wisetack
  try {
    const wisetackApp = await wisetackRequest(`/applications/${appRow.externalId}`);

    // Update local record
    await db.update(financingApplication).set({
      status: wisetackApp.status,
      approvedAmount: wisetackApp.approved_amount ? String(wisetackApp.approved_amount / 100) : null,
      term: wisetackApp.term_months || null,
      updatedAt: new Date(),
    }).where(eq(financingApplication.id, appRow.id));

    return {
      id: appRow.id,
      status: wisetackApp.status,
      approvedAmount: wisetackApp.approved_amount ? wisetackApp.approved_amount / 100 : null,
      apr: wisetackApp.apr,
      termMonths: wisetackApp.term_months,
      monthlyPayment: wisetackApp.monthly_payment ? wisetackApp.monthly_payment / 100 : null,
      applicationUrl: appRow.applicationUrl,
    };
  } catch (error) {
    // Return cached data if API fails
    return {
      id: appRow.id,
      status: appRow.status,
      approvedAmount: appRow.approvedAmount ? Number(appRow.approvedAmount) : null,
      termMonths: appRow.term,
      applicationUrl: appRow.applicationUrl,
      cached: true,
    };
  }
}

/**
 * Get applications for a quote or invoice
 */
export async function getApplicationsFor(
  companyId: string,
  { quoteId, invoiceId, contactId }: { quoteId?: string; invoiceId?: string; contactId?: string },
) {
  const conditions: any[] = [eq(financingApplication.companyId, companyId)];
  if (contactId) conditions.push(eq(financingApplication.contactId, contactId));

  const apps = await db.select().from(financingApplication)
    .where(and(...conditions))
    .orderBy(desc(financingApplication.createdAt));

  // Fetch related contact data
  const result = [];
  for (const app of apps) {
    const [contactRow] = await db.select({ id: contact.id, name: contact.name, email: contact.email })
      .from(contact).where(eq(contact.id, app.contactId)).limit(1);

    result.push({
      ...app,
      contact: contactRow ?? null,
    });
  }

  return result;
}

/**
 * Process webhook from Wisetack
 */
export async function processWebhook(payload: any, signature: string) {
  // Verify webhook signature
  if (WISETACK_WEBHOOK_SECRET) {
    const expectedSignature = crypto
      .createHmac('sha256', WISETACK_WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (signature !== expectedSignature) {
      throw new Error('Invalid webhook signature');
    }
  }

  const { event, data } = payload;

  // Find the application by externalId
  const [app] = await db.select().from(financingApplication)
    .where(eq(financingApplication.externalId, data.application_id)).limit(1);

  if (!app) {
    console.warn('Webhook for unknown application:', data.application_id);
    return { processed: false, reason: 'Application not found' };
  }

  // Handle different events
  switch (event) {
    case 'application.approved':
      await db.update(financingApplication).set({
        status: 'approved',
        approvedAmount: data.approved_amount ? String(data.approved_amount / 100) : null,
        term: data.term_months || null,
        updatedAt: new Date(),
      }).where(eq(financingApplication.id, app.id));
      break;

    case 'application.declined':
      await db.update(financingApplication).set({
        status: 'declined',
        updatedAt: new Date(),
      }).where(eq(financingApplication.id, app.id));
      break;

    case 'application.funded':
      await db.update(financingApplication).set({
        status: 'funded',
        updatedAt: new Date(),
      }).where(eq(financingApplication.id, app.id));
      break;

    case 'application.expired':
      await db.update(financingApplication).set({
        status: 'expired',
        updatedAt: new Date(),
      }).where(eq(financingApplication.id, app.id));
      break;

    default:
      console.log('Unhandled Wisetack event:', event);
  }

  return { processed: true, event, applicationId: app.id };
}

/**
 * Connect company to Wisetack (OAuth flow)
 */
export async function initiateWisetackConnection(companyId: string, returnUrl: string) {
  const state = crypto.randomBytes(32).toString('hex');

  // Save state for verification
  await db.insert(oauthState).values({
    state,
    provider: 'wisetack',
    companyId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
  });

  const authUrl = new URL(`${WISETACK_API_URL}/oauth/authorize`);
  authUrl.searchParams.set('partner_id', WISETACK_PARTNER_ID || '');
  authUrl.searchParams.set('redirect_uri', returnUrl);
  authUrl.searchParams.set('state', state);

  return authUrl.toString();
}

/**
 * Complete Wisetack connection (OAuth callback)
 */
export async function completeWisetackConnection(code: string, stateValue: string) {
  // Verify state
  const [savedState] = await db.select().from(oauthState)
    .where(and(eq(oauthState.state, stateValue), eq(oauthState.provider, 'wisetack')))
    .limit(1);

  if (!savedState || savedState.expiresAt < new Date()) {
    throw new Error('Invalid or expired state');
  }

  // Exchange code for merchant ID
  const response = await wisetackRequest('/oauth/token', {
    method: 'POST',
    body: JSON.stringify({
      code,
      partner_id: WISETACK_PARTNER_ID,
    }),
  });

  // Save merchant ID in company settings JSON
  if (savedState.companyId) {
    const [companyRow] = await db.select({ settings: company.settings })
      .from(company).where(eq(company.id, savedState.companyId)).limit(1);

    const settings = (companyRow?.settings as any) || {};
    settings.wisetackMerchantId = response.merchant_id;
    settings.wisetackConnectedAt = new Date().toISOString();

    await db.update(company).set({
      settings,
      updatedAt: new Date(),
    }).where(eq(company.id, savedState.companyId));
  }

  // Clean up state
  await db.delete(oauthState).where(eq(oauthState.id, savedState.id));

  return { connected: true, merchantId: response.merchant_id };
}

/**
 * Disconnect Wisetack
 */
export async function disconnectWisetack(companyId: string) {
  const [companyRow] = await db.select({ settings: company.settings })
    .from(company).where(eq(company.id, companyId)).limit(1);

  const settings = (companyRow?.settings as any) || {};
  delete settings.wisetackMerchantId;
  delete settings.wisetackConnectedAt;

  await db.update(company).set({
    settings,
    updatedAt: new Date(),
  }).where(eq(company.id, companyId));

  return { disconnected: true };
}

/**
 * Get Wisetack connection status
 */
export async function getConnectionStatus(companyId: string) {
  const [companyRow] = await db.select({ settings: company.settings })
    .from(company).where(eq(company.id, companyId)).limit(1);

  const settings = (companyRow?.settings as any) || {};

  return {
    connected: !!settings.wisetackMerchantId,
    merchantId: settings.wisetackMerchantId || null,
    connectedAt: settings.wisetackConnectedAt || null,
  };
}

/**
 * Calculate estimated monthly payment
 */
export function calculateMonthlyPayment(amount: number, apr: number = 9.99, termMonths: number = 36): number {
  const monthlyRate = apr / 100 / 12;
  if (monthlyRate === 0) {
    return Math.round((amount / termMonths) * 100) / 100;
  }
  const payment = (amount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
                  (Math.pow(1 + monthlyRate, termMonths) - 1);
  return Math.round(payment * 100) / 100;
}

/**
 * Get financing options preview
 */
export function getFinancingOptions(amount: number) {
  return [
    {
      termMonths: 12,
      apr: 0,
      monthlyPayment: calculateMonthlyPayment(amount, 0, 12),
      totalCost: amount,
      label: '12 months @ 0% APR',
    },
    {
      termMonths: 24,
      apr: 4.99,
      monthlyPayment: calculateMonthlyPayment(amount, 4.99, 24),
      totalCost: calculateMonthlyPayment(amount, 4.99, 24) * 24,
      label: '24 months @ 4.99% APR',
    },
    {
      termMonths: 36,
      apr: 7.99,
      monthlyPayment: calculateMonthlyPayment(amount, 7.99, 36),
      totalCost: calculateMonthlyPayment(amount, 7.99, 36) * 36,
      label: '36 months @ 7.99% APR',
    },
    {
      termMonths: 60,
      apr: 9.99,
      monthlyPayment: calculateMonthlyPayment(amount, 9.99, 60),
      totalCost: calculateMonthlyPayment(amount, 9.99, 60) * 60,
      label: '60 months @ 9.99% APR',
    },
  ];
}

export default {
  createLoanApplication,
  getApplicationStatus,
  getApplicationsFor,
  processWebhook,
  initiateWisetackConnection,
  completeWisetackConnection,
  disconnectWisetack,
  getConnectionStatus,
  calculateMonthlyPayment,
  getFinancingOptions,
};
