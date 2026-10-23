// Settings › Users, as the live tests of 2026-10-22 and the coordinator (10/23) found it, through the real server:
//   · an owner or admin sets the FIRST password of a login that has never been used (POST /users/:id/password) — the
//     testers' manager and staff sat at "Invite sent", and PUT /users/:id answered 200 to a password and dropped it;
//   · PUT /users/:id refuses a field it does not take instead of answering 200 for it; a blank name is refused;
//   · an address already in use is refused in words, whatever its case;
//   · turning a login back on meets the plan's seats, as adding one does;
//   · every seat rule that stood still stands (the owner's row is the owner's, rank where the server asks rank).
// And Settings › Company: every vertical saves its time zone (company.timezone), and /auth/me says which was chosen.
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let seeded: Awaited<ReturnType<typeof seedOwner>>
let owner = ''

const signIn = async (email: string, password: string) => {
  const r = await t.call('/api/auth/login', { method: 'POST', json: { email, password } })
  return { status: r.status, token: ((await r.json()) as any).accessToken as string | undefined }
}
const as = async (token: string, path: string, method = 'GET', json?: unknown) => {
  const r = await t.call(path, { method, json, headers: { Authorization: `Bearer ${token}` } })
  const text = await r.text()
  let body: any = text
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, body }
}
const userRow = async (email: string) => (await t.db.select().from(t.schema.user).where(eq(t.schema.user.email, email)))[0] as any
const auditFor = async (entityId: string) => {
  // The audit write is not awaited by the route; give it a moment.
  for (let i = 0; i < 20; i++) {
    const rows = await t.db.select().from(t.schema.auditLog).where(and(eq(t.schema.auditLog.entityId, entityId), eq(t.schema.auditLog.companyId, seeded.company.id)))
    if (rows.length) return rows as any[]
    await Bun.sleep(25)
  }
  return [] as any[]
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'contractor' })
  seeded = await seedOwner(t)
  owner = (await signIn('owner@test.example', seeded.password)).token!
}, 60_000)

describe('a first password for a login that has never been used', () => {
  test('an invited teammate gets a password from the owner, can sign in with it, and the invite link is spent', async () => {
    const added = await as(owner, '/api/company/users', 'POST', { firstName: 'Mia', lastName: 'Manager', email: 'mia@test.example', role: 'manager' })
    expect(added.status).toBe(201)
    expect(added.body.invited).toBe(true)
    const listed = (await as(owner, '/api/company/users')).body.find((u: any) => u.email === 'mia@test.example')
    expect(listed.invitePending).toBe(true)
    // Before: the only door was PUT, which said 200 and changed nothing.
    expect((await signIn('mia@test.example', 'Mia-first-pass-1')).status).toBe(401)

    const set = await as(owner, `/api/company/users/${added.body.id}/password`, 'POST', { password: 'Mia-first-pass-1' })
    expect(set.status).toBe(200)
    expect((await signIn('mia@test.example', 'Mia-first-pass-1')).status).toBe(200)
    const row = await userRow('mia@test.example')
    expect(row.resetToken).toBeNull()
    expect(row.resetTokenExp).toBeNull()

    // Recorded — who did it and for whom — and the password is nowhere in the record.
    const audit = await auditFor(added.body.id)
    const entry = audit.find((r) => JSON.stringify(r.metadata || {}).includes('First password set'))
    expect(entry).toBeTruthy()
    expect(JSON.stringify(audit)).not.toContain('Mia-first-pass-1')
  })

  test('once they have signed in, the password is theirs: the owner is refused and pointed at Forgot password', async () => {
    const mia = await userRow('mia@test.example')
    const again = await as(owner, `/api/company/users/${mia.id}/password`, 'POST', { password: 'Owner-chose-this-2' })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('already_signed_in')
    expect(again.body.error).toContain('Forgot password')
    expect((await signIn('mia@test.example', 'Mia-first-pass-1')).status).toBe(200)
  })

  test("never the owner's account, never your own, never a switched-off login, never a short password", async () => {
    const ownerId = seeded.owner.id
    const added = await as(owner, '/api/company/users', 'POST', { firstName: 'Ada', lastName: 'Admin', email: 'ada@test.example', role: 'admin', password: 'Ada-admin-pass-1' })
    expect(added.status).toBe(201)
    const ada = (await signIn('ada@test.example', 'Ada-admin-pass-1')).token!
    const toOwner = await as(ada, `/api/company/users/${ownerId}/password`, 'POST', { password: 'Taken-over-123' })
    expect(toOwner.status).toBe(409)
    expect(toOwner.body.code).toBe('owner_account')
    const adaRow = await userRow('ada@test.example')
    await t.db.update(t.schema.user).set({ lastLogin: null } as any).where(eq(t.schema.user.id, adaRow.id))
    const self = await as(ada, `/api/company/users/${adaRow.id}/password`, 'POST', { password: 'Self-set-pass-1' })
    expect(self.status).toBe(409)
    expect(self.body.code).toBe('own_account')

    const sam = await as(owner, '/api/company/users', 'POST', { firstName: 'Sam', lastName: 'Staff', email: 'sam@test.example', role: 'field' })
    expect((await as(owner, `/api/company/users/${sam.body.id}/password`, 'POST', { password: 'short' })).status).toBe(400)
    expect((await as(owner, `/api/company/users/${sam.body.id}`, 'PUT', { isActive: false })).status).toBe(200)
    const off = await as(owner, `/api/company/users/${sam.body.id}/password`, 'POST', { password: 'Sam-first-pass-1' })
    expect(off.status).toBe(409)
    expect(off.body.code).toBe('inactive')
    expect((await as(owner, `/api/company/users/${sam.body.id}`, 'PUT', { isActive: true })).status).toBe(200)
  })

  test('rank where the server asks rank: a manager may not set anyone a password', async () => {
    const mia = (await signIn('mia@test.example', 'Mia-first-pass-1')).token!
    const sam = await userRow('sam@test.example')
    const r = await as(mia, `/api/company/users/${sam.id}/password`, 'POST', { password: 'Manager-set-1' })
    expect(r.status).toBe(403)
    expect((await signIn('sam@test.example', 'Manager-set-1')).status).toBe(401)
  })
})

