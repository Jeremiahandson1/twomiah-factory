// /api/care-autopay — a family's saved card pays each invoice as it is issued (item 3, docs/parity/homecare-privatepay.md).
// Mounted only for an agency with care_autopay (not ready). The work is core/autopay.ts; every charge is on the agency's own
// Stripe account, the card is only ever typed on Stripe's page, and nothing here takes a card number.
//
//   GET    /clients                     clients with a card on file or a link out (brand and last four only)
//   GET    /clients/:clientId           one client's autopay
//   POST   /clients/:clientId/setup     → { url } Stripe's own page for saving a card (open it with the family, or send them the address)
//   DELETE /clients/:clientId           stop charging that card
//   GET    /attention                   invoices whose automatic payment failed or needs the family
//   GET    /invoices/:invoiceId/attempts   the tries on one invoice
//   POST   /invoices/:invoiceId/try-now    try the card now, without waiting for the next retry day
//
// Who: reading is care-billing:read; saving, removing and "try now" are care-billing:update.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, done, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { who } from './shared.ts'

export function createAutopayRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const read = d.permissions.requirePermission('care-billing:read')
  const update = d.permissions.requirePermission('care-billing:update')
  const originOf = (c: any) => String(process.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/+$/, '')

  app.get('/clients', read, async (c) => listAll(c, await core.autopay.clients(who(c).companyId)))

  app.get('/clients/:clientId', read, async (c) => one(c, await core.autopay.statusOf(who(c).companyId, c.req.param('clientId'))))

  app.post('/clients/:clientId/setup', update, async (c) => {
    const { companyId, userId } = who(c) as any
    const origin = originOf(c)
    const out = await core.autopay.startSetup(companyId, c.req.param('clientId'), {
      success: `${origin}/crm/autopay?saved=1`, cancel: `${origin}/crm/autopay?cancelled=1`,
    }, userId)
    if ('problem' in out) return fail(c, out.status as any, out.problem, out.code)
    return one(c, out)
  })

  app.delete('/clients/:clientId', update, async (c) => {
    const removed = await core.autopay.remove(who(c).companyId, c.req.param('clientId'))
    if (!removed) return fail(c, 404, 'This client has no card on file for automatic payment.')
    return done(c)
  })

  app.get('/attention', read, async (c) => listAll(c, await core.autopay.needingAttention(who(c).companyId)))

  app.get('/invoices/:invoiceId/attempts', read, async (c) => listAll(c, await core.autopay.attemptsForInvoice(who(c).companyId, c.req.param('invoiceId'))))

  app.post('/invoices/:invoiceId/try-now', update, async (c) => {
    const r = await core.autopay.chargeInvoice(who(c).companyId, c.req.param('invoiceId'), { force: true })
    if (r.status === 'skipped') return fail(c, 400, SKIPPED[r.reason ?? ''] ?? 'This invoice cannot be charged automatically right now.', r.reason ?? 'skipped')
    return one(c, r)
  })

  return app
}

/** Why a "try now" did nothing, in plain words. */
const SKIPPED: Record<string, string> = {
  autopay_off: 'Automatic payment is not switched on.',
  no_invoice: 'Invoice not found.',
  draft: 'This invoice has not been sent yet — automatic payment only charges an invoice once it is sent.',
  paid: 'This invoice is already paid.',
  nothing_owed: 'Nothing is owed on this invoice.',
  no_card: 'This client has no working card on file.',
  stripe_unavailable: 'Card payments are not available on your account yet.',
  cards_not_connected: 'Card payments are not connected — connect Stripe in Settings › Integrations and switch on Online Payments.',
  account_changed: 'The card was saved on a different Stripe account than the one connected now — save the card again.',
  already_charged: 'This invoice was already charged.',
  needs_family: 'The card\'s bank needs the card owner to approve the payment — ask the family to pay from the invoice link.',
  card_finished: 'That card can no longer be charged — save a new card.',
  no_more_tries: 'All four tries have been made — ask the family to pay another way.',
  in_progress: 'A payment is already being made for this invoice.',
}
