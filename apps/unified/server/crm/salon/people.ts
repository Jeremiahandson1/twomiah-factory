// Who is a client, and who may hold a chair — each answered once. Moved from templates/crm-salon/backend/src/utils
// (clientTypes.ts, stylist.ts).
import type { Context } from 'hono'
import { and, eq, notInArray } from 'drizzle-orm'
import { contact, user, teamMember } from '../../db/schema/index.ts'
import { fail } from '../../http/reply.ts'

/**
 * Contact types that are NOT a client of the salon. A lead has not sat in a chair yet; a vendor is not a customer at
 * all; "other" only exists on rows a pre-validation CSV import let through. (Salon T20 M2, T28 L2)
 */
export const NON_CLIENT_TYPES = ['lead', 'vendor', 'other'] as const

/** The filter for "a client": everyone who sits in your chairs. */
export const isClient = () => notInArray(contact.type, NON_CLIENT_TYPES as unknown as string[])

/** Every client of this company — the one definition the list and the count share. */
export const clientsOf = (companyId: string) => and(eq(contact.companyId, companyId), isClient())

/**
 * A stylist is one of two things, and the column that holds them depends on which: a login user, or a roster member.
 * Exactly one of the two ids is ever set. Validated here rather than left to the foreign key, so the refusal can say
 * which person it could not find. (Salon T20 H1)
 */
export interface StylistRef {
  stylistId: string | null
  stylistMemberId: string | null
}

export const NO_STYLIST: StylistRef = { stylistId: null, stylistMemberId: null }

/** The two columns, for a row being written; null when the id is not a person at this salon. */
export async function resolveStylist(db: any, companyId: string, id: unknown): Promise<StylistRef | null> {
  if (id == null || id === '') return NO_STYLIST
  const wanted = String(id)

  const [u] = await db.select({ id: user.id }).from(user)
    .where(and(eq(user.id, wanted), eq(user.companyId, companyId))).limit(1)
  if (u) return { stylistId: u.id, stylistMemberId: null }

  const [m] = await db.select({ id: teamMember.id }).from(teamMember)
    .where(and(eq(teamMember.id, wanted), eq(teamMember.companyId, companyId))).limit(1)
  if (m) return { stylistId: null, stylistMemberId: m.id }

  return null
}

/** The id a caller gave us, whichever column it ended up in — what every read hands back. */
export const stylistIdOf = (row: { stylistId?: string | null; stylistMemberId?: string | null } | null | undefined): string | null =>
  row?.stylistId ?? row?.stylistMemberId ?? null

/** The refusal for an id that is no one here. (The template also sent `field: 'stylistId'`; the code names it.) */
export const unknownStylist = (c: Context, id: unknown) =>
  fail(c, 400, `No stylist here has the id "${String(id)}". Pick one from the team list.`, 'UNKNOWN_STYLIST', { stylistId: 'Pick one from the team list.' })
