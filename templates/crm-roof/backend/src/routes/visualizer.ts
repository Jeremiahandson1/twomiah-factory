import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// Proxies the tenant's Exterior Visualizer (Twomiah Vision) so each client can
// choose which products/brands show in their own visualizer. The Vision API key
// is tenant-specific and stays server-side — it's never sent to the browser.
// Vision side: /api/tenant/materials (Bearer api_key) — see home-visualizer repo.

const app = new Hono()

app.use('*', authenticate)

function visionConfig() {
  const base = process.env.VISION_URL
  const apiKey = process.env.VISION_API_KEY
  return { base, apiKey, ok: !!(base && apiKey) }
}

async function visionProxy(method: string, path: string, body?: any) {
  const { base, apiKey, ok } = visionConfig()
  if (!ok) {
    return { status: 503, data: { error: 'Visualizer not configured', notConfigured: true } }
  }
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json().catch(() => ({}))
    return { status: res.status, data }
  } catch (err) {
    console.error(`Visualizer proxy error [${method} ${path}]:`, err)
    return { status: 502, data: { error: 'Failed to reach visualizer service' } }
  }
}

// ─── Embed URL ──────────────────────────────────────────────────────────────
// Resolves the tenant's slug from Vision (authoritative) and returns the embed
// URL so the frontend never needs to know the slug or Vision base itself.
app.get('/embed-url', async (c) => {
  const { base, ok } = visionConfig()
  if (!ok) return c.json({ configured: false }, 200)
  const { status, data } = await visionProxy('GET', '/api/tenant/materials?category=siding')
  if (status !== 200 || !data?.tenant?.slug) {
    return c.json({ configured: false }, 200)
  }
  return c.json({
    configured: true,
    url: `${base}/embed?tenant=${encodeURIComponent(data.tenant.slug)}`,
  })
})

// ─── Product catalog (built-in + custom, with per-tenant hidden flags) ──────
app.get('/materials', async (c) => {
  const category = c.req.query('category')
  const path = '/api/tenant/materials' + (category ? `?category=${encodeURIComponent(category)}` : '')
  const { status, data } = await visionProxy('GET', path)
  if (status === 503) return c.json({ notConfigured: true, builtin: [], custom: [], hiddenKeys: [] })
  return c.json(data, status as any)
})

// ─── Toggle a single product on/off for this tenant ────────────────────────
// Body: { action: 'hide' | 'show', material_key: string }
app.put('/materials', async (c) => {
  const body = await c.req.json()
  if (!['hide', 'show'].includes(body?.action) || !body?.material_key) {
    return c.json({ error: 'action (hide|show) and material_key are required' }, 400)
  }
  const { status, data } = await visionProxy('PUT', '/api/tenant/materials', {
    action: body.action,
    material_key: body.material_key,
  })
  return c.json(data, status as any)
})

// ─── Bulk toggle (e.g. hide/show an entire brand at once) ──────────────────
// Body: { hide?: string[], show?: string[] }
app.post('/materials/bulk', async (c) => {
  const body = await c.req.json()
  const hide: string[] = Array.isArray(body?.hide) ? body.hide : []
  const show: string[] = Array.isArray(body?.show) ? body.show : []
  if (hide.length === 0 && show.length === 0) {
    return c.json({ error: 'Provide hide[] and/or show[]' }, 400)
  }
  const results = { hidden: 0, shown: 0, failed: [] as string[] }
  for (const key of hide) {
    const { status } = await visionProxy('PUT', '/api/tenant/materials', { action: 'hide', material_key: key })
    if (status === 200) results.hidden++; else results.failed.push(key)
  }
  for (const key of show) {
    const { status } = await visionProxy('PUT', '/api/tenant/materials', { action: 'show', material_key: key })
    if (status === 200) results.shown++; else results.failed.push(key)
  }
  return c.json({ success: results.failed.length === 0, ...results })
})

export default app
