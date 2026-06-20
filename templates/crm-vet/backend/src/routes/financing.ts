/**
 * Multi-Provider Financing Routes
 *
 * Manages financing provider configuration and loan applications
 * across all supported providers (Wisetack, GreenSky, Mosaic, etc.)
 */

import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import financing from '../services/financing.ts'

const app = new Hono()
app.use('*', authenticate)

// List all available providers with their status for this company
app.get('/providers', async (c) => {
  const user = c.get('user') as any
  const allProviders = financing.getAllProviders()
  const enabled = await financing.getEnabledProviders(user.companyId)
  const enabledNames = new Set(enabled.map(e => e.provider.name))

  return c.json(allProviders.map(p => ({
    name: p.name,
    displayName: p.displayName,
    logo: p.logo,
    description: p.description,
    supportedTerms: p.supportedTerms,
    enabled: enabledNames.has(p.name),
    fullyImplemented: p.name === 'wisetack', // only wisetack has full API integration
  })))
})

// Get financing options for a specific amount (from all enabled providers)
app.get('/options', async (c) => {
  const user = c.get('user') as any
  const amount = Number(c.req.query('amount') || '10000')
  if (amount <= 0) return c.json({ error: 'Amount must be positive' }, 400)

  const options = await financing.getFinancingOptionsForCompany(user.companyId, amount)
  return c.json(options)
})

// Get financing options for a specific provider
app.get('/options/:provider', async (c) => {
  const providerName = c.req.param('provider') as any
  const amount = Number(c.req.query('amount') || '10000')
  const provider = financing.getProvider(providerName)
  if (!provider) return c.json({ error: 'Unknown provider' }, 404)

  const enabled = await financing.getEnabledProviders((c.get('user') as any).companyId)
  const match = enabled.find(e => e.provider.name === providerName)
  if (!match) return c.json({ error: 'Provider not enabled' }, 400)

  return c.json({
    provider: provider.name,
    displayName: provider.displayName,
    options: provider.getOptions(amount, match.config),
  })
})

// Create a financing application
app.post('/apply', async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const { provider, contactId, amount, contactName, contactEmail, contactPhone, purpose, invoiceId } = body

  if (!provider || !contactId || !amount) {
    return c.json({ error: 'provider, contactId, and amount are required' }, 400)
  }

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

  return c.json(result, result.success ? 201 : 400)
})

// Get applications for a contact
app.get('/applications/:contactId', async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')
  const apps = await financing.getApplicationsForContact(user.companyId, contactId)
  return c.json(apps)
})

export default app
