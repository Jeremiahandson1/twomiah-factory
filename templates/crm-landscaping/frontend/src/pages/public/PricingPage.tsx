/**
 * Public marketing pricing page for {{COMPANY_NAME}}.
 *
 * Pricing model v2 (seat-tiered, every feature included). This page is
 * intentionally vertical-agnostic — the CRM_TIERS / WEBSITE_PLAN data and the
 * copy are identical across every crm-* template so pricing is the same product
 * everywhere. Keep the numbers in sync with backend/src/config/pricing.ts and
 * with pages/public/SignupPage.tsx (annual = monthly × 10).
 */
import React, { useState } from 'react';
import { Check, ArrowRight, Globe, Shield, Building } from 'lucide-react';

interface Tier {
  id: string;
  name: string;
  seats: string;      // e.g. "Up to 10 seats"
  monthly: number;    // dollars (0 = custom)
  annual: number;     // dollars total per year (0 = custom)
  custom?: boolean;
  blurb: string;
  features: string[];
  popular?: boolean;
  dark?: boolean;
}

// ─────────────────────────────────────────────────────────────
// The website is a single standalone product — no build fee.
// ─────────────────────────────────────────────────────────────
const WEBSITE_PLAN = {
  name: 'Website',
  monthly: 49,
  annual: 490,
  blurb: 'A professional multi-page site with our built-in CMS, blog, online booking and quote forms. Bring your own domain. No build fee, no setup fee.',
};

