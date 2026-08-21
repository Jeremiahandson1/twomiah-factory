/**
 * Public marketing pricing page for {{COMPANY_NAME}}.
 *
 * This is the standalone /pricing page shown to unauthenticated visitors.
 * For per-tenant authenticated pricing (with live API data), see
 * pages/billing/PricingPage.tsx.
 *
 * Data here is hardcoded so the page renders without an API call. Keep the
 * numbers in sync with backend/src/config/pricing.ts — annual = monthly × 10.
 *
 * Per-vertical customization: in each crm-* template's copy of this file,
 * change the WEBSITE_TIERS / SAAS_TIERS arrays and the page copy near the top.
 * The component logic stays identical across all verticals.
 */
import React, { useState } from 'react';
import { Check, ArrowRight, Globe, Sparkles, Shield, Building } from 'lucide-react';

interface WebsiteTier {
  id: string;
  name: string;
  tagline: string;
  description: string;
  monthly: number; // dollars
  annual: number; // dollars total per year
  popular?: boolean;
}

interface SaaSTier {
  id: string;
  name: string;
  tagline: string;
  description: string;
  monthly: number;
  annual: number;
  bundledWebsite: string | null; // website tier id, or null
  heroFeatures: string[];
  users: { included?: number; max?: number | null; min?: number; perUser?: boolean };
  popular?: boolean;
  dark?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Standalone website tiers (Presence / Showcase / Book Jobs)
// ─────────────────────────────────────────────────────────────

const WEBSITE_TIERS: WebsiteTier[] = [
  {
    id: 'presence',
    name: 'Presence',
    tagline: 'Get found online',
    description: 'One-page lead capture site with CMS — your phone number, services, and a form.',
    monthly: 19,
    annual: 190,
  },
  {
    id: 'showcase',
    name: 'Showcase',
    tagline: 'Show off your work',
    description: 'Full multi-page site with CMS, blog, and SEO basics.',
    monthly: 49,
    annual: 490,
    popular: true,
  },
  {
    id: 'book_jobs',
    name: 'Book Jobs',
    tagline: 'Turn visitors into booked jobs',
    description: 'Full site + online booking + quote forms.',
    monthly: 99,
    annual: 990,
  },
];

// ─────────────────────────────────────────────────────────────
// CRM tiers
// ─────────────────────────────────────────────────────────────

const SAAS_TIERS: SaaSTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'CRM only — pair with any website tier',
    description: 'Everything you need to run a contracting business',
    monthly: 49,
    annual: 490,
    bundledWebsite: null,
    heroFeatures: ['Contacts & jobs', 'Scheduling & dispatch', 'Quotes & invoices', 'Payments', 'Customer portal'],
    users: { included: 2, max: 2 },
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'CRM + Showcase website',
    description: 'Scale your crew — website included',
    monthly: 149,
    annual: 1490,
    bundledWebsite: 'showcase',
    heroFeatures: ['Team management', 'Job costing & pricebook', 'QuickBooks sync', 'Recurring jobs', 'Showcase website included'],
    users: { included: 5, max: 10 },
    popular: true,
  },
  {
    id: 'business',
    name: 'Business',
    tagline: 'CRM + Book Jobs website',
    description: 'Run your entire operation',
    monthly: 299,
    annual: 2990,
    bundledWebsite: 'book_jobs',
    heroFeatures: ['Inventory management', 'Change orders', 'Consumer financing', 'Advanced reporting', 'Book Jobs website included'],
    users: { included: 15, max: 25 },
  },
  {
    id: 'construction',
    name: 'Construction',
    tagline: 'Full construction platform + portfolio website',
    description: 'Complete construction management',
    monthly: 599,
    annual: 5990,
    bundledWebsite: 'book_jobs',
    heroFeatures: ['Projects, RFIs & submittals', 'Draw schedules & lien waivers', 'AIA G702/G703 forms', 'Takeoffs & selections', 'Portfolio website with gallery'],
    users: { included: 20, max: 50 },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Everything, unlimited, white-label',
    description: 'Unlimited scale with white-glove support',
    monthly: 199,
    annual: 1990,
    bundledWebsite: 'book_jobs',
    heroFeatures: ['Unlimited everything', 'White-label + custom domain', 'SSO', 'API access', 'Dedicated account manager'],
    users: { min: 10, perUser: true },
    dark: true,
  },
];

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const isAnnual = billingCycle === 'annual';

  const websiteTierMap: Record<string, WebsiteTier> = Object.fromEntries(WEBSITE_TIERS.map((t) => [t.id, t]));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
              <Building className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-gray-900">{'{{COMPANY_NAME}}'}</span>
          </a>
          <div className="flex items-center gap-4">
            <a href="/login" className="text-gray-600 hover:text-gray-900">Log In</a>
            <a href="/signup" className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 inline-flex items-center gap-2">
              Start Free Trial <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="bg-white">
        <div className="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">Simple, Honest Pricing</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Built for your trade — not retrofitted from a generic CRM.
            Start with just a website, add the CRM whenever you're ready.
          </p>

          {/* Trust signals */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-600">
            <div className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-600" /> 30-day free trial</div>
            <div className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-600" /> 60-day money-back guarantee</div>
            <div className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-600" /> Cancel anytime</div>
            <div className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-600" /> No setup fees</div>
          </div>

          {/* Billing toggle */}
          <div className="mt-8 inline-flex items-center bg-gray-100 rounded-full p-1">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition ${
                !isAnnual ? 'bg-white text-gray-900 shadow' : 'text-gray-600'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition ${
                isAnnual ? 'bg-white text-gray-900 shadow' : 'text-gray-600'
              }`}
            >
              Yearly <span className="ml-2 text-green-600 text-xs font-bold">2 months free</span>
            </button>
          </div>
        </div>
      </div>

      {/* Website Tiers */}
      <section className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900 inline-flex items-center gap-2">
            <Globe className="w-7 h-7 text-orange-500" />
            Just need a website?
          </h2>
          <p className="text-gray-600 mt-2 text-lg">Start with a site today. Add the CRM whenever you're ready.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {WEBSITE_TIERS.map((tier) => {
            const monthlyDisplay = isAnnual ? Math.round(tier.annual / 12) : tier.monthly;
            return (
              <div key={tier.id} className={`bg-white rounded-2xl p-8 border-2 ${tier.popular ? 'border-orange-500 shadow-xl' : 'border-gray-200'}`}>
                {tier.popular && (
                  <div className="inline-block px-3 py-1 bg-orange-100 text-orange-700 text-xs font-bold rounded-full mb-3">MOST POPULAR</div>
                )}
                <h3 className="text-2xl font-bold text-gray-900">{tier.name}</h3>
                <p className="text-sm text-gray-500 italic mt-1">{tier.tagline}</p>
                <div className="mt-4 mb-4">
                  <span className="text-4xl font-bold">${monthlyDisplay}</span>
                  <span className="text-gray-500">/mo</span>
                  {isAnnual && <div className="text-xs text-gray-500">${tier.annual} billed annually</div>}
                </div>
                <p className="text-gray-600 mb-6">{tier.description}</p>
                <a href="/signup" className="block w-full text-center py-3 rounded-lg font-medium bg-gray-100 text-gray-900 hover:bg-gray-200">
                  Start Free Trial
                </a>
              </div>
            );
          })}
        </div>
        <p className="text-center text-sm text-gray-500 mt-6">
          Bring your own domain. Every tier includes our CMS so you can edit the site yourself.
        </p>
      </section>

      {/* CRM Tiers */}
      <section className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900">CRM Plans</h2>
          <p className="text-gray-600 mt-2 text-lg">Pro and higher include a website at no extra cost.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          {SAAS_TIERS.map((tier) => {
            const monthlyDisplay = isAnnual ? Math.round(tier.annual / 12) : tier.monthly;
            const bundled = tier.bundledWebsite ? websiteTierMap[tier.bundledWebsite] : null;
            return (
              <div
                key={tier.id}
                className={`relative rounded-2xl p-6 ${
                  tier.dark
                    ? 'bg-gray-900 text-white'
                    : tier.popular
                      ? 'bg-white border-2 border-orange-500 shadow-xl'
                      : 'bg-white border shadow-sm'
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-orange-500 text-white text-xs font-bold rounded-full">
                    MOST POPULAR
                  </div>
                )}
                <h3 className="text-xl font-bold">{tier.name}</h3>
                <p className={`text-sm ${tier.dark ? 'text-gray-400' : 'text-gray-500'} italic`}>{tier.tagline}</p>
                <div className="mt-4 mb-3">
                  <span className="text-3xl font-bold">${monthlyDisplay}</span>
                  <span className={tier.dark ? 'text-gray-400' : 'text-gray-500'}>{tier.users.perUser ? '/user/mo' : '/mo'}</span>
                  {isAnnual && (
                    <div className={`text-xs ${tier.dark ? 'text-gray-400' : 'text-gray-500'}`}>
                      ${tier.annual}{tier.users.perUser ? '/user' : ''} billed annually
                    </div>
                  )}
                </div>
                {bundled && (
                  <div className={`mb-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    tier.dark ? 'bg-orange-900/40 text-orange-300' : 'bg-orange-100 text-orange-700'
                  }`}>
                    <Sparkles className="w-3 h-3" />
                    {bundled.name} website included
                  </div>
                )}
                <div className={`text-sm mb-4 ${tier.dark ? 'text-gray-300' : 'text-gray-600'}`}>
                  {tier.users.perUser ? `Min ${tier.users.min} users` : `${tier.users.included} users included`}
                </div>
                <ul className="space-y-2 mb-6">
                  {tier.heroFeatures.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tier.dark ? 'text-green-400' : 'text-green-600'}`} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="/signup"
                  className={`block w-full text-center py-3 rounded-lg font-medium transition ${
                    tier.dark
                      ? 'bg-orange-500 text-white hover:bg-orange-600'
                      : tier.popular
                        ? 'bg-orange-500 text-white hover:bg-orange-600'
                        : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                  }`}
                >
                  {tier.dark ? 'Contact Sales' : 'Start Free Trial'}
                </a>
              </div>
            );
          })}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Frequently Asked Questions</h2>
        <div className="space-y-4">
          <FAQ
            q="Do I need a CRM to get a website?"
            a="No. The website tiers (Presence, Showcase, Book Jobs) are sold standalone. You can start with just a website at $19/mo and add the CRM whenever you're ready."
          />
          <FAQ
            q="What does 'website included' mean on the Pro plan?"
            a="If you subscribe to Pro CRM at $149/mo, you get the Showcase website ($49 value) included at no extra cost. Business tier includes Book Jobs ($99 value). Same applies to higher tiers."
          />
          <FAQ
            q="Can I bring my own domain?"
            a="Yes. Every tier supports custom domains — you bring it, we'll give you DNS instructions to point it at our hosting."
          />
          <FAQ
            q="What's the difference between monthly and annual billing?"
            a="Annual billing saves you exactly 2 months — pay for 10, get 12. Same plan, lower total cost."
          />
          <FAQ
            q="What if I'm not happy with it?"
            a="We offer a 30-day free trial (no credit card required) and a 60-day money-back guarantee on paid plans. Cancel anytime."
          />
          <FAQ
            q="Do you charge per user?"
            a="No, except on Enterprise. Each tier includes a generous user count (Starter 2, Pro 5, Business 15, Construction 20). Additional users on Pro+ are $29/user/mo. Enterprise is $199/user/mo with a 10-user minimum."
          />
        </div>
      </section>

      {/* Footer CTA */}
      <section className="bg-gradient-to-r from-orange-500 to-orange-600 text-white">
        <div className="max-w-4xl mx-auto px-4 py-16 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-xl text-orange-100 mb-8">30-day free trial. No credit card required.</p>
          <a href="/signup" className="inline-flex items-center gap-2 bg-white text-orange-600 px-8 py-4 rounded-lg font-bold text-lg hover:bg-orange-50">
            Start Your Free Trial <ArrowRight className="w-5 h-5" />
          </a>
        </div>
      </section>
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-lg bg-white">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-4 text-left">
        <span className="font-medium text-gray-900">{q}</span>
        <span className="text-gray-400">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-4 pb-4 text-gray-600">{a}</div>}
    </div>
  );
}
