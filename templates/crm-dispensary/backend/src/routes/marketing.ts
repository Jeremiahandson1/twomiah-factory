import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
import marketing from '../services/marketing.ts'

const app = new Hono()

/**
 * The page a reader lands on after following an unsubscribe link from their inbox.
 *
 * It is the only page in this product a member of the public sees, it is reached from a mail client
 * with no session and no stylesheet, and it was a bare `<h1>Error</h1>` on a white page. Someone who
 * has just asked to be left alone deserves a plain sentence telling them it worked. Self-contained
 * on purpose: no bundle, no fonts, nothing to fetch.
 */
const page = (heading: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading}</title></head>
<body style="margin:0;background:#f8fafc;color:#0f172a;font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:32rem;margin:15vh auto;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
<h1 style="margin:0 0 .75rem;font-size:1.35rem">${heading}</h1>
<p style="margin:0;color:#475569">${body}</p>
</div></body></html>`

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
    return c.html(page('You have been unsubscribed', 'You will no longer receive marketing emails from us.'))
  } catch (error: any) {
    // TWO different failures, and they must not be given the same page.
    //
    // 1. The link's CONTACT has been deleted. The recipient row outlives it, so every email already
    //    in that person's inbox points at a record that is gone. Proved on a live send: the reader
    //    got a bare "<h1>Error</h1>" returned with HTTP 200. A 200 on a failure is a lie to every
    //    cache and crawler in between, and "Error" tells someone who wants to be left alone that
    //    something broke, with nothing to do about it — when the truth is the reassuring part:
    //    there is no record left to send to, so nothing more is coming. 410, because the thing the
    //    link pointed at is genuinely gone.
    //
    // 2. The link NAMES A DIFFERENT CUSTOMER than the message went to. Someone is trying to
    //    unsubscribe a person who never asked. Telling them "you will not receive any more email"
    //    would be false — that customer is still subscribed — and it would tell whoever forged it
    //    that the forgery worked. It gets a refusal that reveals nothing about the other record.
    const mismatch = /does not match/i.test(String(error?.message || ''))
    if (mismatch) {
      return c.html(page(
        'This link could not be used',
        'It does not match the message it came from, so nothing has been changed. If you want to stop receiving email from us, please use the unsubscribe link in your own copy.',
      ), 400)
    }
    return c.html(page(
      'You will not receive any more email',
      'This link is no longer active, which means we no longer hold a record to send to. Nothing further will be sent to you.',
    ), 410)
  }
})

// The same thing by POST, because the message advertises List-Unsubscribe-Post: One-Click.
//
// RFC 8058: a mail client that sees that header posts here when the reader clicks the Unsubscribe
// control next to the sender, and expects a 2xx and no interactive page. Advertising one-click
// without answering the POST would put a button in Gmail that silently fails — the same shape of
// lie as the unsubscribe link that did nothing (T46 N8), which is why it is wired the same day the
// header is. Nothing here is a redirect or a form: a one-click unsubscribe must complete on its own.
app.post('/unsubscribe/:recipientId/:contactId', async (c) => {
  const recipientId = c.req.param('recipientId')
  const contactId = c.req.param('contactId')
  try {
    await marketing.handleUnsubscribe(recipientId, contactId)
    return c.body(null, 200)
  } catch (error: any) {
    return c.json({ error: String(error?.message || 'Could not process this unsubscribe request.') }, 400)
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

// A budtender does not read the marketing list.
//
// Create, update and send have always been gated; the LIST was open to anyone signed in, so the
// person on the till could read every campaign the shop had ever sent, its audience and its copy.
// Not a leak of customer data, but not theirs either, and the rest of the module already draws the
// line one step further up. (T47 P22)
app.get('/campaigns', requirePermission('marketing:read'), async (c) => {
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

// Gated for the same reason the list is, and missed when the list was fixed: the campaign body
// carries the copy and the audience filter, which is the whole of what P22 closed one route
// along. (T48 Q7)
app.get('/campaigns/:id', requirePermission('marketing:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const campaign = await marketing.getCampaign(id, user.companyId)
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)
  return c.json(campaign)
})

/**
 * Who a campaign actually reached, one row per person.
 *
 * T47 P1: a campaign reported "sent 1, failed 0", the email never arrived, and there was NOWHERE in
 * the product to find that out — no recipients route existed at all, so the owner's only evidence
 * was a number the sender had made up. The rows were being written the whole time; nothing read
 * them back. A send total with no per-recipient record behind it is a claim, not a receipt.
 *
 * T48 Q7: and it went in ungated. This is the most personal thing the marketing module holds —
 * every recipient's email address or mobile number, whether they opened it, whether they
 * unsubscribed — and the person on the till could read the lot. P22 drew this line for the
 * campaign LIST and stopped there; a route added afterwards for a different reason inherited
 * nothing. The permission is the same one, because it is the same data one click deeper.
 */
app.get('/campaigns/:id/recipients', requirePermission('marketing:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const campaign = await marketing.getCampaign(id, user.companyId)
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)
  return c.json(await marketing.getCampaignRecipients(id, user.companyId))
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
