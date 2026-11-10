// Roofing's own seats (roofing live test 11/07): invites offered only Viewer / Field / Manager / Admin, so the sales rep and the crew
// member had the same menu, and the crew read the price list's sale prices ("Price $180.00", "Avg price"). Now a roofer can give a
// login Sales rep or Crew (verticals/roof/settings.ts). Both are the Field rung; Crew goes without prices:read, so the pricebook answers
// it the names with no price and no cost, and the menu has no Pricebook for it. A Sales rep still quotes from the prices.
// Through the real server as the roofing vertical; nothing reaches a real tenant.
import { test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tok: Record<string, string> = {}
const PASS = 'Long-enough-pass-1'
const call = (who: string, p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok[who]}` } })
const json = async (r: Response) => ({ status: r.status, body: await r.json() as any })
const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json() as any)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'roofing' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['jobs', 'contacts', 'quotes', 'invoices', 'pricebook', 'team'] } as any).where(eq(t.schema.company.id, s.company.id))
  t.services.features.forgetFeatures()
  tok.owner = (await login('owner@test.example', s.password)).accessToken
  for (const role of ['crew', 'sales_rep']) {
    const made = await json(await call('owner', '/api/company/users', { method: 'POST', json: { email: `${role}@roofer.example`, firstName: role, lastName: 'Person', role, password: PASS } }))
    expect([made.status, made.body.role ?? made.body.user?.role]).toEqual([201, role])
  }
  expect((await call('owner', '/api/pricebook/items', { method: 'POST', json: { name: 'Gutter cleaning visit', price: 180, cost: 60 } })).status).toBe(201)
}, 120_000)

test('a Crew login reads the price list without its prices, and its menu has no Pricebook; it is the Field rung', async () => {
  const signed = await login('crew@roofer.example', PASS)
  tok.crew = signed.accessToken
  expect(signed.permissions).not.toContain('prices:read')
  // Its own word, not the code (re-check 11/07: Users read "Sales_rep").
  expect(signed.user.roleLabel).toBe('Crew')
  const perms = await json(await call('crew', '/api/auth/permissions'))
  expect(perms.body.role).toBe('field')
  const items = await json(await call('crew', '/api/pricebook/items'))
  expect(items.status).toBe(200)
  const list = items.body.data ?? items.body
  expect(list[0].name).toBe('Gutter cleaning visit')
  expect(list[0].price).toBeUndefined()
  expect(list[0].cost).toBeUndefined()
  // The price (180) as a VALUE: in the whole text it can be a timestamp's milliseconds or a random id (unified CI 2026-11-10, same flaw).
  const values = (v: any): unknown[] => v && typeof v === 'object' ? Object.values(v).flatMap(values) : [v]
  expect(values(items.body).some((x) => x === 180 || x === '180' || x === '180.00')).toBe(false)
})

test('a Sales rep quotes from the prices (but not the cost), as Field always has', async () => {
  const signed = await login('sales_rep@roofer.example', PASS)
  tok.rep = signed.accessToken
  expect(signed.permissions).toContain('prices:read')
  expect(signed.user.roleLabel).toBe('Sales rep')
  const list = ((await json(await call('rep', '/api/pricebook/items'))).body.data)
  expect(Number(list[0].price)).toBe(180)
  expect(list[0].cost).toBeUndefined()
})
