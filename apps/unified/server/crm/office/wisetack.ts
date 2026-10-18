// Wisetack consumer financing. Moved from templates/crm/backend/src/routes/wisetack.ts; the work is in
// wisetackService.ts. Mounted PUBLIC because Wisetack's webhook arrives without a session: the router signs people in
// itself, after the webhook, in the template's order.
//
// Not connected until someone signs up: with WISETACK_API_KEY / WISETACK_PARTNER_ID unset, every path here (the
// webhook included) answers 503 with a reason. Setting the two variables is the whole switch.
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { createWisetackService } from './wisetackService.ts'

export function createWisetackRoutes(d: CrmDeps) {
  const { requirePermission, requireRole } = d.permissions
  const wisetack = createWisetackService(d)
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    if (!process.env.WISETACK_API_KEY || !process.env.WISETACK_PARTNER_ID) {
      return fail(c, 503, 'Consumer financing is not connected yet.', 'PROVIDER_NOT_CONFIGURED')
    }
    await next()
  })

  // Webhook (no sign-in: the signature is checked)
  app.post('/webhook', async (c) => {
    const signature = c.req.header('x-wisetack-signature')
    const body = await c.req.json()
    return one(c, await wisetack.processWebhook(body, signature))
  })

  // Everything else needs a signed-in person.
  app.use('*', d.authenticate)

  app.get('/status', async (c) => {
    const user = c.get('user') as any
    return one(c, await wisetack.getConnectionStatus(user.companyId))
  })

  // Connect to Wisetack (start OAuth)
  app.post('/connect', requireRole('admin', 'owner'), async (c) => {
    const user = c.get('user') as any
    const { returnUrl } = await c.req.json()
    if (!returnUrl) return fail(c, 400, 'returnUrl is required')

    const authUrl = await wisetack.initiateWisetackConnection(user.companyId, returnUrl)
    d.audit.log({ action: 'WISETACK_CONNECT_INITIATED', entity: 'company', entityId: user.companyId, req: c })
    return one(c, { authUrl })
  })

  // Complete the connection (OAuth callback)
  app.post('/callback', async (c) => {
    const user = c.get('user') as any
    const { code, state } = await c.req.json()
    if (!code || !state) return fail(c, 400, 'code and state are required')

    const result = await wisetack.completeWisetackConnection(code, state)
    d.audit.log({ action: 'WISETACK_CONNECTED', entity: 'company', entityId: user.companyId, req: c })
    return one(c, result)
  })

  app.post('/disconnect', requireRole('admin', 'owner'), async (c) => {
    const user = c.get('user') as any
    const result = await wisetack.disconnectWisetack(user.companyId)
    d.audit.log({ action: 'WISETACK_DISCONNECTED', entity: 'company', entityId: user.companyId, req: c })
    return one(c, result)
  })

  // A financing application sends a customer's name, contact details and an amount to a lender, for money owed on a
  // quote or invoice — invoices:create, the seat that bills. (T68)
  app.post('/applications', requirePermission('invoices:create'), async (c) => {
    const user = c.get('user') as any
    const { quoteId, invoiceId, contactId, amount, customerInfo } = await c.req.json()
    if (!contactId || !amount) return fail(c, 400, 'contactId and amount are required')

    const application = await wisetack.createLoanApplication({
      companyId: user.companyId,
      quoteId,
      invoiceId,
      contactId,
      amount: parseFloat(amount),
      customerInfo,
    })

    d.audit.log({
      action: 'FINANCING_APPLICATION_CREATED',
      entity: 'financing',
      entityId: application.id,
      metadata: { amount, quoteId, invoiceId },
      req: c,
    })

    return one(c, application, 201)
  })

  app.get('/applications/:id', async (c) => one(c, await wisetack.getApplicationStatus(c.req.param('id'))))

  // The company's applications (optionally one contact's). A list: { data, pagination } (the template: a bare array).
  app.get('/applications', async (c) => {
    const user = c.get('user') as any
    const applications = await wisetack.getApplicationsFor(user.companyId, {
      quoteId: c.req.query('quoteId'),
      invoiceId: c.req.query('invoiceId'),
      contactId: c.req.query('contactId'),
    })
    return list(c, applications, { page: 1, limit: applications.length, total: applications.length })
  })

  // The options preview (no application). A list: { data, pagination } (the template: a bare array).
  app.get('/options', async (c) => {
    const amount = c.req.query('amount')
    if (!amount) return fail(c, 400, 'amount is required')
    const options = wisetack.getFinancingOptions(parseFloat(amount))
    return list(c, options, { page: 1, limit: options.length, total: options.length })
  })

  app.get('/calculate', async (c) => {
    const amount = c.req.query('amount')
    const apr = c.req.query('apr') || '9.99'
    const term = c.req.query('term') || '36'
    if (!amount) return fail(c, 400, 'amount is required')

    const monthlyPayment = wisetack.calculateMonthlyPayment(parseFloat(amount), parseFloat(apr), parseInt(term))
    return one(c, {
      amount: parseFloat(amount),
      apr: parseFloat(apr),
      termMonths: parseInt(term),
      monthlyPayment,
      totalCost: monthlyPayment * parseInt(term),
    })
  })

  return app
}
