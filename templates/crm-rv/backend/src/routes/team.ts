import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { user } from '../../db/schema.ts'
import { eq, and, count, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const app = new Hono()
app.use('*', authenticate)

// Roles a company can assign to staff. Mirrors permissions.ts ROLE_PERMISSIONS.
const ROLES = ['owner', 'admin', 'manager', 'field', 'viewer', 'user'] as const

const createSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.enum(ROLES).default('field'),
  hourlyRate: z.number().optional(),
  isActive: z.boolean().default(true),
  password: z.string().min(8).optional(),
})

const updateSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: z.enum(ROLES).optional(),
  hourlyRate: z.number().optional(),
  isActive: z.boolean().optional(),
})

// Strip sensitive columns before returning a user as a "team member".
const publicUser = {
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  phone: user.phone,
  avatar: user.avatar,
  role: user.role,
  hourlyRate: user.hourlyRate,
  isActive: user.isActive,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
}

function randomPassword(): string {
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('')
}

app.get('/', requirePermission('team:read'), async (c) => {
  const { active, role, page = '1', limit = '50' } = c.req.query() as any
  const currentUser = c.get('user') as any

  const conditions: any[] = [eq(user.companyId, currentUser.companyId)]
  if (active !== undefined) conditions.push(eq(user.isActive, active === 'true'))
  if (role) conditions.push(eq(user.role, role))

  const where = and(...conditions)
  const pageNum = +page
  const limitNum = +limit

  const [data, [{ value: total }]] = await Promise.all([
    db.select(publicUser).from(user).where(where).orderBy(asc(user.firstName)).offset((pageNum - 1) * limitNum).limit(limitNum),
    db.select({ value: count() }).from(user).where(where),
  ])

  return c.json({ data, pagination: { page: pageNum, limit: limitNum, total: Number(total), pages: Math.ceil(Number(total) / limitNum) } })
})

app.get('/:id', requirePermission('team:read'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [member] = await db.select(publicUser).from(user).where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId))).limit(1)
  if (!member) return c.json({ error: 'Team member not found' }, 404)
  return c.json(member)
})

// Invite / create a staff member.
app.post('/', requirePermission('team:create'), async (c) => {
  const currentUser = c.get('user') as any
  const data = createSchema.parse(await c.req.json())

  // Enforce unique email within the company.
  const [existing] = await db.select({ id: user.id }).from(user)
    .where(and(eq(user.email, data.email), eq(user.companyId, currentUser.companyId))).limit(1)
  if (existing) return c.json({ error: 'A team member with this email already exists' }, 409)

  const passwordHash = await Bun.password.hash(data.password || randomPassword(), 'bcrypt')

  const [member] = await db.insert(user).values({
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    phone: data.phone,
    role: data.role,
    hourlyRate: data.hourlyRate != null ? String(data.hourlyRate) : undefined,
    isActive: data.isActive,
    passwordHash,
    companyId: currentUser.companyId,
  }).returning(publicUser)

  return c.json(member, 201)
})

app.put('/:id', requirePermission('team:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const data = updateSchema.parse(await c.req.json())

  const [existing] = await db.select().from(user)
    .where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Team member not found' }, 404)

  // Guard: don't demote or deactivate the last active owner.
  const demotingOwner = existing.role === 'owner' && (
    (data.role && data.role !== 'owner') || data.isActive === false
  )
  if (demotingOwner) {
    const [{ value: ownerCount }] = await db.select({ value: count() }).from(user)
      .where(and(eq(user.companyId, currentUser.companyId), eq(user.role, 'owner'), eq(user.isActive, true)))
    if (ownerCount <= 1) {
      return c.json({ error: 'Cannot remove the last active owner' }, 400)
    }
  }

  const [member] = await db.update(user).set({
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone,
    role: data.role,
    hourlyRate: data.hourlyRate != null ? String(data.hourlyRate) : undefined,
    isActive: data.isActive,
    updatedAt: new Date(),
  }).where(eq(user.id, id)).returning(publicUser)

  return c.json(member)
})

app.delete('/:id', requirePermission('team:delete'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  // Can't delete yourself.
  if (id === currentUser.userId || id === currentUser.id) {
    return c.json({ error: 'You cannot delete your own account' }, 400)
  }

  const [existing] = await db.select().from(user)
    .where(and(eq(user.id, id), eq(user.companyId, currentUser.companyId))).limit(1)
  if (!existing) return c.json({ error: 'Team member not found' }, 404)

  // Guard: don't delete the last active owner.
  if (existing.role === 'owner') {
    const [{ value: ownerCount }] = await db.select({ value: count() }).from(user)
      .where(and(eq(user.companyId, currentUser.companyId), eq(user.role, 'owner'), eq(user.isActive, true)))
    if (ownerCount <= 1) {
      return c.json({ error: 'Cannot delete the last active owner' }, 400)
    }
  }

  await db.delete(user).where(eq(user.id, id))
  return c.body(null, 204)
})

export default app
