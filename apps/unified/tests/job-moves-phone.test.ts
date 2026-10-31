// Parity item 3 (docs/parity/fieldservice-phone-job-flow.md rows 1, 4, 8, 10): what the server does for the phone's job flow.
// Through the real server and the real login, on BOTH field service and basic.
//   · a job can be put On hold (POST /:id/hold) and picked up again with Start; a repeat changes nothing; a finished job is refused
//     in words (the server only moves a job forward — already built in 10/30, proven here with the new move);
//   · a move that says WHEN the tech tapped (tappedAt) records that time, if it is a real recent one: the completion time and the
//     first start; a time in the future or over a week back is ignored; resuming keeps the first start;
//   · the customer text "on my way" / "on site" goes for a fresh tap, and is not sent for one tapped over half an hour ago;
//   · job photos kept on the phone: the file is uploaded under its name (the same name is one file), then the save records the
//     addresses on the job once, whatever the number of retries; another job's or business's address is refused.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const photoForm = (name?: string) => {
  const fd = new FormData()
  fd.append('photo', new File([new Uint8Array(Buffer.from(PNG_B64, 'base64'))], 'site.png', { type: 'image/png' }))
  if (name) fd.append('name', name)
  return fd
}
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

for (const vertical of ['fieldservice', 'basic'] as const) {
  describe(`${vertical}`, () => {
    let t: Awaited<ReturnType<typeof bootTenant>>
    let co = ''
    let tok = ''
    let customer = ''
    const texts: Array<{ jobId: string; kind: string }> = []
    const as = async (path: string, method = 'GET', json?: unknown) => {
      const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${tok}` } })
      const text = await r.text(); let body: any = text
      try { body = JSON.parse(text) } catch { /* not JSON */ }
      return { status: r.status, body }
    }
    const newJob = async () => (await as('/api/jobs', 'POST', { title: 'Furnace', contactId: customer })).body
    const row = async (id: string) => ((await t.db.select().from(t.schema.job).where(eq(t.schema.job.id, id))) as any[])[0]

    beforeAll(async () => {
      t = await bootTenant({ vertical })
      Object.assign((t.services as any).crm.storage, {
        storageConfigured: () => true,
        put: async (key: string, b: Buffer, type: string) => { await t.store.put(key, b, type) },
        getObject: async (key: string) => t.store.getObject(key),
        deleteFile: (key: string) => { void t.store.remove(key); return true },
      })
      ;(t.services as any).crm.sms.sendJobUpdate = async (_co: string, jobId: string, kind: string) => { texts.push({ jobId, kind }) }
      const s = await seedOwner(t)
      co = s.company.id
      await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'jobs', 'photo_capture'] } as any).where(eq(t.schema.company.id, co))
      t.services.features.forgetFeatures()
      tok = ((await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
      customer = (await as('/api/contacts', 'POST', { name: 'Pat', type: 'client' })).body.id
    }, 120_000)

    describe('on hold', () => {
      test('put on hold, repeated (nothing changes), picked up again with Start', async () => {
        const j = await newJob()
        await as(`/api/jobs/${j.id}/start`, 'POST', {})
        const hold = await as(`/api/jobs/${j.id}/hold`, 'POST', {})
        expect(hold.status).toBe(200)
        expect(hold.body.status).toBe('on_hold')
        const again = await as(`/api/jobs/${j.id}/hold`, 'POST', {})
        expect(again.status).toBe(200)
        expect(again.body.unchanged).toBe(true)
        const resume = await as(`/api/jobs/${j.id}/start`, 'POST', {})
        expect(resume.body.status).toBe('in_progress')
      })

      test('a finished or cancelled job cannot be put on hold, in words', async () => {
        const j = await newJob()
        await as(`/api/jobs/${j.id}/complete`, 'POST', {})
        const r = await as(`/api/jobs/${j.id}/hold`, 'POST', {})
        expect(r.status).toBe(409)
        expect(r.body.code).toBe('JOB_MOVE_REFUSED')
        expect(r.body.error).toContain('put on hold')
        expect((await row(j.id)).status).toBe('completed')
      })

      test('a late "start" does not turn a completed job back (already built: only forward)', async () => {
        const j = await newJob()
        await as(`/api/jobs/${j.id}/complete`, 'POST', {})
        const r = await as(`/api/jobs/${j.id}/start`, 'POST', {})
        expect(r.status).toBe(409)
        expect((await row(j.id)).status).toBe('completed')
      })
    })

    describe('paused (ServiceTitan\'s Pause)', () => {
      test('a started job is paused and resumed; the status stays in progress; a repeat changes nothing', async () => {
        const j = await newJob()
        await as(`/api/jobs/${j.id}/start`, 'POST', {})
        const p = await as(`/api/jobs/${j.id}/pause`, 'POST', { tappedAt: minutesAgo(10) })
        expect(p.status).toBe(200)
        expect(p.body.status).toBe('in_progress')
        expect(Math.abs(new Date(p.body.pausedAt).getTime() - Date.parse(minutesAgo(10)))).toBeLessThan(2000)
        expect((await as(`/api/jobs/${j.id}/pause`, 'POST', {})).body.unchanged).toBe(true)
        const r = await as(`/api/jobs/${j.id}/resume`, 'POST', {})
        expect(r.status).toBe(200)
        expect(r.body.pausedAt).toBeNull()
        expect((await as(`/api/jobs/${j.id}/resume`, 'POST', {})).body.unchanged).toBe(true)
      })
      test('only a started job can be paused; a finished one is refused in words', async () => {
        const j = await newJob()
        const early = await as(`/api/jobs/${j.id}/pause`, 'POST', {})
        expect(early.status).toBe(409)
        expect(early.body.error).toContain('nothing to pause')
        await as(`/api/jobs/${j.id}/start`, 'POST', {})
        await as(`/api/jobs/${j.id}/pause`, 'POST', {})
        await as(`/api/jobs/${j.id}/complete`, 'POST', {})
        const late = await as(`/api/jobs/${j.id}/resume`, 'POST', {})
        expect(late.status).toBe(409)
        expect(late.body.error).toContain('already completed')
        expect((await row(j.id)).status).toBe('completed')
      })
    })

    describe('when the tech tapped', () => {
      test('completed: the tapped time is the completion time', async () => {
        const j = await newJob()
        const tapped = minutesAgo(90)
        const r = await as(`/api/jobs/${j.id}/complete`, 'POST', { tappedAt: tapped })
        expect(r.status).toBe(200)
        expect(Math.abs(new Date((await row(j.id)).completedAt).getTime() - Date.parse(tapped))).toBeLessThan(1000)
      })

      test('a time in the future, over a week back, or not a time is ignored', async () => {
        for (const bad of [new Date(Date.now() + 3_600_000).toISOString(), minutesAgo(60 * 24 * 8), 'yesterday-ish']) {
          const j = await newJob()
          const before = Date.now()
          await as(`/api/jobs/${j.id}/complete`, 'POST', { tappedAt: bad })
          const done = new Date((await row(j.id)).completedAt).getTime()
          expect(done).toBeGreaterThanOrEqual(before - 2000)
          expect(done).toBeLessThanOrEqual(Date.now() + 2000)
        }
      })

      test('started: the first start is kept, and resuming from hold does not move it', async () => {
        const j = await newJob()
        const first = minutesAgo(40)
        await as(`/api/jobs/${j.id}/start`, 'POST', { tappedAt: first })
        expect(Math.abs(new Date((await row(j.id)).startedAt).getTime() - Date.parse(first))).toBeLessThan(1000)
        await as(`/api/jobs/${j.id}/hold`, 'POST', {})
        await as(`/api/jobs/${j.id}/start`, 'POST', { tappedAt: minutesAgo(5) })
        expect(Math.abs(new Date((await row(j.id)).startedAt).getTime() - Date.parse(first))).toBeLessThan(1000)
      })
    })

    describe('the customer texts', () => {
      test('"on my way" goes for a fresh tap and for no tap time; not for one tapped over half an hour ago', async () => {
        const fresh = await newJob(); const stale = await newJob(); const plain = await newJob()
        texts.length = 0
        await as(`/api/jobs/${fresh.id}/dispatch`, 'POST', { tappedAt: minutesAgo(3) })
        await as(`/api/jobs/${plain.id}/dispatch`, 'POST', {})
        await as(`/api/jobs/${stale.id}/dispatch`, 'POST', { tappedAt: minutesAgo(50) })
        const sent = texts.map((x) => `${x.jobId}:${x.kind}`)
        expect(sent).toContain(`${fresh.id}:on_my_way`)
        expect(sent).toContain(`${plain.id}:on_my_way`)
        expect(sent).not.toContain(`${stale.id}:on_my_way`)
        // …but the move itself happened.
        expect((await row(stale.id)).status).toBe('dispatched')
      })

      test('"on site" the same', async () => {
        const stale = await newJob(); const fresh = await newJob()
        texts.length = 0
        await as(`/api/jobs/${stale.id}/start`, 'POST', { tappedAt: minutesAgo(45) })
        await as(`/api/jobs/${fresh.id}/start`, 'POST', { tappedAt: minutesAgo(1) })
        const sent = texts.map((x) => `${x.jobId}:${x.kind}`)
        expect(sent).toContain(`${fresh.id}:on_site`)
        expect(sent).not.toContain(`${stale.id}:on_site`)
      })
    })

    describe('job photos kept on the phone', () => {
      const photosOf = async (id: string) => ((await t.db.select().from(t.schema.jobPhoto).where(eq(t.schema.jobPhoto.jobId, id))) as any[])
      const upload = async (jobId: string, name?: string) => {
        const r = await t.call(`/api/jobs/${jobId}/photos/file`, { method: 'POST', body: photoForm(name), headers: { Authorization: `Bearer ${tok}` } })
        return { status: r.status, body: (await r.json()) as any }
      }

      test('the file goes up under its name (the same name is one file), then one save records it — however often it is sent', async () => {
        const j = await newJob()
        const a = await upload(j.id, 'save1abc-0')
        expect(a.status).toBe(201)
        expect(a.body.url).toBe(`/media/photos/${co}/${j.id}/save1abc-0.png`)
        const b = await upload(j.id, 'save1abc-0')
        expect(b.body.url).toBe(a.body.url)
        expect((await photosOf(j.id)).length).toBe(0) // the file alone makes no photo row
        const saved = await as(`/api/jobs/${j.id}/photos/saved`, 'POST', { photos: [a.body.url], notes: '(1 photo could not be sent from the phone)' })
        expect(saved.status).toBe(201)
        expect(saved.body.saved).toBe(1)
        const again = await as(`/api/jobs/${j.id}/photos/saved`, 'POST', { photos: [a.body.url] })
        expect(again.status).toBe(200)
        expect(again.body.saved).toBe(0)
        const rows = await photosOf(j.id)
        expect(rows.length).toBe(1)
        expect(rows[0].caption).toContain('could not be sent')
        // The job's photo list shows it.
        expect(((await as(`/api/jobs/${j.id}/photos`)).body as any[]).map((p) => p.url)).toEqual([a.body.url])
      })

      test('not an image: refused; an address that is not this job\'s: refused', async () => {
        const j = await newJob(); const other = await newJob()
        const fd = new FormData(); fd.append('photo', new File([new Uint8Array(Buffer.from('<html></html>'))], 'x.png', { type: 'image/png' }))
        const bad = await t.call(`/api/jobs/${j.id}/photos/file`, { method: 'POST', body: fd, headers: { Authorization: `Bearer ${tok}` } })
        expect(bad.status).toBe(400)
        const theirs = (await upload(other.id, 'othersave-0')).body.url
        const r = await as(`/api/jobs/${j.id}/photos/saved`, 'POST', { photos: [theirs] })
        expect(r.status).toBe(400)
        expect(r.body.code).toBe('bad_photo')
        expect((await as(`/api/jobs/${j.id}/photos/saved`, 'POST', { photos: [`/media/photos/${co}/${j.id}/../x.png`] })).status).toBe(400)
        expect((await photosOf(j.id)).length).toBe(0)
      })

      test('a job that is not there: 404', async () => {
        expect((await as('/api/jobs/nope/photos/saved', 'POST', { photos: [] })).status).toBe(404)
      })
    })
  })
}
