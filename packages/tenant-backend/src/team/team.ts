// Team roster — ONE implementation for every CRM (vendored into each template as ../shared). The roster (team_member)
// is the people you schedule and pay; login accounts live in the user table and are managed under Settings → Users.
// A freshly provisioned tenant has an empty roster, so the list falls back to the login accounts marked
// `_source: 'user'` (read-only for this page) until a real member is added (F-14).
// Before: two copies differing only in whether a negative hourly rate was refused; phone was free text; paging unclamped.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, count, asc, ilike, or, inArray } from 'drizzle-orm'
import { isValidPhone } from '../contacts/contacts'

export interface TeamTables { teamMember: any; user: any
  /**
   * Jobs, where present. Removing someone from the roster sets their jobs' assignedToMemberId to null, which
   * happened with nothing said either before or after — the work was quietly left unassigned. With this the
   * list can say how much each person is holding and the delete can say what it let go. (Contractor T26 L2)
   */
  job?: any }
/**
 * Somewhere a roster member can be holding work: the table, the property on it that points at team_member,
 * and what one of them is called. Removing the member sets that column to null, so this is also the list of
 * what a removal strands — the count in the confirm dialog, and the count the delete reports afterwards.
 * Defaults to jobs (see createTeamRoutes) for the verticals whose work IS jobs. (Salon T27 N14)
 */
export interface AssignedWork { table: any; field: string; one: string; many: string }
export interface TeamDeps {
  db: any
  tables: TeamTables
  authenticate: any
  requirePermission: (permission: string) => any
  options?: { maxLimit?: number; assignedWork?: AssignedWork[] }
}

const clampInt = (v: unknown, min: number, max: number, dflt: number) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt }
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => '\\' + ch)
const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim()
const optText = (max: number) => z.string().trim().max(max).transform(stripTags).optional().nullable()
const phoneField = z.string().trim().max(40).optional().nullable().refine(isValidPhone, { message: 'Enter a valid phone number (at least 7 digits)' })

export const teamMemberSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120).transform(stripTags),
  email: z.string().trim().email('Enter a valid email').max(320).optional().nullable().or(z.literal('').transform(() => null)),
  phone: phoneField,
  role: optText(80),
  department: optText(80),
  hireDate: z.string().optional().nullable().refine((v) => !v || !isNaN(new Date(v).getTime()), { message: 'Enter a valid hire date' }),
  hourlyRate: z.coerce.number().min(0, 'Hourly rate cannot be negative').max(100000).optional().nullable(),
  active: z.boolean().default(true),
  skills: z.array(z.string().trim().max(60)).max(50).optional(),
  notes: z.string().max(5000).optional().nullable(),
})

