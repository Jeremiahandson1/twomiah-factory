import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
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

// All remaining routes require authentication — and the module switch.
//
// The gate cannot go on the mount in index.ts because the three routes above it are public by
// design: an email's tracking pixel and its unsubscribe link are followed by a mail client, with
// no session to authenticate. So it goes here, below them, the same way branded email does.
// Either switch opens the module; the screen's nav entry is gated on the same pair. (T45 H23)
app.use('*', authenticate)
app.use('*', requireEnabledFeature(['email_campaigns', 'sms_marketing']))

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
  if (!template) return c.json({ error: 'Template not found' }, 404)
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

// Who would this reach?
//
// T45 H23: an owner could write a campaign and press Send with no idea who was on the other end —
// there was no way to ask. A draft with an empty audience filter was created, and the only way to
// find out it reached nobody was to send it. The service has computed this all along
// (getAudiencePreview); nothing exposed it. (T45 H23)
app.get('/audience-preview', async (c) => {
  const user = c.get('user') as any
  const audienceType = c.req.query('audienceType') || 'all'
  const raw = c.req.query('filter')
  let filter: any = {}
  if (raw) {
    try { filter = JSON.parse(raw) } catch { return c.json({ error: 'filter must be JSON' }, 400) }
  }
  // The channel decides who is reachable, not just how. Text messages need an opt-in and email
  // needs the absence of an opt-out, so the same audience is two different numbers. (T46 N9)
  const channel = (c.req.query('channel') || c.req.query('type') || 'email').toLowerCase() === 'sms' ? 'sms' : 'email'
  const preview = await marketing.getAudiencePreview(user.companyId, audienceType, filter, channel)
  return c.json(preview)
})

app.post('/campaigns/:id/send', requirePermission('marketing:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  try {
    const result = await marketing.sendCampaign(id, user.companyId)
    return c.json(result)
  } catch (e: any) {
    // Empty-audience / all-failed sends throw — report the truth as a 400, not a 500.
    //
    // The message is checked before it is shown. sendCampaign did not exist at all (T46 N8), so
    // every send answered with the TypeError's own words — "marketing.sendCampaign is not a
    // function" — handing the operator a piece of the server's internals and no idea what to do.
    // A message that names an identifier rather than an action is a fault, not an explanation.
    const raw = String(e?.message || '')
    const internal = /is not a function|undefined|null|Cannot read|\bat \w+\.\w+/.test(raw)
    if (internal) console.error('[marketing] send failed:', raw)
    return c.json({ error: internal ? 'That campaign could not be sent. The shop\'s support team has the details.' : raw || 'Unable to send campaign' }, 400)
  }
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


app.delete('/campaigns/:id', requirePermission('marketing:delete'), async (c) => {
  const user = c.get('user') as any
  await marketing.deleteCampaign(c.req.param('id'), user.companyId)
  return c.json({ success: true })
})

export default app
