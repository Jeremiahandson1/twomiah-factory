/**
 * Trial status helpers. Duck-typed against the minimum shape every
 * template's Company exposes:
 *   - createdAt?: string  (fallback for trial start)
 *   - settings?: { trialEndsAt?: string; subscriptionStatus?: string }
 *
 * Templates with richer Company types still work here — we only read
 * the fields that matter for trial gating.
 */
type TrialCompany = {
  createdAt?: string;
  settings?: {
    trialEndsAt?: string;
    subscriptionStatus?: string;
  } | null;
} | null | undefined;

/**
 * Returns true if the tenant's 30-day trial has expired and they don't
 * have a paying subscription. Used by ProtectedRoute to hard-lock all
 * /crm routes except the paywall bypass list below.
 *
 * If company.settings.trialEndsAt is absent, derive it from
 * company.createdAt + 30 days so legacy tenants don't get stuck.
 */
export function isTrialExpired(company: TrialCompany): boolean {
  if (!company) return false;

  const sub = company.settings?.subscriptionStatus;
  if (sub === 'active' || sub === 'past_due') return false;

  let trialEnd: Date | null = null;
  if (company.settings?.trialEndsAt) {
    trialEnd = new Date(company.settings.trialEndsAt);
  } else if (company.createdAt) {
    trialEnd = new Date(company.createdAt);
    trialEnd.setDate(trialEnd.getDate() + 30);
  }
  if (!trialEnd || isNaN(trialEnd.getTime())) return false;

  return trialEnd.getTime() < Date.now();
}

/** Routes a trial-expired user can still reach (upgrade path + paywall + logout) */
const TRIAL_BYPASS_PREFIXES = [
  '/crm/paywall',
  '/crm/settings/billing',
  '/crm/billing',       // Roof uses /crm/billing/pricing for upgrade
  '/login',
  '/logout',
];

export function isTrialBypassPath(path: string): boolean {
  return TRIAL_BYPASS_PREFIXES.some(p => path.startsWith(p));
}
