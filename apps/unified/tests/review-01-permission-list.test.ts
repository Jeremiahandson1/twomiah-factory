// Code review 01 (shared backend: permissions), 2026-11-13 — finding 01-1. The list of permissions the screens are
// given could not say "all of this, except that": a seat whose rung holds `leads:*` and has `leads:read-all` withheld
// was sent `leads:*` alone, so the screen offered what the server refuses. The refusal now travels as `-name`.
import { describe, test, expect, beforeAll } from 'bun:test'
import { permissionAllows } from '../../../packages/tenant-ui/src/auth/types.ts'
import { permits } from '../../mobile/src/auth/roles.ts'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const PASSWORD = 'Correct-horse-1'
let list: string[] = []
let token = ''

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  const { company } = await seedOwner(t, PASSWORD)
  // A manager (whose rung holds `jobs:*`) with one permission of it taken away.
  const [seat] = await t.db.insert(t.schema.user).values({
    email: 'seat@test.example', passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'),
    firstName: 'Sam', lastName: 'Seat', role: 'manager', companyId: company.id, extraPermissions: ['-jobs:delete'],
  }).returning()
  const signedIn = await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'seat@test.example', password: PASSWORD } })).json() as any
  token = signedIn.accessToken
  const me = await (await t.call('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })).json() as any
  list = me.permissions || me.user?.permissions || []
  void seat
}, 120_000)

describe('01-1: the screens are told what a wildcard does not cover', () => {
  test('a permission taken away under a wildcard is sent as a refusal, and both apps read it', async () => {
    expect(list).toContain('jobs:*')
    expect(list).toContain('-jobs:delete')
    expect(permissionAllows(list, 'jobs:delete')).toBe(false)
    expect(permits(list, 'jobs:delete')).toBe(false)
    // …the rest of the wildcard still stands…
    expect(permissionAllows(list, 'jobs:update')).toBe(true)
    expect(permits(list, 'jobs:update')).toBe(true)
    // …and it is what the server answers: the delete is refused for want of the permission, not for want of the job.
    const refused = await t.call('/api/jobs/00000000-0000-0000-0000-000000000000', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    expect(refused.status).toBe(403)
  })

  test('the rule: a refusal beats a wildcard, never the owner’s "*"', () => {
    expect(permissionAllows(['jobs:*', '-jobs:delete'], 'jobs:delete')).toBe(false)
    expect(permissionAllows(['jobs:*', '-jobs:delete'], 'jobs:update')).toBe(true)
    expect(permissionAllows(['*', '-jobs:delete'], 'jobs:delete')).toBe(true)
    expect(permits(['jobs:*', '-jobs:delete'], 'jobs:delete')).toBe(false)
    expect(permits(['jobs:*', '-jobs:delete'], 'jobs:update')).toBe(true)
    expect(permits(['*', '-jobs:delete'], 'jobs:delete')).toBe(true)
  })
})
