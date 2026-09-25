/**
 * lib/crm/guests.ts — the Regulars list.
 *
 * A guest is created only when someone gives their number (at the bar or on
 * /regulars). Email consent is separate and recorded with its evidence in
 * `subscribers` (timestamp, where, IP, the exact words shown) — SPEC §12.
 * Visits, spend and points are counted when a check with the guest on it is
 * paid (recordVisit), once per check.
 */
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { db as DB } from '../../db'
import { checkItems, checks, guests, loyaltyLedger, settings as settingsTbl, subscribers } from '../../db/schema'
import { toE164 } from '../sms/twilio'
import { birthdaySoon, loyaltyConfig, pointsFor, type LoyaltyConfig } from './loyalty'

export class GuestError extends Error { constructor(message: string, public status = 400) { super(message) } }

export const EMAIL_CONSENT_TEXT = 'Email me about the Regulars, my birthday, and what is going on at the Amber Inn. About once a month. Unsubscribe any time.'

export async function loyaltySettings(db: typeof DB): Promise<LoyaltyConfig> {
  const [s] = await db.select({ loyalty: settingsTbl.loyalty }).from(settingsTbl).limit(1)
  return loyaltyConfig(s?.loyalty)
}

const clean = (v: unknown, max: number) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null }
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)

export interface GuestSummary { id: string; name: string; phone: string | null; visitCount: number; lastVisitAt: string | null; pointsBalance: number }
const summary = (g: typeof guests.$inferSelect): GuestSummary => ({ id: g.id, name: g.name, phone: g.phone, visitCount: g.visitCount, lastVisitAt: g.lastVisitAt ? g.lastVisitAt.toISOString() : null, pointsBalance: g.pointsBalance })

/** Search by phone digits (3+), name or email. */
export async function searchGuests(db: typeof DB, q: string): Promise<GuestSummary[]> {
  const term = q.trim().slice(0, 60)
  if (term.length < 2) return []
  const digits = term.replace(/\D/g, '')
  const where = digits.length >= 3 && digits.length === term.replace(/[\s()+.-]/g, '').length
    ? sql`regexp_replace(coalesce(${guests.phone}, ''), '\\D', '', 'g') like ${'%' + digits + '%'}`
    : or(ilike(guests.name, `%${term}%`), ilike(guests.email, `%${term}%`))
  const rows = await db.select().from(guests).where(where).orderBy(desc(guests.lastVisitAt), guests.name).limit(8)
  return rows.map(summary)
}

export interface SaveGuestInput {
  name?: unknown; phone?: unknown; email?: unknown; birthdayMonth?: unknown; birthdayDay?: unknown; note?: unknown
  emailConsent?: boolean; consentSource?: string; consentIp?: string | null
}

/**
 * Create or update a guest, matched by phone ONLY. An email never finds a
 * record: otherwise anyone who knows a regular's email could overwrite their
 * name and number from the public sign-up.
 */
export async function saveGuest(db: typeof DB, input: SaveGuestInput, source: 'register' | 'website'): Promise<typeof guests.$inferSelect> {
  const name = clean(input.name, 60)
  const phone = input.phone ? toE164(String(input.phone)) : null
  const emailRaw = clean(input.email, 120)?.toLowerCase() || null
  if (!name) throw new GuestError('Put a name on it.')
  if (!phone) throw new GuestError('We need a phone number. It is how the bar finds you.')
  if (emailRaw && !emailOk(emailRaw)) throw new GuestError('That email does not look right.')
  if (input.emailConsent && !emailRaw) throw new GuestError('Add an email to get the emails.')
  const m = Number(input.birthdayMonth), d = Number(input.birthdayDay)
  const bday = Number.isInteger(m) && m >= 1 && m <= 12 && Number.isInteger(d) && d >= 1 && d <= new Date(Date.UTC(2024, m, 0)).getUTCDate() ? { birthdayMonth: m, birthdayDay: d } : {}
  let [g] = await db.select().from(guests).where(eq(guests.phone, phone)).limit(1)
  // The public form never touches an existing guest: knowing someone's number isn't
  // being them. Say nothing that reveals the number is on the list; only record the
  // email consent they gave (on its own, not linked to that guest).
  const existingFromWebsite = !!g && source === 'website'
  if (emailRaw && !existingFromWebsite) {
    const [clash] = await db.select({ id: guests.id }).from(guests).where(eq(guests.email, emailRaw)).limit(1)
    if (clash && (!g || clash.id !== g.id)) throw new GuestError('That email is already on the list under another number.', 409)
  }
  const note = input.note !== undefined ? clean(input.note, 200) : undefined
  if (existingFromWebsite) {
    // leave the guest exactly as they are
  } else if (g) {
    ;[g] = await db.update(guests).set({ name, phone, ...(emailRaw ? { email: emailRaw } : {}), ...bday, ...(note !== undefined ? { note } : {}), updatedAt: new Date() }).where(eq(guests.id, g.id)).returning()
  } else {
    ;[g] = await db.insert(guests).values({ name, phone, email: emailRaw, ...bday, note: note ?? null, source }).returning()
  }
  if (input.emailConsent && emailRaw) {
    // Consent evidence: when, where, from what IP, and the exact words they agreed to.
    const [sub] = await db.select().from(subscribers).where(eq(subscribers.email, emailRaw)).limit(1)
    const values = { name, guestId: existingFromWebsite ? null : g.id, birthdayMonth: existingFromWebsite ? null : g.birthdayMonth, birthdayDay: existingFromWebsite ? null : g.birthdayDay, consentSource: input.consentSource || (source === 'website' ? 'website:/regulars' : 'register'), consentText: EMAIL_CONSENT_TEXT, consentAt: new Date(), consentIp: input.consentIp || null, unsubscribedAt: null }
    if (sub) await db.update(subscribers).set(values).where(eq(subscribers.id, sub.id))
    else await db.insert(subscribers).values({ email: emailRaw, ...values })
  }
  return g
}

