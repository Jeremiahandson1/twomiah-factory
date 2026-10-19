// The switch the call log rides (CrmSettings.callTrackingSwitch). Roofing sells no Call Tracking, so its call log and
// CallRail key ride the AI Receptionist (templates/crm-roof index.ts: ['/api/calltracking', 'ai_receptionist']): a
// roofer with the AI Receptionist on reads the calls it handled. Everywhere else Call Tracking is its own switch, sold
// on its own, and the AI Receptionist alone does not open it.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

const boot = async (vertical: string, features: string[]) => {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, seeded.company.id))
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken as string
  return (p: string) => t.call(p, { headers: { Authorization: `Bearer ${token}` } })
}

type Call = Awaited<ReturnType<typeof boot>>
let roofOn: Call, roofOff: Call, contractor: Call
beforeAll(async () => {
  roofOn = await boot('roofing', ['jobs', 'contacts', 'ai_receptionist'])
  roofOff = await boot('roofing', ['jobs', 'contacts'])
  contractor = await boot('contractor', ['jobs', 'contacts', 'ai_receptionist'])
}, 180_000)

describe('the switch the call log rides', () => {
  test('a roofer with the AI Receptionist on reads its call log and its CallRail key', async () => {
    expect((await roofOn('/api/calltracking/calls?limit=20')).status).toBe(200)
    expect((await roofOn('/api/calltracking/settings')).status).toBe(200)
  })

  test('a roofer with the AI Receptionist off is refused, naming that switch', async () => {
    const r = await roofOff('/api/calltracking/calls')
    expect(r.status).toBe(403)
    expect((await r.json() as any).feature).toBe('ai_receptionist')
  })

  test('elsewhere the AI Receptionist alone does not open Call Tracking', async () => {
    const r = await contractor('/api/calltracking/calls')
    expect(r.status).toBe(403)
    expect((await r.json() as any).feature).toBe('call_tracking')
  })
})
