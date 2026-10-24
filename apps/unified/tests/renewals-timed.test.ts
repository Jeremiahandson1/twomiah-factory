// Salon memberships and vet wellness plans renew on their own (crm/salon/index.ts settleMembershipsForAll,
// crm/vet/index.ts settleWellnessForAll — run every 6 hours from boot). The help said "renewals are billed as they come
// due" and they were billed only when someone opened the list or pressed Run billing (matrix sweep, 2026-10-23).
//   · a due renewal is billed by the timed pass, once — a second pass bills nothing more;
//   · only where the business has the feature on.
// The renewal dates are long past (January 2026), so the pass has a period to bill whatever day the test runs.
import { describe, test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { settleMembershipsForAll } from '../server/crm/salon/index.ts'
import { settleWellnessForAll } from '../server/crm/vet/index.ts'
import logger from '../server/core/logger.ts'

const depsOf = (t: Awaited<ReturnType<typeof bootTenant>>) => ({ db: t.db, features: t.services.features, logger, services: t.services.crm } as any)

describe('salon memberships', () => {
  test('due renewals are billed by the timed pass, once, and only with Memberships on', async () => {
    const t = await bootTenant({ vertical: 'salon' })
    const s = await seedOwner(t)
    const companyId = s.company.id
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'client_profiles'] } as any).where(eq(t.schema.company.id, companyId))
    const [ann] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', type: 'client' } as any).returning()
    const [plan] = await t.db.insert(t.schema.membershipPlan).values({ companyId, name: 'Blow-dry club', price: '40', billingCycle: 'monthly' } as any).returning()
    const [enr] = await t.db.insert(t.schema.membershipEnrollment).values({ companyId, planId: plan.id, contactId: ann.id, status: 'active', renewsAt: '2026-01-01', lastBilledFor: '2025-12-01' } as any).returning()
    expect(await settleMembershipsForAll(depsOf(t))).toBe(0) // Memberships off
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'client_profiles', 'salon_memberships'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures(companyId)
    const billed = await settleMembershipsForAll(depsOf(t))
    expect(billed).toBeGreaterThan(0)
    expect(await settleMembershipsForAll(depsOf(t))).toBe(0)
    const invoices = await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.contactId, ann.id))
    expect(invoices.length).toBe(billed)
    const [after] = await t.db.select().from(t.schema.membershipEnrollment).where(eq(t.schema.membershipEnrollment.id, enr.id))
    expect(String(after.renewsAt) > '2026-01-01').toBe(true)
  }, 120_000)
})

describe('vet wellness plans', () => {
  test('due renewals are billed by the timed pass, once, and only with Wellness Plans on', async () => {
    const t = await bootTenant({ vertical: 'vet' })
    const s = await seedOwner(t)
    const companyId = s.company.id
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'patient_records'] } as any).where(eq(t.schema.company.id, companyId))
    const [owner] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', type: 'client' } as any).returning()
    const [pet] = await t.db.insert(t.schema.patient).values({ companyId, ownerId: owner.id, name: 'Luna' } as any).returning()
    const [plan] = await t.db.insert(t.schema.wellnessPlan).values({ companyId, name: 'Puppy plan', monthlyPrice: '30' } as any).returning()
    await t.db.insert(t.schema.wellnessEnrollment).values({ companyId, planId: plan.id, patientId: pet.id, ownerId: owner.id, status: 'active', billingCycle: 'monthly', startDate: '2025-12-01', renewsAt: '2026-01-01', lastBilledFor: '2025-12-01' } as any)
    expect(await settleWellnessForAll(depsOf(t))).toBe(0)
    await t.db.update(t.schema.company).set({ enabledFeatures: ['contacts', 'invoices', 'patient_records', 'wellness_plans'] } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures(companyId)
    const billed = await settleWellnessForAll(depsOf(t))
    expect(billed).toBeGreaterThan(0)
    expect(await settleWellnessForAll(depsOf(t))).toBe(0)
    expect((await t.db.select().from(t.schema.invoice).where(eq(t.schema.invoice.contactId, owner.id))).length).toBe(billed)
  }, 120_000)
})
