import api from '../services/api';

/**
 * Who can be assigned as a stylist.
 *
 * This MUST come from /api/company/users, not /api/team. They are different
 * tables: /api/team lists `team_member` (a crew/field roster that is empty on a
 * new tenant), while every assignment column here — clientProfile
 * .preferredStylistId, appointment.stylistId, serviceRecord.stylistId —
 * references `user.id`. Reading the wrong one gives an empty dropdown on a
 * fresh salon and, once a team_member row exists, a foreign-key violation on
 * save. Inherited from crm-vet, which still has it.
 *
 * /api/company/users returns a BARE ARRAY, not the usual {data} envelope.
 */

export interface StaffMember {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  isActive?: boolean;
}

export function staffName(u: StaffMember): string {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id;
}

export async function fetchStaff(): Promise<StaffMember[]> {
  const res = await api.get('/api/company/users');
  const list: StaffMember[] = Array.isArray(res) ? res : (res?.data ?? []);
  // A revoked stylist must not stay assignable.
  return list.filter((u) => u.isActive !== false);
}
