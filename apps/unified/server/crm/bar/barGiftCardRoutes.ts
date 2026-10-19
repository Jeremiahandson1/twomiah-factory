// /api/gift-cards — the bar's own (barGiftCards.ts), behind the gift_cards feature. Selling one and spending one happen
// on the register (barRegisterRoutes.ts); this is the rest:
//
//   GET    /lookup?code=        a card's balance, for the bartender (bar:register)
//   GET    /                    every card and what is still owed on them (bar:manage)
//   GET    /:id                 one card and its ledger (bar:manage)
//   POST   /:id/adjust          { deltaCents, reason }  a correction, who and why (bar:manage)
//   POST   /:id/void            { reason }              (bar:manage)
//
// Moved from templates/crm-bar/backend/src/routes/barGiftCards.ts; paths, permissions and answers as they were.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { barGiftCard } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { GiftCardError } from './barGiftCards.ts'
import type { BarServices } from './services.ts'

type Ctx = any

export function createBarGiftCardRoutes(d: CrmDeps, bar: BarServices) {
  const { db, audit, logger } = d
  const { requirePermission } = d.permissions
  const on = d.features.requireEnabledFeature('gift_cards')
  const { actorOf } = bar.managers
  const { adjustCard, cardHistory, findCard, listCards, voidCard } = bar.giftCards
  const app = new Hono<AppEnv>()

  async function act(c: Ctx, fn: () => Promise<unknown>) {
    try {
      return one(c, { ok: true, ...(await fn() as object) })
    } catch (e: any) {
      if (e instanceof GiftCardError) return fail(c, e.status as any, e.message)
      logger.error('[gift-cards]', { error: e?.message || String(e) })
      return fail(c, 500, 'That did not save. Try again.')
    }
  }

  app.get('/lookup', on, requirePermission('bar:register'), async (c) => {
    const actor = await actorOf(c)
    c.header('Cache-Control', 'no-store')
    const card = await findCard(actor.companyId, c.req.query('code') || '')
    if (!card) return fail(c, 404, 'No gift card with that number.')
    return one(c, { code: card.code, balanceCents: card.balanceCents, initialCents: card.initialCents, status: card.status })
  })

  app.get('/', on, requirePermission('bar:manage'), async (c) => {
    const actor = await actorOf(c)
    c.header('Cache-Control', 'no-store')
    return one(c, await listCards(actor.companyId, c.req.query('q') || ''))
  })

  app.get('/:id', on, requirePermission('bar:manage'), async (c) => {
    const actor = await actorOf(c)
    const [card] = await db.select().from(barGiftCard).where(and(eq(barGiftCard.id, c.req.param('id')), eq(barGiftCard.companyId, actor.companyId))).limit(1)
    if (!card) return fail(c, 404, 'That card is gone.')
    return one(c, { card, history: await cardHistory(actor.companyId, card.id) })
  })

  app.post('/:id/adjust', on, requirePermission('bar:manage'), async (c) => {
    const actor = await actorOf(c)
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, async () => {
      const card = await adjustCard(actor.companyId, c.req.param('id'), b.deltaCents, b.reason, actor.name)
      audit.log({ req: c, action: 'update', entity: 'bar_gift_card', entityId: card.id, entityName: card.code, changes: { deltaCents: b.deltaCents, reason: b.reason } })
      return { card }
    })
  })

  app.post('/:id/void', on, requirePermission('bar:manage'), async (c) => {
    const actor = await actorOf(c)
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
    return act(c, async () => {
      await voidCard(actor.companyId, c.req.param('id'), b.reason, actor.name)
      audit.log({ req: c, action: 'delete', entity: 'bar_gift_card', entityId: c.req.param('id'), changes: { status: 'void', reason: b.reason } })
      return {}
    })
  })

  return app
}
