// The one door every API comes through (RULEBOOK §6). Each router is declared once with who may reach it and,
// for an optional module, the feature that switches it on. The registry applies sign-in and the feature gate, so
// a module can't be reachable with its feature off, and the menu and the server read the same switch.
//
// The CRM templates mounted ~90 routers by hand, with each feature gate written out as two app.use lines beside
// them; a router mounted without its pair answered 200 with the feature off (base crm index.ts, RR4 M1).
import crypto from 'node:crypto'
import type { Hono, MiddlewareHandler } from 'hono'
import { fail } from './reply.ts'

export type Access =
  /** Anyone: the public website, the booking widget, a customer's portal link. */
  | 'public'
  /** The Factory, proven by the X-Factory-Key header against FACTORY_SYNC_KEY. */
  | 'factory'
  /** A signed-in person of this company. Each action still checks its own permission. */
  | 'user'

export interface Mount {
  /** Where it lives, e.g. '/api/contacts'. */
  path: string
  router: Hono<any, any, any>
  access: Access
  /** The feature id (shared feature registry) that switches this module on; absent = always on. */
  feature?: string | string[]
}

export interface Gates {
  authenticate: MiddlewareHandler
  requireEnabledFeature: (feature: string | string[]) => MiddlewareHandler
  isFeatureEnabled: (companyId: string, feature: string | string[]) => Promise<boolean>
  /** The one company this database holds (one company per tenant database, SPEC §2). */
  companyId: () => Promise<string | null>
}

/** Constant-time check of the Factory's key; 503 when this tenant has none set, never an open door. */
export const factoryOnly: MiddlewareHandler = async (c, next) => {
  const key = process.env.FACTORY_SYNC_KEY
  if (!key) return fail(c, 503, 'Sync not configured')
  const got = String(c.req.header('X-Factory-Key') || '')
  if (got.length !== key.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(key))) return fail(c, 401, 'Unauthorized')
  await next()
}

export function mountAll(app: Hono<any, any, any>, mounts: Mount[], gates: Gates) {
  const seen = new Set<string>()
  for (const m of mounts) {
    if (!m.path.startsWith('/api/')) throw new Error(`Mount ${m.path}: API paths start with /api/`)
    if (seen.has(m.path)) throw new Error(`Mount ${m.path}: declared twice`)
    seen.add(m.path)

    const guards: MiddlewareHandler[] = []
    if (m.access === 'factory') guards.push(factoryOnly)
    if (m.access === 'user') {
      guards.push(gates.authenticate)
      if (m.feature) guards.push(gates.requireEnabledFeature(m.feature))
    }
    if (m.access === 'public' && m.feature) {
      // A switched-off public module is not there at all: 404, so the public can't tell what exists (SPEC §5.2).
      const feature = m.feature
      guards.push(async (c, next) => {
        const id = await gates.companyId()
        if (!id || !(await gates.isFeatureEnabled(id, feature))) return fail(c, 404, 'Not found')
        await next()
      })
    }
    for (const g of guards) {
      app.use(m.path, g)
      app.use(m.path + '/*', g)
    }
    app.route(m.path, m.router)
  }
}
