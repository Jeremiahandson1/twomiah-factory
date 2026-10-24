// Commissions: void (with the reason, kept) and reassign (to the person who earned it) — contractor live re-test 3,
// 2026-10-24: a $165 commission read "Former team member" and nothing could put it right.
import { describe, test, expect, beforeAll } from 'bun:test'
import { sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const ids: Record<string, string> = {}
const tokens: Record<string, string> = {}
const PASSWORD = 'Pass-word-1'
const rows = async (q: any) => ((await t.db.execute(q)) as any).rows as any[]
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { Authorization: `Bearer ${tokens[who]}` } })
const record = async (userId: string, amount = 165) => (await (await as('owner', '/api/commissions', { method: 'POST', json: { userId, commissionAmount: amount } })).json()).id as string

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const seeded = await seedOwner(t)
  ids.owner = seeded.owner.id
  await t.db.execute(sql`UPDATE company SET enabled_features = '["commission_tracking"]'::json WHERE id = ${seeded.company.id}`)
  t.services.features.forgetFeatures()
  for (const [key, role, active] of [['admin', 'admin', true], ['mgr', 'manager', true], ['staff', 'field', true], ['gone', 'field', false]] as const) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@test.example`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: key, lastName: 'Person', role, companyId: seeded.company.id, isActive: active } as any).returning()
    ids[key] = u.id
  }
  const login = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken
  tokens.owner = await login('owner@test.example', seeded.password)
  for (const k of ['admin', 'mgr', 'staff']) tokens[k] = await login(`${k}@test.example`, PASSWORD)
})

describe('reassign', () => {
  test('a row pointing at nobody is moved to the person who earned it, and the list names them; audited', async () => {
    const id = await record(ids.staff)
    // The live row: its login was deleted and added again, so it points at an id that no longer exists.
    await t.db.execute(sql`UPDATE commission SET user_id = 'deleted-login-id', status = 'approved' WHERE id = ${id}`)
    const before = (await (await as('owner', '/api/commissions')).json()).data.find((r: any) => r.id === id)
    expect(before.userName).toBe(null)
    const r = await as('admin', `/api/commissions/${id}/reassign`, { method: 'POST', json: { userId: ids.staff } })
    expect(r.status).toBe(200)
    expect((await r.json()).userName).toBe('staff Person')
    const after = (await (await as('owner', '/api/commissions')).json()).data.find((x: any) => x.id === id)
    expect(after).toMatchObject({ userId: ids.staff, userName: 'staff Person', status: 'approved', commissionAmount: '165.00' })
    const [a] = await rows(sql`SELECT user_id, changes FROM audit_log WHERE entity = 'commission' AND entity_id = ${id} ORDER BY created_at DESC LIMIT 1`)
    expect(a.user_id).toBe(ids.admin)
    expect(a.changes.userId).toEqual({ old: 'deleted-login-id', new: ids.staff })
  })

  test('refused: without commissions:update, to a switched-off or unknown login, and once paid', async () => {
    const id = await record(ids.staff)
    expect((await as('mgr', `/api/commissions/${id}/reassign`, { method: 'POST', json: { userId: ids.admin } })).status).toBe(403)
    expect((await as('staff', `/api/commissions/${id}/reassign`, { method: 'POST', json: { userId: ids.admin } })).status).toBe(403)
    expect((await as('owner', `/api/commissions/${id}/reassign`, { method: 'POST', json: { userId: ids.gone } })).status).toBe(400)
    expect((await as('owner', `/api/commissions/${id}/reassign`, { method: 'POST', json: { userId: 'nobody' } })).status).toBe(400)
    await as('owner', `/api/commissions/${id}/approve`, { method: 'POST', json: {} })
    await as('owner', `/api/commissions/${id}/mark-paid`, { method: 'POST', json: {} })
    const paid = await as('owner', `/api/commissions/${id}/reassign`, { method: 'POST', json: { userId: ids.admin } })
    expect(paid.status).toBe(409)
  })
})

describe('void', () => {
  test('kept, marked void with the reason, out of the statement; audited; a reason is required', async () => {
    const id = await record(ids.staff, 50)
    expect((await as('owner', `/api/commissions/${id}/void`, { method: 'POST', json: { reason: '  ' } })).status).toBe(400)
    expect((await as('mgr', `/api/commissions/${id}/void`, { method: 'POST', json: { reason: 'x' } })).status).toBe(403)
    const r = await as('admin', `/api/commissions/${id}/void`, { method: 'POST', json: { reason: 'Recorded twice' } })
    expect(r.status).toBe(200)
    const [row] = await rows(sql`SELECT status, void_reason, voided_by_id, voided_at FROM commission WHERE id = ${id}`)
    expect(row).toMatchObject({ status: 'void', void_reason: 'Recorded twice', voided_by_id: ids.admin })
    expect(row.voided_at).not.toBe(null)
    const stmt = await (await as('owner', `/api/commissions/statement?userId=${ids.staff}`)).json()
    expect(stmt.lines.some((l: any) => l.id === id)).toBe(false)
    const [a] = await rows(sql`SELECT changes, metadata FROM audit_log WHERE entity = 'commission' AND entity_id = ${id} ORDER BY created_at DESC LIMIT 1`)
    expect(a.changes.status).toEqual({ old: 'pending', new: 'void' })
    expect(a.metadata.description).toBe('Commission voided — Recorded twice')
    // Once void, not again; nor approved.
    expect((await as('owner', `/api/commissions/${id}/void`, { method: 'POST', json: { reason: 'again' } })).status).toBe(409)
    expect((await as('owner', `/api/commissions/${id}/approve`, { method: 'POST', json: {} })).status).toBe(409)
  })
})
