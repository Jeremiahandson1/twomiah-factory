// The conversation brain of live AI call answering (feature `ai_call_answering`): a deterministic dialogue engine, not
// a prompt. It is pure — `step(ctx, state, input)` returns the next state, what to say or do (VoiceAction), and the
// effects the service carries out (find slots, book, save a message, transfer, end) — so every path is a test.
//
// NOTHING IS SPOKEN THAT THE OWNER DID NOT SUPPLY. Every utterance is one of the owner's wording templates (Wording,
// edited on the AI Call Answering page; DEFAULT_WORDING is what the page shows until the owner changes it) with its
// variables filled from what the owner set up elsewhere: the business's name, its pricebook services and prices, its
// hours, its service area, and the open slots Find a time returns. A caller's words are never echoed back except the
// name they gave and the address they gave, and anything outside the templates is answered with the owner's fallback
// line and the offer to take a message.
//
// Reading what the caller said is the IntentReader: `keywordIntentReader` here is deterministic (the owner's service
// names and transfer keywords, yes/no words, ordinals and times for picking a slot). An LLM reader can stand behind the
// same interface later; the spoken text stays template-driven whatever reads the caller.
import type { VoiceAction } from './voiceProvider.ts'

// ------------------------------------------------------------------------------------------------------------ wording

export const WORDING_KEYS = [
  'greeting', 'recordingNotice', 'askHelp', 'askService', 'serviceNotFound', 'askName', 'askAddress', 'outsideArea', 'offerSlots',
  'noSlots', 'confirmBooking', 'priceClause', 'booked', 'slotTaken', 'hours', 'price', 'priceUnknown', 'area', 'noArea', 'askMessage',
  'messageTaken', 'transferring', 'transferFailed', 'fallback', 'anythingElse', 'goodbye', 'silence', 'emergency',
] as const
export type WordingKey = typeof WORDING_KEYS[number]
export type Wording = Record<WordingKey, string>

/** What each line is for, as the settings page labels it (labels, never the key). */
export const WORDING_LABELS: Record<WordingKey, string> = {
  greeting: 'Greeting', recordingNotice: 'Recording notice (spoken when calls are recorded)', askHelp: 'Asking what the caller needs',
  askService: 'Asking which service', serviceNotFound: 'Service not understood', askName: 'Asking the caller\'s name',
  askAddress: 'Asking the address', outsideArea: 'Address outside the service area', offerSlots: 'Offering open times',
  noSlots: 'No open time found', confirmBooking: 'Confirming the booking', priceClause: 'The price, inside the confirmation',
  booked: 'Booked', slotTaken: 'The time was just taken', hours: 'Answering a question about hours', price: 'Answering a price question',
  priceUnknown: 'No price on file', area: 'Answering a service-area question', noArea: 'No service area on file',
  askMessage: 'Asking for the message', messageTaken: 'Message taken', transferring: 'Transferring to a person',
  transferFailed: 'Nobody picked up the transfer', fallback: 'Anything the assistant cannot help with', anythingElse: 'Anything else?',
  goodbye: 'Goodbye', silence: 'Nothing heard', emergency: 'An emergency when nobody can be reached',
}

/** The variables each template may carry, so the settings page can list them. */
export const WORDING_VARIABLES = ['company', 'caller_name', 'services', 'service', 'price', 'slots', 'date', 'time', 'tech', 'hours', 'area', 'days', 'transfer_name'] as const

export const DEFAULT_WORDING: Wording = {
  greeting: 'Thanks for calling {{company}}. I\'m the automated assistant.',
  recordingNotice: 'This call may be recorded.',
  askHelp: 'I can book a visit, answer a question about our hours, prices or service area, or take a message. How can I help?',
  askService: 'What do you need help with? We offer {{services}}.',
  serviceNotFound: 'I didn\'t catch that. We offer {{services}}. Which would you like?',
  askName: 'Can I get your name?',
  askAddress: 'What\'s the address for the visit, including the ZIP code?',
  outsideArea: 'I\'m sorry, {{company}} doesn\'t serve that address. I can take a message for the team.',
  offerSlots: 'For {{service}}, the next openings are {{slots}}. Which works for you?',
  noSlots: 'I don\'t have an opening in the next {{days}} days. I can take a message and someone will call you back.',
  confirmBooking: 'I have {{service}} on {{date}} at {{time}} with {{tech}}{{price_clause}}. Shall I book it?',
  priceClause: 'for {{price}}',
  booked: 'You\'re booked for {{date}} at {{time}}. {{company}} will see you then.',
  slotTaken: 'That time was just taken. The next openings are {{slots}}. Which works for you?',
  hours: 'Our hours are {{hours}}.',
  price: '{{service}} is {{price}}.',
  priceUnknown: 'I don\'t have a price for that on file. The team can quote it for you.',
  area: 'We serve {{area}}.',
  noArea: 'I don\'t have our service area on file. I can take a message and the team will confirm.',
  askMessage: 'Please tell me your message, and I\'ll pass it on.',
  messageTaken: 'Got it. Someone from {{company}} will get back to you at this number.',
  transferring: 'One moment while I connect you.',
  transferFailed: 'Nobody could pick up right now. I can take a message instead.',
  fallback: 'I\'m sorry, I can\'t help with that. I can take a message for the team.',
  anythingElse: 'Is there anything else I can help with?',
  goodbye: 'Thanks for calling {{company}}. Goodbye.',
  silence: 'I didn\'t hear anything.',
  emergency: 'If this is an emergency, please hang up and call 911.',
}

