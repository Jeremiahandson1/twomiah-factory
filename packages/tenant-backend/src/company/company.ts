// Company settings, feature toggles and login-user management — one implementation for every CRM.
// The template injects its Drizzle db, `company` + `user` tables, auth middleware and template id.
//
// Provider secrets never leave the server: GET/PUT /api/company strip them from every response.
// Feature writes are validated against the registry (the one vocabulary the Factory, the sidebar and
// this route share). User writes are company-scoped and guard against locking the tenant out.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { getFeaturesForTemplate } from '../featureRegistry'

export interface CompanyDeps {
  db: any
  tables: { company: any; user: any }
  authenticate: any
  /** admin | owner */
  requireAdmin: any
  requirePermission: (permission: string) => any
  /** drops the cached extra-permission grants for a user after they change */
  invalidateExtraPermissions?: (userId: string) => void
  /** this template's id in the feature registry, e.g. 'crm-salon' */
  template: string
  options?: { roles?: string[] }
}

export const COMPANY_SECRETS = ['twilioAuthToken', 'twilioAccountSid', 'stripeCustomerId', 'sendgridApiKey', 'smtpPassword'] as const
export function sanitizeCompany<T extends Record<string, any>>(row: T): T {
  if (!row) return row
  const clone: any = { ...row }
  for (const f of COMPANY_SECRETS) delete clone[f]
  return clone
}

const DEFAULT_ROLES = ['admin', 'manager', 'user', 'field']
const USER_COLUMNS = (user: any) => ({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, isActive: user.isActive })

