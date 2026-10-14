/**
 * DOMAIN RENEWALS ARE CHARGED TO THE CUSTOMER, THEN RENEWED BY US. (10/14)
 *
 * We sell a domain's first year through Stripe and register it on our Namecheap account. Nothing charged the
 * customer for the years after: the 60/30/7-day emails said "renews automatically", and any renewal landed on our
 * Namecheap balance. Now, 30 days before a domain we registered expires:
 *
 *   1. chargeDueDomainRenewals (daily cron) bills the customer one year — at cost plus the Stripe fee, from
 *      Namecheap's live renewal price (config/domainPricing.ts) — on a Stripe invoice, paid off-session with the card
 *      they already use. A card that fails leaves the invoice open: they are emailed its pay link.
 *   2. completePaidDomainRenewal (Stripe invoice.paid) renews the domain at Namecheap for exactly one year — only
 *      after the money is in, and only once per invoice however many times Stripe delivers the event.
 *
 * Unpaid means not renewed: we are never out of pocket. This relies on Namecheap's OWN auto-renew being off for
 * these domains (registration never sets it; it is an account setting) — otherwise Namecheap renews it too.
 */
import { renewalChargeCents } from '../config/domainPricing'

const DAY = 24 * 60 * 60 * 1000
/** Bill this far ahead of expiry: time for a failed card to be fixed before the domain lapses. */
export const CHARGE_DAYS_BEFORE_EXPIRY = 30

export type RenewalTenant = {
  id: string; name: string; slug?: string; email?: string | null; admin_email?: string | null
  domain?: string | null; domain_registrar?: string | null; domain_expires_at?: string | null
  stripe_customer_id?: string | null; status?: string | null; offboard_started_at?: string | null
  domain_renewal_price_cents?: number | null; domain_renewal_invoice_id?: string | null
  domain_renewal_error?: string | null; render_frontend_url?: string | null
}

/**
 * What one year of renewal costs this customer: a price staff set by hand (domain_renewal_price_cents) if there is
 * one, else Namecheap's live renewal price plus the Stripe fee — at cost, for everyone. null when it cannot be worked
 * out (no live price), and then nobody is billed.
 */
export function renewalPriceCents(t: Pick<RenewalTenant, 'domain' | 'domain_renewal_price_cents'>, liveRenewalCostCents: number | null): number | null {
  if (typeof t.domain_renewal_price_cents === 'number' && t.domain_renewal_price_cents > 0) return t.domain_renewal_price_cents
  if (!t.domain) return null
  return renewalChargeCents(liveRenewalCostCents)
}

/** The TLD of a domain — what the registrar prices by. */
export const tldOf = (domain: string) => domain.trim().toLowerCase().replace(/^[^.]+\./, '')

/** Should the cron bill this tenant now? `charge`, or the reason it is left alone. */
export function renewalAction(t: RenewalTenant, now: Date): { act: 'charge' } | { act: 'skip'; reason: string } {
  if (t.domain_registrar !== 'namecheap' || !t.domain) return { act: 'skip', reason: 'not a domain we registered' }
  if (!t.domain_expires_at) return { act: 'skip', reason: 'expiry unknown' }
  const left = new Date(t.domain_expires_at).getTime() - now.getTime()
  if (left <= 0) return { act: 'skip', reason: 'already expired' }
  if (left > CHARGE_DAYS_BEFORE_EXPIRY * DAY) return { act: 'skip', reason: 'not due yet' }
  if (t.domain_renewal_invoice_id) return { act: 'skip', reason: 'already billed for this renewal' }
  if (t.domain_renewal_error) return { act: 'skip', reason: 'needs staff: ' + t.domain_renewal_error }
  if (t.offboard_started_at || t.status === 'offboarded' || t.status === 'suspended') return { act: 'skip', reason: 'leaving — the domain is theirs to transfer' }
  // A renewal price of $0 means WE cover it (family, comped): nobody is billed, and Namecheap's own auto-renew — left
  // ON for these domains — keeps it alive on our account. (owner, 10/14)
  if (t.domain_renewal_price_cents === 0) return { act: 'skip', reason: 'we cover it — Namecheap auto-renew keeps it' }
  return { act: 'charge' }
}

