import api from '../services/api';

/**
 * Who can be assigned as a provider (veterinarian).
 *
 * This MUST come from /api/company/users, not /api/team. They are different
 * tables: /api/team lists `team_member` (a crew/field roster that is empty on a
 * new tenant), while every assignment column here — appointment.providerId,
 * visit.providerId, vaccination.providerId, prescription.prescriberId —
 * references `user.id`. Reading the wrong one gives an empty dropdown on a
 * fresh clinic and, once a team_member row exists, a foreign-key violation on
 * save. Same fix as crm-salon/crm-restaurant (shipped 8ab0b1b3).
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
  // A revoked provider must not stay assignable.
  return list.filter((u) => u.isActive !== false);
}
