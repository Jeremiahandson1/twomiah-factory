import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { teamMember, user as userTable } from '../../db/schema.ts'
import { eq, and, count, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission, requireRole } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

const schema = z.object({ name: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional(), role: z.string().optional(), department: z.string().optional(), hireDate: z.string().optional(), hourlyRate: z.number().optional(), active: z.boolean().default(true), skills: z.array(z.string()).optional(), notes: z.string().optional() })

app.get('/', requirePermission('team:read'), async (c) => {
  const { active, department, page = '1', limit = '50' } = c.req.query() as any
  const user = c.get('user') as any
  const pageNum = +page
  const limitNum = +limit

  const conditions: any[] = [eq(teamMember.companyId, user.companyId)]
  if (active !== undefined) conditions.push(eq(teamMember.active, active === 'true'))
  if (department) conditions.push(eq(teamMember.department, department))

  const members = await db.select().from(teamMember).where(and(...conditions)).orderBy(asc(teamMember.name))

  // F-14: the owner and provisioned logins live in the user table, not teamMember,
  // and must ALWAYS appear on the Team page — not only when the teamMember roster is
  // empty. (The old code dropped the fallback the moment one team_member existed, so
  // the owner vanished once staff were added.) Union the login accounts in, deduped
  // by email against the team_member roster (team_member rows win — they're
  // editable; user rows are marked _source:'user' so the UI shows them read-only).
  // A department filter excludes users, which have no department.
  const combined: any[] = [...members]
  if (!department) {
    const uConds: any[] = [eq(userTable.companyId, user.companyId)]
    if (active !== undefined) uConds.push(eq(userTable.isActive, active === 'true'))
    const users = await db.select({
      id: userTable.id, firstName: userTable.firstName, lastName: userTable.lastName,
      email: userTable.email, phone: userTable.phone, role: userTable.role, isActive: userTable.isActive,
      // T48 Q10: not selected, and hardcoded null below — so a rate saved onto a LOGIN (which is
      // what T47 P7 made possible, and what payroll reads first) came straight back as "-" on the
      // very screen that had just saved it. PUT learned about logins; this list never did.
      hourlyRate: userTable.hourlyRate,
    }).from(userTable).where(and(...uConds))

    const memberEmails = new Set(
      members.map((m: any) => (m.email || '').toLowerCase()).filter(Boolean)
    )
    for (const u of users) {
      if (u.email && memberEmails.has(u.email.toLowerCase())) continue
      combined.push({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: u.email,
        phone: u.phone,
        role: u.role,
        department: null,
        hireDate: null,
        hourlyRate: u.hourlyRate,
        active: u.isActive,
        _source: 'user' as const,
      })
    }
  }

  combined.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  const total = combined.length
  const start = (pageNum - 1) * limitNum
  const data = combined.slice(start, start + limitNum)

  return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 1 } })
})

app.get('/:id', requirePermission('team:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [member] = await db.select().from(teamMember).where(and(eq(teamMember.id, id), eq(teamMember.companyId, user.companyId))).limit(1)
  if (member) return c.json(member)

  // The row might be a LOGIN, not a roster entry — the same union GET / and PUT /:id already do.
  //
  // T48 Q10: the list shows logins, PUT was taught to save them in T47 P7, and this route was
  // left looking in team_member alone. So opening any of those rows answered 404 "Team member not
  // found" about somebody plainly on the screen. Three routes over one union and the third one
  // never got the message.
  const [account] = await db.select().from(userTable)
    .where(and(eq(userTable.id, id), eq(userTable.companyId, user.companyId))).limit(1)
  if (!account) return c.json({ error: 'Team member not found' }, 404)

  // Shaped like the row the list handed out, so a screen can open what it listed.
  return c.json({
    id: account.id,
    name: `${account.firstName} ${account.lastName}`.trim(),
    email: account.email,
    phone: account.phone,
    role: account.role,
    department: null,
    hireDate: null,
    hourlyRate: account.hourlyRate,
    active: account.isActive,
    _source: 'user' as const,
  })
})

app.post('/', requirePermission('team:create'), async (c) => {
  const user = c.get('user') as any
  const tBody = await c.req.json()
  if (tBody.email && typeof tBody.email === 'string') tBody.email = tBody.email.toLowerCase().trim()
  const data = schema.parse(tBody)
  if (data.email) {
    const [dupe] = await db.select({ id: teamMember.id }).from(teamMember)
      .where(and(eq(teamMember.companyId, user.companyId), eq(teamMember.email, data.email))).limit(1)
    if (dupe) return c.json({ error: 'A team member with that email already exists' }, 409)
  }
  const [member] = await db.insert(teamMember).values({
    ...data,
    hireDate: data.hireDate ? new Date(data.hireDate) : null,
    companyId: user.companyId,
  }).returning()
  return c.json(member, 201)
})

