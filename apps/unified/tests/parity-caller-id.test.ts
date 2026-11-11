// Parity tier 3 (11/10, field service): caller ID — the screen pop (ServiceTitan's caller ID with the customer's record). Through the
// real server as field service:
//   · an incoming call is announced to the office's screens by its id only ('call:incoming');
//   · the screen asks who it is: the matched customer, their open jobs and the next one, what they owe; a new number is "a new caller";
//   · an outgoing call is not announced; switched off, nothing is announced and the route is closed.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = '', owner = '', hank = ''
const announced: any[] = []
const call = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${owner}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const ins = async (table: any, values: any) => ((await (t.db as any).insert(table).values(values).returning()) as any[])[0]
const FEATURES = ['jobs', 'contacts', 'invoices', 'call_tracking', 'caller_id']
const setFeatures = async (list: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: list } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
const ring = async (from: string, direction = 'inbound') => (await json(await call('/api/calltracking/calls', { method: 'POST', json: { callerNumber: from, direction, status: 'ringing' } }))).body

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await setFeatures(FEATURES)
  owner = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
  const rt = (t.services as any).realtime
  const real = rt.emitToCompany.bind(rt)
  rt.emitToCompany = (cid: string, event: string, data: unknown) => { if (event === 'call:incoming') announced.push(data); return real(cid, event, data) }
  hank = (await ins(t.schema.contact, { companyId, name: 'Hank Homeowner', type: 'client', phone: '+16085550111', address: '1 Elm St', city: 'Madison' })).id
  await ins(t.schema.job, { companyId, number: 'JOB-1', title: 'Furnace tune-up', contactId: hank, status: 'scheduled', scheduledDate: new Date(Date.now() + 3 * 86_400_000) })
  await ins(t.schema.invoice, { companyId, number: 'INV-1', contactId: hank, status: 'sent', subtotal: '250', total: '250', amountPaid: '100' })
}, 120_000)

test("an incoming call from a customer: announced by id, and the screen reads who it is", async () => {
  const logged = await ring('+16085550111')
  expect(announced.at(-1)).toEqual({ callId: logged.id })
  const r = await json(await call(`/api/caller-id/${logged.id}`))
  expect(r.status).toBe(200)
  expect(r.body.customer).toMatchObject({ id: hank, name: 'Hank Homeowner', address: '1 Elm St, Madison' })
  expect(r.body).toMatchObject({ openJobs: 1, owed: 150 })
  expect(r.body.nextJob.title).toBe('Furnace tune-up')
})

test('a new number is a new caller; an outgoing call is not announced', async () => {
  const logged = await ring('+16085550999')
  expect((await json(await call(`/api/caller-id/${logged.id}`))).body.customer).toBeNull()
  const before = announced.length
  await ring('+16085550111', 'outbound')
  expect(announced.length).toBe(before)
})

test('switched off: nothing announced and the route is closed', async () => {
  await setFeatures(['jobs', 'contacts', 'invoices', 'call_tracking'])
  const before = announced.length
  const logged = await ring('+16085550111')
  expect(announced.length).toBe(before)
  expect([403, 404]).toContain((await call(`/api/caller-id/${logged.id}`)).status)
})
