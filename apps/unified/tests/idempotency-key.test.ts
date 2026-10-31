// Idempotency-Key, honoured for every signed-in write (server/http/savedOnce.ts). The phone's offline queue sends a save
// again until it is answered, with the same key on every try; before 10/30 the server ignored the key and a lost reply
// meant the save was made twice (field service PR #169). Through the real server: a contact (any module) and a job move.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let as: (path: string, init?: any) => Promise<Response>
const KEY = 'phone-save-0001-abcdef'
let customer = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'fieldservice' })
  const s = await seedOwner(t)
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken as string
  as = (path, init = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  expect((await as('/api/company/features', { method: 'PUT', json: { features: ['contacts', 'jobs'] } })).status).toBe(200)
  // A new job is for a customer in field service (contractor PR #173: crm.jobs.requireCustomer).
  customer = (await (await as('/api/contacts', { method: 'POST', json: { name: 'Job Customer', type: 'client' } })).json() as any).id
}, 120_000)

const contacts = async (name: string) => ((await (await as(`/api/contacts?search=${encodeURIComponent(name)}`)).json() as any).data as any[]).filter((c) => c.name === name)

describe('a save sent twice with one key is made once', () => {
  test('the repeat gets the first answer back, and there is one record', async () => {
    const send = () => as('/api/contacts', { method: 'POST', json: { name: 'Quinn Repeat' }, headers: { 'Idempotency-Key': KEY } })
    const first = await send()
    const again = await send()
    expect([first.status, again.status]).toEqual([201, 201])
    expect(again.headers.get('Idempotent-Replay')).toBe('true')
    expect((await again.json() as any).id ?? null).toBe(((await first.clone().json()) as any).id ?? null)
    expect((await contacts('Quinn Repeat')).length).toBe(1)
  })

  test('without a key nothing changes: two sends make two records', async () => {
    for (let i = 0; i < 2; i++) await as('/api/contacts', { method: 'POST', json: { name: 'Nokey Twice' } })
    expect((await contacts('Nokey Twice')).length).toBe(2)
  })

  test('two tries at the same moment: one is made, the other is told to try again', async () => {
    // A job: unlike a contact (which refuses a duplicate name on its own), nothing else stops a second one being made.
    const send = () => as('/api/jobs', { method: 'POST', json: { title: 'Racer job', contactId: customer }, headers: { 'Idempotency-Key': 'phone-save-race-0001' } })
    const statuses = (await Promise.all([send(), send()])).map((r) => r.status).sort()
    expect(statuses.filter((s) => s === 503).length).toBeLessThanOrEqual(1)
    const jobs = ((await (await as('/api/jobs?search=Racer%20job')).json() as any).data as any[]).filter((j) => j.title === 'Racer job')
    expect(jobs.length).toBe(1)
  })

  test('a refused save keeps nothing: fixed and sent again under the same key, it is made', async () => {
    const key = 'phone-save-fixme-0001'
    const bad = await as('/api/contacts', { method: 'POST', json: { type: 'nonsense' }, headers: { 'Idempotency-Key': key } })
    expect(bad.status).toBe(400)
    const good = await as('/api/contacts', { method: 'POST', json: { name: 'Fixed Later' }, headers: { 'Idempotency-Key': key } })
    expect([200, 201]).toContain(good.status)
    expect(good.headers.get('Idempotent-Replay')).toBeNull()
    expect((await contacts('Fixed Later')).length).toBe(1)
  })

  test('one key used for a different save is refused; a malformed key is refused', async () => {
    const r = await as('/api/jobs', { method: 'POST', json: { title: 'Other save', contactId: customer }, headers: { 'Idempotency-Key': KEY } })
    expect([r.status, (await r.json() as any).code]).toEqual([422, 'key_reused'])
    const bad = await as('/api/jobs', { method: 'POST', json: { title: 'x' }, headers: { 'Idempotency-Key': 'no spaces allowed' } })
    expect([bad.status, (await bad.json() as any).code]).toEqual([400, 'bad_key'])
  })

  test("the phone queue's own keys are accepted (apps/mobile/src/offline/engine.ts: a UUID, or its fallback)", async () => {
    // A key the server refused would be a 400, which the queue shows as "couldn't send" — every queued save would fail.
    const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
    for (const key of [crypto.randomUUID(), fallback]) {
      const r = await as('/api/contacts', { method: 'POST', json: { name: 'Queue ' + key.slice(0, 6) }, headers: { 'Idempotency-Key': key } })
      expect([key, r.status]).toEqual([key, 201])
    }
  })

  test('a queued "complete" sent twice completes the job once', async () => {
    const job = await (await as('/api/jobs', { method: 'POST', json: { title: 'Queued', contactId: customer } })).json() as any
    const id = (job.data ?? job).id
    const send = () => as(`/api/jobs/${id}/complete`, { method: 'POST', headers: { 'Idempotency-Key': 'phone-complete-0001' } })
    const a = await (await send()).json() as any
    const b = await send()
    expect(b.headers.get('Idempotent-Replay')).toBe('true')
    expect(((await b.json()) as any).completedAt).toBe(a.completedAt)
  })
})
