/**
 * Wisetack Consumer Financing Service
 * 
 * Integration with Wisetack for consumer financing:
 * - Create loan applications
 * - Check loan status
 * - Handle webhooks for approvals
 * - Embed financing widget in quotes/invoices
 * 
 * API Docs: https://docs.wisetack.com
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

const WISETACK_API_URL = process.env.WISETACK_API_URL || 'https://api.wisetack.com/v1';
const WISETACK_PARTNER_ID = process.env.WISETACK_PARTNER_ID;
const WISETACK_API_KEY = process.env.WISETACK_API_KEY;
const WISETACK_WEBHOOK_SECRET = process.env.WISETACK_WEBHOOK_SECRET;

/**
 * Make authenticated request to Wisetack API
 */
async function wisetackRequest(endpoint, options = {}) {
  const url = `${WISETACK_API_URL}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WISETACK_API_KEY}`,
      'X-Partner-ID': WISETACK_PARTNER_ID,
      ...options.headers,
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
}) {
  // Get company's Wisetack merchant ID
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { wisetackMerchantId: true, name: true },
  });

  if (!company?.wisetackMerchantId) {
    throw new Error('Company not connected to Wisetack');
  }

  // Get contact info
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
  });

  // Create application with Wisetack
  const application = await wisetackRequest('/applications', {
    method: 'POST',
    body: JSON.stringify({
      merchant_id: company.wisetackMerchantId,
      amount: Math.round(amount * 100), // Convert to cents
      customer: {
        first_name: customerInfo?.firstName || contact?.name?.split(' ')[0] || '',
        last_name: customerInfo?.lastName || contact?.name?.split(' ').slice(1).join(' ') || '',
        email: customerInfo?.email || contact?.email,
        phone: customerInfo?.phone || contact?.phone,
        address: {
          street: customerInfo?.address || contact?.address,
          city: customerInfo?.city || contact?.city,
          state: customerInfo?.state || contact?.state,
          zip: customerInfo?.zip || contact?.zip,
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
  const savedApp = await prisma.financingApplication.create({
    data: {
      companyId,
      contactId,
      quoteId,
      invoiceId,
      wisetackApplicationId: application.id,
      amount,
      status: application.status || 'pending',
      applicationUrl: application.application_url,
      expiresAt: application.expires_at ? new Date(application.expires_at) : null,
      metadata: application,
    },
  });

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
export async function getApplicationStatus(applicationId) {
  const app = await prisma.financingApplication.findFirst({
    where: { 
      OR: [
        { id: applicationId },
        { wisetackApplicationId: applicationId },
      ],
    },
  });

  if (!app) {
    throw new Error('Application not found');
  }

  // Fetch latest status from Wisetack
  try {
    const wisetackApp = await wisetackRequest(`/applications/${app.wisetackApplicationId}`);
    
    // Update local record
    await prisma.financingApplication.update({
      where: { id: app.id },
      data: {
        status: wisetackApp.status,
        approvedAmount: wisetackApp.approved_amount ? wisetackApp.approved_amount / 100 : null,
        apr: wisetackApp.apr,
        termMonths: wisetackApp.term_months,
        monthlyPayment: wisetackApp.monthly_payment ? wisetackApp.monthly_payment / 100 : null,
        metadata: wisetackApp,
        updatedAt: new Date(),
      },
    });

    return {
      id: app.id,
      status: wisetackApp.status,
      approvedAmount: wisetackApp.approved_amount ? wisetackApp.approved_amount / 100 : null,
      apr: wisetackApp.apr,
      termMonths: wisetackApp.term_months,
      monthlyPayment: wisetackApp.monthly_payment ? wisetackApp.monthly_payment / 100 : null,
      applicationUrl: app.applicationUrl,
    };
  } catch (error) {
    // Return cached data if API fails
    return {
      id: app.id,
      status: app.status,
      approvedAmount: app.approvedAmount,
      apr: app.apr,
      termMonths: app.termMonths,
      monthlyPayment: app.monthlyPayment,
      applicationUrl: app.applicationUrl,
      cached: true,
    };
  }
}

/**
 * Get applications for a quote or invoice
 */
export async function getApplicationsFor(companyId, { quoteId, invoiceId, contactId }) {
  const where = { companyId };
  
  if (quoteId) where.quoteId = quoteId;
  if (invoiceId) where.invoiceId = invoiceId;
  if (contactId) where.contactId = contactId;

  return prisma.financingApplication.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      contact: { select: { id: true, name: true, email: true } },
      quote: { select: { id: true, number: true, total: true } },
      invoice: { select: { id: true, number: true, total: true } },
    },
  });
}

/**
 * Process webhook from Wisetack
 */
export async function processWebhook(payload, signature) {
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

  // Find the application
  const app = await prisma.financingApplication.findFirst({
    where: { wisetackApplicationId: data.application_id },
    include: { 
      company: true, 
      contact: true,
      quote: true,
      invoice: true,
    },
  });

  if (!app) {
    console.warn('Webhook for unknown application:', data.application_id);
    return { processed: false, reason: 'Application not found' };
  }

  // Handle different events
  switch (event) {
    case 'application.approved':
      await prisma.financingApplication.update({
        where: { id: app.id },
        data: {
          status: 'approved',
          approvedAmount: data.approved_amount ? data.approved_amount / 100 : null,
          apr: data.apr,
          termMonths: data.term_months,
          monthlyPayment: data.monthly_payment ? data.monthly_payment / 100 : null,
          approvedAt: new Date(),
        },
      });

      // TODO: Send notification email
      // TODO: Trigger webhook to company's systems
      break;

    case 'application.declined':
      await prisma.financingApplication.update({
        where: { id: app.id },
        data: {
          status: 'declined',
          declinedAt: new Date(),
          declineReason: data.decline_reason,
        },
      });
      break;

    case 'application.funded':
      await prisma.financingApplication.update({
        where: { id: app.id },
        data: {
          status: 'funded',
          fundedAt: new Date(),
          fundedAmount: data.funded_amount ? data.funded_amount / 100 : null,
        },
      });

      // Mark invoice as paid if linked
      if (app.invoiceId) {
        await prisma.invoice.update({
          where: { id: app.invoiceId },
          data: {
            status: 'paid',
            paidAt: new Date(),
            paymentMethod: 'financing',
            financingApplicationId: app.id,
          },
        });
      }
      break;

    case 'application.expired':
      await prisma.financingApplication.update({
        where: { id: app.id },
        data: { status: 'expired' },
      });
      break;

    default:
      console.log('Unhandled Wisetack event:', event);
  }

  return { processed: true, event, applicationId: app.id };
}

/**
 * Connect company to Wisetack (OAuth flow)
 */
export async function initiateWisetackConnection(companyId, returnUrl) {
  const state = crypto.randomBytes(32).toString('hex');
  
  // Save state for verification
  await prisma.oauthState.create({
    data: {
      state,
      provider: 'wisetack',
      companyId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  });

  const authUrl = new URL(`${WISETACK_API_URL}/oauth/authorize`);
  authUrl.searchParams.set('partner_id', WISETACK_PARTNER_ID);
  authUrl.searchParams.set('redirect_uri', returnUrl);
  authUrl.searchParams.set('state', state);

  return authUrl.toString();
}

/**
 * Complete Wisetack connection (OAuth callback)
 */
export async function completeWisetackConnection(code, state) {
  // Verify state
  const savedState = await prisma.oauthState.findFirst({
    where: { state, provider: 'wisetack' },
  });

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

  // Save merchant ID to company
  await prisma.company.update({
    where: { id: savedState.companyId },
    data: {
      wisetackMerchantId: response.merchant_id,
      wisetackConnectedAt: new Date(),
    },
  });

  // Clean up state
  await prisma.oauthState.delete({ where: { id: savedState.id } });

  return { connected: true, merchantId: response.merchant_id };
}

/**
 * Disconnect Wisetack
 */
export async function disconnectWisetack(companyId) {
  await prisma.company.update({
    where: { id: companyId },
    data: {
      wisetackMerchantId: null,
      wisetackConnectedAt: null,
    },
  });

  return { disconnected: true };
}

/**
 * Get Wisetack connection status
 */
export async function getConnectionStatus(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { 
      wisetackMerchantId: true, 
      wisetackConnectedAt: true,
    },
  });

  return {
    connected: !!company?.wisetackMerchantId,
    merchantId: company?.wisetackMerchantId,
    connectedAt: company?.wisetackConnectedAt,
  };
}

/**
 * Calculate estimated monthly payment
 */
export function calculateMonthlyPayment(amount, apr = 9.99, termMonths = 36) {
  const monthlyRate = apr / 100 / 12;
  const payment = (amount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) / 
                  (Math.pow(1 + monthlyRate, termMonths) - 1);
  return Math.round(payment * 100) / 100;
}

/**
 * Get financing options preview
 */
export function getFinancingOptions(amount) {
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
