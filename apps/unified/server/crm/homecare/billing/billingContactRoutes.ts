// /api/care-billing-contacts — who pays each client's invoices and every address they go to (parity row 23,
// care_billing_contacts, not ready: mounted only for an agency with the feature on). The rule is data/homecareBillingContacts.ts;
// the senders that read it are the invoice email and reminder (billing/invoices.ts), the automatic reminders
// (crm/billing/invoiceReminders.ts) and the automatic-payment notices (core/autopay.ts).
//   GET  /clients              (a list reply) every active client with its billing contact and where the next invoice goes — care-billing:read
//   GET  /clients/:clientId    one client's, with the family members that may be chosen — care-billing:read
//   PUT  /clients/:clientId    { kind: 'client' | 'family' | 'other' | null, familyMemberId?, name?, emails?: string[] } — care-billing:update
//   POST /bulk                 { clientIds: string[], kind: 'client' | 'other' | null, name?, emails? } — the same contact on
//                              many clients at once (a family member is one client's, so not in bulk) — care-billing:update
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import {
  billingContactList, billingContactOfClient, checkBillingContact, clientEmailsOf, familyMemberOf, portalLoginOf, saveBillingContact,
} from '../../../data/homecareBillingContacts.ts'
import { body, who } from './shared.ts'

const MAX_BULK = 500

export function createBillingContactRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const read = d.permissions.requirePermission('care-billing:read')
  const update = d.permissions.requirePermission('care-billing:update')

  app.get('/clients', read, async (c) => listAll(c, await billingContactList(db, who(c).companyId)))

  app.get('/clients/:clientId', read, async (c) => {
    const row = await billingContactOfClient(db, who(c).companyId, c.req.param('clientId'))
    return row ? one(c, row) : fail(c, 404, 'Client not found', 'not_found')
  })

  app.put('/clients/:clientId', update, async (c) => {
    const { companyId, userId } = who(c)
    const clientId = c.req.param('clientId')
    const current = await billingContactOfClient(db, companyId, clientId)
    if (!current) return fail(c, 404, 'Client not found', 'not_found')
    let b = await body(c)
    let memberEmail: string | null = null
    // A portal login picked as the family member: kept as someone else, by its name, with its email first.
    const login = b?.kind === 'family' && b.familyMemberId ? await portalLoginOf(db, companyId, clientId, String(b.familyMemberId)) : null
    if (login) b = { ...b, kind: 'other', familyMemberId: null, name: login.name, emails: [login.email, ...(Array.isArray(b.emails) ? b.emails : [])] }
    if (b?.kind === 'family') {
      const m = b.familyMemberId ? await familyMemberOf(db, companyId, clientId, String(b.familyMemberId)) : null
      if (!m) return fail(c, 400, 'Choose one of this client\'s family members.', 'validation_failed', { familyMemberId: 'Not this client\'s family member' })
      if (!m.email && !(Array.isArray(b.emails) && b.emails.length)) return fail(c, 400, `${m.name} has no email address. Add one on the family member, or type an address here.`, 'validation_failed', { emails: 'No address' })
      memberEmail = m.email
    }
    const checked = checkBillingContact(b, { clientEmail: current.clientEmail, memberEmail })
    if ('problem' in checked) return fail(c, 400, checked.problem, 'validation_failed', { [checked.field]: checked.problem })
    if (checked.value.kind === 'client' && !current.clientEmail && !checked.value.emails.length) {
      return fail(c, 400, 'This client has no email address. Add one to the client, or type an address here.', 'validation_failed', { emails: 'No address' })
    }
    await saveBillingContact(db, companyId, clientId, checked.value)
    d.audit.log({ req: c, action: d.audit.ACTIONS.UPDATE, entity: 'client-billing-contact', entityId: clientId, userId, companyId,
      metadata: { kind: checked.value.kind, emails: checked.value.emails.length } })
    const saved = await billingContactOfClient(db, companyId, clientId)
    return saved ? one(c, saved) : fail(c, 404, 'Client not found', 'not_found')
  })

  app.post('/bulk', update, async (c) => {
    const { companyId, userId } = who(c)
    const b = await body(c)
    const ids: string[] = Array.isArray(b?.clientIds) ? [...new Set<string>(b.clientIds.map((x: unknown) => String(x)).filter(Boolean))] : []
    if (!ids.length) return fail(c, 400, 'Choose at least one client.', 'validation_failed', { clientIds: 'None chosen' })
    if (ids.length > MAX_BULK) return fail(c, 400, `At most ${MAX_BULK} clients at once.`, 'validation_failed', { clientIds: 'Too many' })
    if (b?.kind === 'family') return fail(c, 400, 'A family member belongs to one client: set it on each client.', 'validation_failed', { kind: 'Not in bulk' })
    const emails = await clientEmailsOf(db, companyId, ids)
    const missing = ids.filter((id) => !emails.has(id))
    if (missing.length) return fail(c, 404, 'One or more clients were not found.', 'not_found')
    // Each client is checked against its own limit (the client's own address counts when the client pays) — all or none.
    const values = new Map<string, any>()
    for (const id of ids) {
      const checked = checkBillingContact(b, { clientEmail: emails.get(id) })
      if ('problem' in checked) return fail(c, 400, checked.problem, 'validation_failed', { [checked.field]: checked.problem })
      if (checked.value.kind === 'client' && !emails.get(id) && !checked.value.emails.length) {
        return fail(c, 400, 'A client chosen has no email address. Add one to the client, or type an address here.', 'validation_failed', { emails: 'No address' })
      }
      values.set(id, checked.value)
    }
    await db.transaction(async (tx: any) => { for (const [id, v] of values) await saveBillingContact(tx, companyId, id, v) })
    d.audit.log({ req: c, action: d.audit.ACTIONS.UPDATE, entity: 'client-billing-contact', entityId: companyId, userId, companyId,
      metadata: { bulk: ids.length, kind: b?.kind ?? null } })
    return one(c, { updated: ids.length })
  })

  return app
}
