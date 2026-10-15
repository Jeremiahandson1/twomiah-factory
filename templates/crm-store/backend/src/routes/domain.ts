// The store's own web address — find and buy one, or connect one the owner already has. (Owner, 10/15: "store owners
// should be able to buy like everyone else.")
//
//   GET  /api/admin/domain/status         where the address stands: none yet, waiting on nameservers, live
//   POST /api/admin/domain/check          is it free — with the first-year price and the yearly renewal
//   POST /api/admin/domain/buy-checkout   a Stripe checkout; Stripe brings the owner back to /domain here
//   POST /api/admin/domain/attach         connect a domain the owner already owns
//
// The same Factory routes the premium sites' Domain page uses (website-premium-*/server-static.ts), authenticated by
// this store's sync key: the Factory prices it, registers it after payment and wires it — the storefront on the
// domain and www, this admin on app.<domain>. Store configuration, like the email domain beside it: settings:update,
// the owner's.
import { Hono } from 'hono'
import { createFactoryApiClient } from '../shared/index.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/
const factory = createFactoryApiClient() as any

const app = new Hono()
app.use('*', authenticate, requirePermission('settings:update'))

// A Factory refusal keeps its status and words (a taken name, a missing business address); no answer is a 502. A
// Factory 401/403 is about the store's sync key, not the owner's session — passed on as-is, the admin would read it
// as "signed out" and send the owner to the login page — so it is a 502 too.
const relay = (c: any, err: any, fallback: string) => {
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 ? err.status : 502
  return c.json({ ...(err?.upstream && typeof err.upstream === 'object' ? err.upstream : {}), error: err?.upstream?.error || err?.message || fallback }, status)
}
const domainOf = async (c: any) => {
  const body = await c.req.json().catch(() => ({})) as { domain?: unknown }
  const d = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : ''
  return DOMAIN_RE.test(d) ? d : null
}

// A store with no Factory link (a local build, or one deployed before these were set) has no domain to show: the status
// says "none yet" — as the premium sites' does — and the actions refuse in words instead of a 500.
const linked = () => !!(process.env.FACTORY_URL && process.env.TENANT_ID && process.env.FACTORY_SYNC_KEY)
const unlinked = (c: any) => c.json({ error: 'Domains are not set up for this store yet. Email support@twomiah.com and we will connect it.', code: 'factory_not_linked' }, 503)
app.post('*', async (c, next) => (linked() ? next() : unlinked(c)))

app.get('/status', async (c) => {
  if (!linked()) return c.json({ status: 'unconfigured', domain: null, nameservers: [] })
  try { return c.json(await factory.getDomainStatus()) } catch (err: any) { return relay(c, err, 'Could not read the domain status') }
})

app.post('/check', async (c) => {
  const domain = await domainOf(c)
  if (!domain) return c.json({ error: 'Enter a domain like yourshop.com' }, 400)
  try { return c.json(await factory.checkDomain(domain)) } catch (err: any) { return relay(c, err, 'Could not check that domain') }
})

app.post('/buy-checkout', async (c) => {
  const domain = await domainOf(c)
  if (!domain) return c.json({ error: 'Enter a domain like yourshop.com' }, 400)
  try {
    const r = await factory.startDomainCheckout(domain, '/domain')
    return c.json({ url: r?.url || null, priceCents: r?.priceCents ?? null, renewalCents: r?.renewalCents ?? null })
  } catch (err: any) { return relay(c, err, 'The checkout did not open') }
})

app.post('/attach', async (c) => {
  const domain = await domainOf(c)
  if (!domain) return c.json({ error: 'Enter a domain like yourshop.com' }, 400)
  try { return c.json(await factory.attachDomain(domain)) } catch (err: any) { return relay(c, err, 'Could not connect that domain') }
})

export default app
