// GIFT CARDS — the bar's own (services/barGiftCards.ts). Mounted at /api/gift-cards behind the gift_cards feature.
// Selling one and spending one happen on the register (routes/barRegister.ts); this is the rest:
//
//   GET    /lookup?code=        a card's balance, for the bartender (bar:register)
//   GET    /                    every card and what is still owed on them (bar:manage)
//   GET    /:id                 one card and its ledger (bar:manage)
//   POST   /:id/adjust          { deltaCents, reason }  a correction, who and why (bar:manage)
//   POST   /:id/void            { reason }              (bar:manage)
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { barGiftCard } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
import audit from '../services/audit.ts'
import { actorOf } from '../services/barManagers.ts'
import { adjustCard, cardHistory, findCard, GiftCardError, listCards, voidCard } from '../services/barGiftCards.ts'

type Ctx = any
const app = new Hono()
app.use('*', authenticate)
const on = requireEnabledFeature('gift_cards')

async function act(c: Ctx, fn: () => Promise<unknown>) {
  try {
    return c.json({ ok: true, ...(await fn() as object) })
  } catch (e: any) {
    if (e instanceof GiftCardError) return c.json({ error: e.message }, e.status)
    console.error('[gift-cards]', e?.message || e)
    return c.json({ error: 'That did not save. Try again.' }, 500)
  }
}

app.get('/lookup', on, requirePermission('bar:register'), async (c) => {
  const actor = await actorOf(c)
  c.header('Cache-Control', 'no-store')
  const card = await findCard(actor.companyId, c.req.query('code') || '')
  if (!card) return c.json({ error: 'No gift card with that number.' }, 404)
  return c.json({ code: card.code, balanceCents: card.balanceCents, initialCents: card.initialCents, status: card.status })
})

app.get('/', on, requirePermission('bar:manage'), async (c) => {
  const actor = await actorOf(c)
  c.header('Cache-Control', 'no-store')
  return c.json(await listCards(actor.companyId, c.req.query('q') || ''))
})

app.get('/:id', on, requirePermission('bar:manage'), async (c) => {
  const actor = await actorOf(c)
  const [card] = await db.select().from(barGiftCard).where(and(eq(barGiftCard.id, c.req.param('id')), eq(barGiftCard.companyId, actor.companyId))).limit(1)
  if (!card) return c.json({ error: 'That card is gone.' }, 404)
  return c.json({ card, history: await cardHistory(actor.companyId, card.id) })
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

export default app
