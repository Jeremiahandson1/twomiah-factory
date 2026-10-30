// Automatic retention sends (salon gap #9; feature `retention_sends`, off for every salon until its owner switches the parts on).
// Today's lists — due to rebook, birthdays, lapsed — are sent by hand. This sends by itself, once per client per event:
//   · rebook      on a service's due date (not before the owner switched it on, and not more than a few days late)
//   · birthday    on the day, once a year
//   · win-back    when a client's last visit becomes N days old (the owner sets N), if they hold no future appointment
//   · next visit  a "book your next visit" prompt shortly after a visit is completed, if they hold no future appointment
//   · drips       completed visits and lapses start the salon's own follow-up sequences (marketing triggers visit_completed / lapsed)
// The rules every send follows: a TEXT goes only to a number that agreed to be texted (site/smsConsent.ts) and never to one that
// replied STOP; otherwise an EMAIL, never to an unsubscribed address, always with the unsubscribe link; nothing goes in the owner's
// quiet hours (it waits for the next pass); one message of these per client per week; and the ledger (retention_send) is
// unique per client and event, so a pass can run any number of times and send each thing once.
import { Hono } from 'hono'
import { and, eq, gt, gte, inArray, isNotNull, lte, ne } from 'drizzle-orm'
import { categoryKey, publicApiBase, tzParts } from '@twomiah/tenant-backend'
import { appointment, clientProfile, company, contact, retentionSend, serviceMenu } from '../../db/schema/index.ts'
import { activeSequencesForTrigger, clientsLastSeenBetween } from '../../data/salon.ts'
import { hasConsent, phoneE164 } from '../../site/smsConsent.ts'
import { siteOrigin } from '../../booking/happenings.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, listAll, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { calendarDateIn, shiftDays, salonDayStart } from './days.ts'
import type { SalonServices } from './services.ts'

export const KINDS = ['rebook', 'birthday', 'win_back', 'next_visit'] as const
type Kind = (typeof KINDS)[number]
const MESSAGE_TOKENS = ['firstName', 'salon', 'service', 'link']
const DAY = 86400_000
/** Grace between a visit being completed and the "book your next visit" prompt: the client is still at the desk. */
const NEXT_VISIT_GRACE_MS = 30 * 60_000
/** A rebooking that is more than this many days past its due date is not chased by this (it is the owner's win-back list). */
const REBOOK_LATE_DAYS = 3
const COOLDOWN_DAYS = 7

export interface RetentionSettings {
  rebook: boolean; birthday: boolean; winBack: boolean; nextVisit: boolean; drips: boolean
  winBackDays: number
  quietStart: string; quietEnd: string
  /** When the first part was switched on: nothing earlier than this is ever sent (no old history). */
  since: string | null
  templates: Partial<Record<Kind, string>>
}
export const RETENTION_DEFAULTS: RetentionSettings = {
  rebook: false, birthday: false, winBack: false, nextVisit: false, drips: false,
  winBackDays: 90, quietStart: '21:00', quietEnd: '09:00', since: null, templates: {},
}
const anyOn = (s: RetentionSettings) => s.rebook || s.birthday || s.winBack || s.nextVisit || s.drips
export const retentionOf = (settings: any): RetentionSettings => {
  const r = (settings && typeof settings === 'object' ? settings.retention : null) || {}
  return {
    ...RETENTION_DEFAULTS, ...r,
    templates: r.templates && typeof r.templates === 'object' ? r.templates : {},
  }
}

const hm = /^([01]\d|2[0-3]):([0-5]\d)$/
const minutesOf = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
/** Is this minute-of-day inside the quiet window (which may wrap midnight)? Equal start and end means no quiet hours. */
export function inQuietHours(minuteOfDay: number, start: string, end: string): boolean {
  const a = minutesOf(start), b = minutesOf(end)
  if (a === b) return false
  return a < b ? minuteOfDay >= a && minuteOfDay < b : minuteOfDay >= a || minuteOfDay < b
}

