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

export function staffName(u: StaffMember): string {
  return u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;
}

export async function fetchStaff(): Promise<StaffMember[]> {
  const res = await api.get('/api/team/assignable');
  const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
  return list
    // A revoked stylist must not stay assignable.
    .filter((u) => u.active !== false && u.isActive !== false)
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
