// OWN IT — the owner buys the software outright and takes the code. twomiah.com: "Buy it outright (~36× monthly) and take
// the code." (owner, 2026-10-27: every claim on the site must be true.)
//
//   1. The owner opens Settings › Billing in their own app (owner only). The app asks the Factory for the offer
//      (GET /customers/:id/license, X-Factory-Key) and shows the price — 36× the plan's monthly list price — what comes
//      with it, and what Terms §7 says before any payment.
//   2. The owner gives their GitHub username and accepts the terms; the app asks for a Stripe checkout
//      (POST /customers/:id/license-checkout). A one-time payment for exactly that price.
//   3. On Stripe's checkout.session.completed (purpose own_it_license) the Factory records the licence once per session
//      (tenant_licenses) and hands over: a read-only GitHub invitation to the business's own repo, and a full data export
//      (the same ZIP as Settings › Your Data) as a seven-day download link — by email to the owner. Each step is kept on
//      the row, so a failed one is retried (never repeated) and staff are told when one needs a person.
//
// A licence is the right to RUN the software, not to resell it (Terms §7). The hosted service is not cancelled by buying
// it: the subscription goes on until the owner ends it in the billing portal, so buying never takes a site down.
//
// Everything outside (Stripe, GitHub, the tenant's app, storage, email) is reached through `deps`, so a test runs the whole
// thing against fakes and nothing leaves the machine.
import { planFor } from '../config/planSeats'

export const LICENSE_MONTHS = 36
/** Bumped whenever the words shown before payment change; stored with the purchase. */
export const LICENSE_TERMS_VERSION = '2026-10-28'
/** What the owner is told before paying (shown in the app and, shortened, on the Stripe page). */
export const LICENSE_TERMS = [
  'A licence lets you run this software for your own business. It is not a licence to resell it, rebrand it for other businesses, or offer it to others as a service (Terms of Service §7).',
  'You get your own copy of the code to run yourself. Twomiah keeps its rights in the code; updates we make after today are not part of the licence unless we say so.',
  'Buying it does not cancel your hosted Twomiah service. That subscription carries on, billed monthly, until you end it from your billing portal.',
]
export const LICENSE_INCLUDES = [
  'Read access to your business’s own code repository on GitHub, for the GitHub username you give — invited the moment you pay.',
  'A full export of your business’s data: every list as a spreadsheet file, plus your website pages and media list — emailed to you as a download link that works for seven days.',
  'The licence recorded against your account.',
]

export interface LicenseTenant {
  id: string
  slug?: string | null
  name?: string | null
  email?: string | null
  admin_email?: string | null
  plan?: string | null
  engine?: string | null
  billing_status?: string | null
  status?: string | null
  is_test_tenant?: boolean | null
  github_repo?: string | null
  render_backend_url?: string | null
  render_frontend_url?: string | null
  stripe_customer_id?: string | null
  factory_sync_key?: string | null
}

export interface LicenseRow {
  id: string
  tenant_id: string
  stripe_session_id: string
  stripe_payment_intent: string | null
  amount_cents: number
  monthly_cents: number
  months: number
  plan: string | null
  github_username: string
  repo: string
  terms_version: string
  paid_at: string
  repo_invited_at: string | null
  repo_invite_note: string | null
  export_sent_at: string | null
  export_note: string | null
  handover_status: 'paid' | 'complete' | 'needs_attention'
}

/** GitHub's own rule for a username: 1–39 letters, digits and single hyphens, not starting or ending with one. */
export const isGithubUsername = (s: unknown): s is string => typeof s === 'string' && /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(s)

/** "https://github.com/org/name" or "org/name" → "org/name". */
export const repoFullName = (v: string) => v.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/$/, '')

/** The business's own repo: what the deploy recorded, else the unified app's `<slug>-app` in the Factory's GitHub org. */
export function licenseRepo(t: LicenseTenant, org = process.env.GITHUB_ORG || process.env.GITHUB_USER || ''): string | null {
  if (t.github_repo) return repoFullName(t.github_repo)
  if (t.engine === 'unified' && t.slug && org) return org + '/' + t.slug + '-app'
  return null
}

export interface Offer {
  eligible: boolean
  /** Why not, in words for the owner. */
  reason: string | null
  planName: string | null
  monthlyCents: number | null
  months: number
  priceCents: number | null
  includes: string[]
  terms: string[]
  termsVersion: string
  /** The licence already bought, if any (never the key to anything). */
  license: { paidAt: string; githubUsername: string; amountCents: number; handoverStatus: LicenseRow['handover_status']; repoInvited: boolean; exportSent: boolean } | null
}