/** One year on from the expiry we renewed — not from today, which would shorten it. */
export function nextExpiry(currentExpiry: string | Date): Date {
  const d = new Date(currentExpiry)
  d.setUTCFullYear(d.getUTCFullYear() + 1)
  return d
}

export const RENEWAL_TENANT_COLUMNS = 'id, name, slug, email, admin_email, domain, domain_registrar, domain_expires_at, stripe_customer_id, status, offboard_started_at, domain_renewal_price_cents, domain_renewal_invoice_id, domain_renewal_error, render_frontend_url'

type Deps = {
  supabase: any
  /** Namecheap's live price to renew one year of a TLD, in cents (registrar.getRenewalCostCents). */
  renewalCostCents: (tld: string) => Promise<number | null>
  createInvoice: (o: { customerId: string; amountCents: number; domain: string; tenantId: string; expiresAt: string }) => Promise<{ invoiceId: string; paid: boolean; hostedUrl?: string | null; error?: string }>
  notifyPaymentNeeded: (t: RenewalTenant, o: { amountCents: number; hostedUrl?: string | null; expiresAt: string }) => Promise<unknown>
  alertStaff: (subject: string, detail: string, tenantId: string) => Promise<unknown>
}

/** Daily: bill every domain renewal that is due. Returns counts and per-tenant errors; never throws. */
export async function chargeDueDomainRenewals(now: Date, deps: Deps) {
  const out = { billed: 0, paid: 0, awaitingPayment: 0, skipped: 0, errors: [] as string[] }
  const { data, error } = await deps.supabase.from('tenants').select(RENEWAL_TENANT_COLUMNS)
    .eq('domain_registrar', 'namecheap').not('domain_expires_at', 'is', null)
    .lte('domain_expires_at', new Date(now.getTime() + CHARGE_DAYS_BEFORE_EXPIRY * DAY).toISOString())
    .gt('domain_expires_at', now.toISOString())
    .is('domain_renewal_invoice_id', null)
  if (error) { out.errors.push('domain renewal query: ' + error.message); return out }
  for (const t of (data || []) as RenewalTenant[]) {
    const action = renewalAction(t, now)
    if (action.act === 'skip') { out.skipped++; continue }
    try {
      const amountCents = renewalPriceCents(t, await deps.renewalCostCents(tldOf(t.domain!)))
      if (!amountCents) throw new Error('could not price the renewal of ' + t.domain + " — Namecheap's renewal price was unavailable, or it is not a TLD we sell")
      if (!t.stripe_customer_id) throw new Error('no Stripe customer to bill')
      const inv = await deps.createInvoice({ customerId: t.stripe_customer_id, amountCents, domain: t.domain!, tenantId: t.id, expiresAt: t.domain_expires_at! })
      const { error: upErr } = await deps.supabase.from('tenants').update({ domain_renewal_invoice_id: inv.invoiceId }).eq('id', t.id)
      if (upErr) out.errors.push(`domain renewal ${t.id}: invoice ${inv.invoiceId} created but not recorded — ${upErr.message}`)
      out.billed++
      if (inv.paid) out.paid++
      else {
        out.awaitingPayment++
        await deps.notifyPaymentNeeded(t, { amountCents, hostedUrl: inv.hostedUrl, expiresAt: t.domain_expires_at! }).catch(() => {})
      }
    } catch (e: any) {
      // Recorded on the row so tomorrow's run does not try again (and email again) — staff resolve it.
      await deps.supabase.from('tenants').update({ domain_renewal_error: String(e.message || e).slice(0, 300) }).eq('id', t.id)
      await deps.alertStaff('Domain renewal could not be billed: ' + t.domain, String(e.message || e), t.id).catch(() => {})
      out.errors.push(`domain renewal ${t.id}: ${e.message || e}`)
    }
  }
  return out
}

