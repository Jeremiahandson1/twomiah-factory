// Booth rent, the doors (salon row 24; hidden feature `booth_rent`, /api/booth-rent): the renters, their schedule, autopay, waiving a period,
// the ledger and the statement — and the renter's own private card page (/api/renter-card/:token). Money seats only: every door asks for
// what invoices ask for, so a stylist's seat never sees a colleague's rent.
import { Hono } from 'hono'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { boothRenter, boothRentPeriod, boothRentCharge, contact, teamMember, invoice, payment, company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, done, listAll } from '../../http/reply.ts'
import { escHtml } from '../../core/email.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import type { CrmDeps } from '../deps.ts'
import type { SalonServices } from './services.ts'
import { cardWords } from './cardOnFile.ts'
import { readRetry } from './membershipRetry.ts'
import { settingsOf } from './patchTest.ts'
import { firstDue, isYmd, parseRenter, plusDays, rentWords, rescheduleFrom, statementCsv, type RenterInput } from './boothRentRules.ts'
import type { BoothRent } from './boothRent.ts'

type RenterRow = typeof boothRenter.$inferSelect
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const cents = (n: unknown) => Math.round(Number(n || 0) * 100)
const inputOf = (r: RenterRow): RenterInput => ({ rentCents: r.rentCents, frequency: r.frequency as any, dueWeekday: r.dueWeekday, dueDay: r.dueDay, startDate: r.startDate, notes: r.notes })

