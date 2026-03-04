/**
 * QuickBooks Online Integration Service
 * 
 * Handles OAuth2 authentication and syncing:
 * - Customers (Contacts)
 * - Invoices
 * - Payments
 * - Items/Services
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// QuickBooks API URLs
const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company';
const QBO_SANDBOX_API_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company';

// Environment config
const CLIENT_ID = process.env.QBO_CLIENT_ID;
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET;
const REDIRECT_URI = process.env.QBO_REDIRECT_URI;
const USE_SANDBOX = process.env.QBO_SANDBOX === 'true';

/**
 * Generate OAuth2 authorization URL
 */
export function getAuthUrl(companyId) {
  const state = Buffer.from(JSON.stringify({ companyId })).toString('base64');
  
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: REDIRECT_URI,
    state,
  });

  return `${QBO_AUTH_URL}?${params}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code) {
  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(refreshToken) {
  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return response.json();
}

/**
 * Save QuickBooks connection
 */
export async function saveConnection(companyId, { accessToken, refreshToken, realmId, expiresIn }) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  return prisma.quickBooksConnection.upsert({
    where: { companyId },
    update: {
      accessToken,
      refreshToken,
      realmId,
      expiresAt,
      isConnected: true,
    },
    create: {
      companyId,
      accessToken,
      refreshToken,
      realmId,
      expiresAt,
      isConnected: true,
    },
  });
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getValidToken(companyId) {
  const connection = await prisma.quickBooksConnection.findUnique({
    where: { companyId },
  });

  if (!connection || !connection.isConnected) {
    throw new Error('QuickBooks not connected');
  }

  // Check if token is expired or expiring soon (5 min buffer)
  const buffer = 5 * 60 * 1000;
  if (new Date() >= new Date(connection.expiresAt.getTime() - buffer)) {
    // Refresh token
    const tokens = await refreshAccessToken(connection.refreshToken);
    
    await prisma.quickBooksConnection.update({
      where: { companyId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });

    return { token: tokens.access_token, realmId: connection.realmId };
  }

  return { token: connection.accessToken, realmId: connection.realmId };
}

/**
 * Make authenticated API request
 */
async function apiRequest(companyId, method, endpoint, body = null) {
  const { token, realmId } = await getValidToken(companyId);
  const baseUrl = USE_SANDBOX ? QBO_SANDBOX_API_BASE : QBO_API_BASE;
  
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}/${realmId}${endpoint}`, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`QBO API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Disconnect QuickBooks
 */
export async function disconnect(companyId) {
  await prisma.quickBooksConnection.update({
    where: { companyId },
    data: {
      isConnected: false,
      accessToken: null,
      refreshToken: null,
    },
  });
}

/**
 * Get connection status
 */
export async function getConnectionStatus(companyId) {
  const connection = await prisma.quickBooksConnection.findUnique({
    where: { companyId },
  });

  if (!connection) {
    return { connected: false };
  }

  return {
    connected: connection.isConnected,
    realmId: connection.realmId,
    lastSyncAt: connection.lastSyncAt,
    expiresAt: connection.expiresAt,
  };
}

// ============================================
// CUSTOMER SYNC
// ============================================

/**
 * Create customer in QuickBooks
 */
export async function createCustomer(companyId, contact) {
  const customerData = {
    DisplayName: contact.name,
    CompanyName: contact.company || undefined,
    PrimaryEmailAddr: contact.email ? { Address: contact.email } : undefined,
    PrimaryPhone: contact.phone ? { FreeFormNumber: contact.phone } : undefined,
    Mobile: contact.mobile ? { FreeFormNumber: contact.mobile } : undefined,
    BillAddr: contact.address ? {
      Line1: contact.address,
      City: contact.city,
      CountrySubDivisionCode: contact.state,
      PostalCode: contact.zip,
    } : undefined,
  };

  const result = await apiRequest(companyId, 'POST', '/customer', { Customer: customerData });
  
  // Save QBO ID to contact
  await prisma.contact.update({
    where: { id: contact.id },
    data: { qboCustomerId: result.Customer.Id },
  });

  return result.Customer;
}

/**
 * Update customer in QuickBooks
 */
export async function updateCustomer(companyId, contact) {
  if (!contact.qboCustomerId) {
    return createCustomer(companyId, contact);
  }

  // Get current customer to get SyncToken
  const current = await apiRequest(companyId, 'GET', `/customer/${contact.qboCustomerId}`);

  const customerData = {
    Id: contact.qboCustomerId,
    SyncToken: current.Customer.SyncToken,
    DisplayName: contact.name,
    CompanyName: contact.company || undefined,
    PrimaryEmailAddr: contact.email ? { Address: contact.email } : undefined,
    PrimaryPhone: contact.phone ? { FreeFormNumber: contact.phone } : undefined,
    BillAddr: contact.address ? {
      Line1: contact.address,
      City: contact.city,
      CountrySubDivisionCode: contact.state,
      PostalCode: contact.zip,
    } : undefined,
  };

  const result = await apiRequest(companyId, 'POST', '/customer', { Customer: customerData });
  return result.Customer;
}

/**
 * Sync all contacts to QuickBooks
 */
export async function syncAllCustomers(companyId) {
  const contacts = await prisma.contact.findMany({
    where: { companyId, type: 'client' },
  });

  const results = [];
  
  for (const contact of contacts) {
    try {
      if (contact.qboCustomerId) {
        await updateCustomer(companyId, contact);
        results.push({ id: contact.id, success: true, action: 'updated' });
      } else {
        await createCustomer(companyId, contact);
        results.push({ id: contact.id, success: true, action: 'created' });
      }
    } catch (error) {
      results.push({ id: contact.id, success: false, error: error.message });
    }
  }

  await prisma.quickBooksConnection.update({
    where: { companyId },
    data: { lastSyncAt: new Date() },
  });

  return results;
}

// ============================================
// INVOICE SYNC
// ============================================

/**
 * Create invoice in QuickBooks
 */
export async function createInvoice(companyId, invoice) {
  // Ensure customer exists
  const contact = await prisma.contact.findUnique({ where: { id: invoice.contactId } });
  if (!contact.qboCustomerId) {
    await createCustomer(companyId, contact);
  }

  const lineItems = invoice.lineItems.map((item, index) => ({
    LineNum: index + 1,
    Amount: Number(item.total),
    DetailType: 'SalesItemLineDetail',
    Description: item.description,
    SalesItemLineDetail: {
      Qty: Number(item.quantity),
      UnitPrice: Number(item.unitPrice),
    },
  }));

  const invoiceData = {
    CustomerRef: { value: contact.qboCustomerId },
    DocNumber: invoice.number,
    TxnDate: invoice.issueDate ? new Date(invoice.issueDate).toISOString().split('T')[0] : undefined,
    DueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().split('T')[0] : undefined,
    Line: lineItems,
    CustomerMemo: invoice.notes ? { value: invoice.notes } : undefined,
  };

  const result = await apiRequest(companyId, 'POST', '/invoice', { Invoice: invoiceData });

  // Save QBO ID
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { qboInvoiceId: result.Invoice.Id },
  });

  return result.Invoice;
}

/**
 * Update invoice in QuickBooks
 */
export async function updateInvoice(companyId, invoice) {
  if (!invoice.qboInvoiceId) {
    return createInvoice(companyId, invoice);
  }

  const current = await apiRequest(companyId, 'GET', `/invoice/${invoice.qboInvoiceId}`);
  const contact = await prisma.contact.findUnique({ where: { id: invoice.contactId } });

  const lineItems = invoice.lineItems.map((item, index) => ({
    LineNum: index + 1,
    Amount: Number(item.total),
    DetailType: 'SalesItemLineDetail',
    Description: item.description,
    SalesItemLineDetail: {
      Qty: Number(item.quantity),
      UnitPrice: Number(item.unitPrice),
    },
  }));

  const invoiceData = {
    Id: invoice.qboInvoiceId,
    SyncToken: current.Invoice.SyncToken,
    CustomerRef: { value: contact.qboCustomerId },
    DocNumber: invoice.number,
    TxnDate: invoice.issueDate ? new Date(invoice.issueDate).toISOString().split('T')[0] : undefined,
    DueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().split('T')[0] : undefined,
    Line: lineItems,
  };

  const result = await apiRequest(companyId, 'POST', '/invoice', { Invoice: invoiceData });
  return result.Invoice;
}

/**
 * Sync all invoices to QuickBooks
 */
export async function syncAllInvoices(companyId, { startDate, endDate } = {}) {
  const where = { 
    companyId,
    status: { not: 'draft' },
  };

  if (startDate) {
    where.createdAt = { gte: new Date(startDate) };
  }
  if (endDate) {
    where.createdAt = { ...where.createdAt, lte: new Date(endDate) };
  }

  const invoices = await prisma.invoice.findMany({
    where,
    include: { 
      lineItems: { orderBy: { sortOrder: 'asc' } },
      contact: true,
    },
  });

  const results = [];

  for (const invoice of invoices) {
    try {
      // Ensure contact has QBO ID
      if (!invoice.contact.qboCustomerId) {
        await createCustomer(companyId, invoice.contact);
      }

      if (invoice.qboInvoiceId) {
        await updateInvoice(companyId, invoice);
        results.push({ id: invoice.id, number: invoice.number, success: true, action: 'updated' });
      } else {
        await createInvoice(companyId, invoice);
        results.push({ id: invoice.id, number: invoice.number, success: true, action: 'created' });
      }
    } catch (error) {
      results.push({ id: invoice.id, number: invoice.number, success: false, error: error.message });
    }
  }

  await prisma.quickBooksConnection.update({
    where: { companyId },
    data: { lastSyncAt: new Date() },
  });

  return results;
}

// ============================================
// PAYMENT SYNC
// ============================================

/**
 * Create payment in QuickBooks
 */
export async function createPayment(companyId, payment, invoice) {
  const contact = await prisma.contact.findUnique({ where: { id: invoice.contactId } });

  if (!contact.qboCustomerId || !invoice.qboInvoiceId) {
    throw new Error('Customer and invoice must be synced to QuickBooks first');
  }

  const paymentData = {
    CustomerRef: { value: contact.qboCustomerId },
    TotalAmt: Number(payment.amount),
    TxnDate: payment.paidAt ? new Date(payment.paidAt).toISOString().split('T')[0] : undefined,
    Line: [{
      Amount: Number(payment.amount),
      LinkedTxn: [{
        TxnId: invoice.qboInvoiceId,
        TxnType: 'Invoice',
      }],
    }],
  };

  const result = await apiRequest(companyId, 'POST', '/payment', { Payment: paymentData });

  // Save QBO ID
  await prisma.payment.update({
    where: { id: payment.id },
    data: { qboPaymentId: result.Payment.Id },
  });

  return result.Payment;
}

// ============================================
// IMPORT FROM QUICKBOOKS
// ============================================

/**
 * Import customers from QuickBooks
 */
export async function importCustomers(companyId) {
  const result = await apiRequest(companyId, 'GET', '/query?query=SELECT * FROM Customer MAXRESULTS 1000');
  const customers = result.QueryResponse?.Customer || [];

  const imported = [];

  for (const customer of customers) {
    // Check if already exists
    const existing = await prisma.contact.findFirst({
      where: { companyId, qboCustomerId: customer.Id },
    });

    if (existing) {
      // Update
      await prisma.contact.update({
        where: { id: existing.id },
        data: {
          name: customer.DisplayName,
          company: customer.CompanyName,
          email: customer.PrimaryEmailAddr?.Address,
          phone: customer.PrimaryPhone?.FreeFormNumber,
          address: customer.BillAddr?.Line1,
          city: customer.BillAddr?.City,
          state: customer.BillAddr?.CountrySubDivisionCode,
          zip: customer.BillAddr?.PostalCode,
        },
      });
      imported.push({ qboId: customer.Id, action: 'updated', id: existing.id });
    } else {
      // Create
      const contact = await prisma.contact.create({
        data: {
          companyId,
          type: 'client',
          name: customer.DisplayName,
          company: customer.CompanyName,
          email: customer.PrimaryEmailAddr?.Address,
          phone: customer.PrimaryPhone?.FreeFormNumber,
          address: customer.BillAddr?.Line1,
          city: customer.BillAddr?.City,
          state: customer.BillAddr?.CountrySubDivisionCode,
          zip: customer.BillAddr?.PostalCode,
          qboCustomerId: customer.Id,
        },
      });
      imported.push({ qboId: customer.Id, action: 'created', id: contact.id });
    }
  }

  return imported;
}

/**
 * Get QuickBooks company info
 */
export async function getCompanyInfo(companyId) {
  const result = await apiRequest(companyId, 'GET', '/companyinfo/' + (await getValidToken(companyId)).realmId);
  return result.CompanyInfo;
}

export default {
  getAuthUrl,
  exchangeCodeForTokens,
  saveConnection,
  disconnect,
  getConnectionStatus,
  getCompanyInfo,
  createCustomer,
  updateCustomer,
  syncAllCustomers,
  createInvoice,
  updateInvoice,
  syncAllInvoices,
  createPayment,
  importCustomers,
};