const DEFAULT_WORDS: Record<Kind, string> = {
  rebook: "{salon}: Hi {firstName}, it's about time for your next {service}. Book online: {link}",
  birthday: '{salon}: Happy birthday, {firstName}! Treat yourself — book your next visit: {link}',
  win_back: '{salon}: Hi {firstName}, we miss you! Book your next visit: {link}',
  next_visit: '{salon}: Thanks for coming in, {firstName}! Book your next visit now: {link}',
}
const SUBJECTS: Record<Kind, string> = {
  rebook: 'Time for your next visit to {salon}', birthday: 'Happy birthday from {salon}',
  win_back: 'We miss you at {salon}', next_visit: 'Book your next visit at {salon}',
}
const fill = (text: string, v: Record<string, string>) => text.replace(/\{\s*(\w+)\s*\}/g, (_m, k) => v[k] ?? '')
const escHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

export interface Candidate { contactId: string; kind: Kind | 'drip_visit_completed' | 'drip_lapsed'; eventKey: string; service?: string }
export interface PassResult { quiet: boolean; sent: number; skipped: number; failed: number; wouldSend: Array<{ client: string | null; kind: string; via: string }> }

export function createRetention(d: CrmDeps, salon: SalonServices) {
  const { db, logger } = d

  async function settingsFor(companyId: string): Promise<{ settings: any; r: RetentionSettings }> {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings = (typeof co?.settings === 'string' ? JSON.parse(co.settings || '{}') : co?.settings) || {}
    return { settings, r: retentionOf(settings) }
  }

  /** Everything this pass might send, from the rules above. */
  async function candidates(companyId: string, r: RetentionSettings, now: Date, tz: string): Promise<Candidate[]> {
    const out: Candidate[] = []
    const today = calendarDateIn(now, tz)
    const sinceDay = r.since ? calendarDateIn(new Date(r.since), tz) : today
    const since = r.since ? new Date(r.since) : now

    if (r.rebook) {
      const rows = await salon.rebooking.dueRebookings(companyId, { windowDays: 1, maxOverdue: REBOOK_LATE_DAYS })
      for (const row of rows) {
        if (row.dueDate > today || row.dueDate < sinceDay) continue
        out.push({ contactId: row.contactId, kind: 'rebook', eventKey: `${categoryKey(row.category)}:${row.dueDate}`, service: row.serviceName })
      }
    }
    if (r.birthday) {
      const [y, m, dd] = today.split('-').map(Number)
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
      const rows = await db.select({ contactId: clientProfile.contactId, birthday: clientProfile.birthday }).from(clientProfile)
        .where(and(eq(clientProfile.companyId, companyId), isNotNull(clientProfile.birthday)))
      for (const row of rows as any[]) {
        const [, bm, bd] = String(row.birthday).split('-').map(Number)
        const same = (bm === m && bd === dd) || (!leap && bm === 2 && bd === 29 && m === 2 && dd === 28)
        if (same) out.push({ contactId: row.contactId, kind: 'birthday', eventKey: String(y) })
      }
    }
    if (r.winBack || r.drips) {
      // Whose last visit became N days old in the last week, and not before the owner switched this on.
      const lineDay = shiftDays(today, -r.winBackDays)
      const fromDay = shiftDays(lineDay, -7)
      const rows = await clientsLastSeenBetween(db, companyId, salonDayStart(fromDay, tz).toISOString(), salonDayStart(shiftDays(lineDay, 1), tz).toISOString(), 1000)
      for (const row of rows) {
        const last = new Date(row.lastVisit as string)
        const becameLapsed = shiftDays(calendarDateIn(last, tz), r.winBackDays)
        if (becameLapsed < sinceDay) continue
        if (r.winBack) out.push({ contactId: row.contactId, kind: 'win_back', eventKey: calendarDateIn(last, tz) })
        if (r.drips) out.push({ contactId: row.contactId, kind: 'drip_lapsed', eventKey: calendarDateIn(last, tz) })
      }
    }
    if (r.nextVisit || r.drips) {
      const done = await db.select({ id: appointment.id, contactId: appointment.contactId, updatedAt: appointment.updatedAt }).from(appointment).where(and(
        eq(appointment.companyId, companyId), eq(appointment.status, 'completed'), isNotNull(appointment.contactId),
        gte(appointment.startTime, new Date(now.getTime() - 2 * DAY)), lte(appointment.updatedAt, new Date(now.getTime() - NEXT_VISIT_GRACE_MS)),
        gte(appointment.updatedAt, since),
      ))
      for (const a of done as any[]) {
        if (r.nextVisit) out.push({ contactId: a.contactId, kind: 'next_visit', eventKey: a.id })
        if (r.drips) out.push({ contactId: a.contactId, kind: 'drip_visit_completed', eventKey: a.id })
      }
    }
    return out
  }

  /** A client who holds an appointment yet to come needs no prompt to book one. */
  async function hasFutureVisit(companyId: string, contactId: string, now: Date): Promise<boolean> {
    const rows = await db.select({ id: appointment.id }).from(appointment).where(and(
      eq(appointment.companyId, companyId), eq(appointment.contactId, contactId), gt(appointment.startTime, now),
      inArray(appointment.status, ['scheduled', 'confirmed', 'checked_in']),
    )).limit(1)
    return rows.length > 0
  }

  /** How a client would be reached, or why not. */
  async function reach(companyId: string, ct: typeof contact.$inferSelect): Promise<{ via: 'sms' | 'email'; to: string } | { why: string }> {
    const phone = ct.mobile || ct.phone
    if (phone && phoneE164(phone) && !ct.optedOutSms && (await hasConsent(db, companyId, phone))) return { via: 'sms', to: phone }
    if (ct.email && !ct.emailOptOut && publicApiBase()) return { via: 'email', to: ct.email }
    if (ct.email && ct.emailOptOut) return { why: 'They unsubscribed from email and have not agreed to texts.' }
    if (phone && ct.optedOutSms) return { why: 'They replied STOP to texts and have no email.' }
    return { why: phone ? 'They have not agreed to be texted and have no email on file.' : 'No mobile number or email on file.' }
  }

  async function pass(companyId: string, opts: { now?: Date; dryRun?: boolean } = {}): Promise<PassResult> {
    const now = opts.now ?? new Date()
    const result: PassResult = { quiet: false, sent: 0, skipped: 0, failed: 0, wouldSend: [] }
    const { r } = await settingsFor(companyId)
    if (!anyOn(r)) return result
    const tz = await salon.clock.salonTimezone(companyId)
    const parts = tzParts(now, tz)
    result.quiet = inQuietHours(parts.minutes, r.quietStart, r.quietEnd)
    if (result.quiet && !opts.dryRun) return result                     // wait for the next pass

    const wanted = await candidates(companyId, r, now, tz)
    if (!wanted.length) return result
    const ids = [...new Set(wanted.map((w) => w.contactId))]
    const people: Array<typeof contact.$inferSelect> = await db.select().from(contact).where(and(eq(contact.companyId, companyId), inArray(contact.id, ids)))
    const byId = new Map(people.map((p) => [p.id, p]))
    const before = await db.select({ contactId: retentionSend.contactId, kind: retentionSend.kind, eventKey: retentionSend.eventKey, status: retentionSend.status, createdAt: retentionSend.createdAt })
      .from(retentionSend).where(and(eq(retentionSend.companyId, companyId), inArray(retentionSend.contactId, ids)))
    const done = new Set((before as any[]).map((x) => `${x.contactId}|${x.kind}|${x.eventKey}`))
    const coolFrom = now.getTime() - COOLDOWN_DAYS * DAY
    const cooling = new Set((before as any[]).filter((x) => x.status === 'sent' && ['rebook', 'birthday', 'win_back'].includes(x.kind) && new Date(x.createdAt).getTime() >= coolFrom).map((x) => x.contactId))
    const [co] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const salonName = co?.name || 'Your salon'
    const link = `${siteOrigin()}/book`
    const sequencesOn = await d.features.isFeatureEnabled(companyId, ['email_marketing', 'follow_up_sequences'])

    const record = async (c: Candidate, status: string, extra: { channel?: string | null; reason?: string | null; message?: string | null } = {}) => {
      const rows = await db.insert(retentionSend).values({ companyId, contactId: c.contactId, kind: c.kind, eventKey: c.eventKey, status, channel: extra.channel ?? null, reason: extra.reason ?? null, message: extra.message ?? null } as any)
        .onConflictDoNothing().returning({ id: retentionSend.id })
      return rows[0]?.id as string | undefined
    }

    // The most urgent first, so a client with two things due gets the one that matters this week.
    const order: Record<string, number> = { birthday: 0, next_visit: 1, rebook: 2, win_back: 3, drip_visit_completed: 4, drip_lapsed: 5 }
    for (const c of wanted.sort((a, b) => order[a.kind] - order[b.kind])) {
      const key = `${c.contactId}|${c.kind}|${c.eventKey}`
      const ct = byId.get(c.contactId)
      if (!ct || done.has(key)) continue

      // Drips: start the salon's own sequences. Email-only, and the sequence worker holds the unsubscribe rules.
      if (c.kind === 'drip_visit_completed' || c.kind === 'drip_lapsed') {
        if (!sequencesOn) continue
        const trigger = c.kind === 'drip_visit_completed' ? 'visit_completed' : 'lapsed'
        const seqs = await activeSequencesForTrigger(db, companyId, trigger)
        if (!seqs.length) continue
        if (opts.dryRun) { result.wouldSend.push({ client: ct.name, kind: c.kind, via: 'sequence' }); continue }
        const claimed = await record(c, 'pending', { channel: 'drip' })
        if (!claimed) continue
        let started = 0, why = ''
        for (const id of seqs) {
          try { await d.services.marketing.enrollInSequence(id, ct.id, companyId); started++ } catch (e: any) { why = e?.message || 'Not started' }
        }
        await db.update(retentionSend).set({ status: started ? 'sent' : 'skipped', reason: started ? null : why }).where(eq(retentionSend.id, claimed))
        done.add(key); if (started) result.sent++; else result.skipped++
        continue
      }

      if (cooling.has(c.contactId) && c.kind !== 'next_visit') continue
      if ((c.kind === 'win_back' || c.kind === 'next_visit' || c.kind === 'rebook') && (await hasFutureVisit(companyId, c.contactId, now))) continue

      const way = await reach(companyId, ct)
      if ('why' in way) {
        if (!opts.dryRun) { await record(c, 'skipped', { reason: way.why }); done.add(key); result.skipped++ }
        continue
      }
      const words = fill((r.templates as Record<string, string>)[c.kind] || DEFAULT_WORDS[c.kind as Kind], { firstName: (ct.name || '').split(' ')[0] || 'there', salon: salonName, service: c.service || 'visit', link })
      if (opts.dryRun) { result.wouldSend.push({ client: ct.name, kind: c.kind, via: way.via }); continue }
      const claimed = await record(c, 'pending', { channel: way.via, message: words })
      if (!claimed) continue
      done.add(key)
      let status = 'sent', reason: string | null = null, channel: string = way.via
      try {
        if (way.via === 'sms') {
          const sms: any = await d.services.sms.sendSMS(companyId, { contactId: ct.id, toPhone: way.to, message: /STOP/i.test(words) ? words : `${words} Reply STOP to opt out.` })
          if (sms === null) { status = 'skipped'; reason = 'They replied STOP to texts.' }
          else if (sms?.refused || sms?.status === 'failed' || sms?.status === 'refused') { status = 'failed'; reason = sms?.errorMessage || 'The text could not be sent.' }
        } else {
          const unsub = `${publicApiBase()}/api/marketing/unsubscribe/none/${ct.id}`
          await d.services.emailService.sendRaw({
            to: way.to, subject: fill(SUBJECTS[c.kind as Kind], { salon: salonName }), fromName: salonName,
            html: `<div style="font-family:sans-serif;max-width:520px;margin:auto"><p>${escHtml(words.replace(link, '').replace(/\s+$/, '').replace(/[:\s]+$/, ''))}</p><p><a href="${escHtml(link)}" style="display:inline-block;padding:10px 18px;background:#0f766e;color:#fff;border-radius:6px;text-decoration:none">Book online</a></p><p style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">You are receiving this because you are a client of ${escHtml(salonName)}. <a href="${escHtml(unsub)}" style="color:#6b7280">Unsubscribe</a></p></div>`,
          })
          channel = 'email'
        }
      } catch (e: any) { status = 'failed'; reason = e?.message || 'Could not send.' }
      await db.update(retentionSend).set({ status, reason, channel }).where(eq(retentionSend.id, claimed))
      if (status === 'sent') { result.sent++; cooling.add(c.contactId) } else if (status === 'failed') result.failed++; else result.skipped++
    }
    if (result.sent || result.failed) logger.info('[retention] pass', { companyId, ...result, wouldSend: undefined })
    return result
  }

  /** The timed pass: every salon with the feature on. */
  async function passForAll() {
    const rows = await db.select({ id: company.id }).from(company)
    for (const co of rows as any[]) {
      if (!(await d.features.isFeatureEnabled(co.id, 'retention_sends'))) continue
      await pass(co.id).catch((e: any) => logger.warn('[retention] pass failed', { companyId: co.id, error: e?.message || String(e) }))
    }
  }

  return { settingsFor, pass, passForAll }
}
export type Retention = ReturnType<typeof createRetention>

