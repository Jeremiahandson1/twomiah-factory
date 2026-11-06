// WHOSE CHAIRS A SEAT SEES IN THE BOOK. (Owner's decision, 2026-10-25)
//
// By default every seat that opens The Book sees every chair — the pro default, and what the salon had. The owner can
// switch on "Stylists see only their own appointments" (Square Appointments, Vagaro and Boulevard offer the same per
// role): then a seat WITHOUT `schedule:read-all` reads and acts on only the appointments in its own chair.
//
// Why a permission plus a switch, not a permission alone: the permission says who the switch never narrows — the front
// desk (the salon's viewer, granted it in verticals/salon/settings.ts), managers and admins (schedule:*) and the owner
// ('*'). The stylist rung never holds it, in any vertical, so no other business moves; the switch only decides whether a
// seat lacking it is narrowed. Off, nothing changes for anybody. Rank is never compared.
//
// A seat's own chair is the login itself (appointment.stylistId) and the roster card(s) that are that same person
// (appointment.stylistMemberId): the card the Team page links to the login (crew_login.team_member_id), and the card
// carrying the login's email — the match /api/team/assignable uses to offer someone with both once, as their login.
import { and, eq, inArray, isNotNull, or, type SQL } from 'drizzle-orm'
import { visitHasService } from '../../data/salon.ts'
import { appointment, appointmentItem, company, crewLogin, teamMember, user } from '../../db/schema/index.ts'

/** Holding it, a seat sees the whole book whatever the switch says. */
export const SEE_WHOLE_BOOK = 'schedule:read-all'

/** company.settings key for the owner's switch (Settings › The Book). Absent = off. */
export const OWN_BOOK_SETTING = 'stylistsSeeOwnBookOnly'

/** The switch, read from a company.settings value (an object, or the JSON text an older row may hold). */
export function ownBookOnlyFrom(settings: unknown): boolean {
  let s: any = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = {} } }
  return !!(s && typeof s === 'object' && s[OWN_BOOK_SETTING] === true)
}

/** A narrowed seat: the ids that are its own chair. */
export interface OwnChair {
  userId: string
  memberIds: string[]
}

type Permissions = { hasPermission: (role: string, p: string, extra?: string[]) => boolean; getExtraPermissions: (id?: string) => Promise<string[]> }

export function createBookScope(db: any, permissions: Permissions) {
  async function switchOn(companyId: string): Promise<boolean> {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return ownBookOnlyFrom(co?.settings)
  }

  /** May this seat see every chair? (The permission, with the owner's per-user grants on top.) */
  async function seesWholeBook(u: { role?: string; userId?: string }): Promise<boolean> {
    return permissions.hasPermission(String(u?.role || ''), SEE_WHOLE_BOOK, await permissions.getExtraPermissions(u?.userId))
  }

  /** The roster cards that are this login: linked on the Team page, or carrying its email. */
  async function memberIdsOf(companyId: string, userId: string): Promise<string[]> {
    const linked: Array<{ id: string | null }> = await db.select({ id: crewLogin.teamMemberId }).from(crewLogin)
      .where(and(eq(crewLogin.companyId, companyId), eq(crewLogin.userId, userId), isNotNull(crewLogin.teamMemberId)))
    const [me] = await db.select({ email: user.email }).from(user).where(and(eq(user.id, userId), eq(user.companyId, companyId))).limit(1)
    const email = String(me?.email || '').trim().toLowerCase()
    // Compared here, case-folded, as /api/team/assignable compares them (a salon's roster is a handful of cards).
    const cards: Array<{ id: string; email: string | null }> = email
      ? await db.select({ id: teamMember.id, email: teamMember.email }).from(teamMember).where(and(eq(teamMember.companyId, companyId), isNotNull(teamMember.email)))
      : []
    const byEmail = cards.filter((m) => String(m.email || '').trim().toLowerCase() === email)
    return Array.from(new Set([...linked.map((r) => r.id).filter(Boolean) as string[], ...byEmail.map((r) => r.id)]))
  }

  /**
   * null = this seat sees the whole book (the switch is off, or it holds schedule:read-all); otherwise its own chair.
   * Every read and write of an appointment asks this once per request.
   */
  async function ownChairOf(u: { role?: string; userId?: string; companyId?: string }): Promise<OwnChair | null> {
    if (!u?.companyId || !u?.userId) return null
    if (await seesWholeBook(u)) return null
    if (!(await switchOn(u.companyId))) return null
    return { userId: String(u.userId), memberIds: await memberIdsOf(u.companyId, String(u.userId)) }
  }

  return { switchOn, seesWholeBook, ownChairOf, memberIdsOf }
}

export type BookScope = ReturnType<typeof createBookScope>

/** The condition on `appointment` for a narrowed seat's own chair. */
export function inOwnChair(own: OwnChair): SQL {
  const mine = eq(appointment.stylistId, own.userId)
  // A visit with several services is also in the chair of whoever does one of them (salon #5); no rows, no change.
  const mineItem = own.memberIds.length ? or(eq(appointmentItem.stylistId, own.userId), inArray(appointmentItem.stylistMemberId, own.memberIds))! : eq(appointmentItem.stylistId, own.userId)
  const inItems = visitHasService(appointment.id, mineItem)
  return own.memberIds.length ? or(mine, inArray(appointment.stylistMemberId, own.memberIds), inItems)! : or(mine, inItems)!
}

/** Is this appointment row (or the stylist being written onto one) in the seat's own chair? */
export function isOwnChair(own: OwnChair, row: { stylistId?: string | null; stylistMemberId?: string | null }): boolean {
  return (!!row.stylistId && row.stylistId === own.userId) || (!!row.stylistMemberId && own.memberIds.includes(row.stylistMemberId))
}
