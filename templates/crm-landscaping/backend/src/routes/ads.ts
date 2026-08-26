import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate)

// ─── Mock data generators ────────────────────────────────────────────────────
// These return realistic mock data. Replace with real Twomiah Ads API calls later.

function generateDailyData(days: number) {
  const data = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    const impressions = 0
    const clicks = 0
    data.push({
      date: date.toISOString().split('T')[0],
      impressions,
      clicks,
    })
  }
  return data
}

const MOCK_CAMPAIGNS: any[] = []

const MOCK_PENDING_APPROVALS: any[] = []

// In-memory store for approvals/rejections (mock — replace with DB later)
const approvalStore = new Map<string, { status: string; feedback?: string }>()

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/performance', async (c) => {
  const range = c.req.query('range') || '30'
  const days = Math.min(Number(range) || 30, 90)
  const daily = generateDailyData(days)

  const totalImpressions = daily.reduce((s, d) => s + d.impressions, 0)
  const totalClicks = daily.reduce((s, d) => s + d.clicks, 0)
  const totalSpend = MOCK_CAMPAIGNS.reduce((s, c) => s + c.spend, 0)
  const totalLeads = MOCK_CAMPAIGNS.reduce((s, c) => s + c.leads, 0)

  return c.json({
    summary: {
      impressions: totalImpressions,
      clicks: totalClicks,
      ctr: totalClicks / Math.max(totalImpressions, 1),
      spend: totalSpend,
      leads: totalLeads,
      costPerLead: totalSpend / Math.max(totalLeads, 1),
    },
    daily,
    campaigns: MOCK_CAMPAIGNS.filter(c => c.status !== 'draft').map(camp => ({
      id: camp.id,
      name: camp.name,
      platform: camp.platform,
      status: camp.status,
      impressions: camp.impressions,
      clicks: camp.clicks,
      ctr: camp.clicks / Math.max(camp.impressions, 1),
      spend: camp.spend,
      leads: camp.leads,
    })),
  })
})

app.get('/campaigns', async (c) => {
  const status = c.req.query('status')
  let campaigns = MOCK_CAMPAIGNS
  if (status && status !== 'all') {
    campaigns = campaigns.filter(camp => camp.status === status)
  }

  return c.json({
    campaigns: campaigns.map(camp => ({
      ...camp,
      ads: camp.ads.map(ad => ({
        ...ad,
        // Merge any approval state
        ...(approvalStore.has(ad.id) ? { status: approvalStore.get(ad.id)!.status === 'approved' ? 'active' : ad.status } : {}),
      })),
    })),
  })
})

app.get('/pending-approvals', async (c) => {
  const pending = MOCK_PENDING_APPROVALS.filter(p => {
    const stored = approvalStore.get(p.id)
    return !stored || stored.status === 'pending'
  })
  return c.json({ approvals: pending, count: pending.length })
})

app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  approvalStore.set(id, { status: 'approved' })

  // In production: notify Twomiah Ads service
  const adsUrl = process.env.ADS_URL
  if (adsUrl) {
    try {
      await fetch(`${adsUrl}/api/webhooks/ad-approved`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId: id, approvedAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) {
      console.error('Failed to notify Ads service:', err)
    }
  }

  return c.json({ success: true, status: 'approved' })
})

app.post('/:id/request-changes', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const feedback = body?.feedback || ''
  approvalStore.set(id, { status: 'changes_requested', feedback })

  // In production: notify Twomiah Ads service
  const adsUrl = process.env.ADS_URL
  if (adsUrl) {
    try {
      await fetch(`${adsUrl}/api/webhooks/ad-changes-requested`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adId: id, feedback, requestedAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) {
      console.error('Failed to notify Ads service:', err)
    }
  }

  return c.json({ success: true, status: 'changes_requested' })
})

export default app
