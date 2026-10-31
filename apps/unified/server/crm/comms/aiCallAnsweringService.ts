// Live AI call answering (feature `ai_call_answering`, Jobber's AI Receptionist / Housecall Pro's AI CSR): the business's
// line answered by the assistant, which books into real open slots, answers hours / price / service-area questions
// from what the owner set up, takes a message, or transfers to a person on the owner's rules. This file is the glue:
//   · the owner's settings (ai_receptionist_settings.call_answering) with their defaults and validation;
//   · "is the assistant answering right now?" — on, the feature on, and inside the hours the owner chose;
//   · the context the engine speaks from (callDialogue.ts): the business's name, its pricebook services and prices, its
//     opening hours, its service area, the owner's wording and transfer rules, and who is calling;
//   · each turn of a call: the engine's effects carried out — Find a time (data/techAvailability.ts findOpenSlots) for
//     the slots, the job made under the job book's lock with the same check again, the contact or lead made for a new
//     caller, the message saved on the contact and announced, the transfer — and the transcript kept turn by turn;
//   · the end of the call: the call-log row completed with the transcript, a summary and the contact.
// The provider (voiceProvider.ts) is the only thing that knows Twilio.
import { z } from 'zod'
import { and, asc, count, desc, eq, inArray, or } from 'drizzle-orm'
import { WEEK_DAYS, checkBusinessHours, businessHoursLines, businessHoursOf, businessHoursWindows, companyRowTimeZone, formatPhoneE164, insertLead, nextNumber, tzParts, twilioConfigFor } from '@twomiah/tenant-backend'
import { activity, aiCallSession, aiCallTurn, aiReceptionistSettings, bookingZone, callLog, company, contact, job, lead, pricebookItem, user, website } from '../../db/schema/index.ts'
import { findOpenSlots, type OpenSlot } from '../../data/techAvailability.ts'
import { lockJobBook } from '../../data/bookingLock.ts'
import { clientByPhone } from '../../data/calltracking.ts'
import { createCalltrackingService } from './calltrackingService.ts'
import { createDialogue, DEFAULT_WORDING, WORDING_KEYS, initialState, keywordIntentReader, serviceKeywords, slotWords, summarize, wordingOf, type DialogueContext, type DialogueService, type DialogueState, type Effect, type IntentReader, type OfferedSlot, type Outcome, type StepInput, type Wording } from './callDialogue.ts'
import type { CallEvent, VoiceAction, VoiceProvider } from './voiceProvider.ts'
import type { CrmDeps } from '../deps.ts'

// ----------------------------------------------------------------------------------------------------------- settings

export interface CallAnsweringSettings {
  enabled: boolean
  /** When the assistant answers: always, inside the business's opening hours, only outside them, or its own hours. */
  when: 'always' | 'business_hours' | 'outside_business_hours' | 'custom'
  hours: Record<string, { open?: string; close?: string; closed?: boolean }> | null
  booking: { enabled: boolean; days: number; stepMinutes: number; defaultDurationMinutes: number; sayPrices: boolean }
  area: { zips: string[]; places: string[] }
  transfer: { to: string | null; keywords: string[]; emergencyKeywords: string[]; existingCustomer: boolean; emergency: boolean; outsideHours: boolean }
  recordCalls: boolean
  wording: Wording
}

export const DEFAULT_EMERGENCY_KEYWORDS = ['emergency', 'flooding', 'gas smell', 'smell gas', 'sparks', 'smoke', 'fire', 'burst pipe', 'no heat', 'carbon monoxide']

export const DEFAULT_CALL_ANSWERING: CallAnsweringSettings = {
  enabled: false,
  when: 'outside_business_hours',
  hours: null,
  booking: { enabled: true, days: 7, stepMinutes: 60, defaultDurationMinutes: 60, sayPrices: false },
  area: { zips: [], places: [] },
  transfer: { to: null, keywords: [], emergencyKeywords: DEFAULT_EMERGENCY_KEYWORDS, existingCustomer: false, emergency: true, outsideHours: false },
  recordCalls: false,
  wording: DEFAULT_WORDING,
}

