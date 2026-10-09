/**
 * Trial status helpers. Duck-typed against the minimum shape every
 * template's Company exposes:
 *   - createdAt?: string  (no longer read: the trial is never guessed from it — T60)
 *   - settings?: { trialEndsAt?: string; subscriptionStatus?: string }
 *
 * Templates with richer Company types still work here — we only read
 * the fields that matter for trial gating.
 */
type TrialCompany = {
  createdAt?: string | null;
  settings?: {
    trialEndsAt?: string;
    subscriptionStatus?: string;
  } | null;
} | null | undefined;

/**
 * When the trial ends, or null when no trial is deciding access. ONE answer for the gate and the banner.
 *
 * The Factory is the billing system: it sends trialEndsAt whenever a trial exists, and its own rule is
 * that a tenant must never lock a customer out on its own guess (apps/api/src/services/tenantSubscription.ts).
 * This used to guess — "createdAt + 30 days" when trialEndsAt was absent. A manager is never sent the
 * subscription status (commercial terms), so on a paid shop that guess counted down and then sent every
 * manager and staff member to the paywall 30 days after sign-up, while the owner saw nothing. (T60)
 *
 * The server keeps trialEndsAt for those roles exactly while a trial decides access (auth/redactSettings.ts).
 */
export function trialEndDate(company: TrialCompany): Date | null {
  if (!company) return null;
  const sub = company.settings?.subscriptionStatus;
  if (sub === 'active' || sub === 'past_due') return null;
  if (!company.settings?.trialEndsAt) return null;
  const trialEnd = new Date(company.settings.trialEndsAt);
  return isNaN(trialEnd.getTime()) ? null : trialEnd;
}

/**
 * True when the trial has ended without a paying subscription. Used by ProtectedRoute to hard-lock all
 * /crm routes except the paywall bypass list below.
 */
export function isTrialExpired(company: TrialCompany): boolean {
  const trialEnd = trialEndDate(company);
  return !!trialEnd && trialEnd.getTime() < Date.now();
}

/** Routes a trial-expired user can still reach (upgrade path + paywall + logout) */
const TRIAL_BYPASS_PREFIXES = [
  '/crm/paywall',
  '/crm/settings/billing',
  '/crm/billing',
  '/login',
  '/logout',
];

export function isTrialBypassPath(path: string): boolean {
  return TRIAL_BYPASS_PREFIXES.some(p => path.startsWith(p));
}
