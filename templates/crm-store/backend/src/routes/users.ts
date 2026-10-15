// Team logins for the store admin.
//
// crm-store shipped with no way to create a second login: nothing in the app
// ever inserted into `users`, so a store owner paying a seat-based plan was
// permanently a one-person account.
//
// Logins are the owner's (users:read, team:create, team:update — admin and up, and a shop has no admin
// seat): a manager runs the shop but does not decide who else gets into it.
//
// The roles a login can hold here: owner, manager, staff (middleware/permissions.ts says what each may do).
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, sql } from 'drizzle-orm'
import crypto from 'crypto'
import { db } from '../../db/index.ts'
import { users, storeSettings } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { sendTeamInvite } from '../services/email.ts'

// An invite is a 7-day set-your-password link on the same reset route (routes/auth.ts /reset-password), as in the CRMs.
// Its token carries an "invite_" prefix: the users table has no last-sign-in column, and the prefix is what tells a
// waiting invite from a 1-hour Forgot-password link — so the list can say "invite sent" and Resend can refuse once
// they have chosen a password. (10/14, matching Shopify: the owner never knows a teammate's password.)
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const INVITE_PREFIX = 'invite_'
const newInviteToken = () => INVITE_PREFIX + crypto.randomUUID()
const invitePending = (u: { resetToken?: string | null; resetTokenExp?: Date | string | null }) =>
  !!u.resetToken && u.resetToken.startsWith(INVITE_PREFIX) && !!u.resetTokenExp && new Date(u.resetTokenExp).getTime() > Date.now()

/** Email the invite. False when it did not go out (no mail set up) — the owner is told, and can resend or set a password. */
async function emailInvite(c: any, target: { email: string; name: string | null; role: string }, token: string): Promise<boolean> {
  const me = c.get('user')
  const [inviter] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, me.userId)).limit(1)
  const [settings] = await db.select({ companyName: storeSettings.companyName }).from(storeSettings).limit(1)
  const base = (process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '')
  return sendTeamInvite({
    toEmail: target.email, name: target.name, role: target.role,
    storeName: settings?.companyName || 'Your store',
    inviterName: inviter?.name || inviter?.email || 'The store owner',
    inviteUrl: `${base}/reset-password?token=${encodeURIComponent(token)}&invite=1`,
  }).catch(() => false)
}

const app = new Hono()
app.use('*', authenticate)

// The roles the owner hands out. 'owner' is not one of them: the store has one owner, minted when the
// store itself was provisioned, and making a second is not a button.
const ASSIGNABLE_ROLES = ['manager', 'staff'] as const

// GET / — the team list. Password material never leaves the server.
app.get('/', requirePermission('users:read'), async (c) => {
  const list = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      resetToken: users.resetToken,
      resetTokenExp: users.resetTokenExp,
    })
    .from(users)

  // The token itself never leaves the server — only whether an invite is waiting.
  return c.json({ data: list.map(({ resetToken, resetTokenExp, ...u }) => ({ ...u, invitePending: invitePending({ resetToken, resetTokenExp }) })) })
})

// POST / — add a team login. With no password, they are EMAILED an invite and choose their own (7 days) — how
// Shopify does it, and the CRMs since 10/14; the owner never knows it. A password the owner sets is still accepted,
// for a shop that hands logins over in person. The response says whether the invite email actually went out, so a
// store with no mail set up is told rather than left waiting for an email that never comes.
app.post('/', requirePermission('team:create'), async (c) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8).optional(),
    name: z.string().min(1),
    role: z.enum(ASSIGNABLE_ROLES, { errorMap: () => ({ message: 'Role must be manager or staff' }) }).default('staff'),
  })

  const body = (await c.req.json().catch(() => null)) ?? {}
  if (typeof (body as any).email === 'string') (body as any).email = (body as any).email.toLowerCase().trim()

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
  }
  const data = parsed.data

  // Hash before the transaction — bcrypt takes ~100ms and must not be done
  // while holding a lock. An invite gets a random password nobody knows; the link sets the real one.
  const invite = !data.password
  const passwordHash = await Bun.password.hash(data.password || crypto.randomUUID() + crypto.randomUUID(), 'bcrypt')
  const inviteToken = invite ? newInviteToken() : null

  // Seat cap. Env-only here: store_settings has no free-form settings column
  // (only typed shippingZones/taxRates), so unlike the CRM templates there is
  // nowhere to stash a per-tenant override without a migration. Unset => no
  // cap, on purpose — refusing a paying owner's staff member because we never
  // recorded their plan is a worse failure than a missed cap.
  //
  // Count + insert must be serialised, or two concurrent adds each count the
  // same N and both insert, exceeding the plan. The CRM templates lock their
  // company row; this database has no company table (one store per database),
  // so a transaction-scoped ADVISORY lock plays that role. It releases
  // automatically on commit or rollback.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('crm_store_seat_add'))`)

    const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
    const seatLimit = Number.isInteger(envSeats) && envSeats > 0 ? envSeats : null
    if (seatLimit) {
      const activeSeats = await tx.select({ id: users.id }).from(users).where(eq(users.isActive, true))
      if (activeSeats.length >= seatLimit) {
        return { status: 403 as const, body: {
          error: `Your plan includes ${seatLimit} user${seatLimit === 1 ? '' : 's'} and ${activeSeats.length} are already active. Deactivate someone or upgrade to add more.`,
          seatLimit,
          activeSeats: activeSeats.length,
        } }
      }
    }

    // users.email carries a unique index — check first so the caller gets a
    // readable message instead of a raw constraint violation.
    const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, data.email)).limit(1)
    if (existing) return { status: 409 as const, body: { error: 'That email already has an account here' } }

    const [created] = await tx
      .insert(users)
      .values({ email: data.email, name: data.name, role: data.role, passwordHash, ...(inviteToken ? { resetToken: inviteToken, resetTokenExp: new Date(Date.now() + INVITE_TTL_MS) } : {}) })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })

    return { status: 201 as const, body: created }
  })

  // Logged after the transaction has committed — never from inside it, where a second connection would wait on this one.
  if (outcome.status === 201) {
    const u = outcome.body as any
    await audit.log({ action: 'create', entity: 'user', entityId: u.id, entityName: u.name || u.email, metadata: { description: `Login added — ${u.email}, as ${u.role}${invite ? ' (invited by email)' : ''}` }, req: c })
    if (invite && inviteToken) {
      const inviteSent = await emailInvite(c, { email: u.email, name: u.name, role: u.role }, inviteToken)
      return c.json({ ...u, invitePending: true, invited: true, inviteSent }, 201)
    }
  }
  return c.json(outcome.body as any, outcome.status)
})

