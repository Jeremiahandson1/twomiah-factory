// Live AI call answering (fieldservice parity item 12; feature `ai_call_answering`, hidden): the business's line answered by
// the assistant (server/crm/comms/callDialogue.ts, aiCallAnsweringService.ts, voiceProvider.ts), through the real server on
// BOTH field service and basic, as Twilio would call it (signed form posts; TwiML back), and through the engine directly.
//   · the doors: the feature and the AI Receptionist's permission on both sides; an unsigned turn refused; the feature off
//     or the assistant off → the line rings and takes a message as it always did;
//   · the brain is deterministic and speaks only the owner's templates: hours, a price, the service area, the fallback;
//   · a booking into a REAL open slot: Find a time's slots offered, the pick confirmed, the job made under the job lock with
//     the slot checked again (a slot taken between the offer and the yes is refused and new ones offered), the new caller a
//     contact, the office told; a message saved on the contact and announced; a transfer on the owner's rules;
//   · the transcript turn by turn and the recording on the call-log row, linked to the contact.
// No text, call or recording leaves: the texting service and the phone push are recorders; the Twilio provider makes no
// network call from a test (voiceProvider.ts).
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { twilioSignatureFor } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { createDialogue, initialState, keywordIntentReader, cleanName, insideArea, DEFAULT_WORDING, type DialogueContext, type OfferedSlot } from '../server/crm/comms/callDialogue.ts'
import { createAiCallAnsweringService, callAnsweringOf } from '../server/crm/comms/aiCallAnsweringService.ts'
import { memoryVoiceProvider, twilioVoiceProvider } from '../server/crm/comms/voiceProvider.ts'
import { findOpenSlots } from '../server/data/techAvailability.ts'

const TOKEN = 'twilio-auth-token-test'
const FEATURES = ['contacts', 'jobs', 'pricebook', 'call_tracking', 'ai_receptionist', 'ai_call_answering', 'tech_availability']
const json = async (r: Response) => (await r.json()) as any
/** Everything the TwiML says, in order, and the verbs it uses. */
const heard = (twiml: string) => ({ said: [...twiml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g)].map((m) => m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')), gather: /<Gather /.test(twiml), dial: (/<Dial[^>]*>([^<]*)<\/Dial>/.exec(twiml) || [])[1] ?? null, hangup: /<Hangup\/>/.test(twiml) })
const slotsIn = (line: string) => (/(?:openings are|next openings are) (.+?)\. Which works/.exec(line)?.[1] ?? '').split(/, or |, /).filter(Boolean)

// A context the engine is run on directly (no database): one business, two services, an open slot list, the defaults.
const slot = (date: string, startsAt: string, name = 'Tia Tech'): OfferedSlot => ({ date, startsAt, endsAt: '10:00', personId: 'tia', kind: 'user', name, dateWords: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }), timeWords: `${Number(startsAt.slice(0, 2)) % 12 || 12}:${startsAt.slice(3)} ${Number(startsAt.slice(0, 2)) < 12 ? 'am' : 'pm'}` })
const CTX: DialogueContext = {
  companyName: 'Tom & Jerry’s', services: [{ id: 'furnace', name: 'Furnace tune-up', priceCents: 12900, durationMinutes: 60, keywords: ['furnace', 'tune-up', 'tune'] }, { id: 'drain', name: 'Drain cleaning', priceCents: 19900, durationMinutes: 90, keywords: ['drain', 'cleaning'] }],
  hoursLines: ['Monday: 9am – 5pm', 'Tuesday: 9am – 5pm'], openNow: true, area: { zips: ['53703'], places: [] }, caller: { phone: '+16085550199', name: null, known: false },
  sayPrices: true, bookingEnabled: true, bookingDays: 7, recordCalls: false, wording: DEFAULT_WORDING, transfer: { to: '+16085550111', keywords: ['billing'], emergencyKeywords: ['gas smell'], existingCustomer: false, emergency: true, outsideHours: false },
}
const SLOTS = [slot('2026-11-02', '09:00'), slot('2026-11-03', '10:30', 'Sam Tech'), slot('2026-11-04', '14:00')]