export function createCompanyRoutes(deps: CompanyDeps) {
  const { db, tables: t, authenticate, requireAdmin, requirePermission, invalidateExtraPermissions, template } = deps
  const roles = (deps.options?.roles && deps.options.roles.length ? deps.options.roles : DEFAULT_ROLES) as [string, ...string[]]
  const app = new Hono()
  app.use('*', authenticate)

  const readBody = async (c: any) => (await c.req.json().catch(() => null)) ?? ({} as any)

  // ---------------------------------------------------------------- company
  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const [row] = await db.select().from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
    if (!row) return c.json({ error: 'Company not found' }, 404)
    return c.json(sanitizeCompany(row))
  })

  app.put('/', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const schema = z.object({
      name: z.string().min(1).optional(), email: z.string().email().optional(), phone: z.string().optional(), address: z.string().optional(),
      city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(), logo: z.string().optional(), primaryColor: z.string().optional(),
      website: z.string().optional(), licenseNumber: z.string().optional(), settings: z.record(z.any()).optional(),
    })
    const body = await readBody(c)
    if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`.replace(/^: /, '')).join('; ') }, 400)
    const data = parsed.data
    // Settings that feed money math are bounded here, not only in the form (a 150% tax rate saved). (SALON-M3)
    const money: any = data.settings
    if (money && typeof money === 'object') {
      if (money.defaultTaxRate != null && money.defaultTaxRate !== '') { const r = Number(money.defaultTaxRate); if (!Number.isFinite(r) || r < 0 || r > 100) return c.json({ error: 'Default sales tax rate must be between 0 and 100.' }, 400) }
      for (const k of ['paymentTermsDays', 'defaultPaymentTerms']) if (money[k] != null && money[k] !== '') { const d = Number(money[k]); if (!Number.isFinite(d) || d < 0 || d > 365) return c.json({ error: 'Payment terms must be between 0 and 365 days.' }, 400) }
    }
    const [row] = await db.update(t.company).set({ ...data, updatedAt: new Date() }).where(eq(t.company.id, currentUser.companyId)).returning()
    if (!row) return c.json({ error: 'Company not found' }, 404)
    return c.json(sanitizeCompany(row))
  })

  // ---------------------------------------------------------------- features
  // The Features page renders THIS — the registry entries offered to this template — never a local
  // catalog with its own ids. Any signed-in user may read it; only admins write.
  app.get('/features/catalog', async (c) => {
    const features = getFeaturesForTemplate(template).filter((f) => !f.hidden).map(({ id, name, description, category, core }) => ({ id, name, description, category, core }))
    return c.json({ template, features })
  })

  app.put('/features', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const { features } = (await readBody(c)) as { features?: unknown }
    if (!Array.isArray(features) || features.some((f: unknown) => typeof f !== 'string')) return c.json({ error: 'features must be an array of feature ids' }, 400)
    // Only ids this template offers may be switched on. Ids the Factory already enabled stay (it may
    // grant beyond the catalog); anything else is a 400. Core features are always kept on.
    const [current] = await db.select({ enabledFeatures: t.company.enabledFeatures }).from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
    const offered = getFeaturesForTemplate(template)
    const allowed = new Set<string>([...offered.map((f) => f.id), ...((current?.enabledFeatures || []) as string[])])
    const unknown = (features as string[]).filter((f) => !allowed.has(f))
    if (unknown.length) return c.json({ error: `Unknown feature ids for this product: ${unknown.join(', ')}` }, 400)
    const next = [...new Set([...offered.filter((f) => f.core).map((f) => f.id), ...(features as string[])])]
    const [row] = await db.update(t.company).set({ enabledFeatures: next, updatedAt: new Date() }).where(eq(t.company.id, currentUser.companyId)).returning()
    if (!row) return c.json({ error: 'Company not found' }, 404)
    return c.json(sanitizeCompany(row))
  })

  // ---------------------------------------------------------------- users
  // Who may see the login-user list: the OWNER, plus anyone the owner grants 'users:read' to.
  app.get('/users', requirePermission('users:read'), async (c) => {
    const currentUser = c.get('user') as any
    const rows = await db.select({
      id: t.user.id, email: t.user.email, firstName: t.user.firstName, lastName: t.user.lastName, phone: t.user.phone, role: t.user.role,
      isActive: t.user.isActive, lastLogin: t.user.lastLogin, createdAt: t.user.createdAt, extraPermissions: t.user.extraPermissions,
    }).from(t.user).where(eq(t.user.companyId, currentUser.companyId))
    return c.json(rows)
  })

  app.post('/users', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const schema = z.object({ email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional(), role: z.enum(roles).default('user') })
    const body = await readBody(c)
    if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
    const { password, ...rest } = parsed.data
    // Hash before opening the transaction — bcrypt takes ~100ms and must not run under a row lock.
    const passwordHash = await Bun.password.hash(password, 'bcrypt')

    // Seat cap: SEAT_LIMIT (env, written by the Factory) wins; settings.seatLimit lets staff change it
    // without a redeploy; neither set => no cap. The count and the insert happen under a lock on the
    // company row so two concurrent adds cannot both pass the check.
    const outcome = await db.transaction(async (tx: any) => {
      const [companyRow] = await tx.select().from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1).for('update')
      const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
      const settingSeats = Number.parseInt(String((companyRow?.settings as any)?.seatLimit ?? ''), 10)
      const seatLimit = Number.isInteger(envSeats) && envSeats > 0 ? envSeats : (Number.isInteger(settingSeats) && settingSeats > 0 ? settingSeats : null)
      if (seatLimit) {
        const active = await tx.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.companyId, currentUser.companyId), eq(t.user.isActive, true)))
        if (active.length >= seatLimit) {
          return { status: 403 as const, body: { error: `Your plan includes ${seatLimit} user${seatLimit === 1 ? '' : 's'} and ${active.length} are already active. Deactivate someone or upgrade to add more.`, seatLimit, activeSeats: active.length } }
        }
      }
      const [existing] = await tx.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.email, rest.email), eq(t.user.companyId, currentUser.companyId))).limit(1)
      if (existing) return { status: 409 as const, body: { error: 'Email already exists' } }
      const [created] = await tx.insert(t.user).values({ ...rest, passwordHash, companyId: currentUser.companyId }).returning(USER_COLUMNS(t.user))
      return { status: 201 as const, body: created }
    })
    return c.json(outcome.body as any, outcome.status)
  })

  const findTarget = async (id: string, companyId: string) => {
    const [row] = await db.select().from(t.user).where(and(eq(t.user.id, id), eq(t.user.companyId, companyId))).limit(1)
    return row
  }
  /** Would removing `target` (as admin, or entirely) leave the company with no active admin/owner? */
  const isLastAdmin = async (target: any, companyId: string) => {
    if (target.role !== 'admin' && target.role !== 'owner') return false
    const active = await db.select({ id: t.user.id, role: t.user.role }).from(t.user).where(and(eq(t.user.companyId, companyId), eq(t.user.isActive, true)))
    return active.filter((u: any) => u.role === 'admin' || u.role === 'owner').length <= 1
  }

  app.put('/users/:id', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const schema = z.object({ firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), role: z.enum(roles).optional(), extraPermissions: z.array(z.enum(['users:read'])).optional(), isActive: z.boolean().optional() })
    const parsed = schema.safeParse(await readBody(c))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
    const data = parsed.data
    // Grants are the owner's alone to give — an admin cannot widen their own or anyone's access.
    if (data.extraPermissions !== undefined && currentUser.role !== 'owner') return c.json({ error: 'Only the owner can grant or revoke permissions.' }, 403)
    const target = await findTarget(id, currentUser.companyId)
    if (!target) return c.json({ error: 'User not found' }, 404)
    // Never lock the company out of its own CRM: losing the last administrator is unrecoverable from inside the product.
    const losingAccess = data.isActive === false
    const losingAdmin = losingAccess || (data.role !== undefined && data.role !== 'admin' && (target.role === 'admin' || target.role === 'owner'))
    if (losingAccess && id === currentUser.userId) return c.json({ error: "You can't remove your own access." }, 400)
    if (losingAdmin && (await isLastAdmin(target, currentUser.companyId))) return c.json({ error: 'This is the only administrator left — promote someone else first.' }, 400)
    if (data.extraPermissions !== undefined) invalidateExtraPermissions?.(id)
    const [row] = await db.update(t.user).set({ ...data, updatedAt: new Date() }).where(and(eq(t.user.id, id), eq(t.user.companyId, currentUser.companyId))).returning(USER_COLUMNS(t.user))
    return c.json(row)
  })

  // Hard delete. Company-scoped (the old route deleted by id alone, so an admin could reach another
  // tenant's row), 404 when the row isn't ours, and the same self / last-admin guards as revoke.
  app.delete('/users/:id', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    if (id === currentUser.userId) return c.json({ error: 'Cannot delete yourself' }, 400)
    const target = await findTarget(id, currentUser.companyId)
    if (!target) return c.json({ error: 'User not found' }, 404)
    if (target.isActive && (await isLastAdmin(target, currentUser.companyId))) return c.json({ error: 'This is the only administrator left — promote someone else first.' }, 400)
    await db.delete(t.user).where(and(eq(t.user.id, id), eq(t.user.companyId, currentUser.companyId)))
    return c.body(null, 204)
  })

  return app
}
