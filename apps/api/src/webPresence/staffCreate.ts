// Staff setting a $19 Web presence customer up from the Factory — for a customer who should not have to sign up themselves. The SAME
// record as the public signup (signup.ts webPresenceRecord), the SAME site set-up (service.ts provisionSite), the same plan and price.
// What differs is the order and the bill, both the owner's decisions (11/06):
//   - the site is built NOW, not after payment — staff vouch for the customer;
//   - the $19/month is billed by an emailed Stripe INVOICE (factoryStripe.createInvoicedSubscription), not a checkout the customer
//     must open within 24 hours. Paying it is recorded by the webhooks the Factory already handles; an invoice never paid ends the
//     subscription, and an ended subscription takes the site down (billing.ts) — the same end as any $19 customer who stops paying.
// Everything outside is injected so a test makes no live call.
import { requireWebPresence, WEB_PRESENCE_PLAN_ID } from './switch.ts'
import { webPresenceRecord, type SignupDeps, type SignupResult } from './signup.ts'

export interface StaffCreateDeps extends Pick<SignupDeps, 'db' | 'env' | 'allocateSlug' | 'compose' | 'composeAi'> {
  /** Set the Netlify site up and email the owner their sign-in link (service.ts provisionSite). */
  provision: (tenantId: string) => Promise<{ status: string }>
  /** Start the $19 subscription billed by emailed invoice. */
  invoice: (tenant: any) => Promise<{ stripeCustomerId: string; subscriptionId: string; hostedInvoiceUrl: string | null }>
  /** Who did it, for the tenant's audit trail. */
  audit: (tenantId: string, what: string, detail: Record<string, unknown>) => Promise<void>
}

export async function staffCreateWebPresence(body: any, d: StaffCreateDeps, staff: { userId?: string | null }): Promise<SignupResult> {
  requireWebPresence(d.env)
  const built = await webPresenceRecord(body, d, 'staff')
  if (!built.ok) return built.result
  const { data: tenant, error } = await d.db.from('tenants').insert(built.record).select().single()
  if (error || !tenant) return { status: 500, body: { error: 'Could not create the customer: ' + (error?.message || 'no row') } }
  await d.audit(tenant.id, 'web_presence_staff_create', { by: staff.userId || null, plan: WEB_PRESENCE_PLAN_ID }).catch(() => {})
  if (d.composeAi) { try { d.composeAi(tenant.id) } catch { /* the template page is already stored */ } }

  // The bill first: a customer must never have a site and no subscription. If Stripe refuses, nothing is built and staff are told.
  let bill: Awaited<ReturnType<StaffCreateDeps['invoice']>>
  try {
    bill = await d.invoice(tenant)
  } catch (e: any) {
    return { status: 502, body: { error: 'The customer was created, but Stripe did not start their $19 subscription: ' + String(e?.message || e).slice(0, 200) + '. Nothing was built. Fix it and press Retry on their page.', tenantId: tenant.id } }
  }
  await d.db.from('tenants').update({ stripe_customer_id: bill.stripeCustomerId, stripe_subscription_id: bill.subscriptionId }).eq('id', tenant.id)

  let siteStatus = 'failed'
  try { siteStatus = (await d.provision(tenant.id)).status } catch { /* provisionSite alerts staff itself; the page's Retry runs it again */ }
  return {
    status: 200,
    body: {
      success: true, tenantId: tenant.id, slug: tenant.slug, siteStatus, invoiceUrl: bill.hostedInvoiceUrl,
      message: siteStatus === 'live'
        ? 'Created. Their site is live and they have been emailed a sign-in link. Stripe has emailed them the $19 invoice.'
        : 'Created, and Stripe has emailed them the $19 invoice, but the site did not finish setting up. Press Retry on their page.',
    },
  }
}