describe('the brain, on its own', () => {
  const engine = createDialogue(keywordIntentReader)
  const text = (r: any) => r.actions.map((a: any) => a.text ?? a.prompt ?? a.announce).join(' ')

  test('a caller is greeted in the owner\'s words and asked what they need; nothing else is said', () => {
    const r = engine.step(CTX, initialState(), { kind: 'start' })
    expect(text(r)).toBe('Thanks for calling Tom & Jerry’s. I\'m the automated assistant. I can book a visit, answer a question about our hours, prices or service area, or take a message. How can I help?')
    expect(r.state.stage).toBe('help')
    // Every line the engine can speak is a template with its variables filled: no {{raw}} ever reaches the caller.
    expect(text(r)).not.toContain('{{')
  })

  test('hours, a price and the service area are answered from what the owner set up, then "anything else?"', () => {
    let s = engine.step(CTX, initialState(), { kind: 'start' }).state
    let r = engine.step(CTX, s, { kind: 'speech', text: 'What are your hours?' })
    expect(text(r)).toBe('Our hours are Monday 9am – 5pm, or Tuesday 9am – 5pm. Is there anything else I can help with?')
    r = engine.step(CTX, r.state, { kind: 'speech', text: 'How much is drain cleaning?' })
    expect(text(r)).toBe('Drain cleaning is $199. Is there anything else I can help with?')
    r = engine.step(CTX, r.state, { kind: 'speech', text: 'Do you serve my area?' })
    expect(text(r)).toBe('We serve ZIP codes 53703. Is there anything else I can help with?')
    // With prices switched off the owner's "no price on file" line is used — the number is never improvised.
    s = engine.step({ ...CTX, sayPrices: false }, initialState(), { kind: 'start' }).state
    expect(text(engine.step({ ...CTX, sayPrices: false }, s, { kind: 'speech', text: 'how much for a furnace tune up' }))).toContain('I don\'t have a price for that on file.')
    r = engine.step(CTX, r.state, { kind: 'speech', text: 'No, that\'s all' })
    expect(r.actions).toEqual([{ kind: 'hangup', text: 'Thanks for calling Tom & Jerry’s. Goodbye.' }])
    expect(r.effects).toEqual([{ kind: 'end', outcome: 'answered' }])
  })

  test('anything outside the templates: the fallback once, then the message is offered (the name first, for a stranger)', () => {
    const s = engine.step(CTX, initialState(), { kind: 'start' }).state
    let r = engine.step(CTX, s, { kind: 'speech', text: 'What is the weather like today' })
    expect(text(r)).toBe('I\'m sorry, I can\'t help with that. I can take a message for the team. I can book a visit, answer a question about our hours, prices or service area, or take a message. How can I help?')
    r = engine.step(CTX, r.state, { kind: 'speech', text: 'Tell me a joke' })
    expect(text(r)).toBe('I\'m sorry, I can\'t help with that. I can take a message for the team. Can I get your name?')
    r = engine.step(CTX, r.state, { kind: 'speech', text: 'my name is pat jones' })
    expect(r.effects).toEqual([{ kind: 'remember_name', name: 'Pat Jones' }])
    expect(text(r)).toBe('Please tell me your message, and I\'ll pass it on.')
    r = engine.step(CTX, r.state, { kind: 'speech', text: 'The water heater is leaking, call me back' })
    expect(r.effects).toEqual([{ kind: 'save_message', text: 'The water heater is leaking, call me back', callerName: 'Pat Jones' }])
    expect(text(r)).toBe('Got it. Someone from Tom & Jerry’s will get back to you at this number. Is there anything else I can help with?')
  })

  test('silence: the question again, then the fallback; two silences at the end hang up', () => {
    const s = engine.step(CTX, initialState(), { kind: 'start' }).state
    let r = engine.step(CTX, s, { kind: 'silence' })
    expect(text(r)).toStartWith('I didn\'t hear anything. I can book a visit')
    r = engine.step(CTX, r.state, { kind: 'silence' })
    expect(text(r)).toStartWith('I\'m sorry, I can\'t help with that.')
  })

  test('a booking: the service, the name, the address (checked against the area), the slots, the pick, the yes', () => {
    let r = engine.step(CTX, engine.step(CTX, initialState(), { kind: 'start' }).state, { kind: 'speech', text: 'I need to book a furnace tune-up' })
    expect(text(r)).toBe('Can I get your name?')
    r = engine.step(CTX, r.state, { kind: 'speech', text: 'Pat Jones' })
    expect(text(r)).toBe('What\'s the address for the visit, including the ZIP code?')
    r = engine.step(CTX, r.state, { kind: 'speech', text: '12 Oak Street, Madison 53703' })
    expect(r.actions).toEqual([])
    expect(r.effects).toEqual([{ kind: 'find_slots', serviceId: 'furnace', address: '12 Oak Street, Madison 53703', zip: '53703' }])
    r = engine.step(CTX, r.state, { kind: 'slots', slots: SLOTS })
    expect(text(r)).toBe('For Furnace tune-up, the next openings are Monday, November 2 at 9:00 am, Tuesday, November 3 at 10:30 am, or Wednesday, November 4 at 2:00 pm. Which works for you?')
    // The pick, by ordinal, by day, by time, by half of the day, by name — all deterministic.
    for (const [say, want] of [['the second one', SLOTS[1]], ['Wednesday', SLOTS[2]], ['10:30', SLOTS[1]], ['the afternoon one', SLOTS[2]], ['with Sam', SLOTS[1]], ['the earliest', SLOTS[0]], ['2 pm', SLOTS[2]]] as const) {
      const pick = engine.step(CTX, r.state, { kind: 'speech', text: say })
      expect({ say, picked: pick.state.picked?.startsAt + ' ' + pick.state.picked?.date }).toEqual({ say, picked: `${want.startsAt} ${want.date}` })
    }
    r = engine.step(CTX, r.state, { kind: 'speech', text: 'Tuesday works' })
    expect(text(r)).toBe('I have Furnace tune-up on Tuesday, November 3 at 10:30 am with Sam Tech for $129. Shall I book it?')
    const no = engine.step(CTX, r.state, { kind: 'speech', text: 'no, something else' })
    expect(text(no)).toStartWith('For Furnace tune-up, the next openings are')
    r = engine.step(CTX, r.state, { kind: 'speech', text: 'yes please' })
    expect(r.actions).toEqual([])
    expect(r.effects).toEqual([{ kind: 'book', slot: SLOTS[1], serviceId: 'furnace', callerName: 'Pat Jones', address: '12 Oak Street, Madison 53703', zip: '53703' }])
    const taken = engine.step(CTX, r.state, { kind: 'booking_failed', slots: [SLOTS[2]] })
    expect(text(taken)).toBe('That time was just taken. The next openings are Wednesday, November 4 at 2:00 pm. Which works for you?')
    r = engine.step(CTX, r.state, { kind: 'booked', jobNumber: 'JOB-00007' })
    expect(text(r)).toBe('You\'re booked for Tuesday, November 3 at 10:30 am. Tom & Jerry’s will see you then. Is there anything else I can help with?')
    expect(r.state.outcome).toBe('booked')
    const none = engine.step(CTX, r.state, { kind: 'slots', slots: [] })
    expect(text(none)).toStartWith('I don\'t have an opening in the next 7 days.')
  })

  test('an address outside the service area: the owner\'s line and a message; no area set: every address passes', () => {
    expect(insideArea({ zips: ['53703'], places: [] }, '1 Main St Chicago 60601', '60601')).toBe(false)
    expect(insideArea({ zips: [], places: ['Madison', 'Sun Prairie'] }, '12 Oak St, Sun Prairie', null)).toBe(true)
    expect(insideArea({ zips: [], places: ['Madison'] }, '1 Main St Chicago', null)).toBe(false)
    expect(insideArea({ zips: [], places: [] }, 'anywhere', null)).toBe(true)
    let r = engine.step(CTX, { ...initialState(), stage: 'address', serviceId: 'furnace', callerName: 'Pat Jones', purpose: 'book' }, { kind: 'speech', text: '1 Main Street, Chicago 60601' })
    expect(text(r)).toBe('I\'m sorry, Tom & Jerry’s doesn\'t serve that address. I can take a message for the team. Please tell me your message, and I\'ll pass it on.')
    expect(r.effects).toEqual([])
  })

  test('the transfer rules: a keyword, a person asked for, an emergency, an existing customer, outside hours — each to the owner\'s number', () => {
    const start = engine.step(CTX, initialState(), { kind: 'start' }).state
    let r = engine.step(CTX, start, { kind: 'speech', text: 'I have a question about billing' })
    expect(r.actions).toEqual([{ kind: 'transfer', to: '+16085550111', announce: 'One moment while I connect you.' }])
    expect(r.effects).toEqual([{ kind: 'transfer', to: '+16085550111', reason: 'keyword: "billing"' }])
    expect(engine.step(CTX, start, { kind: 'speech', text: 'can I talk to a real person' }).effects[0]).toMatchObject({ kind: 'transfer', reason: 'the caller asked for a person' })
    expect(engine.step(CTX, start, { kind: 'speech', text: 'there is a gas smell in my basement' }).effects[0]).toMatchObject({ kind: 'transfer', reason: 'emergency: "gas smell"' })
    const known = { ...CTX, caller: { ...CTX.caller, known: true, name: 'Ann Able' }, transfer: { ...CTX.transfer, existingCustomer: true } }
    r = engine.step(known, initialState(), { kind: 'start' })
    expect(r.actions.map((a) => a.kind)).toEqual(['say', 'transfer'])
    expect(r.effects[0]).toMatchObject({ kind: 'transfer', reason: 'an existing customer' })
    expect(engine.step({ ...CTX, openNow: false, transfer: { ...CTX.transfer, outsideHours: true } }, initialState(), { kind: 'start' }).effects[0]).toMatchObject({ reason: 'outside hours' })
    // Nobody picks up: the owner's line, and the message is taken (the name first).
    r = engine.step(CTX, r.state, { kind: 'transfer_result', answered: false })
    expect(text(r)).toBe('Nobody could pick up right now. I can take a message instead. Can I get your name?')
    expect(engine.step(CTX, r.state, { kind: 'transfer_result', answered: true }).effects).toEqual([{ kind: 'end', outcome: 'transferred' }])
    // No number to transfer to: the emergency line and a message; "a person" gets the transfer-failed line and a message.
    const noOne = { ...CTX, transfer: { ...CTX.transfer, to: null } }
    expect(text(engine.step(noOne, start, { kind: 'speech', text: 'gas smell' }))).toStartWith('If this is an emergency, please hang up and call 911.')
    expect(text(engine.step(noOne, start, { kind: 'speech', text: 'I want to speak to a person' }))).toStartWith('Nobody could pick up right now.')
  })

  test('names are cleaned, never echoed raw', () => {
    expect(cleanName('my name is pat jones')).toBe('Pat Jones')
    expect(cleanName("It's Mary-Ann O'Neil.")).toBe("Mary-ann O'neil")
    expect(cleanName('123')).toBeNull()
  })

  test('the owner\'s own wording is what is spoken; a blank line falls back to the default', () => {
    const own = { ...CTX, wording: { ...DEFAULT_WORDING, greeting: 'Hiya, {{company}} here.', askHelp: 'What can I do for you?', hours: '' } }
    expect(text(engine.step(own, initialState(), { kind: 'start' }))).toBe('Hiya, Tom & Jerry’s here. What can I do for you?')
    expect(callAnsweringOf({ wording: { hours: '  ' } }).wording.hours).toBe(DEFAULT_WORDING.hours)
  })
})

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let companyId = ''
    let owner: (p: string, init?: any) => Promise<Response>
    let field: (p: string, init?: any) => Promise<Response>
    let tia = ''
    let ann = ''
    const texts: any[] = []

    /** A request as Twilio makes it: form-encoded, signed over the full URL and the sorted parameters. */
    const twilio = (path: string, params: Record<string, string>, sign = true) => {
      const url = `http://localhost${path}`
      const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' }
      if (sign) headers['x-twilio-signature'] = twilioSignatureFor(TOKEN, url, params)
      return Promise.resolve(t.app.request(url, { method: 'POST', headers, body: new URLSearchParams(params).toString() }))
    }
    const call = async (sid: string, from: string) => heard(await (await twilio(`/api/ai-receptionist/webhook/voice/${companyId}`, { CallSid: sid, From: from, To: '+16085550100', FromCity: 'MADISON', FromState: 'WI' })).text())
    const say = async (sid: string, text: string) => heard(await (await twilio(`/api/ai-call-answering/webhook/turn/${companyId}`, { CallSid: sid, SpeechResult: text, Confidence: '0.9' })).text())
    const callRow = async (sid: string) => (await t.db.select().from(t.schema.callLog).where(eq(t.schema.callLog.providerId, sid)))[0] as any
    const sessionRow = async (sid: string) => (await t.db.select().from(t.schema.aiCallSession).where(eq(t.schema.aiCallSession.providerCallId, sid)))[0] as any
    const turnsOf = async (sid: string) => { const c = await callRow(sid); return t.db.select().from(t.schema.aiCallTurn).where(eq(t.schema.aiCallTurn.callLogId, c.id)).orderBy(t.schema.aiCallTurn.seq) }
    const features = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
    const SETTINGS = {
      enabled: true, when: 'always', hours: null,
      booking: { enabled: true, days: 7, stepMinutes: 60, defaultDurationMinutes: 60, sayPrices: true },
      area: { zips: ['53703'], places: [] },
      transfer: { to: '(608) 555-0111', keywords: ['billing'], emergencyKeywords: ['gas smell'], existingCustomer: false, emergency: true, outsideHours: false },
      recordCalls: true, wording: { greeting: 'You\'ve reached {{company}}.' },
    }
    const settings = (body: any) => owner('/api/ai-call-answering/settings', { method: 'PUT', json: body })
    /** The service built by hand on the same database, with the test provider (no network, the actions kept). */
    const bareDeps = (provider: any) => ({ db: t.db, logger: console as any, features: t.services.features, realtime: { emitToCompany() {}, EVENTS: { CONTACT_CREATED: 'c', JOB_CREATED: 'j', LEAD_CREATED: 'l', ALERT_CREATED: 'a' } } as any, phonePush: t.services.phonePush, services: t.services.crm, permissions: {}, authenticate: null, audit: null, provider } as any)

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      const s = await seedOwner(t)
      companyId = s.company.id
      await t.db.update(t.schema.company).set({ name: 'Tom & Jerry’s', timezone: 'America/Chicago', twilioAccountSid: 'AC00000000000000000000000000000000', twilioAuthToken: TOKEN, settings: { businessHours: { monday: { open: '09:00', close: '17:00' }, tuesday: { open: '09:00', close: '17:00' }, wednesday: { open: '09:00', close: '17:00' }, thursday: { open: '09:00', close: '17:00' }, friday: { open: '09:00', close: '17:00' } } } } as any).where(eq(t.schema.company.id, companyId))
      await features(FEATURES)
      const login = async (e: string, p: string) => (await json(await t.call('/api/auth/login', { method: 'POST', json: { email: e, password: p } }))).accessToken
      const as = (tok: string) => (p: string, init: any = {}) => Promise.resolve(t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } }))
      owner = as(await login('owner@test.example', s.password))
      // The owner's phone, so the office's notifications are recorded (harness: pushed).
      expect((await owner('/api/push/expo-token', { method: 'POST', json: { token: 'ExponentPushToken[owner]' } })).status).toBeLessThan(300)
      const [u] = await t.db.insert(t.schema.user).values({ email: 'tia@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Tia', lastName: 'Tech', role: 'field', companyId } as any).returning()
      tia = u.id
      field = as(await login('tia@test.example', 'Seat-pass-1'))
      // Tia works every day of the week, all day, so the next open slot is never a day away whatever the real clock says.
      await t.db.insert(t.schema.techHours).values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ companyId, userId: tia, weekday, startsAt: '00:00', endsAt: '23:59', kind: 'regular' })) as any)
      await t.db.insert(t.schema.pricebookItem).values([
        { companyId, name: 'Furnace tune-up', type: 'service', price: '129.00', laborHours: '1', active: true, showToCustomer: true },
        { companyId, name: 'Drain cleaning', type: 'service', price: '199.00', laborHours: '1.5', active: true, showToCustomer: true },
        { companyId, name: 'Secret internal rate', type: 'service', price: '1.00', active: true, showToCustomer: false },
        { companyId, name: 'Furnace filter', type: 'material', price: '20.00', active: true, showToCustomer: true },
      ] as any)
      ann = (await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', type: 'client', phone: '+16085550150' } as any).returning())[0].id
      ;(t.services.crm.sms as any).sendSMS = async (_c: string, m: any) => { texts.push(m); return { status: 'sent' } }
    }, 120_000)

    describe('the doors', () => {
      test('the settings are the AI Receptionist\'s permission; the feature off closes the API and the line falls back', async () => {
        expect((await t.call('/api/ai-call-answering/settings')).status).toBe(401)
        expect((await field('/api/ai-call-answering/settings')).status).toBe(403)
        expect((await field('/api/ai-call-answering/calls')).status).toBe(403)
        expect((await owner('/api/ai-call-answering/settings')).status).toBe(200)
        await features(FEATURES.filter((f) => f !== 'ai_call_answering'))
        try {
          expect([403, 404]).toContain((await owner('/api/ai-call-answering/settings')).status)
        } finally { await features(FEATURES) }
      })

      test('the settings: validated by field, saved as the page sends them, the defaults shown until then', async () => {
        const before = await json(await owner('/api/ai-call-answering/settings'))
        expect(before.enabled).toBe(false)
        expect(before.wording.greeting).toBe(DEFAULT_WORDING.greeting)
        expect(before.wordingLabels.askMessage).toBe('Asking for the message')
        const bad = await settings({ ...SETTINGS, transfer: { ...SETTINGS.transfer, to: '555-12' }, area: { zips: ['1234'], places: [] }, when: 'custom', hours: null })
        expect(bad.status).toBe(400)
        const fields = (await json(bad)).fields
        expect(fields['transfer.to']).toBe('Enter a 10-digit US phone number')
        expect(fields['area.zips.0']).toBe('A ZIP code is five digits')
        expect(fields.hours).toBeTruthy()
        const ok = await settings(SETTINGS)
        expect(ok.status).toBe(200)
        const saved = await json(ok)
        expect(saved).toMatchObject({ enabled: true, when: 'always', transfer: { to: '+16085550111', keywords: ['billing'] }, area: { zips: ['53703'] }, recordCalls: true })
        expect(saved.wording.greeting).toBe('You\'ve reached {{company}}.')
        expect(saved.wording.askHelp).toBe(DEFAULT_WORDING.askHelp)
        expect((await json(await owner('/api/ai-call-answering/status'))).label).toBe('Answering calls now')
        // The services it will name: the pricebook's active, customer-visible services, with their prices and lengths.
        const svcs = (await json(await owner('/api/ai-call-answering/services'))).data
        expect(svcs.map((s: any) => [s.name, s.priceCents, s.durationMinutes])).toEqual([['Drain cleaning', 19900, 90], ['Furnace tune-up', 12900, 60]])
      })

      test('the assistant off, or outside its hours: the line rings the forwarding number as it always did', async () => {
        await owner('/api/ai-receptionist/settings', { method: 'PUT', json: { isEnabled: true, forwardingNumber: '(608) 555-0111' } })
        expect((await settings({ ...SETTINGS, enabled: false })).status).toBe(200)
        const off = await call('CA-off', '+16085550190')
        expect(off.dial).toBe('+16085550111')
        expect(off.gather).toBe(false)
        expect(await sessionRow('CA-off')).toBeUndefined()
        // Custom hours on one day, 00:00–00:01: never now; the status says so in words.
        expect((await settings({ ...SETTINGS, when: 'custom', hours: { monday: { open: '00:00', close: '00:01' } } })).status).toBe(200)
        expect((await json(await owner('/api/ai-call-answering/status'))).label).toBe('On, but outside its hours right now')
        expect((await call('CA-hours', '+16085550191')).dial).toBe('+16085550111')
        expect((await settings(SETTINGS)).status).toBe(200)
      })

      test('"inside its hours" is judged on the business\'s clock', async () => {
        const svc = createAiCallAnsweringService(bareDeps(memoryVoiceProvider()))
        const co = { timezone: 'America/Chicago', settings: { businessHours: { wednesday: { open: '09:00', close: '17:00' } } } }
        const wed9am = new Date('2026-11-04T15:00:00Z'), wed8pm = new Date('2026-11-05T02:00:00Z')
        expect(svc.withinHours(callAnsweringOf({ when: 'business_hours' }), co, wed9am)).toBe(true)
        expect(svc.withinHours(callAnsweringOf({ when: 'business_hours' }), co, wed8pm)).toBe(false)
        expect(svc.withinHours(callAnsweringOf({ when: 'outside_business_hours' }), co, wed9am)).toBe(false)
        expect(svc.withinHours(callAnsweringOf({ when: 'outside_business_hours' }), co, wed8pm)).toBe(true)
        expect(svc.withinHours(callAnsweringOf({ when: 'custom', hours: { wednesday: { open: '08:00', close: '10:00' } } }), co, wed9am)).toBe(true)
        expect(svc.withinHours(callAnsweringOf({ when: 'custom', hours: { wednesday: { open: '08:00', close: '10:00' } } }), co, wed8pm)).toBe(false)
        expect(svc.withinHours(callAnsweringOf({ when: 'business_hours' }), { timezone: 'America/Chicago', settings: {} }, wed8pm)).toBe(true)
      })

      test('an unsigned turn is refused; a turn for a call that is not live ends politely', async () => {
        expect((await twilio(`/api/ai-call-answering/webhook/turn/${companyId}`, { CallSid: 'CA-x', SpeechResult: 'hello' }, false)).status).toBe(403)
        expect((await say('CA-nobody', 'hello')).hangup).toBe(true)
      })
    })

    describe('a call', () => {
      test('a new caller books Furnace tune-up into a real open slot: contact, job under the lock, transcript, the office told', async () => {
        t.pushed.length = 0
        const first = await call('CA-1', '+16085550199')
        expect(first.said).toEqual(['You\'ve reached Tom & Jerry’s. This call may be recorded. I can book a visit, answer a question about our hours, prices or service area, or take a message. How can I help?'])
        expect(first.gather).toBe(true)
        expect(await callRow('CA-1')).toMatchObject({ status: 'ringing', callerNumber: '+16085550199', contactId: null })
        expect((await sessionRow('CA-1')).status).toBe('live')

        expect((await say('CA-1', 'Hi, I need to book a furnace tune-up')).said).toEqual(['Can I get your name?'])
        expect((await say('CA-1', 'my name is Pat Jones')).said).toEqual(['What\'s the address for the visit, including the ZIP code?'])
        // The name is remembered at once: a new contact, linked to the call.
        const pat = (await t.db.select().from(t.schema.contact).where(and(eq(t.schema.contact.companyId, companyId), eq(t.schema.contact.phone, '+16085550199'))))[0] as any
        expect(pat).toMatchObject({ name: 'Pat Jones', type: 'lead', source: 'ai_call' })
        expect((await callRow('CA-1')).contactId).toBe(pat.id)

        const offer = await say('CA-1', '12 Oak Street, Madison 53703')
        const offered = slotsIn(offer.said[0])
        expect(offer.said[0]).toStartWith('For Furnace tune-up, the next openings are')
        expect(offered.length).toBeGreaterThanOrEqual(2)
        // They are Find a time's own slots for Tia, an hour long, on the hour.
        const session = await sessionRow('CA-1')
        const real = await findOpenSlots(t.db, companyId, { from: session.state.slots[0].date, days: 7, durationMinutes: 60, stepMinutes: 60, personIds: [tia] })
        for (const s of session.state.slots) expect(real.slots.some((x: any) => x.date === s.date && x.startsAt === s.startsAt && x.personId === tia)).toBe(true)
        expect(session.state.slots[0].endsAt).not.toBe(session.state.slots[0].startsAt)

        const confirm = await say('CA-1', 'the second one')
        const picked = session.state.slots[1]
        expect(confirm.said).toEqual([`I have Furnace tune-up on ${picked.dateWords} at ${picked.timeWords} with Tia Tech for $129. Shall I book it?`])

        // Between the offer and the yes, the office books Tia at that very time: the slot is checked again under the lock.
        const [blocker] = await t.db.insert(t.schema.job).values({ companyId, number: 'BLOCK-1', title: 'Office booking', contactId: ann, status: 'scheduled', assignedToId: tia, scheduledDate: new Date(`${picked.date}T00:00:00Z`), scheduledTime: picked.startsAt, estimatedHours: '1' } as any).returning()
        const taken = await say('CA-1', 'yes')
        expect(taken.said[0]).toStartWith('That time was just taken. The next openings are')
        expect(slotsIn(taken.said[0]).some((s) => s === `${picked.dateWords} at ${picked.timeWords}`)).toBe(false)
        expect((await t.db.select().from(t.schema.job).where(eq(t.schema.job.companyId, companyId))).length).toBe(1)
        await t.db.delete(t.schema.job).where(eq(t.schema.job.id, blocker.id))

        const again = (await sessionRow('CA-1')).state.slots
        const booked = await say('CA-1', 'the first one')
        expect(booked.said).toEqual([`I have Furnace tune-up on ${again[0].dateWords} at ${again[0].timeWords} with Tia Tech for $129. Shall I book it?`])
        const done = await say('CA-1', 'yes please')
        expect(done.said).toEqual([`You're booked for ${again[0].dateWords} at ${again[0].timeWords}. Tom & Jerry’s will see you then. Is there anything else I can help with?`])
        const [job] = await t.db.select().from(t.schema.job).where(eq(t.schema.job.companyId, companyId)) as any[]
        expect(job).toMatchObject({ number: 'JOB-00001', title: 'Furnace tune-up', status: 'scheduled', source: 'ai_call', contactId: pat.id, assignedToId: tia, scheduledTime: again[0].startsAt, estimatedHours: '1.00', estimatedValue: '129.00', address: '12 Oak Street, Madison 53703', zip: '53703' })
        expect(job.scheduledDate.toISOString().slice(0, 10)).toBe(again[0].date)
        expect((await sessionRow('CA-1')).jobId).toBe(job.id)
        expect(((await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.id, pat.id)))[0] as any).type).toBe('client')
        expect(t.pushed.map((p) => p.title)).toContain('Booked by the AI receptionist')

        const bye = await say('CA-1', 'No, that\'s everything, thanks')
        expect(bye.said).toEqual(['Thanks for calling Tom & Jerry’s. Goodbye.'])
        expect(bye.hangup).toBe(true)
        const row = await callRow('CA-1')
        expect(row).toMatchObject({ status: 'completed', aiResponseSent: true, contactId: pat.id, callerName: 'Pat Jones' })
        expect(row.aiSummary).toBe(`Booked Furnace tune-up for ${again[0].dateWords} at ${again[0].timeWords} with Tia Tech (JOB-00001).`)
        expect(row.transcription).toContain('Caller: Hi, I need to book a furnace tune-up')
        expect(row.transcription).toContain('Assistant: Can I get your name?')
        const turns = await turnsOf('CA-1') as any[]
        expect(turns.map((x) => x.speaker).slice(0, 4)).toEqual(['assistant', 'caller', 'assistant', 'caller'])
        expect(turns.find((x) => x.speaker === 'caller')?.intent).toBe('book')
        expect((await sessionRow('CA-1')).outcome).toBe('booked')
        const acts = await t.db.select().from(t.schema.activity).where(and(eq(t.schema.activity.entityId, pat.id), eq(t.schema.activity.action, 'ai_call_booked')))
        expect(acts.length).toBe(1)
        // The owner's page reads it back, transcript and all.
        const calls = (await json(await owner('/api/ai-call-answering/calls'))).data
        expect(calls[0]).toMatchObject({ outcomeLabel: 'Booked a visit', jobNumber: 'JOB-00001', contactName: 'Pat Jones' })
        const detail = await json(await owner(`/api/ai-call-answering/calls/${calls[0].id}`))
        expect(detail.turns.length).toBe(turns.length)
      })

      test('the recording comes back through the existing recording webhook and is filed on the call; no missed-call rule runs', async () => {
        await t.db.insert(t.schema.aiReceptionistRule).values({ companyId, name: 'Missed', trigger: 'missed_call', channel: 'sms', messageTemplate: 'Sorry we missed you.' } as any)
        texts.length = 0
        const r = await twilio(`/api/ai-receptionist/webhook/recording/${companyId}`, { CallSid: 'CA-1', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC0/Recordings/RE1', RecordingStatus: 'completed' })
        expect(r.status).toBe(200)
        await new Promise((res) => setTimeout(res, 150))
        expect(await callRow('CA-1')).toMatchObject({ recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC0/Recordings/RE1.wav', status: 'completed' })
        expect(texts).toEqual([])
        // The provider is asked to record at the start of the call, to that same webhook (no network from a test).
        const provider = memoryVoiceProvider()
        const svc = createAiCallAnsweringService(bareDeps(provider))
        await svc.incoming(companyId, { kind: 'incoming', callId: 'CA-rec', from: '+16085550198', to: '+16085550100' }, { provider, callbackUrl: `https://crm.example.com/api/ai-receptionist/webhook/recording/${companyId}` })
        expect(provider.recordings).toEqual([{ callId: 'CA-rec', callbackUrl: `https://crm.example.com/api/ai-receptionist/webhook/recording/${companyId}` }])
        // Twilio's status callback for a call the assistant was on closes it; it is never "missed".
        texts.length = 0
        expect((await twilio(`/api/ai-receptionist/webhook/status/${companyId}`, { CallSid: 'CA-rec', CallStatus: 'no-answer', From: '+16085550198' })).status).toBe(200)
        await new Promise((res) => setTimeout(res, 100))
        expect(texts).toEqual([])
        expect(await sessionRow('CA-rec')).toMatchObject({ status: 'ended', outcome: 'hung_up' })
        expect((await callRow('CA-rec')).status).toBe('completed')
      })

      test('a message: saved on the contact, in the Lead Inbox when that is on, and the managers told', async () => {
        await features([...FEATURES, 'lead_inbox'])
        try {
          t.pushed.length = 0
          await call('CA-2', '+16085550197')
          expect((await say('CA-2', 'I want to leave a message')).said).toEqual(['Can I get your name?'])
          expect((await say('CA-2', 'Lee Park')).said).toEqual(['Please tell me your message, and I\'ll pass it on.'])
          const r = await say('CA-2', 'Tell Bob the water heater is leaking again')
          expect(r.said).toEqual(['Got it. Someone from Tom & Jerry’s will get back to you at this number. Is there anything else I can help with?'])
          const lee = (await t.db.select().from(t.schema.contact).where(and(eq(t.schema.contact.companyId, companyId), eq(t.schema.contact.phone, '+16085550197'))))[0] as any
          expect(lee.name).toBe('Lee Park')
          const acts = await t.db.select().from(t.schema.activity).where(and(eq(t.schema.activity.entityId, lee.id), eq(t.schema.activity.action, 'ai_call_message'))) as any[]
          expect(acts[0].description).toBe('Message taken by the AI receptionist: Tell Bob the water heater is leaking again')
          const leads = await t.db.select().from(t.schema.lead).where(and(eq(t.schema.lead.companyId, companyId), eq(t.schema.lead.phone, '+16085550197'))) as any[]
          expect(leads.length).toBe(1)
          expect(leads[0].description).toContain('water heater')
          expect(t.pushed.map((p) => [p.title, p.body])).toContainEqual(['Message from a caller', 'Lee Park: Tell Bob the water heater is leaking again'])
          expect((await say('CA-2', 'no')).hangup).toBe(true)
          expect(await callRow('CA-2')).toMatchObject({ notes: 'Message: Tell Bob the water heater is leaking again', contactId: lee.id, aiSummary: 'Message: Tell Bob the water heater is leaking again' })
          expect((await sessionRow('CA-2')).outcome).toBe('message')
        } finally { await features(FEATURES) }
      })

      test('an existing customer is known by number and never asked their name; a price question is answered from the pricebook', async () => {
        const r = await call('CA-3', '+16085550150')
        expect(r.said[0]).toContain('How can I help?')
        expect((await say('CA-3', 'how much is drain cleaning')).said).toEqual(['Drain cleaning is $199. Is there anything else I can help with?'])
        expect((await say('CA-3', 'What are your hours')).said).toEqual(['Our hours are Monday 9am – 5pm, Tuesday 9am – 5pm, Wednesday 9am – 5pm, Thursday 9am – 5pm, or Friday 9am – 5pm. Is there anything else I can help with?'])
        expect((await say('CA-3', 'yes, I\'d like to leave a message')).said).toEqual(['Please tell me your message, and I\'ll pass it on.'])
        expect((await say('CA-3', 'Please call Ann about the invoice')).said[0]).toStartWith('Got it.')
        expect((await say('CA-3', 'bye')).hangup).toBe(true)
        expect((await callRow('CA-3')).contactId).toBe(ann)
        expect((await t.db.select().from(t.schema.contact).where(eq(t.schema.contact.phone, '+16085550150'))).length).toBe(1)
      })

      test('a transfer on the owner\'s rules: a keyword rings the person; nobody picks up and a message is taken', async () => {
        await call('CA-4', '+16085550196')
        const r = await say('CA-4', 'I have a question about my billing')
        expect(r.said).toEqual(['One moment while I connect you.'])
        expect(r.dial).toBe('+16085550111')
        const back = heard(await (await twilio(`/api/ai-call-answering/webhook/transfer-result/${companyId}`, { CallSid: 'CA-4', DialCallStatus: 'no-answer' })).text())
        expect(back.said).toEqual(['Nobody could pick up right now. I can take a message instead. Can I get your name?'])
        expect((await say('CA-4', 'Sam Lee')).said).toEqual(['Please tell me your message, and I\'ll pass it on.'])
        await say('CA-4', 'My invoice looks wrong')
        expect((await say('CA-4', 'that\'s all')).hangup).toBe(true)
        expect((await callRow('CA-4')).aiSummary).toBe('Message: My invoice looks wrong Transferred (keyword: "billing").')
        // An existing customer, with that rule on, is transferred straight after the greeting; picked up, the call is done.
        expect((await settings({ ...SETTINGS, transfer: { ...SETTINGS.transfer, existingCustomer: true } })).status).toBe(200)
        const known = await call('CA-5', '+16085550150')
        expect(known.said).toEqual(['You\'ve reached Tom & Jerry’s. This call may be recorded.', 'One moment while I connect you.'])
        expect(known.dial).toBe('+16085550111')
        await twilio(`/api/ai-call-answering/webhook/transfer-result/${companyId}`, { CallSid: 'CA-5', DialCallStatus: 'completed' })
        expect(await sessionRow('CA-5')).toMatchObject({ status: 'ended', outcome: 'transferred' })
        expect((await settings(SETTINGS)).status).toBe(200)
      })

      test('outside the service area: the owner\'s line and a message, no job; a question it cannot answer: the fallback', async () => {
        await call('CA-6', '+16085550195')
        await say('CA-6', 'book a drain cleaning')
        await say('CA-6', 'Kim Chu')
        const r = await say('CA-6', '1 Main Street, Chicago, Illinois 60601')
        expect(r.said).toEqual(['I\'m sorry, Tom & Jerry’s doesn\'t serve that address. I can take a message for the team. Please tell me your message, and I\'ll pass it on.'])
        expect((await t.db.select().from(t.schema.job).where(eq(t.schema.job.companyId, companyId))).length).toBe(1)
        await call('CA-7', '+16085550194')
        expect((await say('CA-7', 'what is the capital of France')).said[0]).toStartWith('I\'m sorry, I can\'t help with that.')
        // Silence: the question again, then the fallback and the message.
        await call('CA-8', '+16085550193')
        const quiet = heard(await (await twilio(`/api/ai-call-answering/webhook/turn/${companyId}`, { CallSid: 'CA-8', SpeechResult: '' })).text())
        expect(quiet.said[0]).toStartWith('I didn\'t hear anything. I can book a visit')
        const quieter = heard(await (await twilio(`/api/ai-call-answering/webhook/turn/${companyId}`, { CallSid: 'CA-8', SpeechResult: '' })).text())
        expect(quieter.said[0]).toBe('I\'m sorry, I can\'t help with that. I can take a message for the team. Can I get your name?')
      })

      test('the TwiML the provider renders: speech gathered to the turn webhook, the transfer to its own, the recording hooked up', () => {
        const paths = { turn: '/t', transferResult: '/x', recording: '/r' }
        const body = twilioVoiceProvider.render([{ kind: 'say', text: 'A & B' }, { kind: 'listen', prompt: 'Yes?', expecting: 'yes_no' }, { kind: 'transfer', to: '+1', announce: 'Hold' }, { kind: 'hangup', text: 'Bye' }], paths).body
        expect(body).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">A &amp; B</Say><Gather input="speech" action="/t" method="POST" language="en-US" speechTimeout="auto" timeout="6" actionOnEmptyResult="true" hints="yes, no, book it, that works, cancel"><Say voice="alice">Yes?</Say></Gather><Say voice="alice">Hold</Say><Dial timeout="25" action="/x" method="POST">+1</Dial><Say voice="alice">Bye</Say><Hangup/></Response>')
      })
    })
  })
}
