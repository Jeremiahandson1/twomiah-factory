// The bar's booking form doesn't ask for the customer's address unless the owner says so: a bar takes the booking at
// its own door (VerticalSettings.booking; templates/crm-bar routes/booking.ts, crm-basic's T42; tests/bar/t59-require-address).
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

async function bookingPage(requireAddress?: boolean | null) {
  const t = await bootTenant({ vertical: 'bar' })
  const seeded = await seedOwner(t)
  // The registry doesn't offer a bar online booking, so the owner's switch refuses it; the Factory can still set it
  // (it replaces the list), which is how the template's own test switched it on.
  await t.db.update(t.schema.company).set({ enabledFeatures: ['online_booking'] }).where(eq(t.schema.company.id, seeded.company.id))
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken as string
  const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { Authorization: `Bearer ${token}` } })
  const svc = await (await as('/api/booking/services', { method: 'POST', json: { name: 'Back room', durationMinutes: 60, price: 40, slotStepMinutes: 60 } })).json()
  if (requireAddress !== undefined) expect((await as('/api/booking/settings', { method: 'PATCH', json: { requireAddress } })).status).toBe(200)
  const r = await t.call(`/book/${svc.slug}`)
  expect(r.status).toBe(200)
  const html = await r.text()
  return { optional: html.includes('Address (optional)'), required: /name="address" required/.test(html) }
}

describe("the bar's booking form and the address", () => {
  // Each case boots its own tenant (a migrated database), which takes seconds.
  test('not asked by default', async () => {
    expect(await bookingPage()).toEqual({ optional: true, required: false })
  }, 60_000)
  test('the owner can switch it on, and null hands it back', async () => {
    expect(await bookingPage(true)).toEqual({ optional: false, required: true })
    expect(await bookingPage(null)).toEqual({ optional: true, required: false })
  }, 60_000)
})
