// The client chart. Moved from templates/crm-salon/backend/src/routes/clients.ts.
//
// A salon client IS the contact, so the salon's own columns live in a 1:1 `client_profile` keyed by contactId and the
// list is driven from `contact` — the shared contact table stays unforked, and these routes address clients BY CONTACT
// ID. The profile row is created on demand (upsert on PUT). The chart also carries the formulas the client is kept on,
// and the money they hold on account.
import { Hono } from 'hono'
import { and, count, desc, eq, ilike, isNotNull, or } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { createAccountBalanceStore, balanceFrom, describeBalance, withoutPortalCredential } from '@twomiah/tenant-backend'
import {
  contact, clientProfile, serviceRecord, serviceMenu, appointment, membershipEnrollment, membershipPlan, user, teamMember, clientAccountEntry,
} from '../../db/schema/index.ts'
import { clientLifetimePaid } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import { calendarDateIn } from './days.ts'
import { hasSubstance } from './formulas.ts'
import { isClient } from './people.ts'
import type { SalonServices } from './services.ts'
import { withVisitPhotos } from './visitPhotos.ts'

const PROFILE_EDITABLE = ['preferredStylistId', 'hairType', 'scalpNotes', 'allergies', 'patchTestAt', 'preferences', 'pronouns', 'birthday', 'notes'] as const
// Hair type is a short label on a client card; the longer free-text fields keep their own ceilings. (Salon T28 L4)
const FIELD_MAX: Record<string, number> = { hairType: 120, pronouns: 40, scalpNotes: 2000, allergies: 2000, preferences: 2000, notes: 5000 }

