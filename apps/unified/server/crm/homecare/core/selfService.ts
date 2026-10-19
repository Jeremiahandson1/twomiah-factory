// Caregiver self-service: the ONE rule for a write (or read) a caregiver may make about themselves. Moved from
// templates/crm-homecare/backend/src/helpers/selfService.ts. Pure (it reads only the session).
//
// The office (admin / owner) acts for anyone. A caregiver acts only for themselves: the caregiver id comes from the
// session, a caregiverId / userId in the body, path or query that names someone else is refused 403 (never silently
// replaced — a screen that sent another person's id is a bug the caller should see), and a row that belongs to someone
// else cannot be edited or deleted.
//
// Used by: absences, blackout-dates, caregiver-availability, caregiver-profile / caregiver-rates /
// caregiver-care-type-rates / certifications (read my own), pto and scheduling time-off.
//
// tests/homecare/write-gates.test.ts recognises `requireAdminOrSelf(` and `selfSubject(` / `ownsRow(` as a
// self-service check; a self-service route on its allow-list must call one of them.
//
// The office acting "for anyone" still means anyone the route then finds in the office's own company: these rules
// name whose record it is; the route's own query is scoped to the company.
import type { Context, Next } from 'hono'
import { fail } from '../../../http/reply.ts'
import { isOfficeUser, userIdOf } from './caregiverAccess.ts'

export const NOT_YOURS = 'You can only do this for yourself.'

/** Route guard for paths that name a caregiver (`/:id`, `/:caregiverId`): the office passes; a caregiver passes only when the path names them. */
export const requireAdminOrSelf = (param = 'caregiverId') => async (c: Context, next: Next) => {
  const user = c.get('user' as never) as any
  if (!user) return fail(c, 401, 'Access token required')
  if (isOfficeUser(user)) return next()
  if (c.req.param(param) && c.req.param(param) === userIdOf(user)) return next()
  return fail(c, 403, NOT_YOURS)
}

/**
 * Whose record a self-service write is about. The office may name anyone (`named`, falling back to themselves); a
 * caregiver is always the subject — naming anybody else is a 403.
 */
export function selfSubject(c: Context, named: unknown): { id: string; office: boolean } | { refusal: Response } {
  const user = c.get('user' as never) as any
  const me = userIdOf(user)
  const office = isOfficeUser(user)
  const asked = named === undefined || named === null || String(named).trim() === '' ? null : String(named)
  if (office) return { id: asked ?? me, office }
  if (asked && asked !== me) return { refusal: fail(c, 403, NOT_YOURS) }
  return { id: me, office }
}

/** May this user change a row owned by `ownerId`? The office always; a caregiver only their own. */
export function ownsRow(c: Context, ownerId: string | null | undefined): boolean {
  const user = c.get('user' as never) as any
  return isOfficeUser(user) || (!!ownerId && ownerId === userIdOf(user))
}
