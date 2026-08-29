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
  const conditions: any[] = [eq(teamMember.companyId, user.companyId)]
  if (active !== undefined) conditions.push(eq(teamMember.active, active === 'true'))
  if (department) conditions.push(eq(teamMember.department, department))

  const where = and(...conditions)
  const pageNum = +page
  const limitNum = +limit

  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(teamMember).where(where).orderBy(asc(teamMember.name)).offset((pageNum - 1) * limitNum).limit(limitNum),
    db.select({ value: count() }).from(teamMember).where(where),
  ])

  // F-14: real staff (the owner + provisioned logins) live in the user table, not
  // teamMember — a freshly provisioned tenant has an empty teamMember roster, so the
  // Team page read "No data" even though people exist and are pickable as staff.
  // When there are no team_member rows, list the login accounts instead, marked
  // _source:'user' so the UI can present them read-only (edit/delete target the
  // teamMember table). Once a real team member is added, that roster takes over.
  if (Number(total) === 0) {
    const uConds: any[] = [eq(userTable.companyId, user.companyId)]
    if (active !== undefined) uConds.push(eq(userTable.isActive, active === 'true'))
    const users = await db.select({
      id: userTable.id, firstName: userTable.firstName, lastName: userTable.lastName,
      email: userTable.email, phone: userTable.phone, role: userTable.role, isActive: userTable.isActive,
    }).from(userTable).where(and(...uConds)).orderBy(asc(userTable.firstName))
    const mapped = users.map((u) => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: u.email,
      phone: u.phone,
      role: u.role,
      department: null,
      hireDate: null,
      hourlyRate: null,
      active: u.isActive,
      _source: 'user' as const,
    }))
    return c.json({ data: mapped, pagination: { page: 1, limit: limitNum, total: mapped.length, pages: 1 } })
  }

  return c.json({ data, pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) } })
})

app.get('/:id', requirePermission('team:read'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [member] = await db.select().from(teamMember).where(and(eq(teamMember.id, id), eq(teamMember.companyId, user.companyId))).limit(1)
  if (!member) return c.json({ error: 'Team member not found' }, 404)
  return c.json(member)
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
  if (!existing) return c.json({ error: 'Team member not found' }, 404)

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
