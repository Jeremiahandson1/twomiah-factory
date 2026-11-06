// "View As" — the owner (or an admin) opens the app AS one of their people, for every vertical (owner's live re-test 3,
// 2026-10-24: "the testers can't test manager, staff, admin or viewer because they can't type passwords"; the HVAC
// tester found home care's route and panel in the bundle with no way to open them). Moved up from home care
// (crm/homecare/office/signIn.ts), where it began as the template's admin impersonation.
//
// HOW IT WORKS. POST /api/auth/impersonate/:userId answers a short-lived token for that person, marked `impersonation`
// and naming who opened it (impersonatorId / impersonatedBy). A cookie-session browser (the app's screens) gets it as the
// View As cookie (tenant-backend auth/cookieSession.ts), never in the reply; the person's own session cookies stay beneath
// it. While the cookie is there every request is the viewed person's — the shared authenticate reads the person's row,
// so every menu, page, button and server refusal is exactly theirs. "Return to my account" is POST /api/auth/logout,
// which in a View As drops only the View As cookie: the real session was never touched, so nobody signs in again.
//
// THE RULES (checked when it starts, and again on EVERY request while it lasts — `wrap` below):
//   · it is opened by a holder of users:view-as (the admin row of the shared matrix; the owner holds '*'), never from
//     inside another View As;
//   · never on the owner's account, never on your own, never on a switched-off login;
//   · NO ESCALATION: every permission the person holds — their role's and any the owner granted them by name — must be
//     one the opener already holds. Rank alone is not enough (an owner can grant a manager something an admin lacks),
//     so the check is the permission sets, and the rung rule from home care stays beside it;
//   · it cannot touch the person's sign-in: their password, two-factor, profile and email (every write under
//     /api/auth but Return), their own seat record (/api/company/users/<them>), ownership, or their phone's push
//     registration;
//   · it times out (VIEW_AS_HOURS), and ends early the moment its premise breaks: the opener switched off, signed out
//     everywhere or no longer allowed; the person switched off, re-roled, or their password changed;
//   · every write it makes is recorded with BOTH people: the audit row's user is the person, its impersonator the real
//     user (core/audit.ts reads `viewAs` off the request). A write the person was refused is recorded too
//     (view_as_refused) — that is what a tester is there to see. Starting and stopping (by Return, timing out, or the
//     premise breaking) are rows of their own.
//
// WRITES ARE ALLOWED, as the viewed person would make them. The point is to see exactly what that person gets, and a
// refusal is only real if the request reaches the route that refuses it; a read-only View As answers every write with
// its own "read-only" and hides the real answer. Every such write is attributed to both people. The one exception is
// home care's caregiver seat (crm/homecare/core/viewAsReadOnly.ts): every write a caregiver can make is a first-hand
// record — a clock-in at the client's door that Medicaid pays on (EVV), vitals, a visit note, an incident they
// witnessed, their own mileage — and one made by the office under the caregiver's name is a false record that no audit
// row repairs. Home care's client-portal preview stays read-only (portals/clientPortal.ts).
import { Hono, type MiddlewareHandler } from 'hono'
import { and, eq, inArray } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { clearViewAsCookie, requestToken, setViewAsCookie, wantsCookieSession, sessionEnded } from '@twomiah/tenant-backend'
import { auditLog, user } from '../db/schema/index.ts'
import { fail, one } from '../http/reply.ts'
import type { AppEnv } from '../http/env.ts'

export const VIEW_AS_HOURS = 2
/** The permission that opens a View As: the admin row's (shared auth/permissions.ts), the owner's through '*'. */
export const VIEW_AS_PERMISSION = 'users:view-as'
export const VIEW_AS_ENDED = 'Your View As has ended — you are back on your own account.'
export const VIEW_AS_NOT_ALLOWED = 'While viewing as someone you can’t change their sign-in — password, two-factor, profile or email — or their access. Return to your own account first.'
const LOGOUT = '/api/auth/logout'
const START = '/api/auth/impersonate'
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** What a request made inside a View As carries (c.get('viewAs')): the real user behind it. */
export interface ViewAsContext { impersonatorId: string; impersonatorEmail: string; viewedId: string; startedAt: number; expiresAt: number | null }

