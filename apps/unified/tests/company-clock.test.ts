// The company's clock (packages/tenant-backend time/businessDay.ts companyTimeZone): the unified app keeps the zone in
// company.timezone — what the Factory provisions and the owner sets — and the shared modules read it. They read only
// settings.timezone (the CRM templates'), so every unified tenant's invoices, timesheets and dashboards kept their days on
// the state's zone, or UTC, whatever the owner chose (found 2026-10-19).
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { companyTimeZone } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''

beforeAll(async () => {
  t = await bootTenant()
  companyId = (await seedOwner(t)).company.id
}, 60_000)

const set = (v: Record<string, unknown>) => t.db.update(t.schema.company).set(v as any).where(eq(t.schema.company.id, companyId))

describe('the company clock', () => {
  test('the timezone column wins; then the old settings value; then the state; else UTC', async () => {
    await set({ timezone: 'America/Denver', state: 'WI', settings: { timezone: 'America/New_York' } })
    expect(await companyTimeZone(t.db, companyId)).toBe('America/Denver')
    await set({ timezone: null })
    expect(await companyTimeZone(t.db, companyId)).toBe('America/New_York')
    await set({ settings: {} })
    expect(await companyTimeZone(t.db, companyId)).toBe('America/Chicago')
    await set({ state: null })
    expect(await companyTimeZone(t.db, companyId)).toBe('UTC')
    // A zone nobody recognises is passed over, never handed to a date calculation.
    await set({ timezone: 'Mars/Olympus', state: 'WI' })
    expect(await companyTimeZone(t.db, companyId)).toBe('America/Chicago')
  })
})