/** Owner templates with every key present: a key the owner left blank or never saved falls back to the default line. */
export function wordingOf(v: unknown): Wording {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const out = { ...DEFAULT_WORDING }
  for (const k of WORDING_KEYS) if (typeof src[k] === 'string' && (src[k] as string).trim()) out[k] = (src[k] as string).trim()
  return out
}

/** Fill a template's variables; one the context does not know is left empty, never spoken as {{raw}}. */
export function fill(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, k: string) => vars[k.toLowerCase()] ?? '').replace(/\s{2,}/g, ' ').trim()
}

// ------------------------------------------------------------------------------------------------------------ context

export interface DialogueService { id: string; name: string; priceCents: number | null; durationMinutes: number; keywords: string[] }
export interface OfferedSlot { date: string; startsAt: string; endsAt: string; personId: string; kind: 'user' | 'member'; name: string; dateWords: string; timeWords: string }
export interface TransferRules { to: string | null; keywords: string[]; emergencyKeywords: string[]; existingCustomer: boolean; emergency: boolean; outsideHours: boolean }

export interface DialogueContext {
  companyName: string
  services: DialogueService[]
  /** "Monday: 9am – 5pm" lines; empty when none set. */
  hoursLines: string[]
  /** Inside the business's opening hours right now (the company's clock). */
  openNow: boolean
  area: { zips: string[]; places: string[] }
  caller: { phone: string; name: string | null; known: boolean }
  sayPrices: boolean
  bookingEnabled: boolean
  bookingDays: number
  recordCalls: boolean
  wording: Wording
  transfer: TransferRules
}

// -------------------------------------------------------------------------------------------------------------- state

export type Stage = 'start' | 'help' | 'service' | 'name' | 'address' | 'slots' | 'confirm' | 'message' | 'anything_else' | 'transferring' | 'ended'
export type Outcome = 'booked' | 'message' | 'transferred' | 'answered' | 'no_answer' | 'hung_up' | 'abandoned'

export interface DialogueState {
  stage: Stage
  serviceId: string | null
  callerName: string | null
  address: string | null
  zip: string | null
  slots: OfferedSlot[]
  picked: OfferedSlot | null
  message: string | null
  /** What the caller came for, read from their first lines (book, message, hours, price, area). */
  purpose: string | null
  /** Did the call end with something done? Set once; "answered" when only questions were answered. */
  outcome: Outcome | null
  /** Retries of the current question (silence or not understood); two and the assistant takes a message. */
  retries: number
  /** Something was already done on this call (a booking, a message), so a goodbye is a clean end. */
  done: string[]
  transferReason: string | null
  /** What the name was asked for: the booking goes on, or the message is taken. */
  afterName: 'book' | 'message' | null
}

export const initialState = (): DialogueState => ({ stage: 'start', serviceId: null, callerName: null, address: null, zip: null, slots: [], picked: null, message: null, purpose: null, outcome: null, retries: 0, done: [], transferReason: null, afterName: null })

export type StepInput =
  | { kind: 'start' }
  | { kind: 'speech'; text: string }
  | { kind: 'silence' }
  /** The service found these open slots (after a `find_slots` effect). */
  | { kind: 'slots'; slots: OfferedSlot[] }
  /** The service booked the picked slot (after a `book` effect)… */
  | { kind: 'booked'; jobNumber: string }
  /** …or could not: the slot was taken; here are the slots open now. */
  | { kind: 'booking_failed'; slots: OfferedSlot[] }
  | { kind: 'transfer_result'; answered: boolean }
  /** The caller hung up (the provider's status callback). */
  | { kind: 'hangup' }

