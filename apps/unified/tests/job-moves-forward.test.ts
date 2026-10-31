// The job buttons (dispatch / start / complete) only move a job forward. Before 10/30 every tap wrote the status and re-ran
// its moment: a repeat texted the customer "on my way" again, and a late tap — a phone's queued Start arriving after the
// office completed the job — put a finished job back in progress (field service PR #169). Now a repeat is nothing, a move
// backwards is refused in words, and reopening is the edit form's (PUT /:id). Through the real server, for every trade that
// runs the shared jobs module.
import { describe, test, expect } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

async function tenant(vertical: string) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken as string
  const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  expect((await as('/api/company/features', { method: 'PUT', json: { features: ['contacts', 'jobs'] } })).status).toBe(200)
  // A new job is for a customer where the trade says so (contractor PR #173: crm.jobs.requireCustomer).
  const customer = (await (await as('/api/contacts', { method: 'POST', json: { name: 'Pat Customer', type: 'client' } })).json() as any).id as string
  const newJob = async () => { const j = await (await as('/api/jobs', { method: 'POST', json: { title: 'Furnace check', contactId: customer } })).json() as any; return (j.data ?? j).id as string }
  const move = async (id: string, to: 'dispatch' | 'start' | 'complete') => { const r = await as(`/api/jobs/${id}/${to}`, { method: 'POST' }); return { status: r.status, body: await r.json() as any } }
  const read = async (id: string) => { const j = await (await as(`/api/jobs/${id}`)).json() as any; return j.data ?? j }
  return { as, newJob, move, read }
}

for (const vertical of ['fieldservice', 'contractor', 'landscaping', 'basic']) {
  describe(`${vertical}: the job buttons move forward only`, () => {
    test('the usual order works, and each step is taken once', async () => {
      const { newJob, move, read } = await tenant(vertical)
      const id = await newJob()
      expect((await move(id, 'dispatch')).status).toBe(200)
      expect((await move(id, 'start')).status).toBe(200)
      const done = await move(id, 'complete')
      expect([done.status, done.body.status, !!done.body.completedAt]).toEqual([200, 'completed', true])
      // A second Complete is nothing: no rewrite (the completion time stands), marked unchanged.
      const stamp = (await read(id)).completedAt
      const again = await move(id, 'complete')
      expect([again.status, again.body.unchanged, again.body.status]).toEqual([200, true, 'completed'])
      expect((await read(id)).completedAt).toBe(stamp)
    }, 120_000)

    test('a late Start or Dispatch never reopens a completed job', async () => {
      const { newJob, move, read } = await tenant(vertical)
      const id = await newJob()
      await move(id, 'complete')
      for (const late of ['start', 'dispatch'] as const) {
        const r = await move(id, late)
        expect([late, r.status, r.body.code]).toEqual([late, 409, 'JOB_MOVE_REFUSED'])
        expect(r.body.error).toContain('already completed')
      }
      const now = await read(id)
      expect([now.status, !!now.completedAt]).toEqual(['completed', true])
    }, 120_000)

    test('a repeat Dispatch or Start is nothing; Dispatch after Start is refused', async () => {
      const { newJob, move } = await tenant(vertical)
      const id = await newJob()
      await move(id, 'dispatch')
      expect((await move(id, 'dispatch')).body.unchanged).toBe(true)
      await move(id, 'start')
      expect((await move(id, 'start')).body.unchanged).toBe(true)
      const back = await move(id, 'dispatch')
      expect([back.status, back.body.error]).toEqual([409, "This job is already in progress, so it can't be sent out now."])
    }, 120_000)

    test('two taps at once: one moves the job, the other changes nothing', async () => {
      const { newJob, move } = await tenant(vertical)
      const id = await newJob()
      const [a, b] = await Promise.all([move(id, 'complete'), move(id, 'complete')])
      expect([a.status, b.status]).toEqual([200, 200])
      expect([!!a.body.unchanged, !!b.body.unchanged].sort()).toEqual([false, true])
    }, 120_000)

    test('a cancelled job is not started or completed by a button; the edit form still reopens a finished job', async () => {
      const { as, newJob, move, read } = await tenant(vertical)
      const id = await newJob()
      expect((await as(`/api/jobs/${id}`, { method: 'PUT', json: { status: 'cancelled' } })).status).toBe(200)
      const r = await move(id, 'complete')
      expect([r.status, r.body.error]).toEqual([409, "This job was cancelled, so it can't be completed. Reopen it first."])
      const done = await newJob()
      await move(done, 'complete')
      expect((await as(`/api/jobs/${done}`, { method: 'PUT', json: { status: 'scheduled' } })).status).toBe(200)
      expect((await read(done)).status).toBe('scheduled')
      expect((await move(done, 'start')).status).toBe(200)
    }, 120_000)
  })
}
