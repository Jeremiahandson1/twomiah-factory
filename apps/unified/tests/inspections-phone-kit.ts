// Shared set-up for the inspections-on-the-phone tests (inspections-phone-*.test.ts): one contractor tenant with the given switches on,
// an owner, a crew (field) seat, and helpers. Booting a tenant is the heavy part, so each file boots few and shares them.
import { eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { bootTenant, seedOwner } from './harness.ts'

export const json = async (r: Response) => (await r.json()) as any
export const BASE = ['contacts', 'projects', 'jobs', 'inspections', 'punch_lists', 'inspection_checklists']
export const today = () => new Date().toISOString().slice(0, 10)
export const INK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
export const SIGN = { signature: INK, signedBy: 'Rosa Ruiz', consent: true }

/** One boot per feature list, kept for the file: tests that need the same switches share a tenant and make their own visits. */
const shared = new Map<string, Promise<Awaited<ReturnType<typeof boot>>>>()
export const sharedBoot = (features: string[]) => {
  const key = features.join(',')
  if (!shared.has(key)) shared.set(key, boot(features))
  return shared.get(key)!
}

export async function boot(features: string[]) {
  const t = await bootTenant({ vertical: 'contractor' })
  Object.assign((t.services as any).crm.storage, {
    storageConfigured: () => true,
    put: async (key: string, b: Buffer, type: string) => { await t.store.put(key, b, type) },
    getObject: async (key: string) => t.store.getObject(key),
    deleteFile: (key: string) => { void t.store.remove(key); return true },
  })
  const s = await seedOwner(t)
  await t.db.update(t.schema.company).set({ enabledFeatures: features } as any).where(eq(t.schema.company.id, s.company.id))
  // The one place a row is written straight to the database: typed by the table it goes into.
  const ins = async <T extends PgTable>(table: T, values: T['$inferInsert']) => ((await t.db.insert(table).values(values as any).returning()) as any[])[0]
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  const as = (tok: string) => (p: string, i: any = {}) => t.call(p, { ...i, headers: { ...(i.headers || {}), Authorization: `Bearer ${tok}` } })
  const owner = as(await login('owner@test.example', s.password))
  const companyId = s.company.id as string
  const seat = async (role: string, email = `${role}@test.example`) => {
    const row = await ins(t.schema.user, { companyId, email, firstName: role, lastName: 'Seat', role, passwordHash: await Bun.password.hash('Correct-horse-1', 'bcrypt') })
    return { id: row.id as string, call: as(await login(email, 'Correct-horse-1')) }
  }
  const crew = await seat('field')
  const customer = await ins(t.schema.contact, { companyId, type: 'client', name: 'Ruiz Family' })
  const house = await ins(t.schema.project, { companyId, number: 'PRJ-0001', name: 'Ruiz addition', type: 'renovation', contactId: customer.id })
  const other = await ins(t.schema.project, { companyId, number: 'PRJ-0002', name: 'Lake cabin', type: 'renovation', contactId: customer.id })
  let n = 0
  const jobOn = (projectId: string, over: Record<string, unknown> = {}) =>
    ins(t.schema.job, { companyId, number: `JOB-${String(++n).padStart(5, '0')}`, title: 'Work', projectId, contactId: customer.id, ...over } as any)
  const visit = async (over: any = {}, projectId = house.id) => json(await owner('/api/inspections', { method: 'POST', json: { type: 'Framing', projectId, scheduledDate: today(), ...over } }))
  const template = async (over: any = {}) => json(await owner('/api/inspection-templates', { method: 'POST', json: { name: 'Framing walk-through', type: 'Framing', items: ['Hangers at every joist', 'Firestopping complete', 'Hold-downs at the shear walls'], ...over } }))
  const startOn = async (inspectionId: string, items = ['Hangers', 'Firestopping']) => owner(`/api/inspection-checklists/${inspectionId}/start`, { method: 'POST', json: { items } })
  const lines = async (inspectionId: string) => (await json(await owner(`/api/inspection-checklists/${inspectionId}`))).items as any[]
  const answerAll = async (inspectionId: string, who: (p: string, i?: any) => Promise<Response> = owner) => {
    for (const l of await lines(inspectionId)) await who(`/api/inspection-checklists/${inspectionId}/items/${l.id}`, { method: 'PUT', json: { result: 'pass' } })
  }
  return { t, ins, owner, seat, crew, companyId, house, other, jobOn, visit, template, startOn, lines, answerAll, project: (name: string) => ins(t.schema.project, { companyId, number: `PRJ-${Math.random().toString(36).slice(2, 8)}`, name, type: 'renovation', contactId: customer.id } as any) }
}

