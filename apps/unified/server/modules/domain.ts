// The business's own web address at /api/admin/domain — find and buy one, or connect one it already owns — for every
// tenant (every one has the website). Moved from templates/crm-store/backend/src/routes/domain.ts (owner, 10/15: "store
// owners should be able to buy like everyone else"), which used the same Factory routes, at the same paths, as the
// premium sites' Domain page (templates/website-premium-*/server-static.ts /api/admin/domain/*):
//
//   GET  /status         where the address stands: none yet, waiting on nameservers, live
//   POST /check          is it free — with the first-year price and the yearly renewal
//   POST /buy-checkout   a Stripe checkout; Stripe brings the owner back to the admin's Domain page
//   POST /attach         connect a domain the owner already owns
//
// The Factory prices it, registers it after payment and wires it, authenticated by this tenant's sync key. Business
// configuration, like the email domain beside it: settings:update (the store's gate; the premium sites asked owner or
// admin, the seats that hold it).
//
// Changes from the store's copy:
//   · every vertical's, not the store's alone; the Factory client is handed in (a test stands one in);
//   · the checkout returns the owner to this app's Domain screen, /crm/domain (the store's admin was at /domain);
//   · a Factory refusal keeps its status, sentence and code; its other fields (e.g. `missing`) are dropped — the
//     sentence names them (RULEBOOK §3: { error, code });
//   · replies through server/http/reply.ts.
import { Hono } from 'hono'
import type { AppEnv } from '../http/env.ts'
import { fail, one } from '../http/reply.ts'

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/
/** Where Stripe returns the owner after paying: the admin screens' Domain page. */
export const DOMAIN_RETURN_PATH = '/crm/domain'

export interface DomainFactoryClient {
  getDomainStatus(): Promise<any>
  checkDomain(domain: string): Promise<any>
  startDomainCheckout(domain: string, returnPath: string): Promise<{ url: string; priceCents?: number; renewalCents?: number | null }>
  attachDomain(domain: string): Promise<any>
}

export function createDomainRoutes(deps: { permissions: any; factoryApiClient: DomainFactoryClient }) {
  const factory = deps.factoryApiClient
  const app = new Hono<AppEnv>()
  app.use('*', deps.permissions.requirePermission('settings:update'))

  // A Factory refusal keeps its status and words (a taken name, a missing business address); no answer is a 502. A
  // Factory 401/403 is about this tenant's sync key, not the owner's session — passed on as-is, the admin would read it
  // as "signed out" and send the owner to the login page — so it is a 502 too.
  const relay = (c: any, err: any, fallback: string) => {
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 403 ? err.status : 502
    const upstream = err?.upstream && typeof err.upstream === 'object' ? err.upstream : {}
    return fail(c, status, String(upstream.error || err?.message || fallback), typeof upstream.code === 'string' ? upstream.code : undefined)
  }
  const domainOf = async (c: any) => {
    const body = await c.req.json().catch(() => ({})) as { domain?: unknown }
    const d = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : ''
    return DOMAIN_RE.test(d) ? d : null
  }

  // A tenant with no Factory link (a local build, or one deployed before these were set) has no domain to show: the
  // status says "none yet" — as the premium sites' does — and the actions refuse in words instead of a 500.
  const linked = () => !!(process.env.FACTORY_URL && process.env.TENANT_ID && process.env.FACTORY_SYNC_KEY)
  app.post('*', async (c, next) => (linked()
    ? next()
    : fail(c, 503, 'Domains are not set up for this account yet. Email support@twomiah.com and we will connect it.', 'factory_not_linked')))

  app.get('/status', async (c) => {
    if (!linked()) return one(c, { status: 'unconfigured', domain: null, nameservers: [] })
    try { return one(c, await factory.getDomainStatus()) } catch (err: any) { return relay(c, err, 'Could not read the domain status') }
  })

  app.post('/check', async (c) => {
    const domain = await domainOf(c)
    if (!domain) return fail(c, 400, 'Enter a domain like yourbusiness.com')
    try { return one(c, await factory.checkDomain(domain)) } catch (err: any) { return relay(c, err, 'Could not check that domain') }
  })

  app.post('/buy-checkout', async (c) => {
    const domain = await domainOf(c)
    if (!domain) return fail(c, 400, 'Enter a domain like yourbusiness.com')
    try {
      const r = await factory.startDomainCheckout(domain, DOMAIN_RETURN_PATH)
      return one(c, { url: r?.url || null, priceCents: r?.priceCents ?? null, renewalCents: r?.renewalCents ?? null })
    } catch (err: any) { return relay(c, err, 'The checkout did not open') }
  })

  app.post('/attach', async (c) => {
    const domain = await domainOf(c)
    if (!domain) return fail(c, 400, 'Enter a domain like yourbusiness.com')
    try { return one(c, await factory.attachDomain(domain)) } catch (err: any) { return relay(c, err, 'Could not connect that domain') }
  })

  return app
}