export type Effect =
  | { kind: 'find_slots'; serviceId: string; address: string | null; zip: string | null }
  | { kind: 'book'; slot: OfferedSlot; serviceId: string; callerName: string | null; address: string | null; zip: string | null }
  | { kind: 'remember_name'; name: string }
  | { kind: 'save_message'; text: string; callerName: string | null }
  | { kind: 'transfer'; to: string; reason: string }
  | { kind: 'end'; outcome: Outcome }

export interface StepResult { state: DialogueState; actions: VoiceAction[]; effects: Effect[] }

// ------------------------------------------------------------------------------------------------------- intent reader

export type Intent = 'book' | 'message' | 'transfer' | 'emergency' | 'hours' | 'price' | 'area' | 'yes' | 'no' | 'goodbye' | 'unknown'
export type Expecting = 'help' | 'service' | 'name' | 'address' | 'slot' | 'yes_no' | 'message' | 'anything_else'
export interface Reading {
  intent: Intent
  /** A service the caller named (any stage). */
  serviceId: string | null
  /** The slot the caller picked (expecting 'slot'). */
  slot: OfferedSlot | null
  /** A transfer rule the line tripped: the owner's keywords, or an emergency word. */
  transferKeyword: string | null
  emergencyKeyword: string | null
  /** A ZIP in the line. */
  zip: string | null
}
export interface IntentReader { read(text: string, expecting: Expecting, ctx: DialogueContext, state: DialogueState): Reading }

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' :]+/g, ' ').split(/\s+/).filter(Boolean)
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'my', 'our', 'your', 'service', 'services', 'repair', 'new', 'with'])
/** The words of a service name that identify it (not "the", not "service"). */
export const serviceKeywords = (name: string, extra: string[] = []): string[] => [...new Set([...words(name), ...extra.flatMap(words)].filter((w) => w.length > 2 && !STOP.has(w)))]

const has = (text: string, phrases: string[]) => { const t = ` ${text.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ')} `; return phrases.find((p) => p && t.includes(` ${p.toLowerCase().trim()} `)) ?? null }
const YES = ['yes', 'yeah', 'yep', 'yup', 'sure', 'correct', 'right', 'ok', 'okay', 'please', 'book it', 'that works', 'sounds good', 'go ahead', 'confirm', 'absolutely', 'fine']
const NO = ['no', 'nope', 'nah', 'not', 'don\'t', 'do not', 'cancel', 'never mind', 'nevermind', 'wrong']
const BOOK = ['book', 'schedule', 'appointment', 'come out', 'send someone', 'set up', 'visit', 'estimate', 'quote', 'available', 'opening', 'when can', 'need someone', 'need a', 'fix', 'broken', 'not working', 'install']
const MESSAGE = ['message', 'call me back', 'call back', 'leave a', 'have someone call', 'let them know', 'tell them', 'pass on']
const TRANSFER = ['talk to a person', 'speak to a person', 'real person', 'human', 'representative', 'speak to someone', 'talk to someone', 'operator', 'transfer', 'agent', 'the owner', 'speak with']
const HOURS = ['hours', 'open', 'close', 'closing', 'opening time', 'what time are you', 'when are you open', 'open today', 'open tomorrow']
const PRICE = ['price', 'cost', 'how much', 'charge', 'rate', 'fee', 'pricing', 'estimate cost']
const AREA = ['service area', 'do you serve', 'do you come to', 'do you cover', 'area', 'where are you', 'how far']
const BYE = ['goodbye', 'bye', 'that\'s all', 'that is all', 'nothing else', 'no thanks', 'no thank you', 'i\'m good', 'im good', 'all set', 'that\'s it']
const ORDINALS: Record<string, number> = { first: 0, one: 0, '1': 0, '1st': 0, second: 1, two: 1, '2': 1, '2nd': 1, third: 2, three: 2, '3': 2, '3rd': 2 }

/** The service the line names, by its keywords: the one with the most keyword hits, ties to the longer name. */
function serviceIn(text: string, services: DialogueService[]): DialogueService | null {
  const w = new Set(words(text))
  let best: DialogueService | null = null, bestHits = 0
  for (const s of services) {
    const hits = s.keywords.filter((k) => w.has(k) || (k.endsWith('s') && w.has(k.slice(0, -1))) || w.has(k + 's')).length
    if (hits > bestHits || (hits === bestHits && hits > 0 && best && s.name.length > best.name.length)) { best = s; bestHits = hits }
  }
  return bestHits > 0 ? best : null
}

