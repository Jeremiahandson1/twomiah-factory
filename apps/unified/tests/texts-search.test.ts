// The texting inbox's search (GET /api/sms/conversations?search=), through the real server. The route passed ?search and
// the service never read it, so the desktop's search box filtered nothing; found 10/30 building the phone's Texts inbox,
// which asks the same question. Search is the contact's name or the number's digits.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
const ids: Record<string, string> = {}
const listed = async (query: string) => {
  const res = await t.call(`/api/sms/conversations${query}`, { headers: { Authorization: `Bearer ${token}` } })
  expect(res.status).toBe(200)
  return ((await res.json()) as any).data.map((r: any) => r.conversation.id).sort()
}

beforeAll(async () => {
  t = await bootTenant()
  const seeded = await seedOwner(t)
  const companyId = seeded.company.id
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'two_way_texting'] } as any).where(eq(t.schema.company.id, companyId))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  const [dana] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Dana Whitfield', mobile: '(715) 555-0101' } as any).returning()
  const S = t.schema as any
  ids.dana = (await t.db.insert(S.smsConversation).values({ companyId, contactId: dana.id, phoneNumber: '+17155550101', lastMessageAt: new Date() }).returning())[0].id
  ids.stranger = (await t.db.insert(S.smsConversation).values({ companyId, phoneNumber: '+16085550188', lastMessageAt: new Date() }).returning())[0].id
}, 120_000)

describe('the texting inbox search', () => {
  test('no search: every conversation', async () => {
    expect(await listed('')).toEqual([ids.dana, ids.stranger].sort())
  })
  test('by the contact\'s name, any case, part of it', async () => {
    expect(await listed('?search=whitf')).toEqual([ids.dana])
  })
  test('by the number, however it is typed', async () => {
    expect(await listed('?search=' + encodeURIComponent('(608) 555-01'))).toEqual([ids.stranger])
    expect(await listed('?search=0101')).toEqual([ids.dana])
  })
  test('nothing matching: nothing', async () => {
    expect(await listed('?search=nobody')).toEqual([])
  })
})
