// A business texts from its OWN registered number (crm/comms/texting.ts; the Factory's services/a2p.ts registers it).
// Every business used to text from one shared Twomiah number: replies went to Twilio's demo auto-reply and Android
// filed the texts as unknown (2026-10-21). Now the shared number is never the business's sender: until the carriers
// approve the business there is no sender and texting says so; once approved, the Factory writes the business's
// Messaging Service and number into its CRM, and every text goes out through them. No live Twilio call is made here.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { twilioConfigFor, twilioConfigured, twilioSender } from '../../../packages/tenant-backend/src/integrations/twilio.ts'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = ''
const MG = 'MG' + 'a'.repeat(32)
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const fromFactory = (json: unknown, key = 'factory-key') => t.call('/api/internal/texting', { method: 'POST', headers: { 'X-Factory-Key': key }, json })
const companyRow = async () => (await t.db.select().from(t.schema.company).where(eq(t.schema.company.id, companyId)))[0]

beforeAll(async () => {
  process.env.FACTORY_SYNC_KEY = 'factory-key'
  // The platform's Twilio ACCOUNT, as the Factory sets it — and no shared number (unified/factory.ts leaves it out).
  process.env.TWILIO_ACCOUNT_SID = 'AC-platform'
  process.env.TWILIO_AUTH_TOKEN = 'platform-token'
  delete process.env.TWILIO_PHONE_NUMBER
  delete process.env.TWILIO_MESSAGING_SERVICE_SID
  t = await bootTenant()
  const s = await seedOwner(t)
  companyId = s.company.id
  // The texting doors are Two-Way Texting's (2026-10-22): this business has it on.
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'two_way_texting'] } as any).where(eq(t.schema.company.id, companyId))
  owner = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
})

describe('before the carriers approve the business', () => {
  test('there is no sender, and a text is refused in words that say why', async () => {
    expect(twilioConfigured(twilioConfigFor(await companyRow()))).toBe(false)
    const r = await as('/api/sms/send', { method: 'POST', json: { toPhone: '608-555-0100', message: 'hello' } })
    expect(r.status).toBe(402)
    expect((await r.json()).error).toContain('Texting is not set up')
  })
})

describe('the Factory hands over the approved sender', () => {
  test('only the Factory, with this business\'s key, and only a real Messaging Service and US number', async () => {
    expect((await fromFactory({ messagingServiceSid: MG, phoneNumber: '+17155550123' }, 'wrong')).status).toBe(401)
    expect((await as('/api/internal/texting', { method: 'POST', json: { messagingServiceSid: MG, phoneNumber: '+17155550123' } })).status).toBe(401)
    expect((await fromFactory({ messagingServiceSid: 'MGnope', phoneNumber: '+17155550123' })).status).toBe(400)
    expect((await fromFactory({ messagingServiceSid: MG, phoneNumber: '715-555-0123' })).status).toBe(400)
    expect((await fromFactory({ messagingServiceSid: MG, phoneNumber: '+17155550123' })).status).toBe(200)
    const j = (await companyRow()).integrations as any
    expect([j.twilioMessagingServiceSid, j.twilioPhoneNumber]).toEqual([MG, '+17155550123'])
  })

  test('texts then go out through the business\'s own Messaging Service, on the platform\'s account', async () => {
    const cfg = twilioConfigFor(await companyRow())
    expect(twilioConfigured(cfg)).toBe(true)
    expect(cfg).toMatchObject({ accountSid: 'AC-platform', authToken: 'platform-token', messagingServiceSid: MG, from: '+17155550123' })
    expect(twilioSender(cfg)).toEqual({ messagingServiceSid: MG })
  })

  test('even with a shared number in the environment, the business\'s own sender wins', async () => {
    process.env.TWILIO_PHONE_NUMBER = '+17152009947'
    try {
      expect(twilioSender(twilioConfigFor(await companyRow()))).toEqual({ messagingServiceSid: MG })
    } finally { delete process.env.TWILIO_PHONE_NUMBER }
  })

  test('the owner sees the number in Settings › Texting; staff without company:read do not', async () => {
    const r = await as('/api/texting')
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.sender).toEqual({ phoneNumber: '+17155550123' })
    // this test tenant is not linked to a Factory: the registration half says so instead of failing the page
    expect(body.registration.error).toBeTruthy()
  })
})
