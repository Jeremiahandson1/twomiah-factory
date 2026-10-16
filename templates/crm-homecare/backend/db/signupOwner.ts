// The agency's account owner: the login made from the sign-up. (Run 4, blockers 1 and 2, 10/16)
//
// Every other CRM seeds the sign-up login as role 'owner', and the shared billing router (packages/tenant-backend
// billing.ts) lets only the owner restart a cancelled subscription or open the Stripe portal — home care asks
// `role === 'owner'` (routes/billing.ts canManage). Home care's seed made the sign-up login an 'admin', so the agency
// had NO owner: after a Factory "Cancel now" the person who pays was told "Only the account owner can restart…", and
// Plan & Billing was read-only for them, with no portal link.
//
// The rule, run by db/seed.ts on every boot:
//   - a new agency's sign-up login is created as the owner;
//   - an agency that has no owner yet (seeded before this fix) gets one: its sign-up login, if that login is still an
//     office admin. A login someone has since made a caregiver, or an agency that already has an owner, is left alone.
// The password is never touched (the seed runs on every boot; the owner's password is theirs).
import { eq } from 'drizzle-orm'

export type SignupOwnerResult = 'created' | 'promoted' | 'kept'

export async function ensureSignupOwner(
  db: any,
  users: any,
  login: { email: string; passwordHash: string; firstName: string; lastName: string },
): Promise<{ user: any; result: SignupOwnerResult }> {
  // Matched exactly as the seed always wrote it, so an existing login is found and never duplicated.
  const email = login.email
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!existing) {
    const [user] = await db.insert(users).values({
      email, passwordHash: login.passwordHash, firstName: login.firstName, lastName: login.lastName,
      role: 'owner', isActive: true, certifications: [], certificationsExpiry: [],
    }).returning()
    return { user, result: 'created' }
  }
  if (existing.role === 'admin') {
    const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'owner')).limit(1)
    if (!owner) {
      const [user] = await db.update(users).set({ role: 'owner', updatedAt: new Date() }).where(eq(users.id, existing.id)).returning()
      return { user, result: 'promoted' }
    }
  }
  return { user: existing, result: 'kept' }
}
