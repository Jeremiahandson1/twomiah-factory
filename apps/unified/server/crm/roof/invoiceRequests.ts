// /api/invoice-requests — "Text this invoice" and scheduled payment requests (roofing parity row 17; JobNimbus, Leap; feature
// invoice_text_requests, not ready). data/invoiceRequests.ts has the rules; the receipts and the cancel-when-paid run from the paid step
// registered in crm/roof/index.ts.
//
//   GET    /:invoiceId              the invoice's payment-request texts (waiting, sent, cancelled)     invoices:read
//   POST   /:invoiceId              text it: { at?: ISO time, everyDays?, times? }                    invoices:update + sms:send
//   DELETE /texts/:id               cancel one not sent yet                                            invoices:update
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import { REQUESTS_FEATURE, MAX_REPEATS, queueInvoiceTexts, requestsFor, cancelRequest } from '../../data/invoiceRequests.ts'

export function createInvoiceRequestRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const gate = async (c: any) => (await d.features.isFeatureEnabled(c.get('user').companyId, REQUESTS_FEATURE).catch(() => false)) ? null : fail(c, 404, 'Not found')

  app.delete('/texts/:id', requirePermission('invoices:update'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await cancelRequest(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'That text is not waiting to be sent.')
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'scheduled_text', entityId: row.id, entityName: 'Payment request cancelled', userId: u.userId, companyId: u.companyId })
    return one(c, { id: row.id, cancelled: true })
  })

  app.get('/:invoiceId', requirePermission('invoices:read'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    return listAll(c, await requestsFor(db, c.get('user').companyId, c.req.param('invoiceId')))
  })

  app.post('/:invoiceId', requirePermission('invoices:update'), requirePermission('sms:send'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const b: any = await c.req.json().catch(() => ({}))
    let startAt: Date | null = null
    if (b?.at) {
      startAt = new Date(String(b.at))
      if (Number.isNaN(startAt.getTime())) return fail(c, 400, 'Pick when to send it.', undefined, { at: 'A date and time' })
    }
    const everyDays = b?.everyDays === undefined || b?.everyDays === null || b?.everyDays === '' ? null : Number(b.everyDays)
    if (everyDays !== null && !(Number.isInteger(everyDays) && everyDays >= 1 && everyDays <= 30)) return fail(c, 400, 'Repeat every 1 to 30 days.', undefined, { everyDays: '1 to 30' })
    const times = b?.times === undefined || b?.times === null || b?.times === '' ? 1 : Number(b.times)
    if (!(Number.isInteger(times) && times >= 1 && times <= MAX_REPEATS)) return fail(c, 400, `Send it at most ${MAX_REPEATS} times.`, undefined, { times: `1 to ${MAX_REPEATS}` })
    const origin = String(process.env.FRONTEND_URL || '')
    const out = await queueInvoiceTexts(db, u.companyId, u.userId, c.req.param('invoiceId'), { origin, startAt, everyDays, times })
    if (out.status === 'refused') return fail(c, out.code === 'NOT_FOUND' ? 404 : 409, out.error, out.code)
    audit.log({ req: c, action: audit.ACTIONS.UPDATE, entity: 'invoice', entityId: c.req.param('invoiceId'), entityName: `Payment request texted (${out.texts.length})`, userId: u.userId, companyId: u.companyId })
    return one(c, { texts: out.texts }, 201)
  })

  return app
}
