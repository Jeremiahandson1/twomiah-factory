// QuickBooks Online — shared implementation (packages/tenant-backend/src/integrations/quickbooks.ts), vendored into this tenant as
// ../shared at generation. This file only wires the template's tables and services in.
import { createQuickBooksService } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { contact, invoice, invoiceLineItem, payment, company, qbIntegration } from '../../db/schema.ts'

const quickbooks = createQuickBooksService({ db, tables: { contact, invoice, invoiceLineItem, payment, company, qbIntegration }, options: { customerType: 'client' } })

export const { getAuthUrl, exchangeCodeForTokens, saveConnection, disconnect, getConnectionStatus, getCompanyInfo, createCustomer, updateCustomer, syncAllCustomers, createInvoice, updateInvoice, syncAllInvoices, createPayment, importCustomers } = quickbooks
export default quickbooks
