// The phone app's RV screens against the unified server: every call the screens make (apps/mobile/app/(tabs)/units.tsx,
// parts.tsx, ai-trade.tsx, app/(details)/deal/fi.tsx; the dashboard's RV cards), with the exact params and body the app
// now sends, and every field the screens read. The AI call has no key here, so it is asserted to get past validation
// (a 503 "not configured", never a 400) — and the body the app USED to send is shown to be refused, so the fix is real.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
let fieldToken = ''
const as = (tok: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` } })
const call = (path: string, init: any = {}) => as(token, path, init)

beforeAll(async () => {
  t = await bootTenant({ vertical: 'rv' })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'unit_inventory', 'deal_pipeline', 'service_dept', 'dashboard', 'scheduling'] }).where(eq(t.schema.company.id, s.company.id))
  // The phone signs in exactly as the web does.
  const login = await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })
  expect(login.status).toBe(200)
  token = (await login.json()).accessToken
  await t.db.insert(t.schema.user).values({ email: 'field@test.example', passwordHash: await Bun.password.hash('Seat-pass-1', 'bcrypt'), firstName: 'Floor', lastName: 'Seat', role: 'field', companyId: s.company.id })
  fieldToken = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'field@test.example', password: 'Seat-pass-1' } })).json()).accessToken

  // Units, made the way the dealership makes them (POST /api/units).
  for (const [i, u] of [
    { category: 'motorhome', stockNumber: 'STK-100', year: 2022, make: 'Winnebago', modelName: 'View 24D', condition: 'new', internetPrice: '45999.00' },
    { category: 'towable', stockNumber: 'STK-101', year: 2019, make: 'Grand Design', modelName: 'Imagine 2500RL', condition: 'used', internetPrice: '28500.00' },
    { category: 'motorcycle', stockNumber: 'STK-102', year: 2024, make: 'Indian', modelName: 'Scout', condition: 'new' },
  ].entries()) {
    const res = await call('/api/units', { method: 'POST', json: u })
    expect({ i, ok: res.ok }).toEqual({ i, ok: true })
  }
}, 120_000)

describe('Inventory tab (units.tsx) and unit detail', () => {
  test('GET /api/units?limit=100 answers {data, pagination} with every field the screen reads', async () => {
    const res = await call('/api/units?limit=100')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.pagination.total).toBe(3)
    const winn = body.data.find((u: any) => u.stockNumber === 'STK-100')
    for (const k of ['id', 'year', 'make', 'modelName', 'stockNumber', 'category', 'condition', 'internetPrice']) expect({ k, has: k in winn }).toEqual({ k, has: true })
    expect(winn.internetPrice).toBe('45999.00')
    expect(Number(winn.internetPrice)).toBe(45999)
    // The fields the screen used to read do not exist.
    expect('price' in winn).toBe(false)
    expect('salePrice' in winn).toBe(false)
    expect('model' in winn).toBe(false)
    // A unit with no price answers null, which the screen shows as a dash.
    expect(body.data.find((u: any) => u.stockNumber === 'STK-102').internetPrice).toBeNull()
  })

  test('the search box goes to the server (?search=) and finds by make and by stock number', async () => {
    const byMake = await (await call('/api/units?limit=100&search=winne')).json()
    expect(byMake.data.map((u: any) => u.stockNumber)).toEqual(['STK-100'])
    const byStock = await (await call('/api/units?limit=100&search=STK-101')).json()
    expect(byStock.data.map((u: any) => u.make)).toEqual(['Grand Design'])
  })

  test('the floor seat reads the inventory too (its tab is there for it)', async () => {
    const res = await as(fieldToken, '/api/units?limit=100')
    expect(res.status).toBe(200)
  })
})

describe('Parts tab (parts.tsx)', () => {
  test('GET /api/oem-parts/search answers parts with every field the screen reads, and says it is the demo catalogue', async () => {
    for (const q of ['', 'oil filter']) {
      const res = await call('/api/oem-parts/search?q=' + encodeURIComponent(q))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.parts.length).toBeGreaterThan(0)
      for (const p of body.parts) {
        for (const k of ['partNumber', 'name', 'oem', 'price', 'availability']) expect({ k, has: p[k] !== undefined }).toEqual({ k, has: true })
        expect(typeof p.price).toBe('number')
      }
      // Nothing imported: the banner's switch.
      expect(body.live).toBe(false)
    }
  })

  test('the screen keys parts by part number + OEM, which is unique in what the server sends', async () => {
    const body = await (await call('/api/oem-parts/search?q=')).json()
    const keys = body.parts.map((p: any) => p.partNumber + '|' + p.oem)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('Trade tab (ai-trade.tsx)', () => {
  test('the body the app now sends gets past validation (no AI key here: 503, never 400)', async () => {
    for (const condition of ['excellent', 'good', 'fair', 'rough']) {
      const res = await call('/api/ai-trade/appraise', { method: 'POST', json: { make: 'Winnebago', model: 'View', condition, year: 2020, mileageHours: '12000' } })
      const body = await res.json()
      // Said in the dealer's words, never the server setting's name (live test 10/22; tests/setting-names-not-shown.test.ts).
      expect({ condition, status: res.status, code: body.code, error: body.error }).toEqual({ condition, status: 503, code: 'ai_not_configured', error: expect.stringContaining('support@twomiah.com') })
    }
    // No year and no mileage: the app leaves them out.
    const bare = await call('/api/ai-trade/appraise', { method: 'POST', json: { make: 'Winnebago', model: 'View', condition: 'good' } })
    expect(bare.status).toBe(503)
  })

  test('what the app used to send is refused: the year as a string, and "poor"', async () => {
    const asString = await call('/api/ai-trade/appraise', { method: 'POST', json: { year: '2020', make: 'Winnebago', model: 'View', mileageHours: '', condition: 'good' } })
    expect(asString.status).toBe(400)
    const poor = await call('/api/ai-trade/appraise', { method: 'POST', json: { make: 'Winnebago', model: 'View', condition: 'poor' } })
    expect(poor.status).toBe(400)
    expect((await poor.json()).error).toContain('rough')
  })
})

describe('Deal → F&I (deal/worksheet.tsx → deal/fi.tsx)', () => {
  test('GET /api/fi/products answers the menu with every field the screen reads', async () => {
    const res = await call('/api/fi/products')
    expect(res.status).toBe(200)
    const { products } = await res.json()
    expect(products.length).toBeGreaterThan(0)
    for (const p of products) for (const k of ['id', 'name', 'desc', 'price']) expect({ k, has: p[k] !== undefined }).toEqual({ k, has: true })
  })

  test('the body the app now sends (with a term) is taken; no lender: not_submitted with a reason, no rate', async () => {
    // Every term the picker offers, and the worksheet's 48/60/72, is one the server accepts.
    for (const term of [24, 36, 48, 60, 72, 84, 120, 144, 180, 240]) {
      const res = await call('/api/fi/submit', { method: 'POST', json: { applicant: { name: 'Pat Buyer' }, amountFinanced: 48731.45, term, products: ['vsc', 'gap'] } })
      expect({ term, status: res.status }).toEqual({ term, status: 200 })
      const body = await res.json()
      expect(body.result.decision).toBe('not_submitted')
      expect(typeof body.result.reason).toBe('string')
      expect(body.result.reason.length).toBeGreaterThan(0)
      expect(body.result.lender).toBeNull()
      // No apr / termMonths / approvedAmount: the screen shows the terms only when they are there.
      expect(body.result.apr).toBeUndefined()
      expect(body.result.termMonths).toBeUndefined()
      expect(body.result.approvedAmount).toBeUndefined()
      expect(body.live).toBe(false)
    }
  })

  test('what the app used to send — no term — is refused', async () => {
    const res = await call('/api/fi/submit', { method: 'POST', json: { applicant: { name: 'Pat Buyer' }, amountFinanced: 48731.45, products: [] } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Term')
  })
})

describe('The floor seat on the phone', () => {
  // Both are refused to `field` by the server (contacts:update, financing:create — packages/tenant-backend permissions),
  // and both screens show the server's error sentence rather than a blank result.
  test('is refused the trade appraisal and the F&I submit with a 403 and an error sentence', async () => {
    for (const [path, json] of [
      ['/api/ai-trade/appraise', { make: 'Winnebago', model: 'View', condition: 'good', year: 2020 }],
      ['/api/fi/submit', { applicant: { name: 'Pat Buyer' }, amountFinanced: 1000, term: 60, products: [] }],
    ] as const) {
      const res = await as(fieldToken, path, { method: 'POST', json })
      expect({ path, status: res.status }).toEqual({ path, status: 403 })
      expect(typeof (await res.json()).error).toBe('string')
    }
  })
})

describe('Dashboard (RV cards)', () => {
  test('GET /api/dashboard/stats sends the inventory total, open leads and open repair orders', async () => {
    const res = await call('/api/dashboard/stats')
    expect(res.status).toBe(200)
    const s = await res.json()
    expect(s.inventory.total).toBe(3)
    expect(typeof s.sales.openLeads).toBe('number')
    expect(typeof s.service.openRepairOrders).toBe('number')
  })

  test('the unit count, if read from the list, is pagination.total — not the length of a capped page', async () => {
    const body = await (await call('/api/units?limit=2')).json()
    expect(body.data.length).toBe(2)
    expect(body.pagination.total).toBe(3)
  })
})