export function createBoothRentRoutes(d: CrmDeps, salon: SalonServices, rent: BoothRent) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const refresh = (companyId: string) => d.realtime.emitToCompany(companyId, d.realtime.EVENTS.REFRESH, { entity: 'booth_renter' })
  const app = new Hono<AppEnv>()
  const me = (c: any) => c.get('user') as any
  const uid = (c: any) => me(c).userId || me(c).id || null

  async function mine(c: any): Promise<RenterRow | null> {
    const [r] = await db.select().from(boothRenter).where(and(eq(boothRenter.id, c.req.param('id')), eq(boothRenter.companyId, me(c).companyId))).limit(1)
    return r ?? null
  }

  /** One renter as the screen reads it: who, the rent in words, the card, what is owed, the last charge. */
  async function view(r: RenterRow, extra: { tries: number }) {
    const [m]: any[] = await db.select({ name: teamMember.name, email: teamMember.email, phone: teamMember.phone }).from(teamMember).where(eq(teamMember.id, r.teamMemberId)).limit(1)
    const [ct]: any[] = await db.select({ email: contact.email, phone: contact.phone }).from(contact).where(eq(contact.id, r.contactId)).limit(1)
    const [card] = await salon.cards.cardsOf(r.companyId, r.contactId)
    const open = await rent.openInvoices(r.id)
    const today = await salon.clock.salonToday(r.companyId)
    const [last]: any[] = await db.select().from(boothRentCharge).where(eq(boothRentCharge.renterId, r.id)).orderBy(desc(boothRentCharge.createdAt), desc(boothRentCharge.attempt)).limit(1)
    const [lastPaid]: any[] = await db.select({ paidAt: payment.paidAt }).from(payment).innerJoin(boothRentPeriod, eq(boothRentPeriod.invoiceId, payment.invoiceId)).where(eq(boothRentPeriod.renterId, r.id)).orderBy(desc(payment.paidAt)).limit(1)
    return {
      id: r.id, teamMemberId: r.teamMemberId, contactId: r.contactId, name: m?.name ?? 'Renter', email: ct?.email ?? m?.email ?? null, phone: ct?.phone ?? m?.phone ?? null,
      status: r.status, rentCents: r.rentCents, frequency: r.frequency, dueWeekday: r.dueWeekday, dueDay: r.dueDay, rentWords: rentWords(r), startDate: r.startDate, nextDue: r.nextDue, endedOn: r.endedOn, notes: r.notes,
      autoCharge: r.autoCharge, autoChargeConsentAt: r.autoChargeConsentAt, autoChargeConsentVia: r.autoChargeConsentVia, pausedForPaymentAt: r.pausedForPaymentAt,
      card: card ? { words: cardWords(card), last4: card.last4, brand: card.brand } : null,
      owedCents: open.reduce((t, x) => t + x.owedCents, 0), overdueCents: open.filter((x) => x.period < today).reduce((t, x) => t + x.owedCents, 0), openInvoices: open,
      lastPaidAt: lastPaid?.paidAt ?? null,
      lastCharge: last ? { status: last.status, attempt: last.attempt, tries: extra.tries, message: last.failureMessage ?? null, at: last.updatedAt } : null,
    }
  }

  // GET /api/booth-rent/renters — every renter (active, paused, ended), what each owes. Reading bills what has come due.
  app.get('/renters', requirePermission('invoices:read'), async (c) => {
    const u = me(c)
    if (c.req.query('settle') !== '0') { try { await rent.settle(u.companyId) } catch (e: any) { d.logger.warn('[booth-rent] billing run skipped', { error: e?.message }) } }
    const rows: RenterRow[] = await db.select().from(boothRenter).where(eq(boothRenter.companyId, u.companyId)).orderBy(boothRenter.createdAt)
    const tries = readRetry(await settingsOf(db, u.companyId)).tries
    const out = []
    for (const r of rows) out.push(await view(r, { tries }))
    out.sort((a, b) => (a.status === 'ended' ? 1 : 0) - (b.status === 'ended' ? 1 : 0) || a.name.localeCompare(b.name))
    return listAll(c, out)
  })

  // POST /api/booth-rent/renters — a Team member (teamMemberId) or a new one (name, email, phone), their rent and its schedule.
  app.post('/renters', requirePermission('invoices:create'), async (c) => {
    const u = me(c)
    const body = (await c.req.json().catch(() => null)) ?? {}
    const today = await salon.clock.salonToday(u.companyId)
    const parsed = parseRenter(body, { today })
    const fields: Record<string, string> = 'fields' in parsed ? { ...parsed.fields } : {}
    let member: any = null
    if (body.teamMemberId) {
      ;[member] = await db.select().from(teamMember).where(and(eq(teamMember.id, String(body.teamMemberId)), eq(teamMember.companyId, u.companyId))).limit(1)
      if (!member) return fail(c, 404, 'That Team member was not found.', 'NOT_FOUND')
    } else {
      const name = String(body.name ?? '').trim()
      if (!name) fields.name = 'Enter the renter\'s name, or choose a Team member.'
      if (body.email && !EMAIL.test(String(body.email).trim())) fields.email = 'That email does not look right.'
    }
    if (Object.keys(fields).length) return fail(c, 400, 'Check the highlighted boxes.', 'VALIDATION', fields)
    const v = (parsed as { values: RenterInput }).values

    const [existing] = member ? await db.select().from(boothRenter).where(and(eq(boothRenter.companyId, u.companyId), eq(boothRenter.teamMemberId, member.id))).limit(1) : []
    if (existing && existing.status !== 'ended') return fail(c, 409, `${member.name} already rents a chair. Change their rent from their row.`, 'ALREADY_RENTER')

    if (!member) {
      ;[member] = await db.insert(teamMember).values({ companyId: u.companyId, name: String(body.name).trim(), email: body.email ? String(body.email).trim() : null, phone: body.phone ? String(body.phone).trim() : null, role: 'Chair renter', active: true } as any).returning()
    }
    const from = v.startDate > today ? v.startDate : v.startDate
    const nextDue = firstDue(from, v.frequency, v.dueWeekday, v.dueDay)
    let row: RenterRow
    if (existing) {
      // A renter who left comes back: the same renter, a new start; what they owed stays in their ledger.
      ;[row] = await db.update(boothRenter).set({ ...v, status: 'active', nextDue, endedOn: null, pausedForPaymentAt: null, cardToken: null, updatedAt: new Date() }).where(eq(boothRenter.id, existing.id)).returning()
    } else {
      const [ct] = await db.insert(contact).values({ companyId: u.companyId, name: member.name, email: member.email ?? null, phone: member.phone ?? null, type: 'other' } as any).returning()
      ;[row] = await db.insert(boothRenter).values({ companyId: u.companyId, teamMemberId: member.id, contactId: ct.id, status: 'active', ...v, nextDue }).returning()
    }
    await audit.log({ action: 'create', entity: 'booth_renter', entityId: row.id, entityName: member.name, req: { user: u } })
    refresh(u.companyId)
    // Rent already due on the start day is invoiced now.
    await rent.settle(u.companyId).catch(() => {})
    const tries = readRetry(await settingsOf(db, u.companyId)).tries
    const [fresh] = await db.select().from(boothRenter).where(eq(boothRenter.id, row.id)).limit(1)
    return one(c, await view(fresh, { tries }), 201)
  })

  app.get('/renters/:id', requirePermission('invoices:read'), async (c) => {
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    return one(c, await view(r, { tries: readRetry(await settingsOf(db, r.companyId)).tries }))
  })

  // PATCH /api/booth-rent/renters/:id — a new rent or schedule. It applies to periods not yet invoiced; what was invoiced stays as it was.
  app.patch('/renters/:id', requirePermission('invoices:update'), async (c) => {
    const u = me(c)
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    if (r.status === 'ended') return fail(c, 409, 'This renter has left. Add them again to start a new rent.', 'ENDED')
    const body = (await c.req.json().catch(() => null)) ?? {}
    const today = await salon.clock.salonToday(u.companyId)
    const parsed = parseRenter(body, { current: inputOf(r), today })
    if ('fields' in parsed) return fail(c, 400, 'Check the highlighted boxes.', 'VALIDATION', parsed.fields)
    const v = parsed.values
    const schedule = v.frequency !== r.frequency || v.dueWeekday !== r.dueWeekday || v.dueDay !== r.dueDay
    // A moved schedule starts from the day after the last period billed (or the start), so no stretch is billed twice or skipped silently.
    let nextDue = r.nextDue
    if (schedule) {
      const [lastP]: any[] = await db.select({ period: boothRentPeriod.period }).from(boothRentPeriod).where(eq(boothRentPeriod.renterId, r.id)).orderBy(desc(boothRentPeriod.period)).limit(1)
      const after = lastP ? plusDays(lastP.period, 1) : v.startDate
      nextDue = rescheduleFrom(after > v.startDate ? after : v.startDate, v.frequency, v.dueWeekday, v.dueDay)
    } else if (v.startDate !== r.startDate && !(await db.select({ id: boothRentPeriod.id }).from(boothRentPeriod).where(eq(boothRentPeriod.renterId, r.id)).limit(1)).length) {
      nextDue = firstDue(v.startDate, v.frequency, v.dueWeekday, v.dueDay)
    }
    const [updated] = await db.update(boothRenter).set({ ...v, nextDue, updatedAt: new Date() }).where(eq(boothRenter.id, r.id)).returning()
    await audit.log({ action: 'update', entity: 'booth_renter', entityId: r.id, changes: audit.diff(r, updated), req: { user: u } })
    refresh(u.companyId)
    return one(c, await view(updated, { tries: readRetry(await settingsOf(db, u.companyId)).tries }))
  })

  // POST /api/booth-rent/renters/:id/end — the renter leaves today: what is due up to today is invoiced first; open invoices stay open.
  app.post('/renters/:id/end', requirePermission('invoices:update'), async (c) => {
    const u = me(c)
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    if (r.status === 'ended') return fail(c, 409, 'This renter has already left.', 'ENDED')
    await rent.settle(u.companyId).catch(() => {})
    const today = await salon.clock.salonToday(u.companyId)
    const [updated] = await db.update(boothRenter).set({ status: 'ended', endedOn: today, nextDue: null, autoCharge: false, cardToken: null, pausedForPaymentAt: null, updatedAt: new Date() }).where(eq(boothRenter.id, r.id)).returning()
    await audit.log({ action: 'update', entity: 'booth_renter', entityId: r.id, metadata: { status: 'ended' }, req: { user: u } })
    refresh(u.companyId)
    return one(c, await view(updated, { tries: readRetry(await settingsOf(db, u.companyId)).tries }))
  })

  // PUT /api/booth-rent/renters/:id/auto-pay — { on, renterAgreed }: charge the renter's card on file each time rent is invoiced, or stop.
  app.put('/renters/:id/auto-pay', requirePermission('invoices:update'), async (c) => {
    const u = me(c)
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    if (typeof body.on !== 'boolean') return fail(c, 400, 'Say whether automatic card payments are on.', 'VALIDATION', { on: 'Choose on or off.' })
    if (body.on) {
      if (r.status === 'ended') return fail(c, 409, 'This renter has left.', 'ENDED')
      if (body.renterAgreed !== true) return fail(c, 400, 'Confirm the renter has agreed to have their rent charged to their card automatically.', 'CONSENT_REQUIRED', { renterAgreed: 'Tick that the renter agreed.' })
      if (!(await d.features.isFeatureEnabled(u.companyId, 'card_on_file'))) return fail(c, 409, 'Card on file is not switched on for this salon.', 'FEATURE_OFF')
      const [card] = await salon.cards.cardsOf(u.companyId, r.contactId)
      if (!card) return fail(c, 409, 'This renter has no card on file. Add one first (Add a card, or send them the link).', 'NO_CARD')
    }
    const [updated] = await db.update(boothRenter).set(body.on
      ? { autoCharge: true, autoChargeConsentAt: new Date(), autoChargeConsentVia: 'staff', autoChargeConsentUserId: uid(c), updatedAt: new Date() }
      : { autoCharge: false, updatedAt: new Date() }).where(eq(boothRenter.id, r.id)).returning()
    await audit.log({ action: 'update', entity: 'booth_renter', entityId: r.id, changes: audit.diff(r, updated), req: { user: u } })
    refresh(u.companyId)
    return one(c, await view(updated, { tries: readRetry(await settingsOf(db, u.companyId)).tries }))
  })

  // POST /api/booth-rent/renters/:id/card-link — email the renter their private page to give a card (and agree to autopay there).
  app.post('/renters/:id/card-link', requirePermission('invoices:update'), async (c) => {
    const u = me(c)
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    if (r.status === 'ended') return fail(c, 409, 'This renter has left.', 'ENDED')
    if (!(await d.features.isFeatureEnabled(u.companyId, 'card_on_file'))) return fail(c, 409, 'Card on file is not switched on for this salon.', 'FEATURE_OFF')
    const [ct]: any[] = await db.select({ name: contact.name, email: contact.email }).from(contact).where(eq(contact.id, r.contactId)).limit(1)
    if (!ct?.email) return fail(c, 409, 'This renter has no email address. Add one to their Team record first.', 'NO_EMAIL')
    const token = r.cardToken || createId() + createId()
    if (!r.cardToken) await db.update(boothRenter).set({ cardToken: token, updatedAt: new Date() }).where(eq(boothRenter.id, r.id))
    await d.services.emailService.send(ct.email, 'boothRentCardLink', { contactName: (ct.name || '').trim().split(/\s+/)[0] || 'there', rent: rentWords(r), link: `${siteOrigin()}/api/renter-card/${token}` })
    await audit.log({ action: 'update', entity: 'booth_renter', entityId: r.id, metadata: { cardLinkSent: true }, req: { user: u } })
    return done(c, `The link was emailed to ${ct.email}.`)
  })

  // POST /api/booth-rent/renters/:id/card-setup — Stripe's own page to save a card with the renter at the desk.
  app.post('/renters/:id/card-setup', requirePermission('invoices:update'), async (c) => {
    const u = me(c)
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    if (r.status === 'ended') return fail(c, 409, 'This renter has left.', 'ENDED')
    if (!(await d.features.isFeatureEnabled(u.companyId, 'card_on_file'))) return fail(c, 409, 'Card on file is not switched on for this salon.', 'FEATURE_OFF')
    let started: { url: string } | null = null
    try { started = await salon.cards.startSetup(u.companyId, r.contactId, 'staff_at_desk', uid(c), undefined, { booth_renter_id: r.id }) }
    catch (e: any) { d.logger.warn('[booth-rent] card page not opened', { error: e?.message }) }
    if (!started) return fail(c, 503, 'Card payments are not set up for this salon, or are not available right now.', 'CARDS_UNAVAILABLE')
    return one(c, { url: started.url })
  })

  app.post('/renters/:id/retry', requirePermission('invoices:update'), async (c) => {
    const u = me(c)
    const out = await rent.retryNow(c.req.param('id'), u.companyId, uid(c))
    if (!out) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    if (out.outcome === 'not_active') return fail(c, 409, out.status === 'paused' ? 'Autopay is paused — use Resume.' : 'Only an active renter can be charged.', 'NOT_ACTIVE')
    if (out.outcome === 'no_invoice') return fail(c, 409, 'There is no declined charge to try again.', 'NOTHING_TO_RETRY')
    if (out.outcome === 'no_tries_left') return fail(c, 409, 'Every try has been used. Resume autopay once the renter has a new card.', 'NO_TRIES_LEFT')
    refresh(u.companyId)
    const [row] = await db.select().from(boothRenter).where(eq(boothRenter.id, c.req.param('id'))).limit(1)
    return one(c, { ...(await view(row, { tries: readRetry(await settingsOf(db, u.companyId)).tries })), retryResult: out.outcome })
  })

  app.post('/renters/:id/resume', requirePermission('invoices:update'), async (c) => {
    const u = me(c)
    const out = await rent.resume(c.req.param('id'), u.companyId)
    if (!out) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    if (out.status === 'not_paused') return fail(c, 409, 'Only a renter whose autopay was paused for a declined card can be resumed.', 'NOT_PAUSED')
    refresh(u.companyId)
    const [row] = await db.select().from(boothRenter).where(eq(boothRenter.id, c.req.param('id'))).limit(1)
    return one(c, { ...(await view(row, { tries: readRetry(await settingsOf(db, u.companyId)).tries })), resumeResult: out.outcome })
  })

  // POST /api/booth-rent/renters/:id/waive — { period, reason }: waive one rent day (before it is invoiced, or while its invoice is unpaid).
  app.post('/renters/:id/waive', requirePermission('invoices:update'), async (c) => {
    const u = me(c)
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const reason = String(body.reason ?? '').trim()
    if (reason.length < 3) return fail(c, 400, 'Say why you are waiving it.', 'VALIDATION', { reason: 'Say why you are waiving it.' })
    const out = await rent.waive(r, String(body.period ?? ''), reason.slice(0, 200), uid(c))
    if ('error' in out) return fail(c, out.status, out.error, out.code)
    const [row] = await db.select().from(boothRenter).where(eq(boothRenter.id, r.id)).limit(1)
    return one(c, await view(row, { tries: readRetry(await settingsOf(db, u.companyId)).tries }))
  })

  app.get('/renters/:id/ledger', requirePermission('invoices:read'), async (c) => {
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    const lines = await rent.ledgerOf(r)
    return one(c, { lines, balanceCents: lines.length ? lines[lines.length - 1].balanceCents : 0 })
  })

  async function range(c: any, r: RenterRow) {
    const today = await salon.clock.salonToday(r.companyId)
    const from = c.req.query('from') ?? c.req.query('start') ?? r.startDate
    const to = c.req.query('to') ?? c.req.query('end') ?? today
    if (!isYmd(from) || !isYmd(to)) return { problem: fail(c, 400, 'Choose the first and last day of the statement.', 'VALIDATION', { from: 'Enter a date.', to: 'Enter a date.' }) }
    if (from > to) return { problem: fail(c, 400, 'The first day is after the last day.', 'VALIDATION', { from: 'Start on or before the last day.' }) }
    return { from, to }
  }

  // GET /api/booth-rent/renters/:id/statement?from=&to=[&format=csv]
  app.get('/renters/:id/statement', requirePermission('invoices:read'), async (c) => {
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    const rg = await range(c, r)
    if ('problem' in rg) return rg.problem
    const s = await rent.statementOf(r, rg.from!, rg.to!)
    const [m]: any[] = await db.select({ name: teamMember.name }).from(teamMember).where(eq(teamMember.id, r.teamMemberId)).limit(1)
    if (c.req.query('format') === 'csv') {
      c.header('Content-Type', 'text/csv; charset=utf-8')
      c.header('Content-Disposition', `attachment; filename="rent-statement-${(m?.name || 'renter').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${s.from}-to-${s.to}.csv"`)
      return c.body(statementCsv(m?.name || 'Renter', s))
    }
    return one(c, { renter: m?.name ?? 'Renter', ...s })
  })

  app.post('/renters/:id/statement/email', requirePermission('invoices:update'), async (c) => {
    const r = await mine(c)
    if (!r) return fail(c, 404, 'Renter not found', 'NOT_FOUND')
    const body = (await c.req.json().catch(() => null)) ?? {}
    const today = await salon.clock.salonToday(r.companyId)
    const from = body.from ?? r.startDate
    const to = body.to ?? today
    if (!isYmd(from) || !isYmd(to) || from > to) return fail(c, 400, 'Choose the first and last day of the statement.', 'VALIDATION', { from: 'Enter a first day on or before the last day.' })
    const out = await rent.emailStatement(r, from, to)
    if (out === 'no_email') return fail(c, 409, 'This renter has no email address. Add one to their Team record first.', 'NO_EMAIL')
    return done(c, 'The statement was emailed.')
  })

  app.post('/run', requirePermission('invoices:create'), async (c) => {
    const billed = await rent.settle(me(c).companyId)
    return one(c, { billed: billed.length, invoices: billed })
  })

  return app
}