// POST /:id/invite — send the invite again: a fresh 7-day link, while they have not yet chosen a password (the first
// expired, went to spam, or never went out). Once they have, Forgot password on the sign-in page is the way, as for
// everyone. The owner's (team:update), like every change to who gets in.
app.post('/:id/invite', requirePermission('team:update'), async (c) => {
  const [target] = await db.select().from(users).where(eq(users.id, c.req.param('id'))).limit(1)
  if (!target) return c.json({ error: 'User not found' }, 404)
  if (target.role === 'owner') return c.json({ error: 'The owner signs in with their own password.' }, 409)
  if (!target.isActive) return c.json({ error: 'Restore their access first — a revoked login cannot sign in.' }, 409)
  if (!target.resetToken || !target.resetToken.startsWith(INVITE_PREFIX)) {
    // No invite waiting: they have chosen a password, or asked Forgot password themselves (that link replaced the invite).
    return c.json({ error: 'They have no invite waiting. If they cannot sign in, Forgot password on the sign-in page sends them a new link.' }, 409)
  }
  const token = newInviteToken()
  await db.update(users).set({ resetToken: token, resetTokenExp: new Date(Date.now() + INVITE_TTL_MS) }).where(eq(users.id, target.id))
  const inviteSent = await emailInvite(c, { email: target.email, name: target.name, role: target.role }, token)
  await audit.log({ action: 'update', entity: 'user', entityId: target.id, entityName: target.name || target.email, metadata: { description: `Invite sent again — ${target.email}` }, req: c })
  return c.json({ invited: true, inviteSent })
})

// PUT /:id — rename a team member, change their role, or revoke their access.
//
// Deactivation, not deletion: orders and fulfilment history reference the user,
// and the seat count is of ACTIVE users so isActive=false is what frees a seat.
// Until this existed a store owner had NO way to remove a login — a departing
// employee kept full access to products, orders, customers and payments, and
// the only recourse was editing the database.
app.put('/:id', requirePermission('team:update'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const schema = z.object({
    name: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    // Promote a member of staff to manager or back. Without this the only way to change somebody's
    // seat was to revoke the login and make a new one — under a different email, because the old
    // address stays taken.
    role: z.enum(ASSIGNABLE_ROLES, { errorMap: () => ({ message: 'Role must be manager or staff' }) }).optional(),
  })
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
  const data = parsed.data
  // An empty UPDATE SET 500'd. Return a clean 400. (BUG-10)
  if (Object.keys(data).length === 0) return c.json({ error: 'No editable changes provided.' }, 400)

  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!target) return c.json({ error: 'User not found' }, 404)

  // The owner's seat is not changed from this screen — demoting it would leave the store with nobody
  // who can reach payments, settings or logins. And nobody re-roles themselves.
  if (data.role !== undefined && data.role !== target.role) {
    if (target.role === 'owner') return c.json({ error: "The owner's role can't be changed." }, 400)
    if (id === currentUser.userId) return c.json({ error: "You can't change your own role." }, 400)
  }

  // An owner locking themselves out has no way back in without a DB edit.
  if (data.isActive === false) {
    if (id === currentUser.userId) return c.json({ error: "You can't remove your own access." }, 400)
    if (target.role === 'owner') {
      const active = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.isActive, true))
      if (active.filter(u => u.role === 'owner').length <= 1) {
        return c.json({ error: 'This is the only owner — you cannot deactivate them.' }, 400)
      }
    }
  }

  const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning({
    id: users.id,
    email: users.email,
    name: users.name,
    role: users.role,
    isActive: users.isActive,
    createdAt: users.createdAt,
  })
  const changes = audit.diff(target as any, updated as any, Object.keys(data))
  await audit.log({
    action: data.role !== undefined && data.role !== target.role ? 'role_change' : 'update',
    entity: 'user', entityId: updated.id, entityName: updated.name || updated.email, changes,
    metadata: data.isActive !== undefined && data.isActive !== target.isActive ? { description: data.isActive ? `Access restored — ${updated.email}` : `Access revoked — ${updated.email}` } : null,
    req: c,
  })

  return c.json(updated)
})

export default app
