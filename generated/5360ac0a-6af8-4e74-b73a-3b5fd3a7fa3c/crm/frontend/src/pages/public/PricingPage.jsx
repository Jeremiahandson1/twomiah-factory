import React, { useState } from 'react';
import { Check, X, HelpCircle, ArrowRight, Zap, Building, Users, Shield } from 'lucide-react';

// Pricing data (mirrors backend config)
const SAAS_TIERS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    description: 'Everything you need to run a service business',
    price: 49,
    priceAnnual: 39,
    users: { included: 2, max: 2 },
    highlight: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    description: 'Scale your field operations',
    price: 149,
    priceAnnual: 119,
    users: { included: 5, max: 10, additionalPrice: 29 },
    highlight: true,
  },
  business: {
    id: 'business',
    name: 'Business',
    description: 'Run your entire operation',
    price: 299,
    priceAnnual: 239,
    users: { included: 15, max: 25, additionalPrice: 29 },
    highlight: false,
  },
  construction: {
    id: 'construction',
    name: 'Construction',
    description: 'Complete construction management',
    price: 599,
    priceAnnual: 479,
    users: { included: 20, max: 50, additionalPrice: 29 },
    highlight: false,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Unlimited scale, white-glove support',
    price: 199,
    priceAnnual: 159,
    perUser: true,
    users: { min: 10 },
    highlight: false,
  },
};

const SELF_HOSTED = {
  starter: { name: 'Starter License', price: 997 },
  pro: { name: 'Pro License', price: 2497 },
  business: { name: 'Business License', price: 4997 },
  construction: { name: 'Construction License', price: 9997 },
  full: { name: 'Full Platform', price: 14997 },
};

const FEATURES = {
  core: {
    name: 'Core Features',
    items: [
      { name: 'Contacts / CRM', starter: true, pro: true, business: true, construction: true },
      { name: 'Jobs / Work Orders', starter: true, pro: true, business: true, construction: true },
      { name: 'Quotes & Estimates', starter: true, pro: true, business: true, construction: true },
      { name: 'Invoicing', starter: true, pro: true, business: true, construction: true },
      { name: 'Payment Processing', starter: true, pro: true, business: true, construction: true },
      { name: 'Time Tracking', starter: true, pro: true, business: true, construction: true },
      { name: 'Expense Tracking', starter: true, pro: true, business: true, construction: true },
      { name: 'Documents', starter: true, pro: true, business: true, construction: true },
      { name: 'Customer Portal', starter: true, pro: true, business: true, construction: true },
      { name: 'Mobile App', starter: true, pro: true, business: true, construction: true },
    ],
  },
  field: {
    name: 'Field Operations',
    items: [
      { name: 'Team Management', starter: false, pro: true, business: true, construction: true },
      { name: 'Two-Way SMS', starter: false, pro: true, business: true, construction: true },
      { name: 'GPS Tracking', starter: false, pro: true, business: true, construction: true },
      { name: 'Geofencing & Auto Clock', starter: false, pro: true, business: true, construction: true },
      { name: 'Route Optimization', starter: false, pro: true, business: true, construction: true },
      { name: 'Online Booking', starter: false, pro: true, business: true, construction: true },
      { name: 'Review Requests', starter: false, pro: true, business: true, construction: true },
      { name: 'Service Agreements', starter: false, pro: true, business: true, construction: true },
      { name: 'Pricebook / Flat Rate', starter: false, pro: true, business: true, construction: true },
      { name: 'QuickBooks Sync', starter: false, pro: true, business: true, construction: true },
      { name: 'Recurring Jobs', starter: false, pro: true, business: true, construction: true },
      { name: 'Job Costing Reports', starter: false, pro: true, business: true, construction: true },
    ],
  },
  operations: {
    name: 'Operations',
    items: [
      { name: 'Inventory Management', starter: false, pro: false, business: true, construction: true },
      { name: 'Purchase Orders', starter: false, pro: false, business: true, construction: true },
      { name: 'Equipment Tracking', starter: false, pro: false, business: true, construction: true },
      { name: 'Fleet Management', starter: false, pro: false, business: true, construction: true },
      { name: 'Warranties', starter: false, pro: false, business: true, construction: true },
      { name: 'Email Campaigns', starter: false, pro: false, business: true, construction: true },
      { name: 'Call Tracking', starter: false, pro: false, business: true, construction: true },
      { name: 'Automations', starter: false, pro: false, business: true, construction: true },
      { name: 'Custom Forms', starter: false, pro: false, business: true, construction: true },
      { name: 'Consumer Financing', starter: false, pro: false, business: true, construction: true },
    ],
  },
  construction: {
    name: 'Construction Management',
    items: [
      { name: 'Projects & Phases', starter: false, pro: false, business: false, construction: true },
      { name: 'Change Orders', starter: false, pro: false, business: false, construction: true },
      { name: 'RFIs', starter: false, pro: false, business: false, construction: true },
      { name: 'Submittals', starter: false, pro: false, business: false, construction: true },
      { name: 'Daily Logs', starter: false, pro: false, business: false, construction: true },
      { name: 'Punch Lists', starter: false, pro: false, business: false, construction: true },
      { name: 'Inspections', starter: false, pro: false, business: false, construction: true },
      { name: 'Bid Management', starter: false, pro: false, business: false, construction: true },
      { name: 'Gantt Charts', starter: false, pro: false, business: false, construction: true },
      { name: 'Selections Portal', starter: false, pro: false, business: false, construction: true },
      { name: 'Takeoffs', starter: false, pro: false, business: false, construction: true },
      { name: 'Lien Waivers', starter: false, pro: false, business: false, construction: true },
      { name: 'Draw Schedules (AIA)', starter: false, pro: false, business: false, construction: true },
    ],
  },
};