export function createClientRoutes(d: CrmDeps, salon: SalonServices) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const live = d.realtime
  const { clock, formulas } = salon
  const refresh = (companyId: string, entity: string) => live.emitToCompany(companyId, live.EVENTS.REFRESH, { entity })
  // The client account-balance ledger, bound to this app's table; the rules live in the shared package.
  const accounts = createAccountBalanceStore(clientAccountEntry)
  const app = new Hono<AppEnv>()

  const clientOf = async (companyId: string, contactId: string) => {
    const [ct] = await db.select().from(contact).where(and(eq(contact.id, contactId), eq(contact.companyId, companyId))).limit(1)
    return (ct || null) as (typeof contact.$inferSelect) | null
  }
  const balanceOf = async (companyId: string, contactId: string) => balanceFrom(await db.select({ amount: clientAccountEntry.amount }).from(clientAccountEntry)
    .where(and(eq(clientAccountEntry.contactId, contactId), eq(clientAccountEntry.companyId, companyId))))

  /**
   * GET /clients — ?search= (name, email, phone), ?stylistId= (preferred stylist). People who sit in the chair: not
   * leads or suppliers (CC-20, T20 M2). Paged and clamped (?limit=100000 was honoured — the whole book in one answer).
   */
  app.get('/', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const search = c.req.query('search')
    const stylistId = c.req.query('stylistId')
    const page = Math.max(1, Math.floor(+(c.req.query('page') || '1')) || 1)
    const limit = Math.min(200, Math.max(1, Math.floor(+(c.req.query('limit') || '50')) || 50))

    const conditions = [eq(contact.companyId, currentUser.companyId), isClient()]
    if (search) conditions.push(or(ilike(contact.name, `%${search}%`), ilike(contact.email, `%${search}%`), ilike(contact.phone, `%${search}%`))!)
    if (stylistId) conditions.push(eq(clientProfile.preferredStylistId, stylistId))
    const where = and(...conditions)

    const data: any[] = await db.select({ contact, profile: clientProfile, stylistFirstName: user.firstName, stylistLastName: user.lastName })
      .from(contact)
      .leftJoin(clientProfile, eq(clientProfile.contactId, contact.id))
      .leftJoin(user, eq(clientProfile.preferredStylistId, user.id))
      .where(where)
      .orderBy(desc(contact.createdAt))
      .offset((page - 1) * limit)
      .limit(limit)
    const [{ value: total }] = await db.select({ value: count() }).from(contact).leftJoin(clientProfile, eq(clientProfile.contactId, contact.id)).where(where)

    // One row level, without the portal credential (T20 L4, T42).
    const rows = data.map((r) => ({
      ...withoutPortalCredential(r.contact),
      ...(r.profile ? { ...r.profile, id: r.contact.id, profileId: r.profile.id } : {}),
      stylistFirstName: r.stylistFirstName,
      stylistLastName: r.stylistLastName,
    }))
    return list(c, rows, { page, limit, total: Number(total) })
  })

  // GET /clients/:contactId — the full chart: contact, profile, formula history, appointments, memberships, stats.
  app.get('/:contactId', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.param('contactId')
    const companyId = currentUser.companyId
    const ct = await clientOf(companyId, contactId)
    if (!ct) return fail(c, 404, 'Client not found')

    const [profile] = await db.select().from(clientProfile).where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, companyId))).limit(1)

    const recordRows: any[] = await db.select({
      record: serviceRecord,
      serviceName: serviceMenu.name,
      rebookIntervalDays: serviceMenu.rebookIntervalDays,
      stylistFirstName: user.firstName,
      stylistLastName: user.lastName,
      // a chair-only stylist's name lives in team_member (Salon T28 M6, T29 M2)
      stylistMemberName: teamMember.name,
    })
      .from(serviceRecord)
      .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
      .leftJoin(user, eq(serviceRecord.stylistId, user.id))
      .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
      .where(and(eq(serviceRecord.contactId, contactId), eq(serviceRecord.companyId, companyId)))
      .orderBy(desc(serviceRecord.performedAt))
      .limit(50)
    const serviceRecords = recordRows.map((r) => ({
      ...withVisitPhotos(r.record), serviceName: r.serviceName, rebookIntervalDays: r.rebookIntervalDays,
      stylistFirstName: r.stylistFirstName, stylistLastName: r.stylistLastName, stylistMemberName: r.stylistMemberName,
    }))

    // The client's photo history: every visit's before and after, newest first — read on its own, not from the 50
    // visits above, so an old colour's photos stay on the chart. Only the visit's own uploads (./visitPhotos.ts).
    // (Salon live test, 2026-10-25: the record had photo columns and nowhere to see them.)
    const photoRows: any[] = await db.select({ record: serviceRecord, serviceName: serviceMenu.name })
      .from(serviceRecord)
      .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
      .where(and(eq(serviceRecord.contactId, contactId), eq(serviceRecord.companyId, companyId), or(isNotNull(serviceRecord.photoBefore), isNotNull(serviceRecord.photoAfter))))
      .orderBy(desc(serviceRecord.performedAt))
      .limit(200)
    const photos = photoRows.flatMap((r) => {
      const v = withVisitPhotos(r.record)
      const at = { recordId: v.id, performedAt: v.performedAt, serviceName: r.serviceName ?? null }
      return [
        ...(v.photoBeforeUrl ? [{ ...at, slot: 'before' as const, url: v.photoBeforeUrl }] : []),
        ...(v.photoAfterUrl ? [{ ...at, slot: 'after' as const, url: v.photoAfterUrl }] : []),
      ]
    })

    const apptRows: any[] = await db.select({
      appointment, serviceName: serviceMenu.name, stylistFirstName: user.firstName, stylistMemberName: teamMember.name, stylistLastName: user.lastName,
    })
      .from(appointment)
      .leftJoin(serviceMenu, eq(appointment.serviceId, serviceMenu.id))
      .leftJoin(user, eq(appointment.stylistId, user.id))
      .leftJoin(teamMember, eq(appointment.stylistMemberId, teamMember.id))
      .where(and(eq(appointment.contactId, contactId), eq(appointment.companyId, companyId)))
      .orderBy(desc(appointment.startTime))
      .limit(30)
    const appointments = apptRows.map((r) => ({ ...r.appointment, serviceName: r.serviceName, stylistFirstName: r.stylistFirstName, stylistLastName: r.stylistLastName, stylistMemberName: r.stylistMemberName }))

    const enrollmentRows: any[] = await db.select({ enrollment: membershipEnrollment, planName: membershipPlan.name, planPrice: membershipPlan.price })
      .from(membershipEnrollment)
      .leftJoin(membershipPlan, eq(membershipEnrollment.planId, membershipPlan.id))
      .where(and(eq(membershipEnrollment.contactId, contactId), eq(membershipEnrollment.companyId, companyId)))
      .orderBy(desc(membershipEnrollment.createdAt))
    const memberships = enrollmentRows.map((r) => ({ ...r.enrollment, planName: r.planName, planPrice: r.planPrice }))

    // "Due back on": the most recent record with a rebook interval, counted from the visit's day in the salon's zone —
    // an 11:03 PM visit is stored after midnight UTC and used to push due-back a day late. (SALON-H9)
    const withInterval = serviceRecords.find((r) => r.rebookIntervalDays)
    const tz = await clock.salonTimezone(companyId)
    const dueBackAt = withInterval
      ? (() => { const [y, m, dd] = calendarDateIn(new Date(withInterval.performedAt), tz).split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd) + withInterval.rebookIntervalDays * 86400000).toISOString().slice(0, 10) })()
      : null

    // Money the client actually paid, net of refunds (Salon T27 N9) — the salon's money, so only for a seat that may see
    // invoices; deleted, not zeroed (T41). What the client holds on account is theirs, and every seat sees it.
    const maySeeClientMoney = await canSee(currentUser?.role, 'invoices:read', currentUser?.userId)
    const lifetimeValue = maySeeClientMoney ? await clientLifetimePaid(db, companyId, contactId) : 0
    const accountBalance = await balanceOf(companyId, contactId)

    return one(c, {
      contact: withoutPortalCredential(ct),
      profile: profile || null,
      serviceRecords,
      photos,
      appointments,
      memberships,
      stats: {
        visits: serviceRecords.length, dueBackAt,
        ...(maySeeClientMoney ? { lifetimeValue } : {}),
        lastVisit: serviceRecords[0]?.performedAt ?? null,
        accountBalance,
        accountBalanceLabel: describeBalance(accountBalance),
      },
    })
  })

  // PUT /clients/:contactId/profile — upsert the salon's own profile.
  app.put('/:contactId/profile', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.param('contactId')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (!(await clientOf(currentUser.companyId, contactId))) return fail(c, 404, 'Client not found')

    const today = await clock.salonToday(currentUser.companyId)
    const tooLong = Object.entries(FIELD_MAX).find(([k, max]) => typeof body[k] === 'string' && body[k].trim().length > max)
    if (tooLong) return fail(c, 400, `${tooLong[0]} must be ${tooLong[1]} characters or fewer.`)
    for (const k of ['birthday', 'patchTestAt'] as const) {
      if (body[k] == null || body[k] === '') continue
      const v = String(body[k])
      const label = k === 'birthday' ? 'Birthday' : 'Patch test date'
      if (!/^\d{4}-\d{2}-\d{2}/.test(v) || isNaN(new Date(v.slice(0, 10) + 'T00:00:00Z').getTime())) return fail(c, 400, `${label} must be a valid date (YYYY-MM-DD).`)
      if (v.slice(0, 10) > today) return fail(c, 400, `${label} cannot be in the future.`)
    }

    const [existing] = await db.select().from(clientProfile).where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, currentUser.companyId))).limit(1)
    let saved: typeof clientProfile.$inferSelect
    if (existing) {
      const updates: Record<string, unknown> = { updatedAt: new Date() }
      for (const k of PROFILE_EDITABLE) if (k in body) updates[k] = body[k] || null
      ;[saved] = await db.update(clientProfile).set(updates).where(eq(clientProfile.id, existing.id)).returning()
      await audit.log({ action: 'update', entity: 'client_profile', entityId: existing.id, changes: audit.diff(existing, saved), req: { user: currentUser } })
    } else {
      const values: Record<string, unknown> = { id: createId(), contactId, companyId: currentUser.companyId }
      for (const k of PROFILE_EDITABLE) if (k in body) values[k] = body[k] || null
      ;[saved] = await db.insert(clientProfile).values(values as any).returning()
      await audit.log({ action: 'create', entity: 'client_profile', entityId: saved.id, metadata: saved, req: { user: currentUser } })
    }
    refresh(currentUser.companyId, 'client_profile')
    return one(c, saved)
  })

  // ─── The formulas a client is kept on ─────────────────────────────────────────────────────────────────────────

  app.get('/:contactId/formulas', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.param('contactId')
    if (!(await clientOf(currentUser.companyId, contactId))) return fail(c, 404, 'Client not found')
    return one(c, { formulas: await formulas.listFormulas(currentUser.companyId, contactId) })
  })

  /** Keep a formula on this client — typed in, or lifted off a visit with { fromRecordId }. contacts:update, a stylist's job. */
  app.post('/:contactId/formulas', requirePermission('contacts:update'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.param('contactId')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const ct = await clientOf(currentUser.companyId, contactId)
    if (!ct) return fail(c, 404, 'Client not found')

    let out
    if (body.fromRecordId) {
      const record = await formulas.recordForKeeping(currentUser.companyId, String(body.fromRecordId))
      if (!record) return fail(c, 404, 'That visit is not on this client\'s chart.')
      if (record.contactId !== contactId) return fail(c, 400, 'That visit belongs to a different client.')
      // `created` from keepFormula: the card gained a row, or re-dated one it had. (RR0929 N6)
      out = await formulas.keepFromRecord(currentUser.companyId, record, String(body.label || '').trim() || 'Kept from a visit')
      if (!out) return fail(c, 400, 'There is no formula or note on that visit to keep.')
    } else {
      if (!hasSubstance(body)) return fail(c, 400, 'Add a formula, a developer volume, a processing time or a note — something to keep.')
      if (Array.isArray(body.formula) && body.formula.length > 40) return fail(c, 400, 'That is more steps than a formula has. Check what was pasted in.')
      out = await formulas.keepFormula(currentUser.companyId, contactId, body)
    }
    if (!out) return fail(c, 400, 'There was nothing to keep.')

    await audit.log({
      action: 'update', entity: 'client_profile', entityId: contactId, entityName: ct.name,
      metadata: { keptFormula: out.kept.id, label: out.kept.label, new: out.created }, req: { user: currentUser },
    })
    refresh(currentUser.companyId, 'client_profile')
    return one(c, { formula: out.kept, added: out.created, formulas: await formulas.listFormulas(currentUser.companyId, contactId) })
  })

  /**
   * Forget one. REMOVING is the salon's record of what went on a client's hair going away, with no undo, so it asks
   * contacts:delete — a stylist adds, a manager removes. (RR4 L3; rank is not permission.)
   */
  app.delete('/:contactId/formulas/:formulaId', requirePermission('contacts:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.param('contactId')
    const ct = await clientOf(currentUser.companyId, contactId)
    if (!ct) return fail(c, 404, 'Client not found')
    const gone = await formulas.forgetFormula(currentUser.companyId, contactId, c.req.param('formulaId'))
    if (!gone) return fail(c, 404, 'That formula is not on this client\'s card.')
    await audit.log({ action: 'update', entity: 'client_profile', entityId: contactId, entityName: ct.name, metadata: { forgotFormula: c.req.param('formulaId') }, req: { user: currentUser } })
    refresh(currentUser.companyId, 'client_profile')
    return one(c, { formulas: await formulas.listFormulas(currentUser.companyId, contactId) })
  })

  // ─── Money the client has on account ──────────────────────────────────────────────────────────────────────────
  //
  // The desk can SPEND what is on account (through the invoice payment route); only an admin can CREATE it —
  // payments:delete, the right a refund and a credit already ask for.

  app.get('/:contactId/account-balance', requirePermission('contacts:read'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.param('contactId')
    if (!(await clientOf(currentUser.companyId, contactId))) return fail(c, 404, 'Client not found')
    const entries: Array<typeof clientAccountEntry.$inferSelect> = await db.select().from(clientAccountEntry)
      .where(and(eq(clientAccountEntry.contactId, contactId), eq(clientAccountEntry.companyId, currentUser.companyId)))
      .orderBy(desc(clientAccountEntry.createdAt))
    const balance = balanceFrom(entries)
    return one(c, { balance, describe: describeBalance(balance), entries: entries.map((e) => ({ ...e, amount: Number(e.amount) })) })
  })

  /**
   * Put money on account, or take it off. A reason is REQUIRED — these balances do not expire. A negative amount may
   * take the balance below zero (a client owing the shop); spending money that is not there is guarded on the spend path.
   */
  app.post('/:contactId/account-balance', requirePermission('payments:delete'), async (c) => {
    const currentUser = c.get('user') as any
    const contactId = c.req.param('contactId')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const ct = await clientOf(currentUser.companyId, contactId)
    if (!ct) return fail(c, 404, 'Client not found')

    const amount = Math.round((Number(body.amount) || 0) * 100) / 100
    if (!Number.isFinite(amount) || amount === 0) return fail(c, 400, 'Enter an amount to add, or a negative amount to take off.')
    if (Math.abs(amount) > 100000) return fail(c, 400, 'That is more than a salon account balance should ever hold. Check the amount.')
    const reason = String(body.reason || '').trim()
    if (!reason) return fail(c, 400, 'Say why this is being added or taken off — it is the client\'s money and the note is the record of it.')
    if (reason.length > 500) return fail(c, 400, 'Keep the reason to 500 characters or fewer.')

    // 'payout' when money is leaving the business (cash back over the counter), 'manual' otherwise.
    const source = amount < 0 ? (body.source === 'payout' ? 'payout' : 'manual') : 'manual'
    const entry = await accounts.add(db, {
      companyId: currentUser.companyId, contactId, amount, source, reason, invoiceId: body.invoiceId || null, createdBy: currentUser.userId,
    })
    const balance = await balanceOf(currentUser.companyId, contactId)

    await audit.log({
      action: 'update', entity: 'client_account_entry', entityId: entry.id, entityName: ct.name,
      metadata: { amount, source, reason, balance }, req: { user: currentUser },
    })
    refresh(currentUser.companyId, 'client_account_entry')
    return one(c, { entry: { ...entry, amount: Number(entry.amount) }, balance, describe: describeBalance(balance) })
  })

  return app
}
