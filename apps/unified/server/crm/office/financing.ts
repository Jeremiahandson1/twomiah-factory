// Financing across the lending partners a company has switched on: their options for an amount, and applications.
// Moved from templates/crm/backend/src/routes/financing.ts (which the template mounted inside a try/catch import);
// the work is in financingService.ts. The registry signs the person in.
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { createFinancingService } from './financingService.ts'

export function createFinancingRoutes(d: CrmDeps) {
  const { requirePermission } = d.permissions
  const financing = createFinancingService(d)
  const app = new Hono<AppEnv>()

  // Every provider, and whether this company has it on. A list: { data, pagination } (the template: a bare array).
  app.get('/providers', async (c) => {
    const user = c.get('user') as any
    const enabled = await financing.getEnabledProviders(user.companyId)
    const enabledNames = new Set(enabled.map((e) => e.provider.name))
    const providers = financing.getAllProviders().map((p) => ({
      name: p.name,
      displayName: p.displayName,
      logo: p.logo,
      description: p.description,
      supportedTerms: p.supportedTerms,
      enabled: enabledNames.has(p.name),
      fullyImplemented: p.name === 'wisetack', // only wisetack has full API integration
    }))
    return list(c, providers, { page: 1, limit: providers.length, total: providers.length })
  })

  // Options for an amount from every enabled provider. A list (the template: a bare array).
  app.get('/options', async (c) => {
    const user = c.get('user') as any
    const amount = Number(c.req.query('amount') || '10000')
    if (amount <= 0) return fail(c, 400, 'Amount must be positive')
    const options = await financing.getFinancingOptionsForCompany(user.companyId, amount)
    return list(c, options, { page: 1, limit: options.length, total: options.length })
  })

  // Options for one provider
  app.get('/options/:provider', async (c) => {
    const providerName = c.req.param('provider') as any
    const amount = Number(c.req.query('amount') || '10000')
    const provider = financing.getProvider(providerName)
    if (!provider) return fail(c, 404, 'Unknown provider')

    const enabled = await financing.getEnabledProviders((c.get('user') as any).companyId)
    const match = enabled.find((e) => e.provider.name === providerName)
    if (!match) return fail(c, 400, 'Provider not enabled')

    return one(c, { provider: provider.name, displayName: provider.displayName, options: provider.getOptions(amount, match.config) })
  })

  // A financing application sends a customer's name, contact details and an amount to a lender, for money owed on a
  // quote or invoice — invoices:create, the seat that bills. (T68)
  app.post('/apply', requirePermission('invoices:create'), async (c) => {
    const user = c.get('user') as any
    const body = await c.req.json()
    const { provider, contactId, amount, contactName, contactEmail, contactPhone, purpose, invoiceId } = body
    if (!provider || !contactId || !amount) return fail(c, 400, 'provider, contactId, and amount are required')

    const result = await financing.createFinancingApplication(provider, {
      companyId: user.companyId,
      contactId,
      amount: Number(amount),
      contactName: contactName || '',
      contactEmail: contactEmail || '',
      contactPhone: contactPhone || '',
      purpose,
      invoiceId,
    })

    // A refusal is the rulebook's error; the template answered { success: false, error } with a 400.
    if (!result.success) return fail(c, 400, result.error || 'The application was not accepted')
    return one(c, result, 201)
  })

  // A contact's applications. A list (the template: a bare array).
  app.get('/applications/:contactId', async (c) => {
    const user = c.get('user') as any
    const apps = await financing.getApplicationsForContact(user.companyId, c.req.param('contactId'))
    return list(c, apps, { page: 1, limit: apps.length, total: apps.length })
  })

  return app
}
