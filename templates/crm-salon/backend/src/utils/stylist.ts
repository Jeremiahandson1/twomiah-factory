// Who may hold a chair, answered once for the book and for the service record.
//
// Salon T20 H1 — a stylist added on the Team page could never be given work. appointment.stylist_id and
// service_records.stylist_id are foreign keys to `user`, and a chair-only stylist lives in team_member
// with a different id, so every write was refused by the database with a 409 that talked about "a
// related record" and named nothing. Meanwhile GET /api/team/assignable listed them, tagged
// source "member" — the API advertised a stylist every write path refused. Seven builds open, and it
// reproduces on landscape too.
//
// A stylist is therefore one of two things, and the column that holds them depends on which: a login
// user, or a roster member. Exactly one of the two ids is ever set. Validated here rather than left to
// the foreign key, so the refusal can say which person it could not find.
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { user, teamMember } from '../../db/schema.ts'

export interface StylistRef {
  stylistId: string | null
  stylistMemberId: string | null
}

export const NO_STYLIST: StylistRef = { stylistId: null, stylistMemberId: null }

/** The two columns, for a row being written. */
export async function resolveStylist(companyId: string, id: unknown): Promise<StylistRef | null> {
  if (id == null || id === '') return NO_STYLIST
  const wanted = String(id)

  const [u] = await db.select({ id: user.id }).from(user)
    .where(and(eq(user.id, wanted), eq(user.companyId, companyId))).limit(1)
  if (u) return { stylistId: u.id, stylistMemberId: null }

  const [m] = await db.select({ id: teamMember.id }).from(teamMember)
    .where(and(eq(teamMember.id, wanted), eq(teamMember.companyId, companyId))).limit(1)
  if (m) return { stylistId: null, stylistMemberId: m.id }

  return null // not a person at this salon
}

/** The id a caller gave us, whichever column it ended up in — what every read hands back. */
export const stylistIdOf = (row: any): string | null => row?.stylistId ?? row?.stylistMemberId ?? null

export const unknownStylist = (c: any, id: unknown) =>
  c.json({
    error: `No stylist here has the id "${String(id)}". Pick one from the team list.`,
    code: 'UNKNOWN_STYLIST',
    field: 'stylistId',
  }, 400)
