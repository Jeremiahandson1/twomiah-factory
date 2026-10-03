/**
 * Who may see a customer's DATE OF BIRTH and MEDICAL CARD, and how to take them off a response.
 *
 * T41, signed in as the read-only VIEWER seat: "/api/contacts returns dateOfBirth (75 contacts) and
 * medicalCardNumber/expiry (12) to the viewer; /api/orders carries customerDob and
 * medicalCardNumber too. The UI never shows them."
 *
 * Both endpoints read with a bare `select()` and no column list, so every column reached anybody
 * holding `*:read` — which is every role, viewer and driver included. Nothing on screen displayed
 * them, which is why it went unnoticed and is also why it does not matter: the API is the product,
 * and a field in a response is disclosed whether or not a page renders it.
 *
 * These are regulated identity fields on a cannabis customer. A viewer seat exists so somebody can
 * be given sight of the business without being given its customers' identities.
 *
 * ── THE LINE IS `contacts:update`, NOT A RANK ───────────────────────────────────────────────────
 *
 * Whoever may edit a customer record already sees these on the edit form, so withholding them from
 * that group would break the counter. And the roles holding contacts:update are exactly the ones
 * with a reason to: owner, admin, manager and BUDTENDER — who checks ID and serves medical
 * patients. Viewer and driver hold contacts:read and NOT contacts:update, which is the gap the
 * report found.
 *
 * Asked as a permission rather than a role because a rank is not a permission: an extra grant on an
 * individual user has to count, and `hasPermission(role, perm, extras)` is how the rest of this
 * template asks.
 */
import { hasPermission, getExtraPermissions } from '../middleware/permissions.ts'

/** camelCase as drizzle returns it, snake_case as raw SQL does. Both are stripped. */
const IDENTITY_KEYS = [
  'dateOfBirth', 'medicalCardNumber', 'medicalCardExpiry',
  'date_of_birth', 'medical_card_number', 'medical_card_expiry',
  // The order carries its own copy of the buyer's details, taken at the till.
  'customerDob', 'customer_dob',
] as const

export async function canSeeCustomerIdentity(currentUser: any): Promise<boolean> {
  const extra = await getExtraPermissions(currentUser?.userId)
  return hasPermission(currentUser?.role, 'contacts:update', extra)
}

/**
 * Remove the identity fields from a row, in place.
 *
 * DELETES the keys rather than nulling them: `dateOfBirth: null` reads as "no date of birth on
 * file", which is a different and false statement — and the age gate's own copy of that logic
 * treats a missing DOB as a reason to refuse a sale, so a null would be actively misleading.
 */
export function redactCustomerIdentity<T>(row: T): T {
  if (!row || typeof row !== 'object') return row
  for (const k of IDENTITY_KEYS) delete (row as any)[k]
  return row
}

/** The same, for a list. Mutates and returns it, so it can be used inline. */
export function redactCustomerIdentityAll<T>(rows: T[]): T[] {
  for (const r of rows || []) redactCustomerIdentity(r)
  return rows
}