const ADDONS = [
  { name: 'SMS Communication', price: 39, description: 'Two-way texting, templates, scheduling' },
  { name: 'GPS & Field', price: 49, description: 'Tracking, geofencing, route optimization' },
  { name: 'Inventory', price: 49, description: 'Items, locations, transfers, POs' },
  { name: 'Fleet Management', price: 39, description: 'Vehicles, maintenance, fuel logs' },
  { name: 'Marketing Suite', price: 59, description: 'Reviews, campaigns, call tracking' },
  { name: 'Construction PM', price: 149, description: 'Projects, COs, RFIs, punch lists' },
  { name: 'Compliance & Draws', price: 79, description: 'Lien waivers, draw schedules, AIA' },
];

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [pricingModel, setPricingModel] = useState('saas');
  const [showFeatures, setShowFeatures] = useState(false);

  const isAnnual = billingCycle === 'annual';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
                <Building className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold text-gray-900">Twomiah Build</span>
            </div>
            <div className="flex items-center gap-4">
              <a href="/login" className="text-gray-600 hover:text-gray-900">Log In</a>
              <a href="/signup" className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600">
                Start Free Trial
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-white py-16">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Choose the plan that fits your business. No hidden fees. No long-term contracts.
          </p>

          {/* Model Toggle */}
          <div className="flex justify-center mb-8">
            <div className="bg-gray-100 p-1 rounded-lg inline-flex">
              <button
                onClick={() => setPricingModel('saas')}
                className={`px-6 py-2 rounded-md text-sm font-medium transition ${
                  pricingModel === 'saas'
                    ? 'bg-white text-gray-900 shadow'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Monthly Subscription
              </button>
              <button
                onClick={() => setPricingModel('selfhosted')}
                className={`px-6 py-2 rounded-md text-sm font-medium transition ${
                  pricingModel === 'selfhosted'
                    ? 'bg-white text-gray-900 shadow'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Self-Hosted License
              </button>
            </div>
          </div>

          {/* Billing Toggle (SaaS only) */}
          {pricingModel === 'saas' && (
            <div className="flex justify-center items-center gap-4 mb-8">
              <span className={billingCycle === 'monthly' ? 'text-gray-900 font-medium' : 'text-gray-500'}>
                Monthly
              </span>
              <button
                onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
                className={`relative w-14 h-7 rounded-full transition ${
                  isAnnual ? 'bg-orange-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    isAnnual ? 'translate-x-8' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className={billingCycle === 'annual' ? 'text-gray-900 font-medium' : 'text-gray-500'}>
                Annual
              </span>
              {isAnnual && (
                <span className="bg-green-100 text-green-700 text-sm px-2 py-1 rounded-full">
                  Save 20%
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="py-12">
        <div className="max-w-7xl mx-auto px-4">
          {pricingModel === 'saas' ? (
            <SaaSPricing isAnnual={isAnnual} />
          ) : (
            <SelfHostedPricing />
          )}
        </div>
      </section>

      {/* Feature Comparison */}
      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Compare All Features</h2>
            <p className="text-gray-600">See exactly what's included in each plan</p>
          </div>

          <button
            onClick={() => setShowFeatures(!showFeatures)}
            className="w-full mb-8 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2"
          >
            {showFeatures ? 'Hide' : 'Show'} Full Feature Comparison
            <ArrowRight className={`w-4 h-4 transition ${showFeatures ? 'rotate-90' : ''}`} />
          </button>

          {showFeatures && <FeatureComparison />}
        </div>
      </section>

      {/* Add-ons Section */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">À La Carte Add-Ons</h2>
            <p className="text-gray-600">Need just one feature? Add it to any plan.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {ADDONS.map((addon) => (
              <div key={addon.name} className="bg-white rounded-lg border p-6">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-gray-900">{addon.name}</h3>
                  <span className="text-orange-500 font-bold">${addon.price}/mo</span>
                </div>
                <p className="text-gray-600 text-sm">{addon.description}</p>
              </div>
            ))}
          </div>

          <p className="text-center text-gray-500 mt-8">
            Bundle multiple features for additional savings. Individual sub-features also available.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 bg-white">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-gray-900 mb-12 text-center">
            Frequently Asked Questions
          </h2>
          <FAQ />
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-orange-500">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to streamline your business?
          </h2>
          <p className="text-orange-100 mb-8">
            Start your 14-day free trial. No credit card required.
          </p>
          <div className="flex justify-center gap-4">
            <a
              href="/signup"
              className="bg-white text-orange-500 px-8 py-3 rounded-lg font-semibold hover:bg-orange-50"
            >
              Start Free Trial
            </a>
            <a
              href="/demo"
              className="border-2 border-white text-white px-8 py-3 rounded-lg font-semibold hover:bg-orange-600"
            >
              Request Demo
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
                  <Building className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg font-bold text-white">Twomiah Build</span>
              </div>
              <p className="text-sm">
                The complete platform for contractors and service businesses.
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/features" className="hover:text-white">Features</a></li>
                <li><a href="/pricing" className="hover:text-white">Pricing</a></li>
                <li><a href="/industries" className="hover:text-white">Industries</a></li>
                <li><a href="/integrations" className="hover:text-white">Integrations</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/docs" className="hover:text-white">Documentation</a></li>
                <li><a href="/blog" className="hover:text-white">Blog</a></li>
                <li><a href="/support" className="hover:text-white">Support</a></li>
                <li><a href="/api" className="hover:text-white">API</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="/about" className="hover:text-white">About</a></li>
                <li><a href="/contact" className="hover:text-white">Contact</a></li>
                <li><a href="/privacy" className="hover:text-white">Privacy</a></li>
                <li><a href="/terms" className="hover:text-white">Terms</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-12 pt-8 text-sm text-center">
            © {new Date().getFullYear()} Twomiah Build. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

// SaaS Pricing Cards
function SaaSPricing({ isAnnual }) {
  const tiers = ['starter', 'pro', 'business', 'construction', 'enterprise'];

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-6">
      {tiers.map((tierId) => {
        const tier = SAAS_TIERS[tierId];
        const price = isAnnual ? tier.priceAnnual : tier.price;

        return (
          <div
            key={tierId}
            className={`bg-white rounded-xl border-2 p-6 relative ${
              tier.highlight
                ? 'border-orange-500 shadow-lg'
                : 'border-gray-200'
            }`}
          >
            {tier.highlight && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                Most Popular
              </div>
            )}

            <h3 className="text-xl font-bold text-gray-900 mb-1">{tier.name}</h3>
            <p className="text-gray-500 text-sm mb-4 h-10">{tier.description}</p>

            <div className="mb-4">
              <span className="text-4xl font-bold text-gray-900">${price}</span>
              <span className="text-gray-500">
                {tier.perUser ? '/user' : ''}/mo
              </span>
              {isAnnual && !tier.perUser && (
                <div className="text-green-600 text-sm">
                  Save ${(tier.price - tier.priceAnnual) * 12}/year
                </div>
              )}
            </div>

            <div className="text-sm text-gray-600 mb-6">
              {tier.perUser ? (
                <span>Minimum {tier.users.min} users</span>
              ) : (
                <span>
                  {tier.users.included} users included
                  {tier.users.additionalPrice && (
                    <span className="block">+${tier.users.additionalPrice}/user after</span>
                  )}
                </span>
              )}
            </div>

            <a
              href={tierId === 'enterprise' ? '/contact' : '/signup?plan=' + tierId}
              className={`block w-full text-center py-3 rounded-lg font-semibold ${
                tier.highlight
                  ? 'bg-orange-500 text-white hover:bg-orange-600'
                  : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
              }`}
            >
              {tierId === 'enterprise' ? 'Contact Sales' : 'Start Free Trial'}
            </a>

            <ul className="mt-6 space-y-2">
              {getTierHighlights(tierId).map((feature, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-600">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// Self-Hosted Pricing Cards
function SelfHostedPricing() {
  const packages = Object.entries(SELF_HOSTED);

  return (
    <div>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8 max-w-3xl mx-auto">
        <div className="flex gap-3">
          <Shield className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-blue-900">Own Your Software</h4>
            <p className="text-blue-700 text-sm">
              One-time purchase. Full source code. Deploy on your servers. No monthly fees.
            </p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-6">
        {packages.map(([id, pkg]) => (
          <div key={id} className="bg-white rounded-xl border-2 border-gray-200 p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-1">{pkg.name}</h3>

            <div className="my-4">
              <span className="text-4xl font-bold text-gray-900">
                ${pkg.price.toLocaleString()}
              </span>
              <span className="text-gray-500 block text-sm">one-time</span>
            </div>

            <a
              href={'/purchase?license=' + id}
              className="block w-full text-center py-3 rounded-lg font-semibold bg-gray-100 text-gray-900 hover:bg-gray-200"
            >
              Buy License
            </a>

            <ul className="mt-6 space-y-2">
              {getSelfHostedIncludes(id).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-600">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-12 grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
        <div className="bg-white rounded-lg border p-6 text-center">
          <h4 className="font-semibold text-gray-900 mb-2">Installation Service</h4>
          <p className="text-2xl font-bold text-gray-900 mb-2">$500</p>
          <p className="text-gray-500 text-sm">We deploy it on your server</p>
        </div>
        <div className="bg-white rounded-lg border p-6 text-center">
          <h4 className="font-semibold text-gray-900 mb-2">Update Subscription</h4>
          <p className="text-2xl font-bold text-gray-900 mb-2">$999/year</p>
          <p className="text-gray-500 text-sm">Get all new features & fixes</p>
        </div>
        <div className="bg-white rounded-lg border p-6 text-center">
          <h4 className="font-semibold text-gray-900 mb-2">Support Contract</h4>
          <p className="text-2xl font-bold text-gray-900 mb-2">$199/month</p>
          <p className="text-gray-500 text-sm">Email & phone support</p>
        </div>
      </div>
    </div>
  );
}

// Feature Comparison Table
function FeatureComparison() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left py-4 px-4 font-semibold text-gray-900">Features</th>
            <th className="text-center py-4 px-2 font-semibold text-gray-900">Starter</th>
            <th className="text-center py-4 px-2 font-semibold text-gray-900 bg-orange-50">Pro</th>
            <th className="text-center py-4 px-2 font-semibold text-gray-900">Business</th>
            <th className="text-center py-4 px-2 font-semibold text-gray-900">Construction</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(FEATURES).map(([categoryKey, category]) => (
            <React.Fragment key={categoryKey}>
              <tr className="bg-gray-50">
                <td colSpan={5} className="py-3 px-4 font-semibold text-gray-700">
                  {category.name}
                </td>
              </tr>
              {category.items.map((feature, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-3 px-4 text-gray-600">{feature.name}</td>
                  <td className="text-center py-3 px-2">
                    {feature.starter ? (
                      <Check className="w-5 h-5 text-green-500 mx-auto" />
                    ) : (
                      <X className="w-5 h-5 text-gray-300 mx-auto" />
                    )}
                  </td>
                  <td className="text-center py-3 px-2 bg-orange-50">
                    {feature.pro ? (
                      <Check className="w-5 h-5 text-green-500 mx-auto" />
                    ) : (
                      <X className="w-5 h-5 text-gray-300 mx-auto" />
                    )}
                  </td>
                  <td className="text-center py-3 px-2">
                    {feature.business ? (
                      <Check className="w-5 h-5 text-green-500 mx-auto" />
                    ) : (
                      <X className="w-5 h-5 text-gray-300 mx-auto" />
                    )}
                  </td>
                  <td className="text-center py-3 px-2">
                    {feature.construction ? (
                      <Check className="w-5 h-5 text-green-500 mx-auto" />
                    ) : (
                      <X className="w-5 h-5 text-gray-300 mx-auto" />
                    )}
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// FAQ Component
function FAQ() {
  const faqs = [
    {
      q: 'Is there a free trial?',
      a: 'Yes! All plans include a 14-day free trial with full access to all features. No credit card required to start.',
    },
    {
      q: 'Can I change plans later?',
      a: 'Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect immediately, and we\'ll prorate any differences.',
    },
    {
      q: 'What payment methods do you accept?',
      a: 'We accept all major credit cards (Visa, Mastercard, American Express) and ACH bank transfers for annual plans.',
    },
    {
      q: 'Is there a contract or commitment?',
      a: 'No long-term contracts. Monthly plans can be canceled anytime. Annual plans are paid upfront for the year.',
    },
    {
      q: 'What\'s included in the self-hosted license?',
      a: 'You get the complete source code, database schema, deployment documentation, and 90 days of email support. You deploy and run it on your own servers.',
    },
    {
      q: 'Can I add features without upgrading?',
      a: 'Yes! You can add individual feature bundles à la carte to any plan. This is great if you only need one or two features from a higher tier.',
    },
    {
      q: 'Do you offer discounts for non-profits or startups?',
      a: 'Yes, we offer special pricing for registered non-profits and early-stage startups. Contact us to learn more.',
    },
    {
      q: 'How does user pricing work?',
      a: 'Each plan includes a set number of users. If you need more, you can add them for $29/user/month. Enterprise plans are priced per-user from the start.',
    },
  ];

  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="space-y-4">
      {faqs.map((faq, i) => (
        <div key={i} className="border rounded-lg">
          <button
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            className="w-full flex justify-between items-center p-4 text-left"
          >
            <span className="font-medium text-gray-900">{faq.q}</span>
            <ArrowRight
              className={`w-5 h-5 text-gray-400 transition ${
                openIndex === i ? 'rotate-90' : ''
              }`}
            />
          </button>
          {openIndex === i && (
            <div className="px-4 pb-4 text-gray-600">{faq.a}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Helper: Get tier highlights for cards
function getTierHighlights(tierId) {
  const highlights = {
    starter: [
      'CRM & Contact Management',
      'Quotes & Invoicing',
      'Payment Processing',
      'Time & Expense Tracking',
      'Customer Portal',
      'Mobile App',
    ],
    pro: [
      'Everything in Starter',
      'Two-Way SMS',
      'GPS & Geofencing',
      'Route Optimization',
      'Online Booking',
      'QuickBooks Sync',
      'Job Costing Reports',
    ],
    business: [
      'Everything in Pro',
      'Inventory Management',
      'Fleet Management',
      'Equipment Tracking',
      'Email Campaigns',
      'Automations',
      'Consumer Financing',
    ],
    construction: [
      'Everything in Business',
      'Project Management',
      'Change Orders',
      'RFIs & Submittals',
      'Gantt Charts',
      'Lien Waivers',
      'Draw Schedules (AIA)',
    ],
    enterprise: [
      'Everything Included',
      'Unlimited Users',
      'API Access',
      'White-Label Options',
      'Custom Domain',
      'SSO Integration',
      'Priority Support',
      'Dedicated Account Manager',
    ],
  };
  return highlights[tierId] || [];
}

// Helper: Get self-hosted includes
function getSelfHostedIncludes(packageId) {
  const includes = {
    starter: [
      'Full source code',
      'Core CRM features',
      'Deployment docs',
      '90 days email support',
    ],
    pro: [
      'Full source code',
      'All field service features',
      'Docker configuration',
      '90 days email support',
    ],
    business: [
      'Full source code',
      'All operations features',
      'CI/CD templates',
      '90 days email support',
    ],
    construction: [
      'Full source code',
      'All construction features',
      '1 hour setup call',
      '90 days email support',
    ],
    full: [
      'Complete source code',
      'Every feature included',
      'Multi-tenant support',
      'White-label ready',
      '2 hour setup call',
    ],
  };
  return includes[packageId] || [];
}
