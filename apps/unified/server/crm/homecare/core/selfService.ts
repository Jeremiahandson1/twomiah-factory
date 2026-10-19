// Caregiver self-service: the ONE rule for a write (or read) a caregiver may make about themselves. Moved from
// templates/crm-homecare/backend/src/helpers/selfService.ts.
//
// A caregiver acts only for themselves: the caregiver id comes from the session, a caregiverId / userId in the body,
// path or query that names someone else is refused 403 (never silently replaced — a screen that sent another person's
// id is a bug the caller should see), and a row that belongs to someone else cannot be edited or deleted. Anyone else
// acts for anyone when they hold the permission the caller names for that act (core/caregiverAccess.ts actsForAnyone):
// care-hr:read to read a caregiver's file, care-schedule:update to change their availability. It was a list of roles
// (owner, admin, manager) — a seat granted read access was refused, and the list was a rank, not a permission.
//
// Used by: absences, blackout-dates, caregiver-availability, caregiver-profile / caregiver-rates /
// caregiver-care-type-rates / certifications (read my own), pto and scheduling time-off.
//
// tests/homecare/write-gates.test.ts recognises `requireAdminOrSelf(` and `selfSubject(` / `ownsRow(` as a
// self-service check; a self-service route on its allow-list must call one of them.
//
// Acting "for anyone" still means anyone the route then finds in the person's own company: these rules name whose
// record it is; the route's own query is scoped to the company.
import type { Context, Next } from 'hono'
import { fail } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { actsForAnyone, userIdOf } from './caregiverAccess.ts'

type Deps = Pick<CrmDeps, 'permissions'>

export const NOT_YOURS = 'You can only do this for yourself.'

/**
 * Route guard for paths that name a caregiver (`/:id`, `/:caregiverId`): the person themself passes; anyone else passes
 * with `permission` (the act on someone else's record).
 */
export const requireAdminOrSelf = (d: Deps, param: string, permission: string) => async (c: Context, next: Next) => {
  const user = c.get('user' as never) as any
  if (!user) return fail(c, 401, 'Access token required')
  if (c.req.param(param) && c.req.param(param) === userIdOf(user)) return next()
  if (await actsForAnyone(d, user, permission)) return next()
  return fail(c, 403, NOT_YOURS)
}

/**
 * Whose record a self-service act is about. With `permission`, the person may name anyone (`named`, falling back to
 * themselves); without it they are always the subject — naming anybody else is a 403.
 */
export async function selfSubject(d: Deps, c: Context, named: unknown, permission: string): Promise<{ id: string; office: boolean } | { refusal: Response }> {
  const user = c.get('user' as never) as any
  const me = userIdOf(user)
  const office = await actsForAnyone(d, user, permission)
  const asked = named === undefined || named === null || String(named).trim() === '' ? null : String(named)
  if (office) return { id: asked ?? me, office }
  if (asked && asked !== me) return { refusal: fail(c, 403, NOT_YOURS) }
  return { id: me, office }
}

/** May this person change a row owned by `ownerId`? Their own; anyone's with `permission`. */
export async function ownsRow(d: Deps, c: Context, ownerId: string | null | undefined, permission: string): Promise<boolean> {
  const user = c.get('user' as never) as any
  if (!!ownerId && ownerId === userIdOf(user)) return true
  return actsForAnyone(d, user, permission)
}