/** The minutes a spoken time means ("9", "9:30", "ten thirty", "2 pm", "noon"), or null. */
function spokenMinutes(text: string): number | null {
  const t = text.toLowerCase()
  if (/\bnoon\b/.test(t)) return 12 * 60
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'clock)?\b/.exec(t)
  if (!m) return null
  let h = Number(m[1]); const min = Number(m[2] || 0)
  if (h > 23 || min > 59) return null
  const ap = (m[3] || '').replace(/\./g, '')
  if (ap.startsWith('p') && h < 12) h += 12
  if (ap.startsWith('a') && h === 12) h = 0
  return h * 60 + min
}
const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()

/** The slot the caller picked: an ordinal, a time, morning/afternoon, a weekday, a person's name. */
function slotIn(text: string, slots: OfferedSlot[]): OfferedSlot | null {
  if (!slots.length) return null
  const w = words(text)
  const lower = text.toLowerCase()
  if (slots.length === 1 && has(text, YES)) return slots[0]
  // A day, a time or a half of the day is read before an ordinal: "the afternoon one" is the afternoon, not number one.
  const day = DAY_NAMES.findIndex((d) => w.includes(d))
  const onDay = day >= 0 ? slots.filter((s) => weekdayOf(s.date) === day) : slots
  const min = spokenMinutes(text)
  if (min !== null && !/\b(first|second|third|1st|2nd|3rd)\b/.test(lower)) {
    const exact = onDay.find((s) => minutesOf(s.startsAt) === min) || onDay.find((s) => minutesOf(s.startsAt) % (12 * 60) === min % (12 * 60))
    if (exact) return exact
  }
  if (/\bmorning\b/.test(lower)) { const s = onDay.find((x) => minutesOf(x.startsAt) < 12 * 60); if (s) return s }
  if (/\b(afternoon|evening|later)\b/.test(lower)) { const s = onDay.find((x) => minutesOf(x.startsAt) >= 12 * 60); if (s) return s }
  for (const x of w) { const i = ORDINALS[x]; if (i !== undefined && slots[i] && (!/^(one|two|three)$/.test(x) || w.length <= 4)) return slots[i] }
  if (/\b(last|latest)\b/.test(lower)) return slots[slots.length - 1]
  if (/\b(earliest|soonest|first available|anything|whatever|any)\b/.test(lower)) return onDay[0] ?? slots[0]
  if (day >= 0 && onDay.length === 1) return onDay[0]
  const byName = slots.find((s) => words(s.name).some((n) => n.length > 2 && w.includes(n)))
  return byName ?? null
}

export const keywordIntentReader: IntentReader = {
  read(text, expecting, ctx, state) {
    const zip = (/\b(\d{5})(?:-\d{4})?\b/.exec(text) || [])[1] ?? null
    const serviceId = serviceIn(text, ctx.services)?.id ?? null
    const transferKeyword = has(text, ctx.transfer.keywords)
    const emergencyKeyword = has(text, ctx.transfer.emergencyKeywords)
    const slot = expecting === 'slot' ? slotIn(text, state.slots) : null
    const base = { serviceId, slot, transferKeyword, emergencyKeyword, zip }
    let intent: Intent = 'unknown'
    if (emergencyKeyword) intent = 'emergency'
    else if (has(text, TRANSFER) || transferKeyword) intent = 'transfer'
    else if (has(text, BYE)) intent = 'goodbye'
    else if (expecting === 'yes_no' && has(text, NO)) intent = 'no'
    else if (expecting === 'yes_no' && has(text, YES)) intent = 'yes'
    else if (has(text, MESSAGE)) intent = 'message'
    else if (has(text, PRICE)) intent = 'price'
    else if (has(text, HOURS)) intent = 'hours'
    else if (has(text, AREA)) intent = 'area'
    else if (has(text, BOOK) || (serviceId && (expecting === 'help' || expecting === 'anything_else'))) intent = 'book'
    else if (expecting === 'anything_else' && has(text, NO)) intent = 'goodbye'
    else if (expecting === 'anything_else' && has(text, YES)) intent = 'unknown'
    return { ...base, intent }
  },
}

// -------------------------------------------------------------------------------------------------------------- engine

const say = (text: string): VoiceAction => ({ kind: 'say', text })
const listen = (prompt: string, expecting: Expecting): VoiceAction => ({ kind: 'listen', prompt, expecting })
const hangup = (text: string): VoiceAction => ({ kind: 'hangup', text })

