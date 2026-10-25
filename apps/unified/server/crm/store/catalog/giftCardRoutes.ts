// The store's gift cards in the back office, at /api/admin/gift-cards (2026-10-24, the store upgrade): every card with
// its balance, a card's ledger, a card issued by hand (store credit, a prize), a balance corrected, a card voided. The
// card rules are the bar's (../../bar/barGiftCards.ts) — one ledger per company.
//
// orders:refund throughout: a card's number is money anyone holding it can spend, and changing a balance is giving money
// or taking it — the seats that refund (the manager and the owner). The menu item asks the same.
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, listAll, one } from '../../../http/reply.ts'
import { invalid } from '../../../http/errors.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { createStoreGiftCards, GiftCardError, MAX_CARD_CENTS, MIN_CARD_CENTS } from '../giftCards.ts'
import { formatCents } from '../lib/money.ts'
import { createActorName } from '@twomiah/tenant-backend'
import { user } from '../../../db/schema/index.ts'

const issueSchema = z.object({
  cents: z.number().int().min(MIN_CARD_CENTS, `At least ${MIN_CARD_CENTS / 100}`).max(MAX_CARD_CENTS, `At most ${MAX_CARD_CENTS / 100}`),
  recipientName: z.string().trim().max(120).optional().nullable(),
  recipientEmail: z.string().trim().email().optional().nullable().or(z.literal('').transform(() => null)),
  message: z.string().trim().max(500).optional().nullable(),
})
const adjustSchema = z.object({ deltaCents: z.number().int(), reason: z.string().trim().min(1, 'Say why').max(120) })
const voidSchema = z.object({ reason: z.string().trim().min(1, 'Say why').max(120) })

export function createGiftCardRoutes(d: CrmDeps, core: StoreCore) {
  const { db, audit } = d
  const app = new Hono<AppEnv>()
  app.use('*', d.permissions.requirePermission('orders:refund'))
  const giftCards = createStoreGiftCards(d, core)
  const actorName = createActorName({ db, tables: { user } })
  const own = (c: any) => c.get('user').companyId as string
  const who = async (c: any) => (await actorName(c.get('user'))) || 'Staff'
  const refused = (c: any, e: unknown) => {
    if (e instanceof GiftCardError) return fail(c, e.status as 400 | 404 | 409, e.message, 'gift_card')
    throw e
  }

  app.get('/', async (c) => {
    const { cards } = await giftCards.cards.listCards(own(c), String(c.req.query('q') || '').slice(0, 60))
    return listAll(c, cards)
  })

  app.get('/:id/history', async (c) => listAll(c, await giftCards.history(own(c), c.req.param('id'))))

  // A card issued by hand — store credit, a prize. Emailed to the recipient when an address is given.
  app.post('/', async (c) => {
    const parsed = issueSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = own(c)
    const by = await who(c)
    try {
      const card = await db.transaction((tx: any) => giftCards.cards.issueCard(tx, companyId, {
        cents: parsed.data.cents, soldVia: 'register', soldByName: by, recipientName: parsed.data.recipientName, recipientEmail: parsed.data.recipientEmail, message: parsed.data.message,
      }))
      const settings = await core.settings(companyId)
      await audit.log({ action: audit.ACTIONS.CREATE, entity: 'gift_card', entityId: card.id, entityName: card.code, metadata: { description: `Gift card issued for ${formatCents(card.initialCents, settings.currency)}` }, req: c })
      if (parsed.data.recipientEmail) {
        const co = await core.shop()
        void core.mail(parsed.data.recipientEmail, 'storeGiftCard', { orderNumber: null, currency: settings.currency, cards: [{ code: card.code, cents: card.initialCents }], supportEmail: co?.email }, co?.email)
      }
      return one(c, card, 201)
    } catch (e) { return refused(c, e) }
  })

  app.post('/:id/adjust', async (c) => {
    const parsed = adjustSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    try {
      const card = await giftCards.cards.adjustCard(own(c), c.req.param('id'), parsed.data.deltaCents, parsed.data.reason, await who(c))
      await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'gift_card', entityId: card.id, entityName: card.code, metadata: { description: `Balance corrected by ${parsed.data.deltaCents > 0 ? '+' : '−'}${formatCents(Math.abs(parsed.data.deltaCents))}: ${parsed.data.reason}` }, req: c })
      return one(c, card)
    } catch (e) { return refused(c, e) }
  })

  app.post('/:id/void', async (c) => {
    const parsed = voidSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    try {
      await giftCards.cards.voidCard(own(c), c.req.param('id'), parsed.data.reason, await who(c))
      await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'gift_card', entityId: c.req.param('id'), metadata: { description: `Gift card voided: ${parsed.data.reason}` }, req: c })
      return done(c)
    } catch (e) { return refused(c, e) }
  })

  return app
}