/** The owner's settings with every field present (a never-saved business gets the defaults, off). */
export function callAnsweringOf(v: unknown): CallAnsweringSettings {
  let src: any = v
  if (typeof src === 'string') { try { src = JSON.parse(src) } catch { src = null } }
  if (!src || typeof src !== 'object') return { ...DEFAULT_CALL_ANSWERING, wording: { ...DEFAULT_WORDING } }
  const d = DEFAULT_CALL_ANSWERING
  const strings = (x: unknown, max: number) => (Array.isArray(x) ? x.map((s) => String(s ?? '').trim()).filter(Boolean).slice(0, max) : [])
  return {
    enabled: src.enabled === true,
    when: ['always', 'business_hours', 'outside_business_hours', 'custom'].includes(src.when) ? src.when : d.when,
    hours: src.hours && typeof src.hours === 'object' && !checkBusinessHours(src.hours) ? src.hours : null,
    booking: {
      enabled: src.booking?.enabled !== false,
      days: clampInt(src.booking?.days, 1, 31, d.booking.days), stepMinutes: clampInt(src.booking?.stepMinutes, 15, 120, d.booking.stepMinutes),
      defaultDurationMinutes: clampInt(src.booking?.defaultDurationMinutes, 15, 480, d.booking.defaultDurationMinutes), sayPrices: src.booking?.sayPrices === true,
    },
    area: { zips: strings(src.area?.zips, 500).filter((z) => /^\d{5}$/.test(z)), places: strings(src.area?.places, 100) },
    transfer: {
      to: typeof src.transfer?.to === 'string' && src.transfer.to.trim() ? src.transfer.to.trim() : null,
      keywords: strings(src.transfer?.keywords, 50), emergencyKeywords: Array.isArray(src.transfer?.emergencyKeywords) ? strings(src.transfer.emergencyKeywords, 50) : d.transfer.emergencyKeywords,
      existingCustomer: src.transfer?.existingCustomer === true, emergency: src.transfer?.emergency !== false, outsideHours: src.transfer?.outsideHours === true,
    },
    recordCalls: src.recordCalls === true,
    wording: wordingOf(src.wording),
  }
}
const clampInt = (v: unknown, min: number, max: number, dflt: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const phrase = (what: string) => z.string({ error: `Enter ${what}` }).trim().min(1, `Enter ${what}`).max(80, 'At most 80 characters')
/** The settings body as the page saves it; a malformed field is named. Wording keys outside the list are dropped. */
export const callAnsweringSchema = z.object({
  enabled: z.boolean({ error: 'Choose on or off' }),
  when: z.enum(['always', 'business_hours', 'outside_business_hours', 'custom'], { error: 'Choose when the assistant answers' }),
  hours: z.record(z.string(), z.object({ open: z.string().regex(HHMM, 'Enter a time like 09:00').optional(), close: z.string().regex(HHMM, 'Enter a time like 17:00').optional(), closed: z.boolean().optional() })).nullable().optional(),
  booking: z.object({
    enabled: z.boolean(),
    days: z.number({ error: 'Enter how many days ahead' }).int().min(1, 'At least 1 day').max(31, 'At most 31 days'),
    stepMinutes: z.number({ error: 'Enter the grid' }).int().min(15, 'At least every 15 minutes').max(120, 'At most every 2 hours'),
    defaultDurationMinutes: z.number({ error: 'Enter a length' }).int().min(15, 'At least 15 minutes').max(480, 'At most 8 hours'),
    sayPrices: z.boolean(),
  }),
  area: z.object({ zips: z.array(z.string().trim().regex(/^\d{5}$/, 'A ZIP code is five digits')).max(500, 'At most 500 ZIP codes'), places: z.array(phrase('a place')).max(100, 'At most 100 places') }),
  transfer: z.object({
    to: z.string().trim().max(30).nullable(),
    keywords: z.array(phrase('a keyword')).max(50, 'At most 50 keywords'),
    emergencyKeywords: z.array(phrase('a keyword')).max(50, 'At most 50 keywords'),
    existingCustomer: z.boolean(), emergency: z.boolean(), outsideHours: z.boolean(),
  }),
  recordCalls: z.boolean(),
  wording: z.record(z.string(), z.string().max(600, 'At most 600 characters')),
}).superRefine((s, ctx) => {
  if (s.when === 'custom') {
    const bad = checkBusinessHours(s.hours ?? null)
    if (bad || !s.hours || !WEEK_DAYS.some((d) => s.hours![d] && !s.hours![d].closed)) ctx.addIssue({ code: 'custom', path: ['hours'], message: bad || 'Give at least one day the assistant answers on' })
  }
  if (s.transfer.to && !dialable(s.transfer.to)) ctx.addIssue({ code: 'custom', path: ['transfer', 'to'], message: 'Enter a 10-digit US phone number' })
  if ((s.transfer.keywords.length || s.transfer.existingCustomer || s.transfer.outsideHours) && !s.transfer.to) ctx.addIssue({ code: 'custom', path: ['transfer', 'to'], message: 'Enter the number to transfer to' })
})
const dialable = (p: string) => { const d = p.replace(/\D/g, ''); return d.length === 10 || (d.length === 11 && d.startsWith('1')) }

// ------------------------------------------------------------------------------------------------------------ service

export interface AiCallAnsweringDeps extends CrmDeps { provider?: VoiceProvider; reader?: IntentReader }

export function createAiCallAnsweringService(d: AiCallAnsweringDeps) {
  const { db, logger } = d
  const calltracking = createCalltrackingService(d)
  const dialogue = createDialogue(d.reader ?? keywordIntentReader)
  const reader = d.reader ?? keywordIntentReader
  const callersAreClients = d.settings?.callers === 'clients'
  const numbering = d.settings?.roof ? { prefix: 'ROOF', pad: 4 } : { prefix: 'JOB', pad: 5 }

  const companyRow = async (companyId: string) => (await db.select().from(company).where(eq(company.id, companyId)).limit(1))[0] ?? null

  async function getSettings(companyId: string): Promise<CallAnsweringSettings> {
    const [row] = await db.select({ v: aiReceptionistSettings.callAnswering }).from(aiReceptionistSettings).where(eq(aiReceptionistSettings.companyId, companyId)).limit(1)
    return callAnsweringOf(row?.v)
  }

  async function saveSettings(companyId: string, body: z.infer<typeof callAnsweringSchema>): Promise<CallAnsweringSettings> {
    const wording: Record<string, string> = {}
    for (const k of WORDING_KEYS) if (typeof body.wording[k] === 'string') wording[k] = body.wording[k]
    const next = callAnsweringOf({ ...body, transfer: { ...body.transfer, to: body.transfer.to ? formatPhoneE164(body.transfer.to) : null }, wording })
    const [existing] = await db.select({ id: aiReceptionistSettings.id }).from(aiReceptionistSettings).where(eq(aiReceptionistSettings.companyId, companyId)).limit(1)
    if (existing) await db.update(aiReceptionistSettings).set({ callAnswering: next, updatedAt: new Date() }).where(eq(aiReceptionistSettings.companyId, companyId))
    else await db.insert(aiReceptionistSettings).values({ companyId, callAnswering: next })
    return next
  }

  /** Inside the hours the owner chose, on the business's clock. "Business hours" with none set counts as always. */
  function withinHours(s: CallAnsweringSettings, co: any, now = new Date()): boolean {
    if (s.when === 'always') return true
    const tz = companyRowTimeZone(co)
    const at = tzParts(now, tz)
    const weekday = new Date(`${at.date}T00:00:00Z`).getUTCDay()
    const inside = (windows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }> | null) => windows === null ? null : windows.some((w) => w.dayOfWeek === weekday && w.startMinute <= at.minutes && at.minutes < w.endMinute)
    if (s.when === 'custom') return inside(businessHoursWindows(s.hours)) === true
    const open = inside(businessHoursWindows(businessHoursOf(co?.settings)))
    if (open === null) return true
    return s.when === 'business_hours' ? open : !open
  }

  /** Should the assistant pick up this company's line right now? */
  async function shouldAnswer(companyId: string, now = new Date()): Promise<boolean> {
    if (!(await d.features.isFeatureEnabled(companyId, 'ai_call_answering'))) return false
    const s = await getSettings(companyId)
    if (!s.enabled) return false
    return withinHours(s, await companyRow(companyId), now)
  }

  /** The services the assistant may name and book: the pricebook's active services shown to customers. */
  async function services(companyId: string, s: CallAnsweringSettings): Promise<DialogueService[]> {
    const rows = await db.select({ id: pricebookItem.id, name: pricebookItem.name, price: pricebookItem.price, laborHours: pricebookItem.laborHours, code: pricebookItem.code, type: pricebookItem.type })
      .from(pricebookItem).where(and(eq(pricebookItem.companyId, companyId), eq(pricebookItem.active, true), eq(pricebookItem.showToCustomer, true))).orderBy(asc(pricebookItem.name))
    return rows.filter((r: any) => r.type === 'service').map((r: any) => {
      const price = Number(r.price); const hours = Number(r.laborHours)
      return {
        id: r.id, name: r.name, priceCents: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null,
        durationMinutes: Number.isFinite(hours) && hours > 0 ? Math.max(15, Math.round(hours * 60)) : s.booking.defaultDurationMinutes,
        keywords: serviceKeywords(r.name, r.code ? [r.code] : []),
      }
    })
  }

  /** The service area the owner set here, else what the website and booking zones already say. */
  async function area(companyId: string, s: CallAnsweringSettings): Promise<{ zips: string[]; places: string[] }> {
    if (s.area.zips.length || s.area.places.length) return s.area
    const [site] = await db.select({ areas: website.serviceAreas }).from(website).where(eq(website.companyId, companyId)).limit(1)
    const places = (Array.isArray(site?.areas) ? site!.areas : []).map((a: any) => String((a && typeof a === 'object' ? a.name : a) || '').trim()).filter(Boolean)
    const zones = await db.select({ zips: bookingZone.zips }).from(bookingZone).where(eq(bookingZone.companyId, companyId))
    const zips = [...new Set(zones.flatMap((z: any) => (Array.isArray(z.zips) ? z.zips : [])).map(String).filter((z: string) => /^\d{5}$/.test(z)))] as string[]
    return { zips, places }
  }

  /** Who is calling: a contact (or a home-care client) with this number, by name. */
  async function caller(companyId: string, phone: string): Promise<{ phone: string; name: string | null; known: boolean; contactId: string | null }> {
    const e164 = formatPhoneE164(phone)
    const digits = e164.replace(/\D/g, '').slice(-10)
    if (callersAreClients) {
      const c = await clientByPhone(db, companyId, e164)
      return { phone: e164, name: null, known: !!c, contactId: null }
    }
    const rows = await db.select({ id: contact.id, name: contact.name, phone: contact.phone, mobile: contact.mobile }).from(contact).where(and(eq(contact.companyId, companyId), or(eq(contact.phone, e164), eq(contact.mobile, e164), eq(contact.phone, digits), eq(contact.mobile, digits)))).limit(5)
    const c = rows.find((r: any) => [r.phone, r.mobile].some((p) => p && String(p).replace(/\D/g, '').slice(-10) === digits)) ?? rows[0]
    return { phone: e164, name: c?.name && c.name !== 'Unknown Caller' ? c.name : null, known: !!c, contactId: c?.id ?? null }
  }

  async function buildContext(companyId: string, phone: string, settings?: CallAnsweringSettings): Promise<{ ctx: DialogueContext; contactId: string | null; co: any }> {
    const s = settings ?? await getSettings(companyId)
    const co = await companyRow(companyId)
    const who = await caller(companyId, phone)
    const hours = businessHoursOf(co?.settings)
    const windows = businessHoursWindows(hours)
    const at = tzParts(new Date(), companyRowTimeZone(co))
    const weekday = new Date(`${at.date}T00:00:00Z`).getUTCDay()
    const ctx: DialogueContext = {
      companyName: co?.name || 'us',
      services: await services(companyId, s),
      hoursLines: businessHoursLines(hours),
      openNow: windows ? windows.some((w) => w.dayOfWeek === weekday && w.startMinute <= at.minutes && at.minutes < w.endMinute) : true,
      area: await area(companyId, s),
      caller: { phone: who.phone, name: who.name, known: who.known },
      sayPrices: s.booking.sayPrices,
      bookingEnabled: s.booking.enabled,
      bookingDays: s.booking.days,
      recordCalls: s.recordCalls,
      wording: s.wording,
      transfer: { ...s.transfer, to: s.transfer.to ? formatPhoneE164(s.transfer.to) : null },
    }
    return { ctx, contactId: who.contactId, co }
  }

  // ---------------------------------------------------------------------------------------------------------- slots

  /** Up to three openings to read out: the earliest, then ones on other days or well apart, so the caller hears a spread. */
  function spread(slots: OpenSlot[]): OfferedSlot[] {
    const out: OpenSlot[] = []
    for (const s of slots) {
      if (out.some((o) => o.date === s.date && o.startsAt === s.startsAt)) continue
      const last = out[out.length - 1]
      if (last && last.date === s.date && minutes(s.startsAt) - minutes(last.startsAt) < 120 && slots.some((x) => x.date > s.date)) continue
      out.push(s)
      if (out.length === 3) break
    }
    if (out.length < 3) for (const s of slots) { if (out.length === 3) break; if (!out.some((o) => o.date === s.date && o.startsAt === s.startsAt)) out.push(s) }
    return out.map((s) => ({ date: s.date, startsAt: s.startsAt, endsAt: s.endsAt, personId: s.personId, kind: s.kind, name: s.name, ...slotWords(s.date, s.startsAt) }))
  }
  const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }

  async function openSlots(exec: any, companyId: string, co: any, s: CallAnsweringSettings, svc: DialogueService, address: string | null, now: Date, only?: { date: string; personId: string }) {
    const at = tzParts(now, companyRowTimeZone(co))
    return findOpenSlots(exec, companyId, {
      from: only?.date ?? at.date, days: only ? 1 : s.booking.days, durationMinutes: svc.durationMinutes, personIds: only ? [only.personId] : undefined,
      at: { address }, stepMinutes: s.booking.stepMinutes, limit: 200, notBefore: { date: at.date, minutes: at.minutes },
    })
  }

  // -------------------------------------------------------------------------------------------------------- effects

  /** The caller's contact: the one matched by number, else a new one named as they said (a lead until they book). */
  async function ensureContact(companyId: string, phone: string, name: string | null, contactId: string | null, type: 'lead' | 'client'): Promise<string> {
    if (contactId) {
      const [c] = await db.select({ name: contact.name, type: contact.type }).from(contact).where(eq(contact.id, contactId)).limit(1)
      const patch: any = {}
      if (name && (!c?.name || c.name === 'Unknown Caller')) patch.name = name
      if (type === 'client' && c?.type === 'lead') patch.type = 'client'
      if (Object.keys(patch).length) await db.update(contact).set({ ...patch, updatedAt: new Date() }).where(eq(contact.id, contactId))
      return contactId
    }
    const [made] = await db.insert(contact).values({ companyId, name: name || 'Unknown Caller', phone, type, source: 'ai_call', notes: `First call: answered by the AI receptionist` }).returning({ id: contact.id })
    d.realtime.emitToCompany(companyId, d.realtime.EVENTS.CONTACT_CREATED, { id: made.id })
    return made.id
  }

  /** The office hears about it: a Lead Inbox row where that is on, a phone notification to the managers, and a live event. */
  async function notifyOffice(companyId: string, what: { title: string; body: string; phone: string; name: string | null; contactId: string }) {
    if (await d.features.isFeatureEnabled(companyId, 'lead_inbox')) {
      try {
        const row = await insertLead(db, lead, { companyId, sourceId: null, platform: 'phone', parsed: { name: what.name || 'Unknown Caller', phone: what.phone, description: what.body }, rawPayload: { via: 'ai_call_answering', contactId: what.contactId } } as any)
        d.realtime.emitToCompany(companyId, d.realtime.EVENTS.LEAD_CREATED, { id: row.id, sourcePlatform: 'phone', homeownerName: row.homeownerName })
      } catch (err: any) { logger.error('[AICall] lead not filed', { error: err?.message }) }
    }
    const office = await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true), inArray(user.role, ['owner', 'admin', 'manager'])))
    await d.phonePush.send(companyId, office.map((u: any) => u.id), { title: what.title, body: what.body, data: { type: 'contact', id: what.contactId } }).catch(() => 0)
    d.realtime.emitToCompany(companyId, d.realtime.EVENTS.ALERT_CREATED, { kind: 'ai_call', title: what.title, body: what.body, contactId: what.contactId })
  }

  /** The job, through the shared path's own rules: the job book's lock, the slot checked again inside it, numbered like every job. */
  async function book(companyId: string, co: any, s: CallAnsweringSettings, svc: DialogueService, slot: OfferedSlot, contactId: string, phone: string, address: string | null, zip: string | null, now: Date): Promise<{ id: string; number: string } | null> {
    const made = await db.transaction(async (tx: any) => {
      await lockJobBook(tx, companyId)
      const again = await openSlots(tx, companyId, co, s, svc, address, now, { date: slot.date, personId: slot.personId })
      if (!again.slots.some((x) => x.date === slot.date && x.startsAt === slot.startsAt && x.personId === slot.personId)) return null
      const number = await nextNumber(tx, job, job.number, job.companyId, companyId, numbering)
      const [row] = await tx.insert(job).values({
        companyId, number, title: svc.name, contactId, status: 'scheduled', priority: 'normal', source: 'ai_call',
        description: `Booked by the AI receptionist on a call from ${phone}.`,
        ...(d.settings?.jobs?.defaultType ? { jobType: d.settings.jobs.defaultType } : {}),
        scheduledDate: new Date(`${slot.date}T00:00:00.000Z`), scheduledTime: slot.startsAt,
        estimatedHours: String(Math.round((svc.durationMinutes / 60) * 100) / 100),
        ...(svc.priceCents != null ? { estimatedValue: String(svc.priceCents / 100) } : {}),
        address, zip, assignedToId: slot.kind === 'user' ? slot.personId : null, assignedToMemberId: slot.kind === 'member' ? slot.personId : null,
      }).returning()
      return row
    })
    if (!made) return null
    d.realtime.emitToCompany(companyId, d.realtime.EVENTS.JOB_CREATED, made)
    // The vertical's "a job was made" steps (the customer's booking text where that is on), as the Jobs page's create runs them.
    const [owner] = await db.select({ id: user.id }).from(user).where(and(eq(user.companyId, companyId), eq(user.role, 'owner'))).limit(1)
    if (d.services.jobHooks?.onCreate) { try { await d.services.jobHooks.onCreate({ job: made, companyId, userId: owner?.id || '' }) } catch (err: any) { logger.error('[AICall] onCreate hook failed', { error: err?.message }) } }
    return { id: made.id, number: made.number }
  }

  // ------------------------------------------------------------------------------------------------------- sessions

  interface Session { id: string; callLogId: string; state: DialogueState; status: string; jobId: string | null }
  const sessionOf = async (companyId: string, callId: string): Promise<Session | null> => {
    const [row] = await db.select().from(aiCallSession).where(and(eq(aiCallSession.companyId, companyId), eq(aiCallSession.providerCallId, callId))).limit(1)
    return row ? { id: row.id, callLogId: row.callLogId, state: row.state as DialogueState, status: row.status, jobId: row.jobId } : null
  }

  async function addTurns(companyId: string, callLogId: string, lines: Array<{ speaker: 'caller' | 'assistant'; text: string; intent?: string | null }>) {
    if (!lines.length) return
    const [last] = await db.select({ seq: aiCallTurn.seq }).from(aiCallTurn).where(eq(aiCallTurn.callLogId, callLogId)).orderBy(desc(aiCallTurn.seq)).limit(1)
    let seq = (last?.seq ?? 0)
    await db.insert(aiCallTurn).values(lines.map((l) => ({ companyId, callLogId, seq: ++seq, speaker: l.speaker, text: l.text, intent: l.intent ?? null })))
  }
  const spoken = (actions: VoiceAction[]) => actions.map((a) => a.kind === 'say' ? a.text : a.kind === 'listen' ? a.prompt : a.kind === 'transfer' ? a.announce : a.text || '').filter(Boolean)

  /** The call-log row finished: transcript, summary, outcome, the contact, and the receptionist's own mark. */
  async function finalise(companyId: string, session: Session, ctx: DialogueContext, state: DialogueState, outcome: Outcome, contactId: string | null) {
    const turns = await db.select({ speaker: aiCallTurn.speaker, text: aiCallTurn.text }).from(aiCallTurn).where(eq(aiCallTurn.callLogId, session.callLogId)).orderBy(asc(aiCallTurn.seq))
    const transcript = turns.map((t: any) => `${t.speaker === 'caller' ? 'Caller' : 'Assistant'}: ${t.text}`).join('\n')
    const summary = summarize(state, ctx)
    // Answered, whatever came of it: to the business this call was picked up (the missed-call rules are for the unanswered).
    await db.update(callLog).set({ transcription: transcript, aiSummary: summary, status: 'completed', aiResponseSent: true, endTime: new Date(), ...(contactId ? { contactId } : {}), ...(state.callerName ? { callerName: state.callerName } : {}), ...(state.message ? { notes: `Message: ${state.message}` } : {}) }).where(eq(callLog.id, session.callLogId))
    await db.update(aiCallSession).set({ status: 'ended', outcome, state, updatedAt: new Date() }).where(eq(aiCallSession.id, session.id))
  }

  /** Run the engine from `input`, carrying out each effect and feeding its result back, until the engine waits for the caller. */
  async function run(companyId: string, co: any, s: CallAnsweringSettings, session: Session, ctx: DialogueContext, contactId: string | null, input: StepInput, phone: string): Promise<VoiceAction[]> {
    const now = new Date()
    let state = session.state
    const actions: VoiceAction[] = []
    let next: StepInput | null = input
    let ended = false
    for (let guard = 0; next && guard < 8; guard++) {
      const r = dialogue.step(ctx, state, next)
      state = r.state
      actions.push(...r.actions)
      next = null
      for (const e of r.effects as Effect[]) {
        if (e.kind === 'find_slots') {
          const svc = ctx.services.find((x) => x.id === e.serviceId)!
          next = { kind: 'slots', slots: spread((await openSlots(db, companyId, co, s, svc, e.address, now)).slots) }
        } else if (e.kind === 'remember_name') {
          contactId = await ensureContact(companyId, phone, e.name, contactId, 'lead')
        } else if (e.kind === 'book') {
          const svc = ctx.services.find((x) => x.id === e.serviceId)!
          contactId = await ensureContact(companyId, phone, e.callerName, contactId, 'client')
          const made = await book(companyId, co, s, svc, e.slot, contactId, phone, e.address, e.zip, now)
          if (made) {
            session.jobId = made.id
            await db.update(aiCallSession).set({ jobId: made.id }).where(eq(aiCallSession.id, session.id))
            await db.insert(activity).values({ companyId, userId: null, entityType: 'contact', entityId: contactId, action: 'ai_call_booked', description: `The AI receptionist booked ${svc.name} (${made.number}) for ${e.slot.dateWords} at ${e.slot.timeWords} with ${e.slot.name}.`, metadata: { jobId: made.id, callLogId: session.callLogId } })
            await notifyOffice(companyId, { title: 'Booked by the AI receptionist', body: `${e.callerName || phone}: ${svc.name}, ${e.slot.dateWords} at ${e.slot.timeWords} with ${e.slot.name} (${made.number}).`, phone, name: e.callerName, contactId })
            next = { kind: 'booked', jobNumber: made.number }
          } else {
            next = { kind: 'booking_failed', slots: spread((await openSlots(db, companyId, co, s, svc, e.address, now)).slots) }
          }
        } else if (e.kind === 'save_message') {
          contactId = await ensureContact(companyId, phone, e.callerName, contactId, 'lead')
          await db.insert(activity).values({ companyId, userId: null, entityType: 'contact', entityId: contactId, action: 'ai_call_message', description: `Message taken by the AI receptionist: ${e.text}`, metadata: { callLogId: session.callLogId } })
          await notifyOffice(companyId, { title: 'Message from a caller', body: `${e.callerName || phone}: ${e.text}`, phone, name: e.callerName, contactId })
        } else if (e.kind === 'transfer') {
          state = { ...state, transferReason: e.reason }
        } else if (e.kind === 'end') {
          ended = true
          await addTurns(companyId, session.callLogId, spoken(actions).map((text) => ({ speaker: 'assistant' as const, text })))
          await finalise(companyId, session, ctx, state, e.outcome, contactId)
        }
      }
    }
    if (!ended) {
      await addTurns(companyId, session.callLogId, spoken(actions).map((text) => ({ speaker: 'assistant' as const, text })))
      await db.update(aiCallSession).set({ state, updatedAt: new Date() }).where(eq(aiCallSession.id, session.id))
      if (contactId) await db.update(callLog).set({ contactId, ...(state.callerName ? { callerName: state.callerName } : {}) }).where(eq(callLog.id, session.callLogId))
    }
    return actions
  }

  // ---------------------------------------------------------------------------------------------------------- doors

  /** A call arrives and the assistant is answering: logged, a session opened, the greeting and first question. */
  async function incoming(companyId: string, ev: Extract<CallEvent, { kind: 'incoming' }>, recording: { provider: VoiceProvider; callbackUrl: string } | null): Promise<VoiceAction[]> {
    const s = await getSettings(companyId)
    const { ctx, contactId, co } = await buildContext(companyId, ev.from, s)
    let callRow = (await db.select({ id: callLog.id }).from(callLog).where(and(eq(callLog.companyId, companyId), eq(callLog.providerId, ev.callId))).limit(1))[0]
    if (!callRow) callRow = await calltracking.logCall(companyId, { trackingNumber: ev.to, callerNumber: ev.from, callerCity: ev.fromCity, callerState: ev.fromState, direction: 'inbound', status: 'ringing', providerId: ev.callId, createContact: false })
    const existing = await sessionOf(companyId, ev.callId)
    const session: Session = existing ?? await (async () => {
      const [row] = await db.insert(aiCallSession).values({ companyId, callLogId: callRow.id, providerCallId: ev.callId, state: initialState() }).returning()
      return { id: row.id, callLogId: row.callLogId, state: row.state as DialogueState, status: row.status, jobId: null }
    })()
    if (s.recordCalls && recording) {
      const cfg = twilioConfigFor(co)
      recording.provider.startRecording({ callId: ev.callId, companyId }, cfg, recording.callbackUrl)
        .then((r) => { if (!r.ok) logger.info('[AICall] recording not started', { reason: r.reason }) })
        .catch((err: any) => logger.error('[AICall] recording failed', { error: err?.message }))
    }
    return run(companyId, co, s, session, ctx, contactId, { kind: 'start' }, ctx.caller.phone)
  }

  /** The caller's next line (or silence), or the transfer's outcome. Null when no live call has this id. */
  async function turn(companyId: string, ev: CallEvent): Promise<VoiceAction[] | null> {
    const session = await sessionOf(companyId, ev.callId)
    if (!session || session.status !== 'live') return null
    const [call] = await db.select({ phone: callLog.callerNumber }).from(callLog).where(eq(callLog.id, session.callLogId)).limit(1)
    const s = await getSettings(companyId)
    const { ctx, contactId, co } = await buildContext(companyId, call?.phone || '', s)
    if (session.state.callerName) ctx.caller.name = session.state.callerName
    let input: StepInput
    if (ev.kind === 'speech') {
      const expecting = session.state.stage === 'help' ? 'help' : session.state.stage === 'service' ? 'service' : session.state.stage === 'name' ? 'name' : session.state.stage === 'address' ? 'address' : session.state.stage === 'slots' ? 'slot' : session.state.stage === 'confirm' ? 'yes_no' : session.state.stage === 'message' ? 'message' : 'anything_else'
      const read = reader.read(ev.text, expecting, ctx, session.state)
      await addTurns(companyId, session.callLogId, [{ speaker: 'caller', text: ev.text, intent: read.intent }])
      input = { kind: 'speech', text: ev.text }
    } else if (ev.kind === 'silence') input = { kind: 'silence' }
    else if (ev.kind === 'transfer_result') input = { kind: 'transfer_result', answered: ev.answered }
    else return null
    return run(companyId, co, s, session, ctx, contactId, input, ctx.caller.phone)
  }

  /** The provider says the call ended (hung up): a live session is closed with what it had. */
  async function hangup(companyId: string, callId: string): Promise<boolean> {
    const session = await sessionOf(companyId, callId)
    if (!session || session.status !== 'live') return false
    const [call] = await db.select({ phone: callLog.callerNumber, contactId: callLog.contactId }).from(callLog).where(eq(callLog.id, session.callLogId)).limit(1)
    const { ctx } = await buildContext(companyId, call?.phone || '')
    const r = dialogue.step(ctx, session.state, { kind: 'hangup' })
    await finalise(companyId, session, ctx, r.state, r.state.outcome ?? 'hung_up', call?.contactId ?? null)
    return true
  }

  /** Is this call one the assistant answered (so the recording is filed and no missed-call rule runs)? */
  const answeredByAssistant = async (companyId: string, callId: string) => !!(await sessionOf(companyId, callId))

  // ---------------------------------------------------------------------------------------------------------- reads

  async function listCalls(companyId: string, page: number, limit: number) {
    const rows = await db.select({
      id: aiCallSession.id, callLogId: aiCallSession.callLogId, outcome: aiCallSession.outcome, status: aiCallSession.status, jobId: aiCallSession.jobId, createdAt: aiCallSession.createdAt,
      callerNumber: callLog.callerNumber, callerName: callLog.callerName, contactId: callLog.contactId, summary: callLog.aiSummary, recordingUrl: callLog.recordingUrl, duration: callLog.duration,
      jobNumber: job.number, contactName: contact.name,
    }).from(aiCallSession).innerJoin(callLog, eq(callLog.id, aiCallSession.callLogId)).leftJoin(job, eq(job.id, aiCallSession.jobId)).leftJoin(contact, eq(contact.id, callLog.contactId))
      .where(eq(aiCallSession.companyId, companyId)).orderBy(desc(aiCallSession.createdAt)).limit(limit).offset((page - 1) * limit)
    const [{ total }] = await db.select({ total: count() }).from(aiCallSession).where(eq(aiCallSession.companyId, companyId))
    return { rows: rows.map((r: any) => ({ ...r, outcomeLabel: OUTCOME_LABELS[r.status === 'live' ? 'live' : (r.outcome as string)] || 'Ended' })), total: Number(total) }
  }

  async function getCall(companyId: string, id: string) {
    const [row] = await db.select({
      id: aiCallSession.id, callLogId: aiCallSession.callLogId, outcome: aiCallSession.outcome, status: aiCallSession.status, jobId: aiCallSession.jobId, createdAt: aiCallSession.createdAt,
      callerNumber: callLog.callerNumber, callerName: callLog.callerName, contactId: callLog.contactId, summary: callLog.aiSummary, recordingUrl: callLog.recordingUrl, duration: callLog.duration, transcription: callLog.transcription,
      jobNumber: job.number, contactName: contact.name,
    }).from(aiCallSession).innerJoin(callLog, eq(callLog.id, aiCallSession.callLogId)).leftJoin(job, eq(job.id, aiCallSession.jobId)).leftJoin(contact, eq(contact.id, callLog.contactId))
      .where(and(eq(aiCallSession.companyId, companyId), eq(aiCallSession.id, id))).limit(1)
    if (!row) return null
    const turns = await db.select({ id: aiCallTurn.id, seq: aiCallTurn.seq, speaker: aiCallTurn.speaker, text: aiCallTurn.text, intent: aiCallTurn.intent, createdAt: aiCallTurn.createdAt }).from(aiCallTurn).where(eq(aiCallTurn.callLogId, row.callLogId)).orderBy(asc(aiCallTurn.seq))
    return { ...row, outcomeLabel: OUTCOME_LABELS[row.status === 'live' ? 'live' : (row.outcome as string)] || 'Ended', turns }
  }

  return { getSettings, saveSettings, shouldAnswer, withinHours, buildContext, services, incoming, turn, hangup, answeredByAssistant, listCalls, getCall, spread }
}

export const OUTCOME_LABELS: Record<string, string> = {
  live: 'In progress', booked: 'Booked a visit', message: 'Took a message', transferred: 'Transferred', answered: 'Answered a question',
  no_answer: 'Nobody could be reached', hung_up: 'Caller hung up', abandoned: 'No reply from the caller',
}

export type AiCallAnsweringService = ReturnType<typeof createAiCallAnsweringService>
