// The basic vertical's switches (verticals/basic/settings.ts, from templates/crm-basic): its lead platforms are not the
// trades' marketplaces, a job's photos are photo_capture's, and the fleet has GPS.
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { Authorization: `Bearer ${token}` } })
const features = (list: string[]) => as('/api/company/features', { method: 'PUT', json: { features: list } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'basic' })
  const seeded = await seedOwner(t)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
}, 60_000)

describe('basic', () => {
  test("lead sources: a gym connects Yelp, not Angi (templates/crm-basic routes/leads.ts, T42)", async () => {
    expect((await features(['contacts', 'lead_inbox'])).status).toBe(200)
    const angi = await as('/api/leads/sources', { method: 'POST', json: { platform: 'angi' } })
    expect(angi.status).toBe(400)
    expect((await angi.json()).error).toContain('google_business, instagram, yelp, website')
    expect((await as('/api/leads/sources', { method: 'POST', json: { platform: 'yelp' } })).status).toBe(201)
  }, 30_000)

  test("a job's photos are photo_capture's (the copy's index.ts gate)", async () => {
    expect((await features(['contacts', 'jobs'])).status).toBe(200)
    // A job is for a customer (crm.jobs.requireCustomer, contractor PR #173).
    const contactId = (await (await as('/api/contacts', { method: 'POST', json: { name: 'Studio Client', type: 'client' } })).json()).id
    const made = await as('/api/jobs', { method: 'POST', json: { title: 'Studio deep clean', contactId } })
    expect(made.status).toBe(201)
    const job = await made.json()
    const off = await as(`/api/jobs/${job.id}/photos`)
    expect(off.status).toBe(403)
    expect((await off.json()).code).toBe('FEATURE_NOT_ENABLED')
    expect((await as(`/api/jobs/${job.id}`)).status).toBe(200)
    expect((await features(['contacts', 'jobs', 'photo_capture'])).status).toBe(200)
    expect((await as(`/api/jobs/${job.id}/photos`)).status).toBe(200)
  }, 30_000)

  test('the fleet has GPS: a trip starts for real, not the stub', async () => {
    expect((await features(['contacts', 'fleet'])).status).toBe(200)
    const v = await (await as('/api/fleet/vehicles', { method: 'POST', json: { name: 'Van 1' } })).json()
    const trip = await as('/api/fleet/trips/start', { method: 'POST', json: { vehicleId: v.id } })
    expect(trip.status).toBeLessThan(300)
    expect((await trip.json()).id).not.toBe('stub')
  }, 30_000)
})
