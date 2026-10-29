// The real dependencies of the Web presence service: the Factory's database, Netlify with the Factory's token, the Factory's mail
// and alerts. The token and team come from the Factory's environment (NETLIFY_AUTH_TOKEN / NETLIFY_TEAM) and go nowhere else —
// never into code, never into a customer site's settings.
import { supabase } from '../middleware/auth'
import { Netlify } from './netlify'
import { raiseAlert } from '../services/alerts'
import { sendEmail } from '../services/email'
import factoryStripe, { endSubscriptionAtPeriodEnd } from '../services/factoryStripe'
import { allocateSlug, signupSlugCandidates, liveSlugLookups } from '../services/resourceOwnership'
import type { Deps } from './service'
import type { UpgradeDeps } from './upgrade'

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

export function linkEmail(name: string, link: string, why: 'welcome' | 'request'): { subject: string; html: string } {
  const lead = why === 'welcome' ? `Your one-page website for ${esc(name)} is live. Use the button below to sign in and make it yours.` : `Here is a new sign-in link for the website of ${esc(name)}.`
  return {
    subject: why === 'welcome' ? 'Your website is live — sign in to edit it' : 'Your sign-in link',
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#14181f"><p>${lead}</p>` +
      `<p><a href="${esc(link)}" style="display:inline-block;padding:12px 20px;background:#1f4e79;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Sign in to edit your page</a></p>` +
      `<p style="color:#4a5565;font-size:14px">The link works once and expires in 15 minutes. If it has expired, open your page's editor and ask for a new one. If you did not ask for this, you can ignore it.</p></div>`,
  }
}

export function liveDeps(): Deps {
  return {
    db: supabase,
    netlify: () => new Netlify({ token: process.env.NETLIFY_AUTH_TOKEN || '', team: process.env.NETLIFY_TEAM || '' }),
    env: process.env,
    now: () => Date.now(),
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    sendLink: async (to, name, link, why) => {
      const m = linkEmail(name, link, why)
      const ok = await sendEmail(to, m.subject, m.html)
      if (!ok) throw new Error('The sign-in email could not be sent')
    },
    alert: async (key, what, detail, tenantId) => { await raiseAlert({ key, what, detail, tenantId }) },
    endSubscriptionAtPeriodEnd,
    cancelSubscriptionNow: async (id) => { await factoryStripe.cancelSubscription(id) },
  }
}

export function liveUpgradeDeps(): UpgradeDeps {
  return {
    ...liveDeps(),
    allocateSlug: async (base) => (await allocateSlug(signupSlugCandidates(base), liveSlugLookups(supabase))).slug,
    checkout: async (t, o) => {
      const co = await factoryStripe.createSubscriptionCheckout({ id: t.id, email: t.email, name: t.name, phone: t.phone, stripeCustomerId: t.stripe_customer_id }, { planId: o.planId, billingCycle: 'monthly', successUrl: o.successUrl, cancelUrl: o.cancelUrl })
      return { url: co.url || null, stripeCustomerId: co.stripeCustomerId }
    },
  }
}