// ─────────────────────────────────────────────────────────────
// CRM plans — every feature is included in every plan. You choose a plan by
// how many seats (users) you need; the price and the infrastructure scale
// together.
// ─────────────────────────────────────────────────────────────
const CRM_TIERS: Tier[] = [
  {
    id: 'starter',
    name: 'Starter',
    seats: 'Up to 10 seats',
    monthly: 99,
    annual: 990,
    blurb: 'Everything included, for a small crew.',
    features: ['Every feature included — nothing locked', 'Website included', 'Up to 10 users', 'Jobs, scheduling, quotes, invoices & payments', 'Customer portal + mobile app'],
  },
  {
    id: 'team',
    name: 'Team',
    seats: '11–25 seats',
    monthly: 139,
    annual: 1390,
    blurb: 'More seats and a faster infrastructure tier.',
    features: ['Everything in Starter', '11–25 users', 'Larger database + more capacity'],
    popular: true,
  },
  {
    id: 'business',
    name: 'Business',
    seats: '26–50 seats',
    monthly: 199,
    annual: 1990,
    blurb: 'For larger operations.',
    features: ['Everything in Team', '26–50 users', 'Pro infrastructure tier'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    seats: '50+ seats',
    monthly: 0,
    annual: 0,
    custom: true,
    blurb: 'Dedicated infrastructure and white-glove support.',
    features: ['Everything in Business', '50+ users', 'Dedicated infrastructure', 'Priority onboarding & support'],
    dark: true,
  },
];

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const isAnnual = billingCycle === 'annual';

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
            Every feature is included in every plan — nothing is locked behind a tier.
            You only pick a plan by how many people need a login.
          </p>

          {/* Trust signals */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-600">
            <div className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-600" /> 30-day free trial</div>
            <div className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-600" /> Cancel anytime</div>
            <div className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-green-600" /> No setup or build fees</div>
          </div>

          {/* Billing toggle */}
          <div className="mt-8 inline-flex items-center bg-gray-100 rounded-full p-1">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition ${!isAnnual ? 'bg-white text-gray-900 shadow' : 'text-gray-600'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition ${isAnnual ? 'bg-white text-gray-900 shadow' : 'text-gray-600'}`}
            >
              Yearly <span className="ml-2 text-green-600 text-xs font-bold">2 months free</span>
            </button>
          </div>
        </div>
      </div>

      {/* Website plan */}
      <section className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900 inline-flex items-center gap-2">
            <Globe className="w-7 h-7 text-orange-500" />
            Just need a website?
          </h2>
          <p className="text-gray-600 mt-2 text-lg">Start with a site today. Add the CRM whenever you're ready.</p>
        </div>
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl p-8 border-2 border-orange-500 shadow-xl text-center">
            <h3 className="text-2xl font-bold text-gray-900">{WEBSITE_PLAN.name}</h3>
            <div className="mt-4 mb-4">
              <span className="text-4xl font-bold">${isAnnual ? Math.round(WEBSITE_PLAN.annual / 12) : WEBSITE_PLAN.monthly}</span>
              <span className="text-gray-500">/mo</span>
              {isAnnual && <div className="text-xs text-gray-500">${WEBSITE_PLAN.annual} billed annually</div>}
            </div>
            <p className="text-gray-600 mb-6">{WEBSITE_PLAN.blurb}</p>
            <a href="/signup" className="block w-full text-center py-3 rounded-lg font-medium bg-gray-100 text-gray-900 hover:bg-gray-200">
              Start Free Trial
            </a>
          </div>
        </div>
      </section>

      {/* CRM Tiers */}
      <section className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-900">CRM Plans</h2>
          <p className="text-gray-600 mt-2 text-lg">Every plan includes a website and every feature — you only pick by how many seats you need.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {CRM_TIERS.map((tier) => {
            const monthlyDisplay = isAnnual ? Math.round(tier.annual / 12) : tier.monthly;
            return (
              <div
                key={tier.id}
                className={`relative rounded-2xl p-6 ${tier.dark ? 'bg-gray-900 text-white' : tier.popular ? 'bg-white border-2 border-orange-500 shadow-xl' : 'bg-white border shadow-sm'}`}
              >
                {tier.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-orange-500 text-white text-xs font-bold rounded-full">
                    MOST POPULAR
                  </div>
                )}
                <h3 className="text-xl font-bold">{tier.name}</h3>
                <p className={`text-sm ${tier.dark ? 'text-gray-400' : 'text-gray-500'} italic`}>{tier.seats}</p>
                <div className="mt-4 mb-3">
                  {tier.custom ? (
                    <span className="text-3xl font-bold">Custom</span>
                  ) : (
                    <>
                      <span className="text-3xl font-bold">${monthlyDisplay}</span>
                      <span className={tier.dark ? 'text-gray-400' : 'text-gray-500'}>/mo</span>
                      {isAnnual && (
                        <div className={`text-xs ${tier.dark ? 'text-gray-400' : 'text-gray-500'}`}>${tier.annual} billed annually</div>
                      )}
                    </>
                  )}
                </div>
                <div className={`text-sm mb-4 ${tier.dark ? 'text-gray-300' : 'text-gray-600'}`}>{tier.blurb}</div>
                <ul className="space-y-2 mb-6">
                  {tier.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tier.dark ? 'text-green-400' : 'text-green-600'}`} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href="/signup"
                  className={`block w-full text-center py-3 rounded-lg font-medium transition ${tier.dark || tier.popular ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'}`}
                >
                  {tier.custom ? 'Contact Sales' : 'Start Free Trial'}
                </a>
              </div>
            );
          })}
        </div>
        <p className="text-center text-sm text-gray-500 mt-6">
          SMS &amp; AI are available for $10/mo to enable, plus carrier/usage passed through at cost.
        </p>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Frequently Asked Questions</h2>
        <div className="space-y-4">
          <FAQ
            q="Which features do I get on each plan?"
            a="All of them. Every feature is included on every plan and you can turn any of them on or off yourself — nothing is locked behind a higher tier. Plans differ only by how many seats (logins) you need."
          />
          <FAQ
            q="How do the seat tiers work?"
            a="Starter covers up to 10 seats at $99/mo, Team covers 11–25 at $139/mo, and Business covers 26–50 at $199/mo. As you move up you also get a larger database and more capacity. Over 50 seats is Enterprise (dedicated infrastructure, custom pricing)."
          />
          <FAQ
            q="Do I need the CRM to get a website?"
            a="No. The website is a standalone product at $49/mo with no build fee — start with just a site and add the CRM whenever you're ready. Bring your own domain."
          />
          <FAQ
            q="What about texting and AI?"
            a="SMS and AI are opt-in: $10/mo to enable, and carrier/per-message/usage costs are passed through at cost via a usage wallet — no markup."
          />
          <FAQ
            q="What's the difference between monthly and annual billing?"
            a="Annual billing saves you exactly 2 months — pay for 10, get 12. Same plan, lower total cost."
          />
          <FAQ
            q="What if I'm not happy with it?"
            a="We offer a 30-day free trial (no credit card required). Cancel anytime."
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