export interface GuestProfile {
  id: string; name: string; phone: string | null; email: string | null; note: string | null
  visitCount: number; lifetimeCents: number; firstVisitAt: string | null; lastVisitAt: string | null
  birthday: string | null; birthdaySoon: boolean
  usual: Array<{ name: string; qty: number }>
  pointsBalance: number; rewardReady: boolean; rewardCents: number; rewardPoints: number; emailOk: boolean
}

export async function guestProfile(db: typeof DB, guestId: string, tz: string): Promise<GuestProfile> {
  const [g] = await db.select().from(guests).where(eq(guests.id, guestId)).limit(1)
  if (!g) throw new GuestError('That guest is gone.', 404)
  const cfg = await loyaltySettings(db)
  // "The usual": what they order most, from their paid checks.
  const usual = await db.select({ name: checkItems.name, size: checkItems.size, qty: sql<number>`sum(${checkItems.qty})::int` })
    .from(checkItems).innerJoin(checks, eq(checks.id, checkItems.checkId))
    .where(and(eq(checks.guestId, g.id), eq(checks.status, 'paid'), eq(checkItems.kind, 'item'), sql`${checkItems.state} <> 'void'`))
    .groupBy(checkItems.name, checkItems.size).orderBy(sql`sum(${checkItems.qty}) desc`).limit(3)
  const [sub] = g.email ? await db.select({ un: subscribers.unsubscribedAt }).from(subscribers).where(eq(subscribers.email, g.email)).limit(1) : []
  const now = new Date()
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number)
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return {
    id: g.id, name: g.name, phone: g.phone, email: g.email, note: g.note,
    visitCount: g.visitCount, lifetimeCents: g.lifetimeCents,
    firstVisitAt: g.firstVisitAt ? g.firstVisitAt.toISOString() : null, lastVisitAt: g.lastVisitAt ? g.lastVisitAt.toISOString() : null,
    birthday: g.birthdayMonth && g.birthdayDay ? `${MONTHS[g.birthdayMonth - 1]} ${g.birthdayDay}` : null,
    birthdaySoon: birthdaySoon(g.birthdayMonth, g.birthdayDay, { year: local[0], month: local[1], day: local[2] }),
    usual: usual.map(u => ({ name: u.name + (u.size ? ` (${u.size.toLowerCase()})` : ''), qty: u.qty })),
    pointsBalance: g.pointsBalance, rewardReady: cfg.enabled && g.pointsBalance >= cfg.rewardPoints, rewardCents: cfg.rewardCents, rewardPoints: cfg.rewardPoints,
    emailOk: !!sub && !sub.un,
  }
}

/**
 * A check with a guest on it was paid: count the visit, the spend and the
 * points. Once per check (the ledger row for the visit is the guard).
 */
export async function recordVisit(db: typeof DB, checkId: string): Promise<void> {
  const [c] = await db.select().from(checks).where(eq(checks.id, checkId)).limit(1)
  if (!c || !c.guestId || c.status !== 'paid') return
  const [already] = await db.select({ id: loyaltyLedger.id }).from(loyaltyLedger).where(and(eq(loyaltyLedger.checkId, checkId), eq(loyaltyLedger.reason, 'visit'))).limit(1)
  if (already) return
  const items = await db.select().from(checkItems).where(and(eq(checkItems.checkId, checkId), eq(checkItems.kind, 'item')))
  const earning = items.filter(i => i.state !== 'void').reduce((s, i) => s + i.qty * i.unitPriceCents, 0)
  const points = pointsFor(earning, await loyaltySettings(db))
  const when = c.closedAt || new Date()
  await db.transaction(async (tx) => {
    await tx.insert(loyaltyLedger).values({ guestId: c.guestId as string, points, reason: 'visit', checkId, by: c.closedBy })
    await tx.update(guests).set({
      visitCount: sql`${guests.visitCount} + 1`,
      lifetimeCents: sql`${guests.lifetimeCents} + ${c.subtotalCents || 0}`,
      pointsBalance: sql`${guests.pointsBalance} + ${points}`,
      firstVisitAt: sql`coalesce(${guests.firstVisitAt}, ${when})`,
      lastVisitAt: when, updatedAt: new Date(),
    }).where(eq(guests.id, c.guestId as string))
  })
}

/** Find a guest by phone without creating one (web orders only credit people already on the list). */
export async function guestByPhone(db: typeof DB, phone: string | null): Promise<string | null> {
  const e = phone ? toE164(phone) : null
  if (!e) return null
  const [g] = await db.select({ id: guests.id }).from(guests).where(eq(guests.phone, e)).limit(1)
  return g?.id || null
}