interface Row { id: string; companyId: string; email: string; role: string; isActive: boolean | null; firstName: string | null; lastName: string | null; sessionsValidFrom: Date | null }
const nameOf = (r: Pick<Row, 'firstName' | 'lastName' | 'email'>) => `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.email

const tokenOf = (c: any): { token: string; via: string } | null => {
  const p: any = requestToken(c)
  return p && 'token' in p ? p : null
}
const verify = (token: string, opts?: jwt.VerifyOptions): any | null => {
  try { return jwt.verify(token, process.env.JWT_SECRET!, opts) } catch { return null }
}
const pathOf = (c: any) => String(c.req.path).replace(/\/+$/, '')

export interface ViewAsDeps {
  db: any
  /** The shared permissions (createPermissions): hasPermission, getPermissions, getExtraPermissions, normalizeRole, roleLabel, ROLE_HIERARCHY. */
  permissions: any
  /** Home care also writes the clinical trail's ADMIN_IMPERSONATE row (audit_logs), as its template did. */
  careTrail?: (row: { companyId: string; actorId: string; actorEmail: string; targetId: string; targetEmail: string }) => Promise<void>
}

export function createViewAs(deps: ViewAsDeps) {
  const { db, permissions } = deps
  const rung = (role: string) => (permissions.ROLE_HIERARCHY as string[]).indexOf(permissions.normalizeRole(role))

  const rowsOf = async (ids: string[]): Promise<Row[]> => db.select({
    id: user.id, companyId: user.companyId, email: user.email, role: user.role, isActive: user.isActive,
    firstName: user.firstName, lastName: user.lastName, sessionsValidFrom: user.sessionsValidFrom,
  }).from(user).where(inArray(user.id, ids))

  /**
   * May `by` view as `target`? null when yes, else the sentence that says why not. The one rule, asked when a View As
   * starts and on every request it makes.
   */
  async function refusal(by: Row, target: Row): Promise<{ status: 403 | 400; error: string; code: string } | null> {
    if (target.companyId !== by.companyId) return { status: 403, error: 'That person is not on this account.', code: 'not_found' }
    if (target.id === by.id) return { status: 400, error: 'That is your own account — you already see it as yourself.', code: 'own_account' }
    if (permissions.normalizeRole(target.role) === 'owner') return { status: 403, error: 'The owner’s account can’t be viewed as.', code: 'owner_account' }
    if (target.isActive === false) return { status: 400, error: 'This login is switched off. Turn it back on first.', code: 'inactive' }
    const byExtra: string[] = await permissions.getExtraPermissions(by.id)
    if (!permissions.hasPermission(by.role, VIEW_AS_PERMISSION, byExtra)) return { status: 403, error: 'Only the owner or an admin can view as someone.', code: 'not_permitted' }
    if (rung(target.role) > rung(by.role)) return { status: 403, error: 'You can only view as someone at or below your own role.', code: 'higher_role' }
    // No escalation: everything the person can do, the opener must already be able to do.
    const theirs: string[] = [...permissions.getPermissions(target.role), ...(await permissions.getExtraPermissions(target.id))].filter((p) => !p.startsWith('-'))
    const beyond = theirs.filter((p) => !permissions.hasPermission(by.role, p, byExtra))
    if (beyond.length) return { status: 403, error: 'This person has access you don’t have, so you can’t view as them.', code: 'beyond_your_access' }
    return null
  }

  /** An audit row about the View As itself (start, end). Throws when `strict` and the row could not be written. */
  async function record(c: any, by: { id: string; email: string; companyId: string }, viewed: { id: string; name: string; email?: string | null; role?: string | null },
    action: 'view_as_start' | 'view_as_end', description: string, extra: Record<string, unknown> = {}, strict = false) {
    try {
      await db.insert(auditLog).values({
        action, entity: 'user', entityId: viewed.id, entityName: viewed.name,
        metadata: { description, viewedId: viewed.id, viewedEmail: viewed.email ?? null, viewedRole: viewed.role ?? null, ...extra },
        userId: by.id, userName: by.email, userEmail: by.email, companyId: by.companyId,
        ipAddress: c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || (c.req.header('x-forwarded-for') || '').split(',')[0].trim() || null,
        userAgent: c.req.header('user-agent') || null,
      } as any)
    } catch (err) {
      if (strict) throw err
      console.error('[view-as] audit row not written:', (err as Error)?.message)
    }
  }

  // Each View As's end is written once, however many requests notice it at the same moment.
  const endedOnce = new Set<string>()
  const endKey = (d: any) => `${d?.impersonatorId}:${d?.userId}:${d?.iat}:${d?.exp}`
  async function recordEnd(c: any, decoded: any, why: string, reason: string) {
    const key = endKey(decoded)
    if (endedOnce.has(key)) return
    endedOnce.add(key)
    if (endedOnce.size > 5000) endedOnce.clear()
    if (!decoded?.impersonatorId || !decoded?.userId) return
    const [by] = await rowsOf([decoded.impersonatorId]).catch(() => [] as Row[])
    if (!by) return
    await record(c, { id: by.id, email: by.email, companyId: by.companyId },
      { id: decoded.userId, name: decoded.name || decoded.email || decoded.userId, email: decoded.email, role: decoded.role },
      'view_as_end', `${why} — viewing as ${decoded.name || decoded.email}`, { reason })
  }

  /** End this View As: drop the cookie, record why, and refuse the request as signed out (the client then refreshes its own session). */
  async function endNow(c: any, decoded: any, why: string, reason: string) {
    clearViewAsCookie(c)
    await recordEnd(c, decoded, why, reason)
    return fail(c, 401, VIEW_AS_ENDED, 'view_as_ended')
  }

  /** Writes a View As may never make: the person's sign-in and access. */
  const touchesSignIn = (c: any, viewedId: string): boolean => {
    if (!WRITES.has(c.req.method)) return false
    const p = pathOf(c)
    if (p.startsWith('/api/auth/') && p !== LOGOUT) return true
    if (p === `/api/company/users/${viewedId}` || p.startsWith(`/api/company/users/${viewedId}/`)) return true
    if (p === '/api/company/transfer-ownership') return true
    if (p === '/api/push' || p.startsWith('/api/push/')) return true
    return false
  }

  /**
   * The app's sign-in check, with View As in it: wraps the authenticate every signed-in route runs (server/app.ts), for
   * every vertical. Outside a View As it is the plain authenticate.
   */
  function wrap(inner: MiddlewareHandler): MiddlewareHandler {
    return async (c, next) => {
      const presented = tokenOf(c)
      const decoded = presented ? verify(presented.token) : null
      const viaCookie = presented?.via === 'view-as'

      // A View As cookie that no longer holds a live View As (run out, or not one at all) is dropped. Run out with a good
      // signature is the View As timing out, and is recorded.
      if (viaCookie && !decoded?.impersonation) {
        const lapsed = presented ? verify(presented.token, { ignoreExpiration: true }) : null
        if (lapsed?.impersonation && lapsed.role !== 'client') return endNow(c, lapsed, 'Timed out', 'timed_out')
        clearViewAsCookie(c)
        return fail(c, 401, VIEW_AS_ENDED, 'view_as_ended')
      }
      if (!decoded?.impersonation) return inner(c, next)
      // Home care's client-portal preview token is the portal's, read-only there (portals/clientPortal.ts); on the office's
      // routes it changes nothing either.
      if (decoded.role === 'client') {
        if (WRITES.has(c.req.method)) return fail(c, 403, 'Portal preview is read-only', 'view_as_read_only')
        return inner(c, next)
      }

      const p = pathOf(c)
      // Return to my account: end only the View As. It never reaches the shared sign-out, which would end the viewed
      // person's own sessions. DELETE /api/auth/impersonate is the screens' Return (below: outside a View As it does
      // nothing, so a late click can never sign the real user out); signing out of a View As is the same.
      if ((c.req.method === 'POST' && p === LOGOUT) || (c.req.method === 'DELETE' && p === START)) {
        if (viaCookie) clearViewAsCookie(c)
        await recordEnd(c, decoded, 'Returned to their own account', 'returned')
        return one(c, { message: 'Logged out', viewAs: 'ended' })
      }
      if (c.req.method === 'POST' && (p === START || p.startsWith(START + '/'))) {
        return fail(c, 403, 'You are already viewing as someone. Return to your own account first.', 'view_as_nested')
      }

      // The premise, again, on every request: both people as they are now, and the same rule as at the start.
      const rows = decoded.impersonatorId && decoded.userId ? await rowsOf([decoded.impersonatorId, decoded.userId]) : []
      const by = rows.find((r) => r.id === decoded.impersonatorId)
      const viewed = rows.find((r) => r.id === decoded.userId)
      if (!by || !viewed) return endNow(c, decoded, 'Ended (a login is gone)', 'login_gone')
      if (by.isActive === false) return endNow(c, decoded, 'Ended (your login was switched off)', 'opener_inactive')
      if (sessionEnded(by.sessionsValidFrom, decoded.iat)) return endNow(c, decoded, 'Ended (your password was changed)', 'opener_session_ended')
      if (sessionEnded(viewed.sessionsValidFrom, decoded.iat)) return endNow(c, decoded, 'Ended (their password was changed)', 'viewed_session_ended')
      if (by.companyId !== decoded.companyId || viewed.companyId !== decoded.companyId) return endNow(c, decoded, 'Ended (not this account)', 'company')
      if (viewed.role !== decoded.role) return endNow(c, decoded, 'Ended (their role changed)', 'role_changed')
      if (await refusal(by, viewed)) return endNow(c, decoded, 'Ended (no longer allowed)', 'not_allowed')

      if (touchesSignIn(c, viewed.id)) return fail(c, 403, VIEW_AS_NOT_ALLOWED, 'view_as_not_allowed')

      const ctx: ViewAsContext = {
        impersonatorId: by.id, impersonatorEmail: by.email, viewedId: viewed.id,
        startedAt: (decoded.iat || 0) * 1000, expiresAt: typeof decoded.exp === 'number' ? decoded.exp * 1000 : null,
      }
      c.set('viewAs', ctx)
      const res = await inner(c, next)
      // A write the person was refused is part of what was done while viewing: recorded with both people.
      const status = res instanceof Response ? res.status : (c.res?.status ?? 0)
      if (WRITES.has(c.req.method) && status >= 400 && status !== 401) {
        await db.insert(auditLog).values({
          action: 'view_as_refused', entity: 'request', entityName: `${c.req.method} ${p}`,
          metadata: { description: `Refused (${status}) while viewing as ${nameOf(viewed)} — ${c.req.method} ${p}`, method: c.req.method, path: p, status },
          userId: viewed.id, userName: viewed.email, userEmail: viewed.email, companyId: viewed.companyId,
          impersonatorId: by.id, impersonatorEmail: by.email,
          userAgent: c.req.header('user-agent') || null,
        } as any).catch((err: any) => console.error('[view-as] refused-write row not written:', err?.message))
      }
      return res
    }
  }

  const routes = new Hono<AppEnv>()

  // GET / — is this session a View As, of whom, opened by whom, until when (the banner). Any signed-in session may ask.
  routes.get('/', async (c) => {
    const presented = tokenOf(c)
    const decoded = presented ? verify(presented.token) : null
    if (!decoded?.impersonation || decoded.role === 'client') return one(c, { active: false })
    const viewed = c.get('user')
    const [row] = await db.select({ firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role })
      .from(user).where(and(eq(user.id, viewed.userId), eq(user.companyId, viewed.companyId))).limit(1)
    const [by] = decoded.impersonatorId ? await db.select({ firstName: user.firstName, lastName: user.lastName, email: user.email })
      .from(user).where(eq(user.id, decoded.impersonatorId)).limit(1) : []
    const role = row?.role ?? viewed.role
    return one(c, {
      active: true,
      name: row ? nameOf(row as any) : decoded.name || '',
      role,
      roleLabel: permissions.roleLabel(role),
      impersonatedBy: decoded.impersonatedBy ?? null,
      impersonatorName: by ? nameOf(by as any) : null,
      expiresAt: typeof decoded.exp === 'number' ? new Date(decoded.exp * 1000).toISOString() : null,
    })
  })

  // POST /:userId — start. users:view-as (rule in `refusal`), then the audit row, then the session — no row, no View As.
  // DELETE / — Return, from outside a View As (it ran out a moment ago, or another tab returned already): nothing to end,
  // and nothing else is touched. Inside a View As, `wrap` answers it before it gets here.
  routes.delete('/', (c) => {
    clearViewAsCookie(c)
    return one(c, { active: false })
  })

  // The declared gate is the permission (who may not view as anyone hears that before whether an id exists); `refusal`
  // asks it again with everything else.
  routes.post('/:userId', permissions.requirePermission(VIEW_AS_PERMISSION), async (c) => {
    const actor = c.get('user')
    const [by] = await rowsOf([actor.userId])
    const [target] = await rowsOf([c.req.param('userId')])
    if (!by) return fail(c, 401, 'Sign in again.')
    if (!target || target.companyId !== actor.companyId) return fail(c, 404, 'User not found')
    const no = await refusal(by, target)
    if (no) return fail(c, no.status, no.error, no.code)

    const name = nameOf(target)
    const roleLabel = permissions.roleLabel(target.role)
    try {
      await record(c, { id: by.id, email: by.email, companyId: by.companyId }, { id: target.id, name, email: target.email, role: target.role },
        'view_as_start', `Started viewing as ${name} (${roleLabel})`, { hours: VIEW_AS_HOURS }, true)
      if (deps.careTrail) await deps.careTrail({ companyId: by.companyId, actorId: by.id, actorEmail: by.email, targetId: target.id, targetEmail: target.email })
    } catch {
      return fail(c, 500, 'Could not record the View As in the audit log — try again.')
    }
    const token = jwt.sign(
      { userId: target.id, email: target.email, role: target.role, companyId: by.companyId, name, impersonatedBy: by.email, impersonatorId: by.id, impersonation: true },
      process.env.JWT_SECRET!,
      { expiresIn: `${VIEW_AS_HOURS}h` },
    )
    const viewed = { id: target.id, email: target.email, name, firstName: target.firstName, lastName: target.lastName, role: target.role, roleLabel, impersonatedBy: by.email }
    if (wantsCookieSession(c)) {
      // A minute inside the token's life, so the browser drops the cookie before the server would refuse the token.
      setViewAsCookie(c, token, VIEW_AS_HOURS * 3600 - 60)
      return one(c, { user: viewed })
    }
    return one(c, { token, user: viewed })
  })

  return { wrap, routes, refusal }
}

export type ViewAs = ReturnType<typeof createViewAs>
