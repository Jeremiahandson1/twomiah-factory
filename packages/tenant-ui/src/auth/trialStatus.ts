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
    accountLock?: string | null;
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

/**
 * Is this company locked? The SERVER decides (tenant-backend auth/accountLock.ts) and sends every role the answer as
 * settings.accountLock — an ended subscription, or a trial that ran out. The trial date is still read as well, for a
 * company whose server has not yet been sent the new answer. (10/14: a paid company cancelled from the Factory was
 * never locked, because only a trial date could lock one.)
 */
export function isAccountLocked(company: TrialCompany): boolean {
  return !!company?.settings?.accountLock || isTrialExpired(company);
}

/** Why it is locked, for the words on the lock page. */
export function accountLockReason(company: TrialCompany): 'subscription_ended' | 'trial_ended' | null {
  const lock = company?.settings?.accountLock;
  if (lock === 'subscription_ended' || lock === 'trial_ended') return lock;
  return isTrialExpired(company) ? 'trial_ended' : null;
}

/** Routes a trial-expired user can still reach (upgrade path + paywall + logout) */
let TRIAL_BYPASS_PREFIXES = [
  '/crm/paywall',
  '/crm/settings/billing',
  '/crm/billing',
  '/login',
  '/logout',
];

/**
 * An app whose addresses differ names its own ways out of the lock. The unified app does: its subscription page is
 * /crm/settings/billing, and /crm/billing is a home-care agency's visit invoicing — which a locked agency must not be
 * let into (the screens filled with "subscription has ended" refusals in place of the lock page).
 */
export function setTrialBypassPaths(paths: string[]): void {
  TRIAL_BYPASS_PREFIXES = [...paths];
}

/** Whole path segments: '/crm/billing' is not '/crm/billing-engine'. */
export function isTrialBypassPath(path: string): boolean {
  return TRIAL_BYPASS_PREFIXES.some(p => path === p || path.startsWith(p + '/'));
}
