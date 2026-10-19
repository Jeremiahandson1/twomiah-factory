// Whether the booking form asks for the customer's address is the owner's switch; unset, it is the vertical's answer
// (VerticalSettings.booking). The trades go to the address, so they ask; basic's gyms, studios and food trucks take the
// booking at their own place, so it doesn't (templates/crm-basic routes/booking.ts, T42; tests/basic/t59-require-address).
import { describe, test, expect } from 'bun:test'
import { bootTenant, seedOwner } from './harness.ts'

async function bookingPage(vertical: string, requireAddress?: boolean | null) {
  const t = await bootTenant({ vertical })
  const seeded = await seedOwner(t)
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken as string
  const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { Authorization: `Bearer ${token}` } })
  expect((await as('/api/company/features', { method: 'PUT', json: { features: ['online_booking'] } })).status).toBe(200)
  const svc = await (await as('/api/booking/services', { method: 'POST', json: { name: 'Strength session', durationMinutes: 60, price: 40, slotStepMinutes: 60 } })).json()
  if (requireAddress !== undefined) expect((await as('/api/booking/settings', { method: 'PATCH', json: { requireAddress } })).status).toBe(200)
  const r = await t.call(`/book/${svc.slug}`)
  expect(r.status).toBe(200)
  const html = await r.text()
  return { optional: html.includes('Address (optional)'), required: /name="address" required/.test(html) }
}

describe("the booking form's address, by vertical", () => {
  // Each case boots its own tenant (a migrated database), which takes seconds.
  test('basic: not asked by default', async () => {
    expect(await bookingPage('basic')).toEqual({ optional: true, required: false })
  }, 60_000)
  test('basic: the owner can switch it on, and null hands it back', async () => {
    expect(await bookingPage('basic', true)).toEqual({ optional: false, required: true })
    expect(await bookingPage('basic', null)).toEqual({ optional: true, required: false })
  }, 60_000)
  test('the trades (contractor, field service): asked by default', async () => {
    expect(await bookingPage('contractor')).toEqual({ optional: false, required: true })
    expect(await bookingPage('fieldservice')).toEqual({ optional: false, required: true })
  }, 60_000)
})
