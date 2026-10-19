// Roofing on the CRM's shared modules (docs/UNIFIED_ROOF_PLAN.md decision 6), through the real server as the roofing
// vertical: the promises roofing's own copies kept, held on the modules that replace them — asking a customer for a
// review is marketing (a crew seat is refused, a manager is not); the business's invoice totals are the books' (a crew
// seat is refused them); a teammate's login is removed by the company module's rules; a text from a number that belongs
// to no contact yet is filed under the contact when their thread is first read.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const ids: Record<string, string> = {}
const PASS = 'Seat-pass-1'

const login = async (email: string, password: string) =>
  (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string) => (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  ids.owner = seeded.owner.id
  tokens.owner = await login('owner@test.example', seeded.password)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'invoices', 'google_reviews', 'two_way_texting'] } as any).where(eq(t.schema.company.id, companyId))
  const hash = await Bun.password.hash(PASS, 'bcrypt')
  for (const [key, role] of [['crew', 'field'], ['mgr', 'manager'], ['admin', 'admin'], ['spare', 'admin']] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: hash, firstName: key, lastName: 'Seat', role, companyId } as any).returning()
    ids[key] = u.id
    tokens[key] = await login(`${key}@test.example`, PASS)
  }
}, 120_000)

describe('roofing on the shared modules', () => {
  test('asking a customer for a review is marketing: the crew seat is refused, a manager gets past the guard', async () => {
    const crew = await as('crew')('/api/reviews/request/no-such-job', { method: 'POST', json: {} })
    expect(crew.status).toBe(403)
    expect((await crew.json() as any).required).toBe('marketing:create')
    expect((await as('mgr')('/api/reviews/request/no-such-job', { method: 'POST', json: {} })).status).not.toBe(403)
  })

  test("the business's invoice totals are the books': the crew seat is refused them", async () => {
    expect((await as('crew')('/api/invoices/stats')).status).toBe(403)
    expect((await as('mgr')('/api/invoices/stats')).status).toBe(200)
  })

  test("a teammate's login: not yourself, not the owner, a spare admin yes, and the crew seat may not", async () => {
    expect((await as('crew')(`/api/company/users/${ids.spare}`, { method: 'DELETE' })).status).toBe(403)
    expect((await as('admin')(`/api/company/users/${ids.admin}`, { method: 'DELETE' })).status).toBe(400)
    const owner = await as('admin')(`/api/company/users/${ids.owner}`, { method: 'DELETE' })
    expect(owner.status).toBe(403)
    expect(String((await owner.json() as any).error)).toMatch(/transfer ownership/i)
    expect((await as('owner')(`/api/company/users/${ids.spare}`, { method: 'DELETE' })).status).toBe(204)
  })

  test("a stray text is filed under the contact the first time their own thread is read", async () => {
    const [conv] = await t.db.insert(t.schema.smsConversation).values({ companyId, phoneNumber: '+16085550909', status: 'active' } as any).returning()
    await t.db.insert(t.schema.smsMessage).values({ conversationId: conv.id, direction: 'inbound', body: 'Who do I call about my gutters?', status: 'received', twilioSid: 'SM-stray' } as any)
    const [who] = await t.db.insert(t.schema.contact).values({ companyId, name: 'New Caller', mobile: '608.555.0909' } as any).returning()
    const r = await as('owner')(`/api/sms/conversations?contactId=${who.id}`)
    expect(r.status).toBe(200)
    expect(((await r.json()) as any).data.map((row: any) => row.conversation.id)).toEqual([conv.id])
    const [after] = await t.db.select().from(t.schema.smsConversation).where(eq(t.schema.smsConversation.id, conv.id))
    expect(after.contactId).toBe(who.id)
  })
})
