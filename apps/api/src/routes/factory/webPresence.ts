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
import { liveDeps, liveUpgradeDeps, liveDownloadDeps } from '../../webPresence/live'
import { removeSite } from '../../webPresence/service'
import { DownloadError, startCheckout, saleStatus, resendLink, stripeStart, stripeDisconnect } from '../../webPresence/downloads'
import { staffCreateWebPresence, type StaffCreateDeps } from '../../webPresence/staffCreate'
import { liveStaffCreateDeps } from '../../webPresence/signupLive'
import type { Deps } from '../../webPresence/service'
import type { UpgradeDeps } from '../../webPresence/upgrade'
import type { DownloadDeps } from '../../webPresence/downloads'

export interface WebPresenceRouteDeps { deps: () => Deps; upgradeDeps: () => UpgradeDeps; downloadDeps?: () => DownloadDeps; staffCreateDeps?: () => StaffCreateDeps }
const real: WebPresenceRouteDeps = { deps: liveDeps, upgradeDeps: liveUpgradeDeps, downloadDeps: liveDownloadDeps, staffCreateDeps: liveStaffCreateDeps }

/** Run a handler; the switch being off, or a failed signature, is a plain 404 — nothing says why. */
async function guarded(c: any, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (e: any) {
    if (e instanceof WebPresenceOffError || e instanceof SignatureError) return c.json({ error: 'Not found' }, 404)
    if (e instanceof DownloadError) return c.json({ error: e.message }, e.status as any)
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

  // Sell a download — each called by the site's own function, signed with that site's secret (as render is). The site sends only
  // what it stores; the Factory checks the switch, the site, and the address a buyer may be sent back to.
  const signedSite = async (c: any) => {
    const raw = await c.req.text()
    if (raw.length > 20_000) throw new SignatureError()
    const row = await verifySiteRequest(D(), { site: c.req.header('x-wp-site'), ts: c.req.header('x-wp-ts'), sig: c.req.header('x-wp-sig') }, raw)
    let body: any
    try { body = JSON.parse(raw) } catch { throw new SignatureError() }
    if (body?.siteId !== row.id) throw new SignatureError()
    return { row, body }
  }
  const DL = () => { if (!injected.downloadDeps) throw new WebPresenceOffError(); return injected.downloadDeps() }
  factory.post('/internal/web-presence/checkout', (c) => guarded(c, async () => { const { row, body } = await signedSite(c); return c.json(await startCheckout(DL(), row, body)) }))
  factory.post('/internal/web-presence/sale-status', (c) => guarded(c, async () => { const { row, body } = await signedSite(c); return c.json(await saleStatus(DL(), row, body)) }))
  factory.post('/internal/web-presence/resend', (c) => guarded(c, async () => { const { row, body } = await signedSite(c); return c.json(await resendLink(DL(), row, body)) }))
  factory.post('/internal/web-presence/stripe/start', (c) => guarded(c, async () => { const { row, body } = await signedSite(c); return c.json(await stripeStart(DL(), row, body)) }))
  factory.post('/internal/web-presence/stripe/disconnect', (c) => guarded(c, async () => { const { row } = await signedSite(c); return c.json(await stripeDisconnect(DL(), row)) }))

  // ─── the scheduler ──────────────────────────────────────────────────────────
  factory.post('/internal/web-presence/sweep', (c) => guarded(c, async () => {
    if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)
    // Off is not a failure: the scheduler alerts on any non-2xx, and a 404 here would email the owner daily about a feature that
    // is deliberately switched off. The public and staff routes keep their 404.
    try { requireWebPresence() } catch (e) { if (e instanceof WebPresenceOffError) return c.json({ ok: true, off: true }); throw e }
    const d = D()
    const swept = await sweep(d)
    const credits = await creditWatch(d)
    return c.json({ ...swept, credits: credits.state })
  }))

  // ─── staff ──────────────────────────────────────────────────────────────────
  const staff = requireRole('owner', 'admin')
  const idOf = (c: any) => { const id = c.req.param('tenantId'); if (!UUID_RE.test(id)) throw new Error('Invalid customer id'); return id }

  // Staff set a customer up without a signup: the same record and site, billed by an emailed invoice (webPresence/staffCreate.ts).
  factory.post('/web-presence/customers', staff, (c) => guarded(c, async () => {
    if (!injected.staffCreateDeps) throw new WebPresenceOffError()
    const body = await c.req.json().catch(() => ({}))
    const user = c.get('user') as any
    const out = await staffCreateWebPresence(body, injected.staffCreateDeps(), { userId: user?.email || user?.id || null })
    return c.json(out.body as any, out.status as any)
  }))
  // Staff take a site down now (a customer who never paid, or asked to leave). The subscription is ended separately, from billing.
  factory.post('/web-presence/:tenantId/remove', staff, (c) => guarded(c, async () => {
    requireWebPresence()
    return c.json({ removed: await removeSite(D(), idOf(c), 'removed by staff') })
  }))

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
