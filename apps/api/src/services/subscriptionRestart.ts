// RESTART — a company whose subscription ended pays again from its own lock page and is back in. (10/14)
//
//   Owner: "shouldnt they just be able to make a payment and restart it? why email?"
//
// The lock page told the owner to email support. As Shopify and the others draw it, a store that lapsed reopens by
// choosing the plan and paying. Here:
//   1. the CRM's lock page asks the Factory for a checkout (POST /customers/:id/restart-checkout, X-Factory-Key) — the
//      company's own plan, the same Stripe checkout sign-up uses, so the price is the price;
//   2. Stripe's checkout.session.completed is handled as it is for a sign-up: billing active, status active, the new
//      subscription recorded, and the summary pushed to the CRM — which unlocks it (tenant-backend auth/accountLock.ts);
//   3. finishRestart() undoes what cancelling set going: the 30-day offboard timer (whose end tears down the company's
//      DNS zone and email), and the registrar lock the offboard removed for a transfer nobody is making now.
// After the grace period the teardown has already run, so a restart is no longer self-serve: support sets it up again.

export type RestartTenant = {
  id: string
  plan?: string | null
  billing_status?: string | null
  status?: string | null
  stripe_subscription_id?: string | null
  offboard_started_at?: string | null
  offboard_grace_ends_at?: string | null
  epp_code_sent_at?: string | null
  domain?: string | null
  domain_registrar?: string | null
  name?: string
  email?: string
  admin_email?: string | null
}

export type RestartRefusal = { status: 409 | 410; code: 'still_active' | 'grace_ended'; error: string }

/** Why this company cannot start a restart checkout right now, or null when it can. */
export function restartRefusal(t: RestartTenant, now: Date = new Date()): RestartRefusal | null {
  if (t.stripe_subscription_id && ['active', 'past_due', 'trialing'].includes(String(t.billing_status))) {
    return { status: 409, code: 'still_active', error: 'This subscription is still running — nothing to restart.' }
  }
  const graceEnd = t.offboard_grace_ends_at ? new Date(t.offboard_grace_ends_at) : null
  if (t.status === 'offboarded' || (graceEnd && graceEnd.getTime() < now.getTime())) {
    return { status: 410, code: 'grace_ended', error: 'The 30 days after this subscription ended have passed, so it can no longer be restarted here. Email support@twomiah.com and we will set it up again.' }
  }
  return null
}

export type FinishRestartDeps = {
  clearOffboard: (tenantId: string) => Promise<{ error?: { message: string } | null }>
  relockDomain: (domain: string) => Promise<{ success: boolean; error?: string }>
  audit: (tenantId: string, changes: Record<string, { old: unknown; new: unknown }>) => Promise<void>
  notifyReactivated: (t: RestartTenant) => Promise<unknown>
}

/**
 * After a subscription checkout is paid for a company that was offboarding: stop the offboard. `before` is the tenant
 * row as it was BEFORE the webhook applied the payment. A company that was not offboarding is left alone — that is an
 * ordinary sign-up. Returns what it did, for the log.
 */
export async function finishRestart(before: RestartTenant, deps: FinishRestartDeps): Promise<{ restarted: boolean; steps: string[] }> {
  if (!before?.offboard_started_at) return { restarted: false, steps: [] }
  const steps: string[] = []
  const { error } = await deps.clearOffboard(before.id)
  steps.push(error ? 'offboard timer: FAILED ' + error.message : 'offboard timer cancelled')
  // The offboard unlocked the domain only when we registered it (lifecycle.ts beginOffboard) — lock exactly those.
  if (before.domain && before.domain_registrar === 'namecheap') {
    const r = await deps.relockDomain(before.domain).catch((e: any) => ({ success: false, error: e?.message }))
    steps.push(r.success ? 'domain re-locked' : 'domain re-lock: FAILED ' + (r.error || 'unknown'))
  }
  await deps.audit(before.id, {
    offboard_started_at: { old: before.offboard_started_at, new: null },
    offboard_grace_ends_at: { old: before.offboard_grace_ends_at ?? null, new: null },
  }).catch(() => {})
  await Promise.resolve(deps.notifyReactivated(before)).catch(() => {})
  return { restarted: true, steps }
}