export const formatCents = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const listWords = (items: string[]) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`
const slotsWords = (slots: OfferedSlot[]) => listWords(slots.map((s) => `${s.dateWords} at ${s.timeWords}`))

/** The variables every template may use, from the context and the state. */
function vars(ctx: DialogueContext, state: DialogueState, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const service = ctx.services.find((s) => s.id === state.serviceId) ?? null
  const price = service?.priceCents != null ? formatCents(service.priceCents) : undefined
  return {
    company: ctx.companyName,
    caller_name: state.callerName ?? ctx.caller.name ?? undefined,
    services: listWords(ctx.services.map((s) => s.name)),
    service: service?.name,
    price,
    // Spoken inside the confirmation, after the person's name, so it always follows a space (the template needs none).
    price_clause: ctx.sayPrices && price ? ` ${fill(ctx.wording.priceClause, { price })}` : '',
    slots: slotsWords(state.slots),
    date: state.picked?.dateWords, time: state.picked?.timeWords, tech: state.picked?.name,
    hours: listWords(ctx.hoursLines.map((l) => l.replace(':', ''))),
    area: listWords([...ctx.area.places, ...(ctx.area.zips.length ? [`ZIP codes ${ctx.area.zips.join(', ')}`] : [])]),
    days: String(ctx.bookingDays),
    ...extra,
  }
}

/** The address passes the service area: no area set → always; ZIPs set → the ZIP must be one of them; places only → a place must be named. */
export function insideArea(area: { zips: string[]; places: string[] }, address: string | null, zip: string | null): boolean {
  if (!area.zips.length && !area.places.length) return true
  if (area.zips.length) return !!zip && area.zips.includes(zip)
  const w = (address || '').toLowerCase()
  return area.places.some((p) => w.includes(p.toLowerCase()))
}

/** The transfer rule a moment trips, or null. */
export function transferRule(ctx: DialogueContext, r: Reading | null, state: DialogueState): string | null {
  if (!ctx.transfer.to) return null
  if (r?.emergencyKeyword && ctx.transfer.emergency) return `emergency: "${r.emergencyKeyword}"`
  if (r?.transferKeyword) return `keyword: "${r.transferKeyword}"`
  if (r?.intent === 'transfer') return 'the caller asked for a person'
  if (ctx.transfer.existingCustomer && ctx.caller.known && state.stage === 'start') return 'an existing customer'
  if (ctx.transfer.outsideHours && !ctx.openNow && state.stage === 'start') return 'outside hours'
  return null
}

export function createDialogue(reader: IntentReader = keywordIntentReader) {
  const W = (ctx: DialogueContext, k: WordingKey, state: DialogueState, extra?: Record<string, string | undefined>) => fill(ctx.wording[k], vars(ctx, state, extra))

  /** The question the caller is in the middle of, asked again (after silence or a line that was not understood). */
  function reask(ctx: DialogueContext, s: DialogueState, prefix = ''): StepResult {
    const p = (t: string) => `${prefix}${prefix ? ' ' : ''}${t}`
    switch (s.stage) {
      case 'service': return { state: s, actions: [listen(p(W(ctx, 'serviceNotFound', s)), 'service')], effects: [] }
      case 'name': return { state: s, actions: [listen(p(W(ctx, 'askName', s)), 'name')], effects: [] }
      case 'address': return { state: s, actions: [listen(p(W(ctx, 'askAddress', s)), 'address')], effects: [] }
      case 'slots': return { state: s, actions: [listen(p(W(ctx, 'offerSlots', s)), 'slot')], effects: [] }
      case 'confirm': return { state: s, actions: [listen(p(W(ctx, 'confirmBooking', s)), 'yes_no')], effects: [] }
      case 'message': return { state: s, actions: [listen(p(W(ctx, 'askMessage', s)), 'message')], effects: [] }
      case 'anything_else': return { state: s, actions: [listen(p(W(ctx, 'anythingElse', s)), 'anything_else')], effects: [] }
      default: return { state: { ...s, stage: 'help' }, actions: [listen(p(W(ctx, 'askHelp', s)), 'help')], effects: [] }
    }
  }

  /** Two misses on one question: the owner's fallback, and the message is offered. */
  function giveUp(ctx: DialogueContext, s: DialogueState): StepResult {
    return toMessage(ctx, { ...s, retries: 0 }, W(ctx, 'fallback', s))
  }
  /** A message is taken from someone whose name is known: a new caller is asked for it first, then the message. */
  function toMessage(ctx: DialogueContext, s: DialogueState, lead: string): StepResult {
    if (!s.callerName && !ctx.caller.name) {
      const next = { ...s, stage: 'name' as Stage, retries: 0, afterName: 'message' as const }
      return { state: next, actions: [listen(`${lead} ${W(ctx, 'askName', next)}`.trim(), 'name')], effects: [] }
    }
    const next = { ...s, stage: 'message' as Stage, retries: 0, afterName: null }
    return { state: next, actions: [listen(`${lead} ${W(ctx, 'askMessage', next)}`.trim(), 'message')], effects: [] }
  }
  function toTransfer(ctx: DialogueContext, s: DialogueState, reason: string): StepResult {
    const next = { ...s, stage: 'transferring' as Stage, transferReason: reason }
    return { state: next, actions: [{ kind: 'transfer', to: ctx.transfer.to as string, announce: W(ctx, 'transferring', next) }], effects: [{ kind: 'transfer', to: ctx.transfer.to as string, reason }] }
  }
  function end(ctx: DialogueContext, s: DialogueState, outcome: Outcome, lead = ''): StepResult {
    const next = { ...s, stage: 'ended' as Stage, outcome: s.outcome ?? outcome }
    return { state: next, actions: [hangup(`${lead} ${W(ctx, 'goodbye', next)}`.trim())], effects: [{ kind: 'end', outcome: next.outcome as Outcome }] }
  }
  function anythingElse(ctx: DialogueContext, s: DialogueState, lead: string): StepResult {
    const next = { ...s, stage: 'anything_else' as Stage, retries: 0 }
    return { state: next, actions: [listen(`${lead} ${W(ctx, 'anythingElse', next)}`.trim(), 'anything_else')], effects: [] }
  }

  /** A question answered from what the owner set up (hours, a price, the area), then "anything else?". */
  function answer(ctx: DialogueContext, s: DialogueState, r: Reading): StepResult | null {
    if (r.intent === 'hours') return anythingElse(ctx, { ...s, purpose: s.purpose ?? 'hours' }, ctx.hoursLines.length ? W(ctx, 'hours', s) : W(ctx, 'fallback', s))
    if (r.intent === 'area') return anythingElse(ctx, { ...s, purpose: s.purpose ?? 'area' }, ctx.area.places.length || ctx.area.zips.length ? W(ctx, 'area', s) : W(ctx, 'noArea', s))
    if (r.intent === 'price') {
      const sid = r.serviceId ?? s.serviceId
      const svc = ctx.services.find((x) => x.id === sid)
      const withSvc = { ...s, purpose: s.purpose ?? 'price', serviceId: sid }
      if (!svc) return { state: { ...withSvc, stage: 'service', retries: 0 }, actions: [listen(W(ctx, 'askService', withSvc), 'service')], effects: [] }
      return anythingElse(ctx, withSvc, ctx.sayPrices && svc.priceCents != null ? W(ctx, 'price', withSvc) : W(ctx, 'priceUnknown', withSvc))
    }
    return null
  }

  /** Booking, from wherever it is: the service, the name, the address, then the slots. */
  function advanceBooking(ctx: DialogueContext, s: DialogueState): StepResult {
    if (!ctx.bookingEnabled) return toMessage(ctx, s, W(ctx, 'fallback', s))
    if (!s.serviceId) return { state: { ...s, stage: 'service', retries: 0 }, actions: [listen(W(ctx, 'askService', s), 'service')], effects: [] }
    if (!s.callerName && !ctx.caller.name) return { state: { ...s, stage: 'name', retries: 0, afterName: 'book' }, actions: [listen(W(ctx, 'askName', s), 'name')], effects: [] }
    if (!s.address) return { state: { ...s, stage: 'address', retries: 0 }, actions: [listen(W(ctx, 'askAddress', s), 'address')], effects: [] }
    return { state: { ...s, stage: 'slots', retries: 0 }, actions: [], effects: [{ kind: 'find_slots', serviceId: s.serviceId, address: s.address, zip: s.zip }] }
  }

  function step(ctx: DialogueContext, state: DialogueState, input: StepInput): StepResult {
    const s = { ...state }
    if (input.kind === 'hangup') return { state: { ...s, stage: 'ended', outcome: s.outcome ?? (s.done.length ? 'answered' : 'hung_up') }, actions: [], effects: [{ kind: 'end', outcome: s.outcome ?? (s.done.length ? 'answered' : 'hung_up') }] }
    if (s.stage === 'ended') return { state: s, actions: [hangup(W(ctx, 'goodbye', s))], effects: [] }

    if (input.kind === 'start') {
      const opening = [W(ctx, 'greeting', s), ctx.recordCalls ? W(ctx, 'recordingNotice', s) : ''].filter(Boolean).join(' ')
      const rule = transferRule(ctx, null, s)
      if (rule) { const t = toTransfer(ctx, s, rule); return { ...t, actions: [say(opening), ...t.actions] } }
      return { state: { ...s, stage: 'help' }, actions: [listen(`${opening} ${W(ctx, 'askHelp', s)}`, 'help')], effects: [] }
    }

    if (input.kind === 'slots') {
      if (!input.slots.length) return toMessage(ctx, { ...s, slots: [] }, W(ctx, 'noSlots', s))
      const next = { ...s, slots: input.slots, stage: 'slots' as Stage, retries: 0 }
      return { state: next, actions: [listen(W(ctx, 'offerSlots', next), 'slot')], effects: [] }
    }
    if (input.kind === 'booked') {
      const next = { ...s, outcome: 'booked' as Outcome, done: [...s.done, `booked ${input.jobNumber}`] }
      return anythingElse(ctx, next, W(ctx, 'booked', next))
    }
    if (input.kind === 'booking_failed') {
      if (!input.slots.length) return toMessage(ctx, { ...s, picked: null, slots: [] }, W(ctx, 'noSlots', s))
      const next = { ...s, picked: null, slots: input.slots, stage: 'slots' as Stage, retries: 0 }
      return { state: next, actions: [listen(W(ctx, 'slotTaken', next), 'slot')], effects: [] }
    }
    if (input.kind === 'transfer_result') {
      if (input.answered) return { state: { ...s, stage: 'ended', outcome: 'transferred' }, actions: [], effects: [{ kind: 'end', outcome: 'transferred' }] }
      return toMessage(ctx, { ...s, stage: 'message' }, W(ctx, 'transferFailed', s))
    }

    // Silence: the question once more, then the fallback and a message.
    if (input.kind === 'silence') {
      if (s.stage === 'message' || s.stage === 'anything_else') return s.done.length || s.stage === 'anything_else' ? end(ctx, s, s.done.length ? 'answered' : 'abandoned', W(ctx, 'silence', s)) : end(ctx, s, 'abandoned', W(ctx, 'silence', s))
      if (s.retries >= 1) return giveUp(ctx, s)
      return reask(ctx, { ...s, retries: s.retries + 1 }, W(ctx, 'silence', s))
    }

    // Speech.
    const text = input.text.trim()
    const expecting: Expecting = s.stage === 'help' ? 'help' : s.stage === 'service' ? 'service' : s.stage === 'name' ? 'name' : s.stage === 'address' ? 'address' : s.stage === 'slots' ? 'slot' : s.stage === 'confirm' ? 'yes_no' : s.stage === 'message' ? 'message' : s.stage === 'anything_else' ? 'anything_else' : 'help'
    const r = reader.read(text, expecting, ctx, s)

    // A transfer rule trips at any moment — except in the middle of dictating a message, where words are the message.
    if (s.stage !== 'message') {
      const rule = transferRule(ctx, r, s)
      if (rule) return toTransfer(ctx, s, rule)
      if (r.intent === 'emergency') return toMessage(ctx, s, W(ctx, 'emergency', s))
      if (r.intent === 'transfer') return toMessage(ctx, s, W(ctx, 'transferFailed', s))
    }

    switch (s.stage) {
      case 'help':
      case 'anything_else': {
        if (r.intent === 'goodbye' || (s.stage === 'anything_else' && r.intent === 'no')) return end(ctx, s, s.done.length ? 'answered' : (s.purpose ? 'answered' : 'hung_up'))
        if (r.intent === 'message') return toMessage(ctx, { ...s, purpose: s.purpose ?? 'message' }, '')
        const answered = answer(ctx, s, r)
        if (answered) return answered
        if (r.intent === 'book') return advanceBooking(ctx, { ...s, purpose: s.purpose ?? 'book', serviceId: r.serviceId ?? s.serviceId, retries: 0 })
        if (s.retries >= 1) return giveUp(ctx, s)
        return reask(ctx, { ...s, stage: 'help', retries: s.retries + 1 }, W(ctx, 'fallback', s))
      }
      case 'service': {
        if (r.intent === 'goodbye') return end(ctx, s, 'hung_up')
        if (r.intent === 'message') return toMessage(ctx, s, '')
        if (r.serviceId) return s.purpose === 'price' ? (answer(ctx, { ...s, serviceId: r.serviceId }, { ...r, intent: 'price' }) as StepResult) : advanceBooking(ctx, { ...s, serviceId: r.serviceId })
        if (s.retries >= 1) return giveUp(ctx, s)
        return reask(ctx, { ...s, retries: s.retries + 1 })
      }
      case 'name': {
        if (r.intent === 'goodbye') return end(ctx, s, 'hung_up')
        const name = cleanName(text)
        if (!name) { if (s.retries >= 1) return giveUp(ctx, s); return reask(ctx, { ...s, retries: s.retries + 1 }) }
        const next = { ...s, callerName: name }
        const out = s.afterName === 'message' ? toMessage(ctx, next, '') : advanceBooking(ctx, next)
        return { ...out, effects: [{ kind: 'remember_name', name }, ...out.effects] }
      }
      case 'address': {
        if (r.intent === 'goodbye') return end(ctx, s, 'hung_up')
        if (text.length < 4) { if (s.retries >= 1) return giveUp(ctx, s); return reask(ctx, { ...s, retries: s.retries + 1 }) }
        const next = { ...s, address: text, zip: r.zip }
        if (!insideArea(ctx.area, next.address, next.zip)) return toMessage(ctx, next, W(ctx, 'outsideArea', next))
        return advanceBooking(ctx, next)
      }
      case 'slots': {
        if (r.intent === 'goodbye' || r.intent === 'no') return s.done.length ? end(ctx, s, 'answered') : toMessage(ctx, s, W(ctx, 'noSlots', s))
        if (r.intent === 'message') return toMessage(ctx, s, '')
        if (r.slot) { const next = { ...s, picked: r.slot, stage: 'confirm' as Stage, retries: 0 }; return { state: next, actions: [listen(W(ctx, 'confirmBooking', next), 'yes_no')], effects: [] } }
        if (s.retries >= 1) return giveUp(ctx, s)
        return reask(ctx, { ...s, retries: s.retries + 1 })
      }
      case 'confirm': {
        if (r.intent === 'yes' && s.picked && s.serviceId) return { state: s, actions: [], effects: [{ kind: 'book', slot: s.picked, serviceId: s.serviceId, callerName: s.callerName ?? ctx.caller.name, address: s.address, zip: s.zip }] }
        if (r.intent === 'no' || r.intent === 'goodbye') { const next = { ...s, picked: null, stage: 'slots' as Stage, retries: 0 }; return { state: next, actions: [listen(W(ctx, 'offerSlots', next), 'slot')], effects: [] } }
        if (r.slot || r.serviceId) { const next = { ...s, picked: r.slot ?? s.picked, serviceId: r.serviceId ?? s.serviceId }; return { state: next, actions: [listen(W(ctx, 'confirmBooking', next), 'yes_no')], effects: [] } }
        if (s.retries >= 1) return giveUp(ctx, s)
        return reask(ctx, { ...s, retries: s.retries + 1 })
      }
      case 'message': {
        if (r.intent === 'goodbye' && text.length < 30) return end(ctx, s, s.done.length ? 'answered' : 'hung_up')
        const next = { ...s, message: text, outcome: s.outcome ?? 'message' as Outcome, done: [...s.done, 'message'] }
        const out = anythingElse(ctx, next, W(ctx, 'messageTaken', next))
        return { ...out, effects: [{ kind: 'save_message', text, callerName: s.callerName ?? ctx.caller.name }] }
      }
      default:
        return reask(ctx, s)
    }
  }

  return { step }
}

/** The name in "my name is Pat Jones" / "it's Pat" / "Pat Jones": letters, spaces, hyphens and apostrophes, at most four words. */
export function cleanName(text: string): string | null {
  let t = text.trim().replace(/^(my name is|my name's|this is|it's|it is|i am|i'm|name is|name's|the name is|yes,?|yeah,?)\s+/i, '').replace(/[.!?,]+$/g, '').trim()
  t = t.replace(/[^A-Za-z' \-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return null
  const parts = t.split(' ').slice(0, 4)
  const titled = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
  return titled.length >= 2 ? titled : null
}

/** "Wednesday, November 4" / "9:00 am" for a slot, read from its date marker and HH:MM (no zone: the company's day as stored). */
export function slotWords(date: string, hhmm: string): { dateWords: string; timeWords: string } {
  const d = new Date(`${date}T00:00:00Z`)
  const dateWords = d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })
  const [h, m] = hhmm.split(':').map(Number)
  const timeWords = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
  return { dateWords, timeWords }
}

/** A short summary of a call for the call log, from what happened. */
export function summarize(state: DialogueState, ctx: Pick<DialogueContext, 'services'>): string {
  const service = ctx.services.find((s) => s.id === state.serviceId)?.name
  const bits: string[] = []
  const booked = state.done.find((d) => d.startsWith('booked '))
  if (booked && state.picked) bits.push(`Booked ${service || 'a visit'} for ${state.picked.dateWords} at ${state.picked.timeWords} with ${state.picked.name} (${booked.slice(7)}).`)
  if (state.message) bits.push(`Message: ${state.message}`)
  if (state.transferReason) bits.push(`Transferred (${state.transferReason}).`)
  if (!bits.length) bits.push(state.purpose ? `Asked about ${state.purpose}${service ? ` (${service})` : ''}.` : 'Nothing was asked.')
  return bits.join(' ')
}
