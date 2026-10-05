import api from '../services/api';

/**
 * Who can be assigned as a stylist.
 *
 * This reads /api/team/assignable, which is the one endpoint that answers that question: it returns
 * the login users AND the roster stylists from team_member, de-duplicated by email so somebody with
 * both a login and a roster card is offered once.
 *
 * It used to read /api/company/users — logins only — because the assignment columns
 * (appointment.stylistId, serviceRecord.stylistId, clientProfile.preferredStylistId) were foreign keys
 * to `user`, so picking a roster stylist was a foreign-key violation on save. The book now keeps a
 * second column for a roster stylist and resolves whichever kind it is given, so a chair-only stylist
 * added on the Team page is bookable and belongs in this list. Dropping them from the dropdown was the
 * workaround; it is no longer needed and it hid a real person from the owner. (Salon T20 H1)
 */

export interface StaffMember {
  id: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  role?: string;
  isActive?: boolean;
  /** 'user' has a login; 'member' is roster-only. Both can hold a chair. */
  kind?: 'user' | 'member';
}

/**
 * The stylist on a row, whichever kind they are.
 *
 * A chair can be held by a login user (stylistId → user) or by a roster-only stylist
 * (stylistMemberId → team_member), and the API returns the first as firstName/lastName and the second
 * as stylistMemberName. Six copies of this function across the salon pages read only the first pair, so
 * a roster stylist showed as no stylist at all on Recent Services, in Formula History and on the client's
 * appointment table — even after the queries were fixed to return them. (Salon T28 M6 / T27 N5)
 */
export function stylistNameOf(r: { stylistFirstName?: string | null; stylistLastName?: string | null; stylistMemberName?: string | null } | null | undefined): string {
  if (!r) return ''
  const login = [r.stylistFirstName, r.stylistLastName].filter(Boolean).join(' ').trim()
  return login || String(r.stylistMemberName || '').trim()
}

export function staffName(u: StaffMember): string {
  return u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;
}

/**
 * A MANAGEMENT SEAT IS NOT A CHAIR. (T48: "the owner is still offered as a stylist")
 *
 * /api/team/assignable answers "who can be given work", and for field service that rightly includes
 * the owner — in a small trade shop the owner turns out on jobs. A salon's chair is a different
 * question, and the owner has now reported twice that the list offers people who do not take clients.
 *
 * `user.role` is an ACCESS role, not a job title: `user`/`field`/`staff` are the people who do the
 * work (qa.staff's `user` normalises to field — the stylist seat), while owner/admin/manager are
 * seats for running the place. A job title lives on the ROSTER instead, which is why a roster-only
 * stylist (kind 'member') always belongs here — somebody added them to hold a chair.
 *
 * Measured on saltest before writing this rule: Admin User (owner), Morgan Manager and QA2 Manager
 * (manager) were all offered; QA2 Stylist and Sam Staff (`user`) and T20 Roster Probe (roster
 * 'stylist') are the three who actually take clients. "Front Desk" had already gone — that was the
 * viewer seat the shared endpoint stopped offering last round.
 *
 * THE LAST CLAUSE IS THE IMPORTANT ONE. If filtering leaves nobody, the management seats come back:
 * a one-chair salon where the owner IS the stylist must not end up with an empty dropdown and no way
 * to book anyone. A rule that produces an empty picker is a worse bug than the one it fixes.
 */
const MANAGEMENT_ONLY = new Set(['owner', 'admin', 'manager']);
const takesClients = (u: { role?: string; kind?: string }) =>
  u.kind === 'member' || !MANAGEMENT_ONLY.has(String(u.role || '').toLowerCase());

export async function fetchStaff(): Promise<StaffMember[]> {
  const res = await api.get('/api/team/assignable');
  const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
  const active = list.filter((u) => u.active !== false && u.isActive !== false);
  const serving = active.filter(takesClients);
  return (serving.length ? serving : active)
    .map((u) => {
      const parts = String(u.name || '').trim().split(/\s+/);
      return {
        id: u.id,
        name: u.name,
        firstName: u.firstName ?? (parts[0] || undefined),
        lastName: u.lastName ?? (parts.slice(1).join(' ') || undefined),
        email: u.email,
        role: u.role,
        isActive: true,
        kind: u.kind,
      } as StaffMember;
    });
}