describe('PUT /users/:id says no to what it does not take', () => {
  test('a password is refused in words, and the stored password is untouched', async () => {
    const sam = await userRow('sam@test.example')
    const r = await as(owner, `/api/company/users/${sam.id}`, 'PUT', { password: 'Sneaky-pass-123' })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('field_not_editable')
    expect(r.body.error).toContain('Set password')
    expect((await userRow('sam@test.example')).passwordHash).toBe(sam.passwordHash)
  })

  test('any other unknown field is named; an email change is refused; a blank name is refused', async () => {
    const sam = await userRow('sam@test.example')
    const odd = await as(owner, `/api/company/users/${sam.id}`, 'PUT', { firstName: 'Samuel', nickname: 'Sammy' })
    expect(odd.status).toBe(400)
    expect(odd.body.fields).toEqual(['nickname'])
    expect((await userRow('sam@test.example')).firstName).toBe('Sam')
    const mail = await as(owner, `/api/company/users/${sam.id}`, 'PUT', { email: 'new@test.example' })
    expect(mail.status).toBe(400)
    expect(mail.body.error).toContain('email')
    const blank = await as(owner, `/api/company/users/${sam.id}`, 'PUT', { firstName: '   ' })
    expect(blank.status).toBe(400)
    expect(blank.body.error).toContain('First name')
  })

  test("a teammate's name and phone are edited, and the change is on the record", async () => {
    const sam = await userRow('sam@test.example')
    const r = await as(owner, `/api/company/users/${sam.id}`, 'PUT', { firstName: 'Samuel', lastName: 'Staffer', phone: '715-555-0199' })
    expect(r.status).toBe(200)
    const after = await userRow('sam@test.example')
    expect([after.firstName, after.lastName, after.phone]).toEqual(['Samuel', 'Staffer', '715-555-0199'])
    const audit = await auditFor(sam.id)
    expect(audit.some((row) => (row.changes as any)?.firstName?.new === 'Samuel')).toBe(true)
    expect((await as(owner, `/api/company/users/${sam.id}`, 'PUT', { phone: '' })).status).toBe(200)
    expect((await userRow('sam@test.example')).phone).toBeNull()
  })

  test("the owner's row stays the owner's: an admin may not edit it, and the owner can't be demoted", async () => {
    const ada = (await signIn('ada@test.example', 'Ada-admin-pass-1')).token!
    expect((await as(ada, `/api/company/users/${seeded.owner.id}`, 'PUT', { firstName: 'Hijacked' })).status).toBe(403)
    const demote = await as(owner, `/api/company/users/${seeded.owner.id}`, 'PUT', { role: 'admin' })
    expect(demote.status).toBe(400)
    expect(demote.body.code).toBe('owner_cannot_be_demoted')
    // Grants stay the owner's alone.
    const sam = await userRow('sam@test.example')
    expect((await as(ada, `/api/company/users/${sam.id}`, 'PUT', { extraPermissions: ['users:read'] })).status).toBe(403)
  })
})

