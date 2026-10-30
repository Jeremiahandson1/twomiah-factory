// An email address that is a team member's (billy@ → Billy), through the real server (10/30, owner: "each email also has
// to be forwarded to their individual email"). It forwards to the email they sign in with; once they are switched off or
// removed it goes to the owner — never on to someone who has left. What the Factory reads (/api/internal/email-aliases)
// is where Cloudflare sends the mail, so that is what is checked.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let seeded: Awaited<ReturnType<typeof seedOwner>>
let owner: string
let billyId: string
let wesId: string

const KEY = 'factory-key-for-alias-test'
const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const factoryReads = async () => {
  const res = await t.call('/api/internal/email-aliases', { headers: { 'X-Factory-Key': KEY } })
  expect(res.status).toBe(200)
  return Object.fromEntries(((await res.json()) as any).aliases.map((a: any) => [a.localPart, a.forwardTo]))
}

beforeAll(async () => {
  delete process.env.FACTORY_URL // the pushes to the Factory go nowhere in a test
  process.env.FACTORY_SYNC_KEY = KEY
  t = await bootTenant()
  seeded = await seedOwner(t)
  const add = async (email: string, firstName: string, lastName: string) => (await t.db.insert(t.schema.user).values({
    email, passwordHash: await Bun.password.hash('Team-pass-1', 'bcrypt'), firstName, lastName, role: 'field', companyId: seeded.company.id,
  }).returning())[0].id as string
  billyId = await add('billy.h@example.net', 'Billy', 'Higgs')
  wesId = await add('wes.h@example.net', 'Wesley', 'Higgs')
  owner = await signIn('owner@test.example', seeded.password)
})

describe('an address given to a team member', () => {
  test('the page lists the team to choose from', async () => {
    const body = await (await as('/api/email-aliases')).json() as any
    expect(body.members.map((m: any) => m.name).sort()).toEqual(['Billy Higgs', 'Olive Owner', 'Wesley Higgs'])
  })

  test('it forwards to the email they sign in with — no inbox typed', async () => {
    const res = await as('/api/email-aliases', { method: 'POST', json: { localPart: 'billy', routingMode: 'forward', userId: billyId } })
    expect(res.status).toBe(201)
    const { alias } = await res.json() as any
    expect(alias.forwardTo).toBeNull()
    expect(alias.member).toEqual({ id: billyId, name: 'Billy Higgs', active: true })
    expect(alias.deliversTo).toBe('billy.h@example.net')
    expect((await factoryReads()).billy).toBe('billy.h@example.net')
  })

  test('switched off, it goes to the owner, and the page says why; back on, it is theirs again', async () => {
    expect((await as(`/api/company/users/${billyId}`, { method: 'PUT', json: { isActive: false } })).status).toBe(200)
    expect((await factoryReads()).billy).toBe('owner@test.example')
    const row = ((await (await as('/api/email-aliases')).json()) as any).aliases.find((a: any) => a.localPart === 'billy')
    expect(row.fallback).toBe('off')
    expect(row.member).toEqual({ id: billyId, name: 'Billy Higgs', active: false })
    expect(row.deliversTo).toBe('owner@test.example')
    expect((await as(`/api/company/users/${billyId}`, { method: 'PUT', json: { isActive: true } })).status).toBe(200)
    expect((await factoryReads()).billy).toBe('billy.h@example.net')
  })

  test('someone switched off cannot be given an address', async () => {
    expect((await as(`/api/company/users/${billyId}`, { method: 'PUT', json: { isActive: false } })).status).toBe(200)
    const res = await as('/api/email-aliases', { method: 'POST', json: { localPart: 'billy2', routingMode: 'forward', userId: billyId } })
    expect(res.status).toBe(400)
    expect(((await res.json()) as any).error).toContain('switched off')
    expect(((await (await as('/api/email-aliases')).json()) as any).members.map((m: any) => m.name)).not.toContain('Billy Higgs')
    await as(`/api/company/users/${billyId}`, { method: 'PUT', json: { isActive: true } })
  })

  test('someone with an address is switched off, not deleted (the app\'s rule for a login that holds anything)', async () => {
    const res = await as('/api/email-aliases', { method: 'POST', json: { localPart: 'wesley', routingMode: 'forward', userId: wesId } })
    expect(res.status).toBe(201)
    expect((await factoryReads()).wesley).toBe('wes.h@example.net')
    const del = await as(`/api/company/users/${wesId}`, { method: 'DELETE' })
    expect(del.status).toBe(409)
    expect(((await del.json()) as any).error).toContain('1 email address')
    expect((await factoryReads()).wesley).toBe('wes.h@example.net')
  })

  test('an address whose member is gone goes to the owner', async () => {
    // A login removed by some other way than the screen (the column is cleared with it).
    const { emailAlias } = t.schema as any
    const { eq } = await import('drizzle-orm')
    await t.db.update(emailAlias).set({ userId: null }).where(eq(emailAlias.localPart, 'wesley'))
    expect((await factoryReads()).wesley).toBe('owner@test.example')
    const row = ((await (await as('/api/email-aliases')).json()) as any).aliases.find((a: any) => a.localPart === 'wesley')
    expect(row.fallback).toBe('removed')
  })

  test('typing an inbox takes the address back from the member; choosing a member clears the inbox', async () => {
    const { alias } = await (await as('/api/email-aliases')).json().then((b: any) => ({ alias: b.aliases.find((a: any) => a.localPart === 'billy') }))
    let res = await as(`/api/email-aliases/${alias.id}`, { method: 'PATCH', json: { forwardTo: 'office@example.net' } })
    expect(res.status).toBe(200)
    let row = ((await res.json()) as any).alias
    expect([row.userId, row.forwardTo, row.deliversTo]).toEqual([null, 'office@example.net', 'office@example.net'])
    res = await as(`/api/email-aliases/${alias.id}`, { method: 'PATCH', json: { userId: billyId } })
    row = ((await res.json()) as any).alias
    expect([row.userId, row.forwardTo, row.deliversTo]).toEqual([billyId, null, 'billy.h@example.net'])
  })

  test('a typed inbox works as before', async () => {
    const res = await as('/api/email-aliases', { method: 'POST', json: { localPart: 'support', routingMode: 'forward', forwardTo: 'help@example.net' } })
    expect(res.status).toBe(201)
    expect((await factoryReads()).support).toBe('help@example.net')
  })
})