/** The price and whether this business may buy now. 36× the plan's monthly list price; a discount on the subscription does not shrink it. */
export function licenseOffer(t: LicenseTenant, existing: LicenseRow | null): Offer {
  const plan = planFor(t.plan)
  const monthlyCents = plan ? Math.round(plan.monthlyPrice * 100) : null
  const base = {
    planName: plan?.name ?? null, monthlyCents, months: LICENSE_MONTHS,
    priceCents: monthlyCents === null ? null : monthlyCents * LICENSE_MONTHS,
    includes: LICENSE_INCLUDES, terms: LICENSE_TERMS, termsVersion: LICENSE_TERMS_VERSION,
    license: existing ? { paidAt: existing.paid_at, githubUsername: existing.github_username, amountCents: existing.amount_cents, handoverStatus: existing.handover_status, repoInvited: !!existing.repo_invited_at, exportSent: !!existing.export_sent_at } : null,
  }
  const no = (reason: string): Offer => ({ ...base, eligible: false, reason })
  if (existing) return no('This business already owns its licence.')
  if (!plan || monthlyCents === null) return no('We cannot work out the price for this plan here — email support@twomiah.com and we will set it up.')
  if (t.billing_status !== 'active') return no('The licence can be bought while your subscription is active.')
  if (t.is_test_tenant) return no('A test account cannot buy a licence.')
  if (!licenseRepo(t)) return no('This business has no code repository to hand over yet — email support@twomiah.com.')
  return { ...base, eligible: true, reason: null }
}

export interface LicenseStore {
  bySession(sessionId: string): Promise<LicenseRow | null>
  byTenant(tenantId: string): Promise<LicenseRow | null>
  /** Inserts; null when a row for the session exists (a second delivery). */
  insert(row: Omit<LicenseRow, 'id'>): Promise<LicenseRow | null>
  update(id: string, patch: Partial<LicenseRow>): Promise<void>
}

export interface CheckoutDeps {
  createSession(p: {
    tenant: LicenseTenant; priceCents: number; productName: string; description: string; termsNote: string
    metadata: Record<string, string>; successUrl: string; cancelUrl: string
  }): Promise<{ url: string | null; sessionId: string; stripeCustomerId?: string }>
  /** Does this GitHub user exist? (GET /users/<name>) null = could not tell. */
  githubUserExists(username: string): Promise<boolean | null>
}

export type CheckoutResult = { ok: true; url: string; sessionId: string; stripeCustomerId?: string } | { ok: false; status: 400 | 409 | 502; error: string; code: string }

/** Start the purchase: refuses what the offer refuses, a bad GitHub name, and terms not accepted. No charge happens here. */
export async function startLicenseCheckout(
  t: LicenseTenant, existing: LicenseRow | null,
  input: { githubUsername?: unknown; acceptedTerms?: unknown; termsVersion?: unknown; returnTo: string },
  deps: CheckoutDeps,
): Promise<CheckoutResult> {
  const offer = licenseOffer(t, existing)
  if (!offer.eligible || offer.priceCents === null) return { ok: false, status: 409, error: offer.reason || 'Not available.', code: 'not_available' }
  if (input.acceptedTerms !== true || input.termsVersion !== LICENSE_TERMS_VERSION) return { ok: false, status: 400, error: 'Read and accept what the licence is (and is not) before paying.', code: 'terms_not_accepted' }
  const gh = typeof input.githubUsername === 'string' ? input.githubUsername.trim().replace(/^@/, '') : ''
  if (!isGithubUsername(gh)) return { ok: false, status: 400, error: 'That is not a GitHub username — letters, numbers and single hyphens, like "acme-builders".', code: 'bad_github_username' }
  const exists = await deps.githubUserExists(gh).catch(() => null)
  if (exists === false) return { ok: false, status: 400, error: `GitHub has no user called "${gh}". Check the spelling — that is the account we invite to your code.`, code: 'github_user_not_found' }
  const repo = licenseRepo(t)!
  const base = input.returnTo.replace(/\/$/, '')
  const session = await deps.createSession({
    tenant: t, priceCents: offer.priceCents,
    productName: `Twomiah own-it licence — ${offer.planName}`,
    description: `One-time: ${LICENSE_MONTHS} × $${(offer.monthlyCents! / 100).toFixed(0)}/month. Your own copy of the code to run for your business.`,
    termsNote: 'A licence to run the software for your own business — not to resell it (Terms §7). Your hosted subscription is not cancelled.',
    metadata: {
      purpose: 'own_it_license', tenant_id: t.id, plan_id: String(t.plan || ''), github_username: gh, repo,
      monthly_cents: String(offer.monthlyCents), months: String(LICENSE_MONTHS), terms_version: LICENSE_TERMS_VERSION,
    },
    successUrl: base + '?license=paid', cancelUrl: base + '?license=cancelled',
  })
  if (!session.url) return { ok: false, status: 502, error: 'Stripe did not return a checkout page — try again in a moment.', code: 'no_checkout_url' }
  return { ok: true, url: session.url, sessionId: session.sessionId, stripeCustomerId: session.stripeCustomerId }
}

