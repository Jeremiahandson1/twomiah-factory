// The $19 Web presence plan's HTTP routes. EVERY one starts with the switch (WEB_PRESENCE_ON): off, each answers 404 as if it did not
// exist. Three kinds:
//   /internal/web-presence/render | link-request   — called by a customer's own site, signed with that site's secret (no JWT; the
//                                                     auth middleware lets /internal/ through and the signature is checked here)
//   /internal/web-presence/sweep                   — the scheduler (cron secret)
//   /web-presence/…                                — staff only (JWT + role); the only way staff reach a customer's site
//   /public/web-presence/plan                      — what the twomiah.com signup reads; 404 until the switch is on
import { requireRole } from '../../middleware/auth'
import { type FactoryApp, checkCronSecret, UUID_RE } from './shared'
import { WebPresenceOffError, requireWebPresence, WEB_PRESENCE_PLAN_ID, WEB_PRESENCE_PRICE_USD } from '../../webPresence/switch'
import { SignatureError, verifySiteRequest, renderForSite, requestLink, staffLink, cancelAtPeriodEnd, sweep, provisionSite, siteRowFor } from '../../webPresence/service'
import { startUpgrade, changeTrade } from '../../webPresence/upgrade'
import { creditWatch, siteUsage } from '../../webPresence/watch'
import { liveDeps, liveUpgradeDeps } from '../../webPresence/live'
import type { Deps } from '../../webPresence/service'
import type { UpgradeDeps } from '../../webPresence/upgrade'

export interface WebPresenceRouteDeps { deps: () => Deps; upgradeDeps: () => UpgradeDeps }
const real: WebPresenceRouteDeps = { deps: liveDeps, upgradeDeps: liveUpgradeDeps }

/** Run a handler; the switch being off, or a failed signature, is a plain 404 — nothing says why. */
async function guarded(c: any, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (e: any) {
    if (e instanceof WebPresenceOffError || e instanceof SignatureError) return c.json({ error: 'Not found' }, 404)
    console.error('[WebPresence] route error:', e?.message || e)
    return c.json({ error: String(e?.message || 'Something went wrong').slice(0, 300) }, 500)
  }
}

export function registerWebPresenceRoutes(factory: FactoryApp, injected: WebPresenceRouteDeps = real) {
  const D = injected.deps, U = injected.upgradeDeps

  // What the signup shows. Off: not there.
  factory.get('/public/web-presence/plan', (c) => guarded(c, async () => {
    requireWebPresence()
    return c.json({ id: WEB_PRESENCE_PLAN_ID, name: 'Web presence', monthlyPrice: WEB_PRESENCE_PRICE_USD })
  }))

  // ─── called by a customer's own site ────────────────────────────────────────
  factory.post('/internal/web-presence/render', (c) => guarded(c, async () => {
    const raw = await c.req.text()
    if (raw.length > 1_000_000) return c.json({ error: 'Not found' }, 404)
    const d = D()
    const row = await verifySiteRequest(d, { site: c.req.header('x-wp-site'), ts: c.req.header('x-wp-ts'), sig: c.req.header('x-wp-sig') }, raw)
    let body: any
    try { body = JSON.parse(raw) } catch { return c.json({ error: 'That did not look right.' }, 400) }
    if (body?.siteId !== row.id) throw new SignatureError()
    const out = await renderForSite(d, row, { model: body.model, prev: body.prev })
    return c.json(out.body as any, out.status as any)
  }))

  factory.post('/internal/web-presence/link-request', (c) => guarded(c, async () => {
    const raw = await c.req.text()
    const d = D()
    const row = await verifySiteRequest(d, { site: c.req.header('x-wp-site'), ts: c.req.header('x-wp-ts'), sig: c.req.header('x-wp-sig') }, raw)
    await requestLink(d, row)
    return c.json({ ok: true })   // the same answer whoever asks
  }))

  // ─── the scheduler ──────────────────────────────────────────────────────────
  factory.post('/internal/web-presence/sweep', (c) => guarded(c, async () => {
    if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)
    requireWebPresence()
    const d = D()
    const swept = await sweep(d)
    const credits = await creditWatch(d)
    return c.json({ ...swept, credits: credits.state })
  }))

  // ─── staff ──────────────────────────────────────────────────────────────────
  const staff = requireRole('owner', 'admin')
  const idOf = (c: any) => { const id = c.req.param('tenantId'); if (!UUID_RE.test(id)) throw new Error('Invalid customer id'); return id }

  factory.get('/web-presence/sites', staff, (c) => guarded(c, async () => c.json({ sites: await siteUsage(D()) })))
  factory.get('/web-presence/credits', staff, (c) => guarded(c, async () => c.json(await creditWatch(D()))))

  factory.post('/web-presence/:tenantId/signin-link', staff, (c) => guarded(c, async () => c.json({ link: await staffLink(D(), idOf(c)) })))
  factory.post('/web-presence/:tenantId/cancel', staff, (c) => guarded(c, async () => c.json(await cancelAtPeriodEnd(D(), idOf(c)))))
  factory.post('/web-presence/:tenantId/upgrade', staff, (c) => guarded(c, async () => c.json(await startUpgrade(U(), idOf(c)))))
  factory.post('/web-presence/:tenantId/retry', staff, (c) => guarded(c, async () => {
    const id = idOf(c)
    const out = await provisionSite(D(), id)
    return c.json({ status: out.row.status, existing: out.existing })
  }))
  factory.post('/web-presence/:tenantId/trade', staff, (c) => guarded(c, async () => {
    const body = await c.req.json().catch(() => ({})) as { industry?: string }
    const industry = String(body.industry || '').trim().slice(0, 80)
    if (!industry) return c.json({ error: 'Name the trade' }, 400)
    return c.json(await changeTrade(U(), idOf(c), industry))
  }))
  factory.get('/web-presence/:tenantId', staff, (c) => guarded(c, async () => {
    requireWebPresence()
    const row = await siteRowFor(D(), { tenantId: idOf(c) })
    return row ? c.json({ site: row }) : c.json({ error: 'Not found' }, 404)
  }))
}