type CompleteDeps = {
  supabase: any
  renew: (domain: string, years: number) => Promise<{ success: boolean; error?: string }>
  alertStaff: (subject: string, detail: string, tenantId: string) => Promise<unknown>
  /**
   * Keep the free WHOIS privacy running to the domain's new expiry. Owner, 10/14: turning privacy's auto-renew on in
   * Namecheap turns the DOMAIN's auto-renew on with it — which a domain we bill must not have. So privacy is renewed
   * here, beside the paid domain renewal. Missing → staff are told, never silently skipped.
   */
  keepPrivacy?: (domain: string, until: Date) => Promise<{ ok: boolean; renewed: boolean; detail: string }>
}

/**
 * Stripe says a renewal invoice is paid: renew the domain, once. The claim is one conditional UPDATE — this invoice is
 * the tenant's outstanding renewal AND nobody has claimed it — so a second delivery of the same event, or two at once,
 * finds nothing to claim and renews nothing.
 */
export async function completePaidDomainRenewal(invoice: any, deps: CompleteDeps): Promise<{ handled: boolean; renewed?: boolean; skipped?: string; error?: string; privacy?: string }> {
  const meta = invoice?.metadata || {}
  if (meta.purpose !== 'domain_renewal' || !meta.tenant_id || !invoice?.id) return { handled: false }
  const { data: claimed, error } = await deps.supabase.from('tenants')
    .update({ domain_renewal_paid_invoice_id: invoice.id })
    .eq('id', meta.tenant_id)
    .eq('domain_renewal_invoice_id', invoice.id)
    .is('domain_renewal_paid_invoice_id', null)
    .select('id, domain, domain_expires_at')
  if (error) return { handled: true, error: error.message }
  const row = Array.isArray(claimed) ? claimed[0] : null
  if (!row) return { handled: true, skipped: 'not the outstanding renewal, or already renewed' }

  const result = await deps.renew(row.domain, 1)
  if (!result.success) {
    const msg = 'PAID but Namecheap did not renew: ' + (result.error || 'unknown')
    await deps.supabase.from('tenants').update({ domain_renewal_error: msg.slice(0, 300) }).eq('id', row.id)
    await deps.alertStaff('Paid domain renewal FAILED at Namecheap: ' + row.domain, msg + ' — invoice ' + invoice.id + '. Renew it by hand, then clear domain_renewal_* on the tenant.', row.id).catch(() => {})
    return { handled: true, renewed: false, error: msg }
  }
  const newExpiry = nextExpiry(row.domain_expires_at)
  await deps.supabase.from('tenants').update({
    domain_expires_at: newExpiry.toISOString(),
    domain_renewal_invoice_id: null, domain_renewal_paid_invoice_id: null, domain_renewal_error: null,
    // next year's 60/30/7-day reminders go out again
    domain_renewal_warned_60d_at: null, domain_renewal_warned_30d_at: null, domain_renewal_warned_7d_at: null,
  }).eq('id', row.id)
  // The domain is renewed and recorded. Privacy follows; if it cannot be kept, staff renew it by hand — the domain
  // renewal itself is never undone over it.
  const privacy = deps.keepPrivacy
    ? await deps.keepPrivacy(row.domain, newExpiry).catch((e: any) => ({ ok: false, renewed: false, detail: e?.message || 'failed' }))
    : { ok: false, renewed: false, detail: 'the privacy step is not wired' }
  if (!privacy.ok) {
    await deps.alertStaff('Domain privacy NOT renewed: ' + row.domain, 'The domain renewed (invoice ' + invoice.id + ') but its free privacy did not: ' + privacy.detail + '. In Namecheap › Domain List › ' + row.domain + ', renew WithheldforPrivacy — and leave the DOMAIN auto-renew OFF.', row.id).catch(() => {})
  }
  return { handled: true, renewed: true, privacy: privacy.detail }
}
