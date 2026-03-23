import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import marketing from '../services/marketing.ts'

const app = new Hono()

// ============================================
// TRACKING (No auth - called by email pixels/links)
// Must be BEFORE authenticate middleware
// ============================================

app.get('/track/open/:recipientId', async (c) => {
  const recipientId = c.req.param('recipientId')
  try {
    await marketing.trackOpen(recipientId)
  } catch (error) {
    console.error('Track open error:', error)
  }
  const pixel = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (ch) => ch.charCodeAt(0))
  return new Response(pixel, {
    headers: { 'Content-Type': 'image/gif' },
  })
})

app.get('/track/click/:recipientId', async (c) => {
  const recipientId = c.req.param('recipientId')
  const url = c.req.query('url')
  try {
    await marketing.trackClick(recipientId, url)
  } catch (error) {
    console.error('Track click error:', error)
  }
  return c.redirect(url || '/')
})

app.get('/unsubscribe/:recipientId/:contactId', async (c) => {
  const recipientId = c.req.param('recipientId')
  const contactId = c.req.param('contactId')
  try {
    await marketing.handleUnsubscribe(recipientId, contactId)
    return c.html('<html><body><h1>You have been unsubscribed</h1><p>You will no longer receive marketing emails from us.</p></body></html>')
  } catch (error) {
    return c.html('<html><body><h1>Error</h1><p>Could not process unsubscribe request.</p></body></html>')
  }
})

// All remaining routes require authentication
app.use('*', authenticate)

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

// (Tracking routes moved above authenticate middleware)

// ============================================
// STATS
// ============================================

app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const stats = await marketing.getMarketingStats(user.companyId)
  return c.json(stats)
})

export default app
