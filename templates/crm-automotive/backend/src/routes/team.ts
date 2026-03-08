import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { teamMember } from '../../db/schema.ts'
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
  const data = schema.parse(await c.req.json())
  const [member] = await db.insert(teamMember).values({
    ...data,
    hireDate: data.hireDate ? new Date(data.hireDate) : null,
    companyId: user.companyId,
  }).returning()
  return c.json(member, 201)
})

app.put('/:id', requirePermission('team:update'), async (c) => {
  const id = c.req.param('id')
  const data = schema.partial().parse(await c.req.json())
  const [member] = await db.update(teamMember).set({
    ...data,
    hireDate: data.hireDate ? new Date(data.hireDate) : undefined,
    updatedAt: new Date(),
  }).where(eq(teamMember.id, id)).returning()
  return c.json(member)
})

app.delete('/:id', requirePermission('team:delete'), async (c) => {
  const id = c.req.param('id')
  await db.delete(teamMember).where(eq(teamMember.id, id))
  return c.json(null, 204)
})

export default app
