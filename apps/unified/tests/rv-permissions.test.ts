// The RV pages the template left open to any signed-in seat, gated in the move by what each shows or spends:
// reports are reports:read; a paid AI or valuation call made for a deal is contacts:update (the seat that works deals);
// the lead inbox, the schedule and the dashboard ask their read. A refusal is a 403 for the seat without it; the seat
// with it gets past the gate (whatever the page then answers — no AI key here, so it may be a 503).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })

beforeAll(async () => {
  t = await bootTenant({ vertical: 'rv' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'unit_inventory', 'deal_pipeline', 'service_dept', 'dashboard', 'scheduling'] }).where(eq(t.schema.company.id, s.company.id))
  for (const role of ['manager', 'field', 'viewer']) {
    await t.db.insert(t.schema.user).values({ email: `${role}@test.example`, passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: role, lastName: 'Seat', role, companyId: s.company.id })
    tokens[role] = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: `${role}@test.example`, password: 'Seat-pass-1' } })).json()).accessToken
  }
})

const PAID = [
  ['POST', '/api/ai-reports/generate', { question: 'units sold this month' }],
  ['POST', '/api/ai-leads/draft', { leadId: 'none' }],
  ['POST', '/api/ai-trade/appraise', { year: 2020, make: 'Winnebago', model: 'View' }],
  ['POST', '/api/valuation/estimate', { year: 2020, make: 'Winnebago', model: 'View' }],
] as const

describe('RV pages ask the permission of what they show or spend', () => {
  test('the floor seat and the viewer cannot make the paid calls', async () => {
    for (const who of ['field', 'viewer']) {
      for (const [method, path, json] of PAID) {
        const res = await as(who, path, { method, json })
        expect({ who, path, status: res.status }).toEqual({ who, path, status: 403 })
      }
    }
  })

  test('a manager gets past every gate', async () => {
    for (const [method, path, json] of PAID) {
      const res = await as('manager', path, { method, json })
      expect({ path, refused: res.status === 403 || res.status === 401 }).toEqual({ path, refused: false })
    }
  })

  test('every seat still reads the dashboard, the schedule and the lead inbox', async () => {
    for (const who of ['manager', 'field', 'viewer']) {
      for (const path of ['/api/dashboard/stats', '/api/schedule-events', '/api/ai-leads/inbox']) {
        const res = await as(who, path)
        expect({ who, path, status: res.status }).toEqual({ who, path, status: 200 })
      }
    }
  })
})
