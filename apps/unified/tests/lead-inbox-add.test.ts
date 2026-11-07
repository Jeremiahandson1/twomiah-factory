// A lead typed into the Lead Inbox by hand (roofing live test 11/07: the inbox had no Add lead, so Hank went in as a contact and never
// reached the inbox). POST /api/leads/manual writes it the way every other door does (tenant-backend leads.ts insertLead), marked "manual",
// for a seat that may add leads; a lead with no way to reach them, or no name, is refused in words; a viewer is refused.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tok: Record<string, string> = {}
const as = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'lead_inbox'] } as any).where(eq(t.schema.company.id, s.company.id))
  t.services.features.forgetFeatures()
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any).accessToken
  tok.owner = await login('owner@test.example', s.password)
  await t.db.insert(t.schema.user).values({ email: 'view@test.example', passwordHash: await Bun.password.hash('Long-enough-1', 'bcrypt'), firstName: 'Vi', lastName: 'Ew', role: 'viewer', companyId: s.company.id } as any)
  tok.viewer = await login('view@test.example', 'Long-enough-1')
}, 120_000)

test('the owner adds a lead by hand; it is in the inbox as new, added by hand', async () => {
  const made = await json(await as('owner', '/api/leads/manual', { method: 'POST', json: { name: 'Hank Homeowner', phone: '715-555-0123', jobType: 'Roof replacement', location: '1200 Main St, Eau Claire' } }))
  expect(made.status).toBe(201)
  expect([made.body.homeownerName, made.body.sourcePlatform, made.body.status]).toEqual(['Hank Homeowner', 'manual', 'new'])
  const list = await json(await as('owner', '/api/leads'))
  expect((list.body.data ?? list.body.leads ?? list.body).some((l: any) => l.id === made.body.id)).toBe(true)
})

test('no name, or no way to reach them, is said in words; a viewer cannot add one', async () => {
  expect((await json(await as('owner', '/api/leads/manual', { method: 'POST', json: { name: '', phone: '1' } }))).body.error).toMatch(/name/)
  expect((await json(await as('owner', '/api/leads/manual', { method: 'POST', json: { name: 'No Reach' } }))).body.error).toMatch(/phone number or an email/)
  expect((await as('viewer', '/api/leads/manual', { method: 'POST', json: { name: 'X', phone: '1' } })).status).toBe(403)
})
