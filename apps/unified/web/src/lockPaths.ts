// A locked company's ways out, in this app's addresses (packages/tenant-ui auth/trialStatus.ts setTrialBypassPaths):
// the paywall, the subscription page (Settings › Billing) and signing out. Not /crm/billing, which is a home-care
// agency's visit invoicing — the shared list let a locked agency in there, to screens full of refusals.
export const LOCK_WAYS_OUT = ['/crm/paywall', '/crm/settings/billing', '/login', '/logout']
