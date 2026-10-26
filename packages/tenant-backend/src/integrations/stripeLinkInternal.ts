// The Factory's hand-over of a Stripe account an owner linked by signing in at Stripe (OAuth): its own file, apart from
// the owner/admin integrations routes, because no signed-in person drives it — only the Factory, by its key.
import crypto from 'node:crypto'
import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import { requireFactoryKey } from '../leads/leads'

/** How a pending press is kept: only its hash (integrations.ts writes it; this route matches it). */
export const nonceHash = (nonce: string) => crypto.createHash('sha256').update(nonce).digest('hex')

export interface StripeLinkInternalDeps {
  db: any
  tables: { company: any; user: any }
}

/**
 * POST /api/internal/stripe-link — the Factory hands over the account an owner linked at Stripe (X-Factory-Key, applied
 * where it is mounted), or tells this app the sign-in ended without one ({ outcome }). Accepted only for the ONE pending
 * press it matches: same nonce (by hash), not expired, the same admin, who is still an active owner/admin of this
 * business, and no account connected meanwhile. The press is consumed by a conditional update, so a second hand-over
 * of the same nonce finds nothing (410). Any refusal makes the Factory withdraw its access to the account.
 *   410 gone or expired · 403 someone else's press, or no longer an admin · 409 already connected · 400 malformed
 */
export function createStripeLinkInternalRoutes(deps: StripeLinkInternalDeps) {
  const { db, tables: t } = deps
  const app = new Hono()
  // The Factory's key on the route itself, as well as where it is mounted: a write no signed-in person may drive.
  app.post('/', requireFactoryKey, async (c) => {
    const b = await c.req.json().catch(() => null) as any
    const nonce = typeof b?.nonce === 'string' ? b.nonce : ''
    const userId = typeof b?.userId === 'string' ? b.userId : ''
    const accountId = b?.accountId === undefined || b?.accountId === null ? null : String(b.accountId)
    if (!nonce || !userId || (accountId !== null && !/^acct_[A-Za-z0-9]+$/.test(accountId))) return c.json({ error: 'nonce, userId and an account id (acct_...) or an outcome are required' }, 400)
    const hash = nonceHash(nonce)
    const pendingIs = sql`(${t.company.integrations}->'stripeLinkPending'->>'nonceHash') = ${hash}`
    const [row] = await db.select().from(t.company).where(pendingIs).limit(1)
    if (!row) return c.json({ error: 'This Stripe sign-in is no longer pending' }, 410)
    const integrations = { ...((row.integrations as any) || {}) }
    const pending = integrations.stripeLinkPending || {}
    delete integrations.stripeLinkPending
    let refusal: { status: 410 | 403 | 409; error: string } | null = null
    if (!(Number(pending.expiresAt) > Date.now())) refusal = { status: 410, error: 'This Stripe sign-in has expired' }
    else if (pending.userId !== userId) refusal = { status: 403, error: 'This Stripe sign-in was started by someone else' }
    else if (accountId) {
      const [who] = await db.select({ role: t.user.role, isActive: t.user.isActive }).from(t.user).where(and(eq(t.user.id, userId), eq(t.user.companyId, row.id))).limit(1)
      if (!who || who.isActive === false || !['owner', 'admin'].includes(who.role)) refusal = { status: 403, error: 'Only an owner or admin can link a Stripe account' }
      else if (integrations.stripeAccountId) refusal = { status: 409, error: 'Stripe is already connected' }
    }
    if (!refusal && accountId) Object.assign(integrations, { stripeAccountId: accountId, stripeAccountSource: 'oauth' })
    // Consumed only while it is still the same press: two hand-overs racing for one nonce cannot both win.
    const done = await db.update(t.company).set({ integrations, updatedAt: new Date() })
      .where(and(eq(t.company.id, row.id), pendingIs))
      .returning({ id: t.company.id })
    if (!done.length) return c.json({ error: 'This Stripe sign-in is no longer pending' }, 410)
    if (refusal) return c.json({ error: refusal.error }, refusal.status)
    return c.json(accountId ? { linked: true } : { cleared: true })
  })
  return app
}
