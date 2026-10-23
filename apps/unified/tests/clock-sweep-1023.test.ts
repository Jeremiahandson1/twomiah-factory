// The 2026-10-23 clock sweep: every "today", due day and expiry day read on the company's (or the home care agency's)
// clock — not UTC's, not the database's CURRENT_DATE. The clock is pinned to the pair that tells the rules apart:
// 2026-10-23 03:00 UTC is 10pm on the 22nd in Chicago (UTC's day is already the 23rd); 06:00 UTC is 1am on the 23rd.
import { describe, test, expect, afterAll, setSystemTime, setDefaultTimeout } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { agencyClock } from '../server/data/homecareCore.ts'
import { authorizationSummary } from '../server/data/homecareBillingRoutes.ts'
import { latestVaccinationsDue } from '../server/data/vetDashboard.ts'

setDefaultTimeout(60_000)
const EVENING = new Date('2026-10-23T03:00:00Z') // 10pm, 22 Oct, Chicago
const AFTER_MIDNIGHT = new Date('2026-10-23T06:00:00Z') // 1am, 23 Oct, Chicago
const ZONE = 'America/Chicago'
afterAll(() => { setSystemTime() })

async function tenant(vertical: string, features: string[]) {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features, timezone: ZONE } as any).where(eq(t.schema.company.id, s.company.id))
  return { t, companyId: s.company.id as string, ownerId: (s as any).user?.id ?? (s as any).owner?.id }
}

describe('tasks: overdue once the due DAY is over on the company\'s clock (the screen\'s isPastDay)', () => {
  test('due on the 22nd: upcoming at 10pm Chicago, overdue at 1am on the 23rd', async () => {
    setSystemTime(EVENING)
    const x = await tenant('contractor', ['contacts', 'projects'])
    const [owner] = await x.t.db.select().from(x.t.schema.user).where(eq(x.t.schema.user.companyId, x.companyId))
    const svc = (x.t.services as any).crm.tasks
    await svc.createTask({ companyId: x.companyId, createdById: owner.id, title: 'Order the cabinets', dueDate: '2026-10-22', assignedToId: owner.id })
    const ids = async () => ({
      overdue: (await svc.getOverdueTasks(x.companyId, owner.id)).length,
      upcoming: (await svc.getUpcomingTasks(x.companyId, owner.id)).length,
      stats: Number((await svc.getTaskStats(x.companyId, owner.id)).overdue),
    })
    expect(await ids()).toEqual({ overdue: 0, upcoming: 1, stats: 0 })
    setSystemTime(AFTER_MIDNIGHT)
    expect(await ids()).toEqual({ overdue: 1, upcoming: 0, stats: 1 })
  })
})

describe('equipment: a warranty covers its whole expiry day; a service is due once its day begins', () => {
  test('warranty to the 22nd, service due the 23rd', async () => {
    setSystemTime(EVENING)
    const x = await tenant('landscaping', ['contacts', 'equipment_tracking'])
    const svc = (x.t.services as any).crm.equipment
    const eqRow = await svc.createEquipment(x.companyId, { name: 'Zero-turn 1', purchaseDate: '2024-10-22', warrantyExpiry: '2026-10-22' })
    await svc.addServiceRecord(eqRow.id, x.companyId, { type: 'blade', nextDueDate: '2026-10-23' })
    // 10pm on the 22nd: the warranty still covers today; the service is not due until tomorrow.
    expect(eqRow.warrantyActive).toBe(true)
    let list = await svc.getEquipment(x.companyId, { needsMaintenance: true })
    expect((list.data ?? list).length).toBe(0)
    let stats = await svc.getEquipmentStats(x.companyId)
    expect([Number(stats.warrantyExpiring), Number(stats.needsMaintenance)]).toEqual([1, 1]) // within the windows
    expect((await svc.getWarrantyExpiring(x.companyId)).length).toBe(1)
    // 1am on the 23rd: the warranty has run out; the service is due.
    setSystemTime(AFTER_MIDNIGHT)
    const all = await svc.getEquipment(x.companyId, {})
    expect((all.data ?? all)[0].warrantyActive).toBe(false)
    list = await svc.getEquipment(x.companyId, { needsMaintenance: true })
    expect((list.data ?? list).length).toBe(1)
    expect((await svc.getWarrantyExpiring(x.companyId)).length).toBe(0)
    stats = await svc.getEquipmentStats(x.companyId)
    expect(Number(stats.warrantyExpiring)).toBe(0)
  })
})

describe('home care: the agency\'s today, not the database\'s CURRENT_DATE', () => {
  test('an authorization ending the 22nd is not expired at 10pm Chicago, expired at 1am', async () => {
    setSystemTime(EVENING)
    const x = await tenant('homecare', [])
    expect((await agencyClock(x.t.db, x.companyId)).today).toBe('2026-10-22')
    const [client] = await x.t.db.insert(x.t.schema.clients).values({ companyId: x.companyId, firstName: 'Rose', lastName: 'Ward' } as any).returning()
    await x.t.db.insert(x.t.schema.authorizations).values({ companyId: x.companyId, clientId: client.id, authorizedUnits: '100', startDate: '2026-09-01', endDate: '2026-10-22' } as any)
    const sum = async () => { const r = await authorizationSummary(x.t.db, x.companyId); return { expired: Number(r.expired), expiringSoon: Number(r.expiringSoon) } }
    expect(await sum()).toEqual({ expired: 0, expiringSoon: 1 })
    setSystemTime(AFTER_MIDNIGHT)
    expect((await agencyClock(x.t.db, x.companyId)).today).toBe('2026-10-23')
    expect(await sum()).toEqual({ expired: 1, expiringSoon: 0 })
  })
})

describe('vet: a vaccination is overdue once its due day is over at the clinic', () => {
  test('due the 22nd: due soon at 10pm Chicago, overdue at 1am', async () => {
    setSystemTime(EVENING)
    const x = await tenant('vet', ['patient_records', 'vaccinations'])
    const [owner] = await x.t.db.insert(x.t.schema.contact).values({ companyId: x.companyId, name: 'Pat Owner', type: 'client' } as any).returning()
    const [pet] = await x.t.db.insert(x.t.schema.patient).values({ companyId: x.companyId, ownerId: owner.id, name: 'Biscuit', species: 'dog' } as any).returning()
    await x.t.db.insert(x.t.schema.vaccination).values({ companyId: x.companyId, patientId: pet.id, vaccine: 'DHPP', givenDate: '2025-10-22', dueDate: '2026-10-22' } as any)
    const due = async () => ({ overdue: await latestVaccinationsDue(x.t.db, x.companyId, 'overdue'), soon: await latestVaccinationsDue(x.t.db, x.companyId, 'soon') })
    expect(await due()).toEqual({ overdue: 0, soon: 1 })
    setSystemTime(AFTER_MIDNIGHT)
    expect(await due()).toEqual({ overdue: 1, soon: 0 })
  })
})