export function createRetentionRoutes(d: CrmDeps, retention: Retention) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/settings', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    return one(c, (await retention.settingsFor(u.companyId)).r)
  })

  app.put('/settings', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    const { settings, r: before } = await retention.settingsFor(u.companyId)
    const next: RetentionSettings = { ...before, templates: { ...before.templates } }
    const bad = (field: string, message: string) => fail(c, 400, message, 'BAD_SETTING', { [field]: message })
    for (const k of ['rebook', 'birthday', 'winBack', 'nextVisit', 'drips'] as const) {
      if (body[k] === undefined) continue
      if (typeof body[k] !== 'boolean') return bad(k, 'On or off.')
      next[k] = body[k]
    }
    if (body.winBackDays !== undefined) {
      const n = Number(body.winBackDays)
      if (!Number.isInteger(n) || n < 30 || n > 730) return bad('winBackDays', 'Use a whole number of days from 30 to 730.')
      next.winBackDays = n
    }
    for (const k of ['quietStart', 'quietEnd'] as const) {
      if (body[k] === undefined) continue
      if (typeof body[k] !== 'string' || !hm.test(body[k])) return bad(k, 'Use a time like 21:00.')
      next[k] = body[k]
    }
    if (body.templates !== undefined) {
      if (!body.templates || typeof body.templates !== 'object' || Array.isArray(body.templates)) return bad('templates', 'Send the messages as { rebook: "…" }.')
      for (const [k, v] of Object.entries(body.templates)) {
        if (!(KINDS as readonly string[]).includes(k)) return bad('templates', `There is no “${k}” message.`)
        const text = String(v ?? '').trim()
        if (!text) { delete next.templates[k as Kind]; continue }
        if (text.length > 320) return bad('templates', `The ${k} message is too long for a text (320 characters at most).`)
        const unknown = [...text.matchAll(/\{\s*(\w+)\s*\}/g)].map((m) => m[1]).filter((t) => !MESSAGE_TOKENS.includes(t))
        if (unknown.length) return bad('templates', `The ${k} message uses {${unknown[0]}}, which is not one of {${MESSAGE_TOKENS.join('}, {')}}.`)
        next.templates[k as Kind] = text
      }
    }
    // Switching the first part on starts the clock: nothing from before that moment is ever sent.
    next.since = anyOn(next) ? (anyOn(before) && before.since ? before.since : new Date().toISOString()) : null
    await db.update(company).set({ settings: { ...settings, retention: next }, updatedAt: new Date() } as any).where(eq(company.id, u.companyId))
    await audit.log({ action: 'update', entity: 'company', entityId: u.companyId, metadata: { retention: { before, after: next } }, req: { user: u } })
    return one(c, next)
  })

  // What went out (and what did not, with why), newest first.
  app.get('/log', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user') as any
    const rows = await db.select({
      id: retentionSend.id, kind: retentionSend.kind, channel: retentionSend.channel, status: retentionSend.status, reason: retentionSend.reason,
      createdAt: retentionSend.createdAt, contactId: retentionSend.contactId, clientName: contact.name,
    }).from(retentionSend).innerJoin(contact, eq(contact.id, retentionSend.contactId))
      .where(and(eq(retentionSend.companyId, u.companyId), ne(retentionSend.status, 'pending'))).orderBy(retentionSend.createdAt)
    return listAll(c, (rows as any[]).reverse())
  })

  // Run a pass now: `dryRun` lists who would be messaged and how, without sending.
  app.post('/run', requirePermission('company:update'), async (c) => {
    const u = c.get('user') as any
    const body = (await c.req.json().catch(() => null)) ?? ({} as any)
    return one(c, await retention.pass(u.companyId, { dryRun: body.dryRun === true }))
  })

  return app
}
