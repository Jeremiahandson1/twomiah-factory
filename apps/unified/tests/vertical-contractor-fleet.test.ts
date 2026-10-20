// The contractor's fleet has the live map (server/core/vertical.ts BASE_CRM fleet.gps; verticals/contractor screens):
// a vehicle's position comes from its driver's phone, as for field service and basic. The old contractor template had
// no feed and showed "Map integration requires Google Maps API key" — not the reason (seen live, test tenant two).
import { describe, test, expect, beforeAll } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'
import { loadVertical } from '../server/core/vertical.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = '', ownerId = '', companyId = ''
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { Authorization: `Bearer ${token}` } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const s = await seedOwner(t)
  ownerId = s.owner.id; companyId = s.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  await as('/api/company/features', { method: 'PUT', json: { features: ['contacts', 'fleet', 'gps_tracking'] } })
}, 60_000)

describe('contractor fleet', () => {
  test('the screens draw the live map', async () => {
    const v = await loadVertical('contractor')
    expect((v.screens as any).fleet).toEqual({ gps: true })
  })

  test("a vehicle's live position is its driver's latest phone ping, and a trip starts for real", async () => {
    const v = await (await as('/api/fleet/vehicles', { method: 'POST', json: { name: 'Truck 1', assignedUserId: ownerId } })).json()
    await t.db.insert(t.schema.locationLog).values({ companyId, userId: ownerId, lat: '44.8113', lng: '-91.4985', timestamp: new Date() } as any)
    const list = await (await as('/api/fleet/vehicles')).json()
    const truck = (Array.isArray(list) ? list : list.data).find((x: any) => x.id === v.id)
    expect(truck.currentLocation).toMatchObject({ lat: 44.8113, lng: -91.4985 })
    const trip = await as('/api/fleet/trips/start', { method: 'POST', json: { vehicleId: v.id } })
    expect(trip.status).toBeLessThan(300)
    expect((await trip.json()).id).not.toBe('stub')
  }, 30_000)
})