export interface HandoverDeps {
  store: LicenseStore
  /** Add the user to the repo with read access. 'invited' (new invitation) | 'already' (already a collaborator). Throws on a refusal. */
  inviteCollaborator(repoFull: string, username: string): Promise<'invited' | 'already'>
  /** The full data export from the tenant's own app, stored and shared for seven days. Throws when it cannot be made. */
  makeExport(t: LicenseTenant): Promise<{ url: string; expiresAt: Date; files: number; rows: number }>
  sendEmail(t: LicenseTenant, o: { githubUsername: string; repoUrl: string; repoInvited: boolean; export?: { url: string; expiresAt: Date }; amountCents: number }): Promise<boolean>
  alertStaff(subject: string, detail: string, tenantId: string): Promise<unknown>
  audit(tenantId: string, changes: Record<string, { old: unknown; new: unknown }>, note: string): Promise<void>
  now?: () => Date
}

/** A Stripe checkout.session.completed's own fields, as far as the licence needs them. */
export interface PaidSession { id: string; payment_intent?: string | null; amount_total?: number | null; payment_status?: string | null; metadata?: Record<string, string> | null }

/**
 * A paid licence checkout: record it once, then do each handover step that is not done yet. Safe to call again for the
 * same session (Stripe redelivers; staff retry): done steps are skipped, so nothing is invited or emailed twice.
 */
export async function completeLicensePurchase(session: PaidSession, tenant: LicenseTenant, deps: HandoverDeps): Promise<{ status: LicenseRow['handover_status']; steps: string[]; row: LicenseRow }> {
  const meta = session.metadata || {}
  const now = (deps.now ?? (() => new Date()))()
  const steps: string[] = []
  let row = await deps.store.bySession(session.id)
  if (!row) {
    if (session.payment_status && session.payment_status !== 'paid') throw new Error('Checkout is not paid yet')
    const monthly = Number(meta.monthly_cents)
    const inserted = await deps.store.insert({
      tenant_id: tenant.id, stripe_session_id: session.id, stripe_payment_intent: session.payment_intent ?? null,
      amount_cents: Number(session.amount_total ?? 0), monthly_cents: Number.isFinite(monthly) ? monthly : 0,
      months: Number(meta.months) || LICENSE_MONTHS, plan: meta.plan_id || tenant.plan || null, github_username: String(meta.github_username || ''),
      repo: String(meta.repo || licenseRepo(tenant) || ''), terms_version: String(meta.terms_version || ''), paid_at: now.toISOString(),
      repo_invited_at: null, repo_invite_note: null, export_sent_at: null, export_note: null, handover_status: 'paid',
    })
    // A second delivery raced the first insert: the first one does the handover.
    row = inserted ?? (await deps.store.bySession(session.id))
    if (!row) throw new Error('Could not record the licence')
    if (!inserted) return { status: row.handover_status, steps: ['already being handled'], row }
    steps.push('licence recorded')
    await deps.audit(tenant.id, { license: { old: null, new: `own-it licence, ${(row.amount_cents / 100).toFixed(2)} USD` } }, `Own-it licence bought; handover to GitHub @${row.github_username}`).catch(() => {})
  }
  if (row.handover_status === 'complete') return { status: 'complete', steps: ['already complete'], row }

  const patch: Partial<LicenseRow> = {}
  if (!row.repo_invited_at) {
    try {
      const r = await deps.inviteCollaborator(row.repo, row.github_username)
      patch.repo_invited_at = now.toISOString(); patch.repo_invite_note = r === 'already' ? 'already a collaborator' : 'invitation sent'
      steps.push('repo: ' + patch.repo_invite_note)
    } catch (e: any) { patch.repo_invite_note = 'FAILED: ' + String(e?.message || e).slice(0, 300); steps.push('repo: ' + patch.repo_invite_note) }
  }
  let exportInfo: { url: string; expiresAt: Date } | undefined
  if (!row.export_sent_at) {
    try {
      const ex = await deps.makeExport(tenant)
      exportInfo = ex
      steps.push(`export: ${ex.files} files, ${ex.rows} rows`)
    } catch (e: any) { patch.export_note = 'FAILED: ' + String(e?.message || e).slice(0, 300); steps.push('export: ' + patch.export_note) }
  }
  const invited = !!(row.repo_invited_at || patch.repo_invited_at)
  // One email, once, whatever has been done: it says what was done and what will follow.
  const sent = (exportInfo || invited) && await deps.sendEmail(tenant, {
    githubUsername: row.github_username, repoUrl: 'https://github.com/' + row.repo, repoInvited: invited, export: exportInfo, amountCents: row.amount_cents,
  }).catch(() => false)
  if (exportInfo && sent) { patch.export_sent_at = now.toISOString(); patch.export_note = 'emailed' }
  const done = invited && !!(row.export_sent_at || patch.export_sent_at)
  patch.handover_status = done ? 'complete' : 'needs_attention'
  await deps.store.update(row.id, patch)
  row = { ...row, ...patch } as LicenseRow
  if (!done) {
    await Promise.resolve(deps.alertStaff('Own-it licence bought — handover needs a person', `Business ${tenant.slug || tenant.id} paid for its licence. Handover: ${steps.join('; ')}. Retry: POST /api/v1/factory/customers/${tenant.id}/license/retry-handover.`, tenant.id)).catch(() => {})
  }
  return { status: row.handover_status, steps, row }
}
