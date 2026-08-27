import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import marketing from '../services/marketing.ts'

const app = new Hono()
// Tracking pixels, click redirects and unsubscribe links are opened from a mail
// client with no session. They were behind this middleware, which meant every
// recipient who clicked "unsubscribe" got a 401.
const PUBLIC_PATHS = /\/(track|unsubscribe)\//
app.use('*', async (c, next) => {
  if (PUBLIC_PATHS.test(c.req.path)) return next()
  return authenticate(c, next)
})

// ============================================
// TEMPLATES
// ============================================

app.get('/templates', async (c) => {
  const user = c.get('user') as any
  const category = c.req.query('category')
  const active = c.req.query('active')
  const templates = await marketing.getTemplates(user.companyId, {
    category,
    active: active === 'false' ? false : active === 'all' ? null : true,
  })
  return c.json(templates)
})

app.post('/templates', requirePermission('marketing:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const template = await marketing.createTemplate(user.companyId, body)
  return c.json(template, 201)
})

app.put('/templates/:id', requirePermission('marketing:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  await marketing.updateTemplate(id, user.companyId, body)
  return c.json({ success: true })
})

app.post('/templates/:id/duplicate', requirePermission('marketing:create'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const template = await marketing.duplicateTemplate(id, user.companyId)
  return c.json(template, 201)
})

// ============================================
// CAMPAIGNS
// ============================================

app.get('/campaigns', async (c) => {
  const user = c.get('user') as any
  const status = c.req.query('status')
  const page = c.req.query('page')
  const limit = c.req.query('limit')
  const data = await marketing.getCampaigns(user.companyId, {
    status,
    page: parseInt(page || '0') || 1,
    limit: parseInt(limit || '0') || 50,
  })
  return c.json(data)
})

app.get('/campaigns/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const campaign = await marketing.getCampaign(id, user.companyId)
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)
  return c.json(campaign)
})

app.post('/campaigns', requirePermission('marketing:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const campaign = await marketing.createCampaign(user.companyId, body)
  return c.json(campaign, 201)
})

app.put('/campaigns/:id', requirePermission('marketing:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json()
  const campaign = await marketing.updateCampaign(id, user.companyId, body)
  return c.json(campaign)
})

app.post('/campaigns/:id/send', requirePermission('marketing:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const result = await marketing.sendCampaign(id, user.companyId)
  return c.json(result)
})

app.post('/campaigns/:id/schedule', requirePermission('marketing:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { scheduledFor } = await c.req.json()
  await marketing.scheduleCampaign(id, user.companyId, scheduledFor)
  return c.json({ success: true })
})

// ============================================
// DRIP SEQUENCES
// ============================================

app.get('/sequences', async (c) => {
  const user = c.get('user') as any
  const sequences = await marketing.getSequences(user.companyId)
  return c.json(sequences)
})

app.post('/sequences', requirePermission('marketing:create'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const sequence = await marketing.createSequence(user.companyId, body)
  return c.json(sequence, 201)
})

app.post('/sequences/:id/enroll', requirePermission('marketing:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { contactId } = await c.req.json()
  const enrollment = await marketing.enrollInSequence(id, contactId, user.companyId)
  return c.json(enrollment, 201)
})

// ============================================
// TRACKING (No auth - called by email pixels/links)
// ============================================

app.get('/track/open/:recipientId', async (c) => {
  const recipientId = c.req.param('recipientId')
  try {
    await marketing.trackOpen(recipientId)
  } catch (error) {
    console.error('Track open error:', error)
  }
  // Return 1x1 transparent pixel
  const pixel = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (ch) => ch.charCodeAt(0))
  return new Response(pixel, {
    headers: { 'Content-Type': 'image/gif' },
  })
})

app.get('/track/click/:recipientId', async (c) => {
  const recipientId = c.req.param('recipientId')
  const url = c.req.query('url')
  if (!url) return c.text('Missing link', 400)
  try {
    await marketing.trackClick(recipientId, url)
  } catch (error) {
    console.error('Track click error:', error)
  }
  return c.redirect(url)
})

app.get('/unsubscribe/:recipientId/:contactId', async (c) => {
  const recipientId = c.req.param('recipientId')
  const contactId = c.req.param('contactId')
  const page = (title: string, body: string) => c.html(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title></head>` +
    `<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#111827;text-align:center;">` +
    `<h1 style="font-size:1.4rem;margin-bottom:.5rem;">${title}</h1>${body}</body></html>`
  )
  try {
    const result = await marketing.handleUnsubscribe(recipientId, contactId)
    return page(
      'You have been unsubscribed',
      `<p style="color:#4b5563;">${result.email ? result.email + ' will' : 'You will'} no longer receive marketing emails from us.</p>` +
      `<p style="color:#6b7280;font-size:.85rem;">Transactional messages about your jobs, quotes and invoices are not affected.</p>`,
    )
  } catch (error) {
    console.error('Unsubscribe error:', error)
    return page('Something went wrong', '<p style="color:#4b5563;">We could not process that request. Please contact us and we will remove you manually.</p>')
  }
})

// ============================================
// STATS
// ============================================

app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const stats = await marketing.getMarketingStats(user.companyId)
  return c.json(stats)
})

app.get('/campaigns/:id/recipients', async (c) => {
  const user = c.get('user') as any
  const rows = await marketing.getCampaignRecipients(c.req.param('id')!, user.companyId)
  if (rows === null) return c.json({ error: 'Campaign not found' }, 404)
  return c.json({ data: rows })
})

// Who would this actually go to? Checked before sending, not after.
app.post('/audience/preview', async (c) => {
  const user = c.get('user') as any
  const { audienceType, audienceFilter } = await c.req.json()
  const preview = await marketing.previewAudience(user.companyId, audienceType || 'all', audienceFilter ?? null)
  return c.json(preview)
})

app.put('/sequences/:id', requirePermission('marketing:update'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const sequence = await marketing.updateSequence(c.req.param('id')!, user.companyId, body)
  if (!sequence) return c.json({ error: 'Sequence not found' }, 404)
  return c.json(sequence)
})

// Run the queue now instead of waiting for the worker's next pass.
app.post('/process', requirePermission('marketing:update'), async (c) => {
  const campaigns = await marketing.processScheduledCampaigns()
  const drips = await marketing.processDripEmails()
  return c.json({ campaigns, drips })
})

app.post('/contacts/:contactId/resubscribe', requirePermission('marketing:update'), async (c) => {
  const user = c.get('user') as any
  return c.json(await marketing.resubscribe(c.req.param('contactId')!, user.companyId))
})


app.delete('/campaigns/:id', requirePermission('marketing:delete'), async (c) => {
  const user = c.get('user') as any
  await marketing.deleteCampaign(c.req.param('id'), user.companyId)
  return c.json({ success: true })
})

export default app