app.put('/:id', requirePermission('team:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const tuBody = await c.req.json()
  if (tuBody.email && typeof tuBody.email === 'string') tuBody.email = tuBody.email.toLowerCase().trim()
  const data = schema.partial().parse(tuBody)

  // Scope by companyId — an id alone must never reach another tenant's row.
  const [existing] = await db.select({ id: teamMember.id }).from(teamMember)
    .where(and(eq(teamMember.id, id), eq(teamMember.companyId, user.companyId))).limit(1)

  // ── the row might be a LOGIN, not a roster entry ─────────────────────────────────────────────
  //
  // GET / unions team_member rows together with the `user` accounts (F-14, so the owner does not
  // vanish from the Team page the moment staff are added) — and this only ever looked in
  // team_member. On a shop whose staff all have logins, which is most of them, EVERY row on that
  // page 404'd "Team member not found" when you pressed Save.
  //
  // T47 P7 found it through the hourly rate, and that is the whole chain: payroll reads
  // COALESCE(u.hourly_rate, tm.hourly_rate, 0) — the login's rate first — and nothing in the
  // product could write to u.hourly_rate. So every rate stayed null, every gross pay came out $0,
  // and the 8-hours-plus-overtime calculation could not be exercised at all.
  if (!existing) {
    const [account] = await db.select().from(userTable)
      .where(and(eq(userTable.id, id), eq(userTable.companyId, user.companyId))).limit(1)
    if (!account) return c.json({ error: 'Team member not found' }, 404)

    // A login carries fewer fields than a roster entry. Say so rather than accepting a department
    // or a skills list and quietly dropping it.
    //
    // Only a REAL value counts. The Team dialog posts the whole form every time, so `department: ''`
    // arrives on every save whether or not anyone typed in it — refusing that would break the exact
    // screen this is fixing, which is the shape of bug a new 400 usually is.
    const givenAValue = (v: any) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
    const notOnALogin = (['department', 'hireDate', 'skills', 'notes'] as const).filter((k) => givenAValue((data as any)[k]))
    if (notOnALogin.length) {
      return c.json({
        error: `${account.firstName} ${account.lastName} is a login, not a roster entry, so ${notOnALogin.join(', ')} cannot be set here.`,
        code: 'not_on_a_login', fields: notOnALogin,
      }, 400)
    }

    // Two things nobody should do to themselves by accident on a staff screen.
    if (id === user.userId && data.role !== undefined && data.role !== account.role) {
      return c.json({ error: 'You cannot change your own role.', code: 'cannot_change_own_role' }, 400)
    }
    if (id === user.userId && data.active === false) {
      return c.json({ error: 'You cannot deactivate your own account.', code: 'cannot_deactivate_self' }, 400)
    }

    const names = data.name ? String(data.name).trim().split(/\s+/) : null
    const [updated] = await db.update(userTable).set({
      ...(names ? { firstName: names[0], lastName: names.slice(1).join(' ') || account.lastName } : {}),
      ...(data.email !== undefined ? { email: data.email } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.role !== undefined ? { role: data.role } : {}),
      ...(data.active !== undefined ? { isActive: data.active } : {}),
      ...(data.hourlyRate !== undefined ? { hourlyRate: data.hourlyRate === null ? null : String(data.hourlyRate) } : {}),
      updatedAt: new Date(),
    } as any).where(and(eq(userTable.id, id), eq(userTable.companyId, user.companyId))).returning()

    // Shaped like the list this row came from, so the screen reads back what it just sent.
    return c.json({
      id: updated.id,
      name: `${updated.firstName} ${updated.lastName}`.trim(),
      email: updated.email, phone: updated.phone, role: updated.role,
      department: null, hireDate: null,
      hourlyRate: updated.hourlyRate, active: updated.isActive,
      _source: 'user' as const,
    })
  }

  if (data.email) {
    const [dupe] = await db.select({ id: teamMember.id }).from(teamMember)
      .where(and(eq(teamMember.companyId, user.companyId), eq(teamMember.email, data.email))).limit(1)
    if (dupe && dupe.id !== id) return c.json({ error: 'A team member with that email already exists' }, 409)
  }

  const [member] = await db.update(teamMember).set({
    ...data,
    hireDate: data.hireDate ? new Date(data.hireDate) : undefined,
    updatedAt: new Date(),
  }).where(and(eq(teamMember.id, id), eq(teamMember.companyId, user.companyId))).returning()
  return c.json(member)
})

app.delete('/:id', requirePermission('team:delete'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  await db.delete(teamMember).where(and(eq(teamMember.id, id), eq(teamMember.companyId, user.companyId)))
  return c.json(null, 204)
})

export default app
