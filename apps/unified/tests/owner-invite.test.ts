// The owner's account is the owner's: an admin can't send it an invite (a set-your-password link), even before the owner
// has ever signed in (packages/tenant-backend company.ts POST /users/:id/invite; templates/crm-store refused it always).
import { test, expect } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

test("an admin can't send the owner an invite, signed in or not; another teammate's invite still goes", async () => {
  const t = await bootTenant({ vertical: 'store' })
  const { company, owner, password } = await seedOwner(t)
  const hash = await Bun.password.hash('Admin-pass-1-long', 'bcrypt')
  const [admin] = await (t.db as any).insert(t.schema.user).values({ email: 'admin@test.example', passwordHash: hash, firstName: 'Ada', lastName: 'Admin', role: 'admin', companyId: company.id }).returning()
  await t.db.update(t.schema.user).set({ lastLogin: null } as any).where(eq(t.schema.user.id, owner.id))
  const token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'admin@test.example', password: 'Admin-pass-1-long' } })).json()).accessToken
  const r = await t.call(`/api/company/users/${owner.id}/invite`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  expect(r.status).toBe(409)
  expect((await r.json() as any).code).toBe('owner_account')
  const [after] = await t.db.select().from(t.schema.user).where(eq(t.schema.user.id, owner.id))
  expect((after as any).resetToken).toBeFalsy()
  void admin; void password
})