// ---- the renter's own page

const page = (title: string, name: string, inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}main{max-width:30rem;margin:12vh auto;padding:2rem;background:#fff;border:1px solid #e2e8f0;border-radius:12px}h1{font-size:1.4rem;margin:0 0 .5rem}button{font:inherit;padding:.7rem 1.2rem;border:0;border-radius:8px;background:#0f766e;color:#fff;cursor:pointer}p.s{color:#475569}label{display:flex;gap:.6rem;align-items:flex-start;margin:1rem 0}</style></head>
<body><main><p class="s">${escHtml(name)}</p>${inner}</main></body></html>`

/** The renter's private page: give a card for rent (and agree to autopay), or give a new one after a decline. The card is saved on Stripe's own page. */
export function createRenterCardRoutes(d: CrmDeps, cards: SalonServices['cards']) {
  const { db } = d
  const app = new Hono()
  async function byToken(token: string) {
    if (!token || token.length < 20) return null
    const [r] = await db.select().from(boothRenter).where(and(eq(boothRenter.cardToken, token), inArray(boothRenter.status, ['active', 'paused']))).limit(1)
    if (!r) return null
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, r.companyId)).limit(1)
    return { r: r as RenterRow, salon: co?.name || '' }
  }
  app.use('*', async (c, next) => { await next(); c.header('X-Robots-Tag', 'noindex, nofollow'); c.header('Cache-Control', 'no-store') })

  app.get('/:token', async (c) => {
    const f = await byToken(c.req.param('token'))
    if (!f) return c.html(page('Card', '', '<h1>This link is no longer needed</h1><p>Your rent is not waiting for a card. If you think that is wrong, please contact the salon.</p>'), 404)
    const { r, salon } = f
    const paused = r.status === 'paused'
    const agree = r.autoCharge ? '' : `<label><input type="checkbox" name="agree" value="1" required> <span>I agree that ${escHtml(salon || 'the salon')} may charge this card for my chair rent (${escHtml(rentWords(r))}) each time it is due, until I or the salon stop it.</span></label>`
    return c.html(page(paused ? 'Update your card' : 'Pay your rent by card', salon, `<h1>${paused ? 'Update your card' : 'Pay your rent by card'}</h1><p>${paused ? 'We could not take your chair rent, so automatic payments are paused until a card works. Give us a new card on our payment provider&rsquo;s secure page — the unpaid rent is taken then.' : `Your chair rent is ${escHtml(rentWords(r))}. Give us a card on our payment provider&rsquo;s secure page and it is charged when each rent is due.`}</p>
<form method="post" action="">${agree}<button type="submit">${paused ? 'Update my card' : 'Add my card'}</button></form>`))
  })

  app.post('/:token', async (c) => {
    const f = await byToken(c.req.param('token'))
    if (!f) return c.html(page('Card', '', '<h1>This link is no longer needed</h1><p>Your rent is not waiting for a card.</p>'), 404)
    const { r } = f
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>))
    if (!r.autoCharge && form.agree !== '1') return c.html(page('Card', f.salon, '<h1>One more step</h1><p>Please tick the box to agree to automatic payments. Go back and try again.</p>'), 400)
    let started: { url: string } | null = null
    try { started = await cards.startSetup(r.companyId, r.contactId, 'client_online', null, undefined, { booth_renter_id: r.id, ...(r.autoCharge ? {} : { booth_autopay: '1' }) }) }
    catch (e: any) { d.logger.warn('[booth-rent] card page not opened', { error: e?.message || String(e) }) }
    if (!started) return c.html(page('Card', f.salon, '<h1>Card page not available</h1><p>We could not open the card page right now. Please try again later or contact the salon.</p>'), 503)
    return c.redirect(started.url, 303)
  })
  return app
}
