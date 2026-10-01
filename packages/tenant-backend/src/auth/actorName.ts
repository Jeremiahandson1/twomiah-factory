/**
 * WHO DID THIS, BY NAME — for a record a person reads. (T32 H2 / H11)
 *
 * Two fields found in one QA round were taken from the REQUEST BODY: `change_order.approved_by`,
 * where the screen always sent the literal string "Current User", and `rfi.responded_by`, which was
 * always null. Both are text that a human reads off a printed document, and both are the only record
 * of who made a decision. A caller-supplied value is not a record of anything.
 *
 * It is a lookup rather than a field on the auth context deliberately. `AuthUserContext` carries
 * userId / companyId / email / role, and widening it would add two columns to EVERY authenticated
 * request in the fleet — every list, every poll — to serve a handful of rare writes. The actions that
 * need a name are approvals and answers: a few per day, not a few per second.
 *
 * The email is the fallback. Ugly on a document, but unambiguous, which is the property that matters
 * when the question is "who agreed to this".
 */
import { and, eq } from 'drizzle-orm'

export interface ActorNameDeps {
  db: any
  tables: { user: any }
}

export interface ActorContext {
  userId?: string
  companyId?: string
  email?: string
}

export function createActorName(deps: ActorNameDeps) {
  const { db, tables: { user } } = deps
  return async function actorName(u: ActorContext | null | undefined): Promise<string> {
    if (!u?.userId || !u?.companyId) return u?.email || 'Unknown'
    try {
      const [row] = await db.select({ firstName: user.firstName, lastName: user.lastName, email: user.email })
        .from(user).where(and(eq(user.id, u.userId), eq(user.companyId, u.companyId))).limit(1)
      return [row?.firstName, row?.lastName].filter(Boolean).join(' ') || row?.email || u.email || 'Unknown'
      // A failed lookup must not take the write down with it — the decision still happened, and a
      // record naming the email is worth more than a 500 that records nothing.
    } catch { return u.email || 'Unknown' }
  }
}

export type ActorName = ReturnType<typeof createActorName>