export function createTeamRoutes(deps: TeamDeps) {
  const { db, tables: t, authenticate, requirePermission } = deps
  const maxLimit = deps.options?.maxLimit || 200
  // Where this vertical's work lives. Unstated means jobs, which is what every caller meant before salon
  // arrived holding appointments instead and was told it had stranded nothing. Still the COLUMN and not
  // just the table: vet, RV and restaurant have a job table with no assigned_to_member_id, and selecting a
  // column that is not there throws inside drizzle — it 500s the whole Team page, not just the count.
  const work: AssignedWork[] = deps.options?.assignedWork
    ?? (t.job?.assignedToMemberId ? [{ table: t.job, field: 'assignedToMemberId', one: 'job', many: 'jobs' }] : [])
  const workLabel = { one: work[0]?.one || 'job', many: work[0]?.many || 'jobs' }
  const app = new Hono()
  app.use('*', authenticate)

  const emailTaken = async (companyId: string, email: string, exceptId?: string) => {
    const [dupe] = await db.select({ id: t.teamMember.id }).from(t.teamMember)
      .where(and(eq(t.teamMember.companyId, companyId), eq(t.teamMember.email, email))).limit(1)
    return dupe && dupe.id !== exceptId ? dupe : null
  }
  const normEmail = (body: any) => { if (body && typeof body.email === 'string') body.email = body.email.toLowerCase().trim(); return body }
  /** How much work each of these roster members is holding — what removing them would leave unassigned. */
  const assignedJobCounts = async (companyId: string, memberIds: string[]): Promise<Record<string, number>> => {
    if (work.length === 0 || memberIds.length === 0) return {}
    const out: Record<string, number> = {}
    for (const w of work) {
      const col = w.table[w.field]
      if (!col) continue
      const rows = await db.select({ memberId: col, value: count() }).from(w.table)
        .where(and(eq(w.table.companyId, companyId), inArray(col, memberIds)))
        .groupBy(col)
      for (const r of rows) out[String(r.memberId)] = (out[String(r.memberId)] || 0) + Number(r.value)
    }
    return out
  }
  const invalid = (c: any, err: z.ZodError) => c.json({ error: err.errors[0]?.message || 'Invalid team member', details: err.flatten().fieldErrors }, 400)

  app.get('/', requirePermission('team:read'), async (c) => {
    const user = (c as any).get('user')
    const q = c.req.query()
    const page = clampInt(q.page, 1, 1_000_000, 1)
    const limit = clampInt(q.limit, 1, maxLimit, 50)
    const activeFilter = q.active === undefined || q.active === '' ? undefined : q.active === 'true'
    const search = (q.search || '').trim().slice(0, 100)
    const conditions: any[] = [eq(t.teamMember.companyId, user.companyId)]
    if (activeFilter !== undefined) conditions.push(eq(t.teamMember.active, activeFilter))
    if (q.department) conditions.push(eq(t.teamMember.department, String(q.department).slice(0, 80)))
    if (search) { const p = `%${escapeLike(search)}%`; conditions.push(or(ilike(t.teamMember.name, p), ilike(t.teamMember.email, p), ilike(t.teamMember.role, p))!) }
    const where = and(...conditions)
    const [data, [{ value: total }]] = await Promise.all([
      db.select().from(t.teamMember).where(where).orderBy(asc(t.teamMember.name)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(t.teamMember).where(where),
    ])
    // ONE Team list: the roster plus every login account not already on it (matched by email), the login
    // rows flagged `_source: 'user'` (read-only here — logins are managed under Settings › Users). They
    // are appended on the last page so paging never repeats them. Until #172 the login accounts were only
    // a fallback for an EMPTY roster and vanished the moment the first roster member was added (F-14 →
    // events T16 H3).
    const pages = Math.max(1, Math.ceil(Number(total) / limit))
    let rows: any[] = data, totalN = Number(total)
    if (!search && !q.department && page >= pages) {
      const uConds: any[] = [eq(t.user.companyId, user.companyId)]
      if (activeFilter !== undefined) uConds.push(eq(t.user.isActive, activeFilter))
      const [users, roster] = await Promise.all([
        db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName, email: t.user.email, phone: t.user.phone, role: t.user.role, isActive: t.user.isActive })
          .from(t.user).where(and(...uConds)).orderBy(asc(t.user.firstName)),
        db.select({ email: t.teamMember.email }).from(t.teamMember).where(eq(t.teamMember.companyId, user.companyId)),
      ])
      const onRoster = new Set(roster.map((r: any) => String(r.email || '').toLowerCase()).filter(Boolean))
      const logins = users.filter((u: any) => !onRoster.has(String(u.email || '').toLowerCase()))
        .map((u: any) => ({ id: u.id, name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email, email: u.email, phone: u.phone, role: u.role, department: null, hireDate: null, hourlyRate: null, active: u.isActive, _source: 'user' as const }))
      rows = [...data, ...logins]
      totalN += logins.length
    }
    // Each roster row carries the work it is holding, so "Remove" can say what it will leave unassigned
    // instead of finding out afterwards. Login rows are read-only here and keep their jobs either way. (T26 L2)
    const counts = await assignedJobCounts(user.companyId, data.map((m: any) => m.id))
    // …and whether the person can sign in, which has to be answered by "is there a login with this email",
    // NOT by "which table did this row come from". Giving someone a roster card moved them from the user
    // branch above to the roster branch, and their "login" badge vanished with them — on the one page where
    // that badge is the only at-a-glance sign of who has access, and precisely for the people you had just
    // taken the trouble to set up. (Contractor T30 N3)
    const loginEmails = new Set<string>()
    if (data.length) {
      const logins = await db.select({ email: t.user.email }).from(t.user).where(eq(t.user.companyId, user.companyId))
      for (const u of logins) { const e = String(u.email || '').toLowerCase(); if (e) loginEmails.add(e) }
    }
    const hasLogin = (r: any) => r._source === 'user' || loginEmails.has(String(r.email || '').toLowerCase())
    const withCounts = rows.map((r: any) => (r._source === 'user' ? { ...r, hasLogin: true } : { ...r, assignedJobs: counts[r.id] || 0, hasLogin: hasLogin(r) }))
    // …and what that work is CALLED here, so the confirm dialog warns a salon about appointments rather
    // than about jobs it does not have. (Salon T27 N14)
    return c.json({ data: withCounts, workLabel, pagination: { page, limit, total: totalN, pages } })
  })

  // Assignable staff = the login USERS a job/appointment's assignedToId can point at. This is NOT the
  // crew roster (team_member): the roster can hold non-login people and different ids, and once it has a
  // row GET / stops falling back to users — which used to make every login user vanish from the "Assigned
  // To" picker the moment one roster member was added. Pickers must read this, never GET /. (F-14 / assignee)
  app.get('/assignable', requirePermission('team:read'), async (c) => {
    const user = (c as any).get('user')
    const rows = await db.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName, email: t.user.email, role: t.user.role, isActive: t.user.isActive })
      .from(t.user).where(and(eq(t.user.companyId, user.companyId), eq(t.user.isActive, true))).orderBy(asc(t.user.firstName))
    const data = rows.map((u: any) => ({ id: u.id, name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email, email: u.email, role: u.role, active: u.isActive, kind: 'user' as const }))
    // Roster-only crew can be assigned work too, so they belong in the picker — matched to the login users by
    // email so somebody who has both a login and a roster card is offered once, as their login. (T21 M12)
    const seen = new Set(rows.map((u: any) => String(u.email || '').toLowerCase()).filter(Boolean))
    const members = await db.select({ id: t.teamMember.id, name: t.teamMember.name, email: t.teamMember.email, role: t.teamMember.role })
      .from(t.teamMember).where(and(eq(t.teamMember.companyId, user.companyId), eq(t.teamMember.active, true))).orderBy(asc(t.teamMember.name))
    for (const m of members) {
      if (m.email && seen.has(String(m.email).toLowerCase())) continue
      data.push({ id: m.id, name: m.name, email: m.email, role: m.role, active: true, kind: 'member' as const } as any)
    }
    return c.json({ data })
  })

  app.get('/:id', requirePermission('team:read'), async (c) => {
    const user = (c as any).get('user')
    const [member] = await db.select().from(t.teamMember).where(and(eq(t.teamMember.id, c.req.param('id')), eq(t.teamMember.companyId, user.companyId))).limit(1)
    if (!member) return c.json({ error: 'Team member not found' }, 404)
    return c.json(member)
  })

  app.post('/', requirePermission('team:create'), async (c) => {
    const user = (c as any).get('user')
    const parsed = teamMemberSchema.safeParse(normEmail(await c.req.json().catch(() => ({}))))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    if (data.email && await emailTaken(user.companyId, data.email)) return c.json({ error: 'A team member with that email already exists' }, 409)
    const [member] = await db.insert(t.teamMember).values({
      ...data,
      hourlyRate: data.hourlyRate == null ? null : String(data.hourlyRate),
      hireDate: data.hireDate ? new Date(data.hireDate) : null,
      skills: data.skills || [],
      companyId: user.companyId,
    }).returning()
    return c.json(member, 201)
  })

  app.put('/:id', requirePermission('team:update'), async (c) => {
    const user = (c as any).get('user')
    const id = c.req.param('id')
    const parsed = teamMemberSchema.partial().safeParse(normEmail(await c.req.json().catch(() => ({}))))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const [existing] = await db.select({ id: t.teamMember.id }).from(t.teamMember).where(and(eq(t.teamMember.id, id), eq(t.teamMember.companyId, user.companyId))).limit(1)
    if (!existing) return c.json({ error: 'Team member not found' }, 404)
    if (data.email && await emailTaken(user.companyId, data.email, id)) return c.json({ error: 'A team member with that email already exists' }, 409)
    const updates: any = { updatedAt: new Date() }
    for (const [k, v] of Object.entries(data)) if (v !== undefined) updates[k] = v
    if (data.hourlyRate !== undefined) updates.hourlyRate = data.hourlyRate == null ? null : String(data.hourlyRate)
    if (data.hireDate !== undefined) updates.hireDate = data.hireDate ? new Date(data.hireDate) : null
    const [member] = await db.update(t.teamMember).set(updates).where(and(eq(t.teamMember.id, id), eq(t.teamMember.companyId, user.companyId))).returning()
    return c.json(member)
  })

  app.delete('/:id', requirePermission('team:delete'), async (c) => {
    const user = (c as any).get('user')
    const id = c.req.param('id')
    const [existing] = await db.select({ id: t.teamMember.id }).from(t.teamMember).where(and(eq(t.teamMember.id, id), eq(t.teamMember.companyId, user.companyId))).limit(1)
    if (!existing) return c.json({ error: 'Team member not found' }, 404)
    // Their work is about to lose its assignee. Count it first and say so — a caller that only ever
    // sees 204 has no way to learn work was left unassigned. (T26 L2)
    const counts = await assignedJobCounts(user.companyId, [id])
    const unassignedJobs = counts[id] || 0
    // …and do the unassigning HERE, rather than leaving it to ON DELETE SET NULL.
    //
    // The constraint is declared in the schema and in 0018_job_roster_assignee.sql, but that migration is
    // `ADD COLUMN IF NOT EXISTS`: on a tenant where the boot reconcile had already created the column, the
    // whole statement is skipped — REFERENCES clause and all — leaving a column with nothing behind it. The
    // delete then answered {"success":true,"unassignedJobs":1} while the job kept the dead member's id, so
    // the one number this endpoint returns described something that had not happened. Nulling it explicitly
    // is true on every tenant, drifted or not, and in one transaction with the delete so a failure cannot
    // strand jobs half-detached. (Field Service T26 M2)
    await db.transaction(async (tx: any) => {
      for (const w of work) {
        const col = w.table[w.field]
        if (!col) continue
        await tx.update(w.table).set({ [w.field]: null })
          .where(and(eq(w.table.companyId, user.companyId), eq(col, id)))
      }
      await tx.delete(t.teamMember).where(and(eq(t.teamMember.id, id), eq(t.teamMember.companyId, user.companyId)))
    })
    return c.json({ success: true, unassignedJobs, unassignedLabel: workLabel })
  })

  return app
}
