// /api/care-autopay — a family's saved card or bank account pays each invoice as it is issued (item 3 and parity row 22,
// docs/parity/homecare-private-pay.md). Mounted only for an agency with care_autopay (not ready). The work is core/autopay.ts;
// every charge is on the agency's own Stripe account, the card is only ever typed on Stripe's page, and nothing here takes a
// card or account number.
//
//   GET    /settings                    the agency's retry schedule, approval reminders and the ways of paying it offers
//   PUT    /settings                    change them (row 22)
//   GET    /clients                     clients with a card / bank on file or a link out (brand or bank, and last four only)
//   GET    /clients/:clientId           one client's autopay
//   POST   /clients/:clientId/setup { method? }  → { url } Stripe's own page for saving a card ('card'), a US bank account
//                                       ('us_bank_account') or a Canadian one ('acss_debit') — open it with the family, or send them the address
//   DELETE /clients/:clientId           stop charging that card or account
//   GET    /attention                   invoices whose automatic payment failed or needs the family
//   GET    /schedules                   every scheduled charge and instalment waiting, charged or failed (row 22)
//   GET    /invoices/:invoiceId/attempts   the tries on one invoice
//   GET    /invoices/:invoiceId/schedule   its scheduled charge(s)
//   PUT    /invoices/:invoiceId/schedule { parts: [{ chargeOn, amountCents?, label? }] }  set a charge day, or an instalment plan
//   DELETE /invoices/:invoiceId/schedule   take the plan back
//   POST   /invoices/:invoiceId/try-now    try the card now, without waiting for the next retry day
//
// Who: reading is care-billing:read; saving, removing, scheduling, settings and "try now" are care-billing:update.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, done, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { BANK_OWNER_STEPS, METHOD_LABELS } from '../core/autopay.ts'
import { body, who } from './shared.ts'

export function createAutopayRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const read = d.permissions.requirePermission('care-billing:read')
  const update = d.permissions.requirePermission('care-billing:update')
  const originOf = (c: any) => String(process.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/+$/, '')

  app.get('/settings', read, async (c) => one(c, { ...(await core.autopay.settings(who(c).companyId)), methodLabels: METHOD_LABELS, ownerSteps: BANK_OWNER_STEPS }))

  app.put('/settings', update, async (c) => {
    const { companyId, userId } = who(c)
    const out = await core.autopay.saveSettings(companyId, await body(c))
    if ('problem' in out) return fail(c, 400, out.problem, 'bad_settings')
    d.audit.log({ req: c, action: d.audit.ACTIONS.UPDATE, entity: 'autopay-settings', entityId: companyId, userId, companyId })
    return one(c, { ...out, methodLabels: METHOD_LABELS, ownerSteps: BANK_OWNER_STEPS })
  })

  app.get('/clients', read, async (c) => listAll(c, await core.autopay.clients(who(c).companyId)))

  app.get('/clients/:clientId', read, async (c) => one(c, await core.autopay.statusOf(who(c).companyId, c.req.param('clientId'))))

  app.post('/clients/:clientId/setup', update, async (c) => {
    const { companyId, userId } = who(c) as any
    const origin = originOf(c)
    const b = await body(c)
    const out = await core.autopay.startSetup(companyId, c.req.param('clientId'), {
      success: `${origin}/crm/autopay?saved=1`, cancel: `${origin}/crm/autopay?cancelled=1`,
    }, userId, { method: b?.method ? String(b.method) : 'card', by: 'office' })
    if ('problem' in out) return fail(c, out.status as any, out.problem, out.code)
    return one(c, out)
  })

  app.delete('/clients/:clientId', update, async (c) => {
    const removed = await core.autopay.remove(who(c).companyId, c.req.param('clientId'))
    if (!removed) return fail(c, 404, 'This client has no card or bank account on file for automatic payment.')
    return done(c)
  })

  app.get('/attention', read, async (c) => listAll(c, await core.autopay.needingAttention(who(c).companyId)))

  app.get('/schedules', read, async (c) => listAll(c, await core.autopay.schedules(who(c).companyId)))

  app.get('/invoices/:invoiceId/attempts', read, async (c) => listAll(c, await core.autopay.attemptsForInvoice(who(c).companyId, c.req.param('invoiceId'))))

  app.get('/invoices/:invoiceId/schedule', read, async (c) => listAll(c, await core.autopay.schedules(who(c).companyId, c.req.param('invoiceId'))))

  app.put('/invoices/:invoiceId/schedule', update, async (c) => {
    const { companyId, userId } = who(c)
    const b = await body(c)
    const out = await core.autopay.schedule(companyId, c.req.param('invoiceId'), Array.isArray(b?.parts) ? b.parts : [], userId)
    if ('problem' in out) return fail(c, out.status as any, out.problem, out.code)
    d.audit.log({ req: c, action: d.audit.ACTIONS.UPDATE, entity: 'autopay-schedule', entityId: c.req.param('invoiceId'), userId, companyId })
    return listAll(c, await core.autopay.schedules(companyId, c.req.param('invoiceId')))
  })

  app.delete('/invoices/:invoiceId/schedule', update, async (c) => {
    const n = await core.autopay.cancelSchedule(who(c).companyId, c.req.param('invoiceId'))
    if (!n) return fail(c, 404, 'Nothing is scheduled on this invoice.')
    return done(c)
  })

  app.post('/invoices/:invoiceId/try-now', update, async (c) => {
    const r = await core.autopay.tryNow(who(c).companyId, c.req.param('invoiceId'))
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
  billed_to_payer: 'This invoice is billed to a payer, not the family; a saved card or bank account pays only the family\'s invoices.',
  no_card: 'This client has no working card or bank account on file.',
  stripe_unavailable: 'Card payments are not available on your account yet.',
  cards_not_connected: 'Card payments are not connected — connect Stripe in Settings › Integrations and switch on Online Payments.',
  account_changed: 'The card was saved on a different Stripe account than the one connected now — save the card again.',
  already_charged: 'This invoice was already charged.',
  needs_family: 'The bank needs the account owner to approve the payment — ask the family to pay from the invoice link.',
  card_finished: 'That card or account can no longer be charged — save a new one.',
  no_more_tries: 'Every try on the agency\'s schedule has been made — ask the family to pay another way.',
  in_progress: 'A payment is already being made for this invoice.',
  scheduled: 'This invoice has a scheduled charge; it is charged on its day.',
  no_schedule: 'That scheduled charge is no longer waiting.',
  not_yet: 'That charge is scheduled for a later day.',
}