describe('one login per address', () => {
  test('a second login for an address already here is refused in words — whatever its case', async () => {
    const dup = await as(owner, '/api/company/users', 'POST', { firstName: 'Mia', lastName: 'Again', email: 'MIA@Test.Example', role: 'field', password: 'Another-pass-1' })
    expect(dup.status).toBe(409)
    expect(dup.body.code).toBe('email_taken')
    expect(dup.body.error).toBe('mia@test.example already has a login here (Mia Manager). Each person needs their own email address.')
  })

  test('an older row stored in capitals is the same inbox', async () => {
    await t.db.insert(t.schema.user).values({ email: 'Old.Timer@Test.Example', passwordHash: 'x', firstName: 'Old', lastName: 'Timer', role: 'field', isActive: false, companyId: seeded.company.id } as any)
    const dup = await as(owner, '/api/company/users', 'POST', { firstName: 'Old', lastName: 'Timer', email: 'old.timer@test.example', role: 'field', password: 'Another-pass-1' })
    expect(dup.status).toBe(409)
    expect(dup.body.error).toContain('switched off — reactivate it')
  })
})

describe('the seats', () => {
  test('turning a login back on meets the plan, as adding one does', async () => {
    const active = (await t.db.select().from(t.schema.user).where(and(eq(t.schema.user.companyId, seeded.company.id), eq(t.schema.user.isActive, true)))).length
    await t.db.update(t.schema.company).set({ settings: { seatLimit: active } } as any).where(eq(t.schema.company.id, seeded.company.id))
    const full = await as(owner, '/api/company/users', 'POST', { firstName: 'Ned', lastName: 'New', email: 'ned@test.example', role: 'field', password: 'Ned-new-pass-1' })
    expect(full.status).toBe(403)
    const sam = await userRow('sam@test.example')
    expect((await as(owner, `/api/company/users/${sam.id}`, 'PUT', { isActive: false })).status).toBe(200)
    expect((await as(owner, '/api/company/users', 'POST', { firstName: 'Ned', lastName: 'New', email: 'ned@test.example', role: 'field', password: 'Ned-new-pass-1' })).status).toBe(201)
    // The plan is full again: Sam cannot come back on top of it.
    const back = await as(owner, `/api/company/users/${sam.id}`, 'PUT', { isActive: true })
    expect(back.status).toBe(403)
    expect(back.body.code).toBe('seat_limit')
    expect((await userRow('sam@test.example')).isActive).toBe(false)
    // Free a seat, and he can.
    const ned = await userRow('ned@test.example')
    expect((await as(owner, `/api/company/users/${ned.id}`, 'PUT', { isActive: false })).status).toBe(200)
    expect((await as(owner, `/api/company/users/${sam.id}`, 'PUT', { isActive: true })).status).toBe(200)
    await t.db.update(t.schema.company).set({ settings: {} } as any).where(eq(t.schema.company.id, seeded.company.id))
  })
})

describe("Settings › Company: the business's time zone, on every vertical", () => {
  for (const vertical of ['contractor', 'fieldservice', 'basic', 'vet', 'salon', 'landscaping', 'restaurant', 'rv', 'bar', 'homecare', 'roofing', 'store']) {
    test(`${vertical}: saved, read back, refused when it is not a zone, cleared to the state's`, async () => {
      const v = await bootTenant({ vertical })
      const s = await seedOwner(v)
      await v.db.update(v.schema.company).set({ state: 'WI' } as any).where(eq(v.schema.company.id, s.company.id))
      const tok = ((await (await v.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()) as any).accessToken
      const put = async (json: unknown) => { const r = await v.call('/api/company', { method: 'PUT', json, headers: { Authorization: `Bearer ${tok}` } }); return { status: r.status, body: (await r.json()) as any } }
      const me = async () => ((await (await v.call('/api/auth/me', { headers: { Authorization: `Bearer ${tok}` } })).json()) as any)
      const saved = await put({ timezone: 'America/New_York' })
      expect(saved.status).toBe(200)
      expect(saved.body.timezone).toBe('America/New_York')
      expect(saved.body.effectiveTimezone).toBe('America/New_York')
      const m = await me()
      expect((m.company ?? m.data?.company).timezone).toBe('America/New_York')
      expect((await put({ timezone: 'Mars/Olympus' })).status).toBe(400)
      const cleared = await put({ timezone: '' })
      expect(cleared.status).toBe(200)
      expect(cleared.body.timezone).toBeNull()
      expect(cleared.body.effectiveTimezone).toBe('America/Chicago')
    }, 60_000)
  }
})
