import { useState, useEffect } from 'react';
import {
  Check, X, Zap, Building2, Wrench, Crown, Globe, Sparkles, Shield,
  CreditCard, Calendar, Users, HelpCircle,
  ChevronDown, ChevronUp, Loader2
} from 'lucide-react';
import api from '../../services/api';
import { LucideIcon } from 'lucide-react';

// Backend serves these from config/pricing.ts via /api/billing/pricing.
// All four verticals use the same shape — only displayName / heroFeatures
// differ per vertical, so this component renders correctly for each.
interface PlanData {
  monthly: number;
  annual: number;
  bundledWebsite: string | null;
  displayName: string;
  description: string;
  heroFeatures: string[];
  users: { included?: number; max?: number | null; min?: number; additionalPrice?: number | null };
}

interface WebsiteTierData {
  monthly: number;
  annual: number;
  name: string;
  tagline: string;
  description: string;
  features: string[];
}

interface PricingData {
  plans?: Record<string, PlanData>;
  websiteTiers?: Record<string, WebsiteTierData>;
  trialDays?: number;
  moneyBackGuaranteeDays?: number;
  // Legacy fields for backwards compatibility with older /pricing responses
  packages?: Record<string, any>;
  features?: Record<string, { name?: string }>;
}

interface PricingCardProps {
  name: string;
  description: string;
  icon: LucideIcon;
  price: number;
  billingCycle: string;
  yearlyTotal?: number;
  users?: number;
  features: string[];
  cta: string;
  popular?: boolean;
  dark?: boolean;
  bundledWebsiteName?: string | null;
  perUser?: boolean;
}

interface AddonCardProps {
  name: string;
  description: string;
  monthlyPrice?: number;
  oneTimePrice?: number;
  oneTimeOnly?: boolean;
}

interface FeatureComparisonProps {
  plans: Record<string, PlanData>;
  orderedPlanIds: string[];
}

interface FAQProps {
  question: string;
  answer: string;
}

/**
 * Pricing Page
 *
 * Shows all pricing options:
 * - Package comparison
 * - Monthly vs yearly toggle
 * - One-time purchase option
 * - Feature breakdown
 */
export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<string>('monthly');
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandedFeatures, setExpandedFeatures] = useState<boolean>(false);

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async () => {
    try {
      const data = await api.get('/api/billing/pricing');
      setPricing(data);
    } catch (error) {
      console.error('Failed to load pricing:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  const packages = pricing?.packages || {};
  const features = pricing?.features || {};
  const plans = pricing?.plans || {};
  const websiteTiers = pricing?.websiteTiers || {};
  const trialDays = pricing?.trialDays || 30;
  const moneyBackDays = pricing?.moneyBackGuaranteeDays || 60;

  // Order plans by hierarchy. Top-tier key varies per vertical (construction
  // for Build, fleet for Wrench, agency for Care, storm for Roof) — we accept
  // any of those.
  const tierOrder = ['starter', 'pro', 'business', 'construction', 'fleet', 'agency', 'storm', 'enterprise'];
  const orderedPlanIds = tierOrder.filter((id) => plans[id]);

  // Order website tiers by depth.
  const websiteOrder: Array<'presence' | 'showcase' | 'book_jobs'> = ['presence', 'showcase', 'book_jobs'];
  const orderedWebsiteIds = websiteOrder.filter((id) => websiteTiers[id]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Built for your trade — not retrofitted from a generic CRM.
            Choose the plan that fits where you are today.
          </p>

          {/* Trust signals */}
          <div className="mt-6 flex items-center justify-center gap-6 text-sm text-gray-600">
            <div className="flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-green-600" />
              <span>{trialDays}-day free trial</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-green-600" />
              <span>{moneyBackDays}-day money-back guarantee</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-green-600" />
              <span>Cancel anytime</span>
            </div>
          </div>

          {/* Billing Toggle */}
          <div className="mt-8 inline-flex items-center bg-gray-100 rounded-full p-1">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-white text-gray-900 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('yearly')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingCycle === 'yearly'
                  ? 'bg-white text-gray-900 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Yearly
              <span className="ml-2 text-green-600 text-xs font-bold">2 months free</span>
            </button>
          </div>
        </div>
      </div>

      {/* Standalone Website Tiers — for customers who just need a site */}
      {orderedWebsiteIds.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 pt-12">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2">
              <Globe className="w-6 h-6 text-orange-500" />
              Just need a website?
            </h2>
            <p className="text-gray-600 mt-2">
              Start with a site today. Add the CRM whenever you're ready.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {orderedWebsiteIds.map((id) => {
              const tier = websiteTiers[id];
              const isYearly = billingCycle === 'yearly';
              const monthlyDisplay = isYearly ? Math.round(tier.annual / 12 / 100) : tier.monthly / 100;
              return (
                <div key={id} className={`bg-white rounded-2xl p-6 border-2 ${id === 'showcase' ? 'border-orange-500 shadow-xl' : 'border-gray-200'}`}>
                  {id === 'showcase' && (
                    <div className="inline-block px-3 py-1 bg-orange-100 text-orange-700 text-xs font-bold rounded-full mb-2">
                      MOST POPULAR
                    </div>
                  )}
                  <h3 className="text-xl font-bold text-gray-900">{tier.name}</h3>
                  <p className="text-sm text-gray-500 italic">{tier.tagline}</p>
                  <div className="mt-4 mb-4">
                    <span className="text-3xl font-bold">${monthlyDisplay}</span>
                    <span className="text-gray-500">/mo</span>
                    {isYearly && (
                      <div className="text-xs text-gray-500">${tier.annual / 100} billed annually</div>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mb-4">{tier.description}</p>
                  <button className="w-full py-2 rounded-lg font-medium bg-gray-100 text-gray-900 hover:bg-gray-200">
                    Start Free Trial
                  </button>
                </div>
              );
            })}
          </div>
          <div className="text-center mt-6 text-sm text-gray-500">
            Need a CRM too? Pro and higher plans below include a website at no extra cost.
          </div>
        </div>
      )}

      {/* CRM Pricing Cards — fully data-driven from /api/billing/pricing */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900">CRM Plans</h2>
          <p className="text-gray-600 mt-2">
            Pro and higher include a website at no extra cost.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {orderedPlanIds.map((id) => {
            const plan = plans[id];
            const isYearly = billingCycle === 'yearly';
            const monthlyDisplay = isYearly ? plan.annual / 12 / 100 : plan.monthly / 100;
            const yearlyTotal = plan.annual / 100;
            const isPopular = id === 'pro';
            const isDark = id === 'enterprise';
            const isPerUser = id === 'enterprise';
            const bundledTier = plan.bundledWebsite ? websiteTiers[plan.bundledWebsite] : null;
            // Pick an icon by position in the ladder
            const icon: LucideIcon = id === 'starter' ? Zap : id === 'pro' ? Wrench : id === 'enterprise' ? Crown : Building2;
            return (
              <PricingCard
                key={id}
                name={plan.displayName}
                description={plan.description}
                icon={icon}
                price={monthlyDisplay}
                billingCycle={billingCycle}
                yearlyTotal={yearlyTotal}
                users={plan.users?.included}
                features={plan.heroFeatures}
                bundledWebsiteName={bundledTier?.name}
                perUser={isPerUser}
                popular={isPopular}
                dark={isDark}
                cta={isDark ? 'Contact Sales' : 'Start Free Trial'}
              />
            );
          })}
        </div>

        {/* One-Time Purchase Option */}
        <div className="mt-12 bg-gradient-to-r from-orange-500 to-orange-600 rounded-2xl p-8 text-white">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold mb-2">Prefer a One-Time Purchase?</h3>
              <p className="text-orange-100">
                Own {'{{COMPANY_NAME}}'} forever with our lifetime license. No monthly fees, self-hosted option available.
              </p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold">${packages.lifetime?.oneTimePrice?.toLocaleString()}</div>
              <div className="text-orange-100">one-time payment</div>
              <button className="mt-4 px-6 py-2 bg-white text-orange-600 rounded-lg font-medium hover:bg-orange-50">
                Learn More
              </button>
            </div>
          </div>
        </div>

        {/* Feature Comparison */}
        <div className="mt-16">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Compare All Features</h2>
            <button
              onClick={() => setExpandedFeatures(!expandedFeatures)}
              className="mt-2 text-orange-600 hover:text-orange-700 flex items-center gap-1 mx-auto"
            >
              {expandedFeatures ? 'Hide' : 'Show'} full comparison
              {expandedFeatures ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {expandedFeatures && (
            <FeatureComparison plans={plans} orderedPlanIds={orderedPlanIds} />
          )}
        </div>

        {/* Add-ons */}
        <div className="mt-16">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">Add-Ons</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <AddonCard
              name="White Label"
              description="Remove {{COMPANY_NAME}} branding, use your own"
              monthlyPrice={99}
              oneTimePrice={990}
            />
            <AddonCard
              name="API Access"
              description="Full API for custom integrations"
              monthlyPrice={49}
              oneTimePrice={490}
            />
            <AddonCard
              name="Data Migration"
              description="We migrate your data from existing system"
              oneTimePrice={999}
              oneTimeOnly
            />
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-16 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-gray-900 text-center mb-8">
            Frequently Asked Questions
          </h2>
          <div className="space-y-4">
            <FAQ
              question="Can I switch plans later?"
              answer="Yes! You can upgrade or downgrade your plan at any time. When upgrading, you'll be prorated for the remaining time. When downgrading, the change takes effect at your next billing cycle."
            />
            <FAQ
              question="What's included in the free trial?"
              answer="The 30-day free trial includes full access to all features in your selected plan. No credit card required to start."
            />
            <FAQ
              question="What's the difference between monthly and one-time?"
              answer="Monthly subscription includes hosting, updates, and support. One-time purchase is a lifetime license - you can self-host or use our hosting for a small fee. Updates are included for 1 year, then optional."
            />
            <FAQ
              question="Do you offer discounts for annual billing?"
              answer="Yes! Annual billing saves you about 17% compared to monthly billing. That's 2 months free."
            />
            <FAQ
              question="What payment methods do you accept?"
              answer="We accept all major credit cards (Visa, Mastercard, Amex), ACH bank transfers, and wire transfers for enterprise accounts."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingCard({
  name, description, icon: Icon, price, billingCycle, yearlyTotal,
  users, features, cta, popular, dark, bundledWebsiteName, perUser
}: PricingCardProps) {
  return (
    <div className={`relative rounded-2xl p-6 ${
      dark
        ? 'bg-gray-900 text-white'
        : popular
          ? 'bg-white border-2 border-orange-500 shadow-xl'
          : 'bg-white border shadow-sm'
    }`}>
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-orange-500 text-white text-xs font-bold rounded-full">
          MOST POPULAR
        </div>
      )}

      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
        dark ? 'bg-gray-800' : 'bg-orange-100'
      }`}>
        <Icon className={`w-6 h-6 ${dark ? 'text-orange-400' : 'text-orange-600'}`} />
      </div>

      <h3 className="text-xl font-bold">{name}</h3>
      <p className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{description}</p>

      <div className="mt-4 mb-3">
        <span className="text-4xl font-bold">${Math.round(price)}</span>
        <span className={dark ? 'text-gray-400' : 'text-gray-500'}>{perUser ? '/user/mo' : '/mo'}</span>
        {billingCycle === 'yearly' && (
          <div className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
            ${yearlyTotal} billed annually {!perUser && '(2 months free)'}
          </div>
        )}
      </div>

      {/* Bundled website badge */}
      {bundledWebsiteName && (
        <div className={`mb-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
          dark ? 'bg-orange-900/40 text-orange-300' : 'bg-orange-100 text-orange-700'
        }`}>
          <Sparkles className="w-3 h-3" />
          {bundledWebsiteName} website included
        </div>
      )}

      <div className={`flex items-center gap-2 text-sm mb-6 ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
        <Users className="w-4 h-4" />
        {perUser ? `Min ${users || 10} users` : `${users || 1} users included`}
      </div>

      <ul className="space-y-3 mb-6">
        {features.map((feature: string, i: number) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${dark ? 'text-green-400' : 'text-green-600'}`} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button className={`w-full py-3 rounded-lg font-medium transition-all ${
        dark
          ? 'bg-orange-500 text-white hover:bg-orange-600'
          : popular
            ? 'bg-orange-500 text-white hover:bg-orange-600'
            : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
      }`}>
        {cta}
      </button>
    </div>
  );
}

function AddonCard({ name, description, monthlyPrice, oneTimePrice, oneTimeOnly }: AddonCardProps) {
  return (
    <div className="bg-white rounded-xl border p-6">
      <h4 className="font-bold text-gray-900">{name}</h4>
      <p className="text-sm text-gray-500 mt-1">{description}</p>
      <div className="mt-4">
        {monthlyPrice && (
          <div className="text-lg font-bold text-gray-900">
            ${monthlyPrice}<span className="text-sm font-normal text-gray-500">/mo</span>
          </div>
        )}
        {oneTimePrice && (
          <div className={`text-sm ${oneTimeOnly ? 'text-lg font-bold text-gray-900' : 'text-gray-500'}`}>
            {!oneTimeOnly && 'or '}${oneTimePrice} one-time
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureComparison({ plans, orderedPlanIds }: FeatureComparisonProps) {
  // Aggregate every unique hero feature across all plans, then for each one
  // show a checkmark in the columns where that plan includes it. Fully
  // data-driven so this works correctly for every vertical's tier names
  // (Build/Wrench/Care/Roof) without hardcoded category lists.
  const allFeatures = new Set<string>();
  for (const id of orderedPlanIds) {
    for (const f of plans[id]?.heroFeatures || []) {
      allFeatures.add(f);
    }
  }
  const featureList = Array.from(allFeatures);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left py-4 px-4 font-medium text-gray-500">Feature</th>
            {orderedPlanIds.map((id: string) => (
              <th key={id} className="text-center py-4 px-4 font-bold text-gray-900">
                {plans[id]?.displayName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {featureList.map((feature: string) => (
            <tr key={feature} className="border-b">
              <td className="py-3 px-4 text-gray-600">{feature}</td>
              {orderedPlanIds.map((id: string) => (
                <td key={id} className="text-center py-3 px-4">
                  {plans[id]?.heroFeatures?.includes(feature) ? (
                    <Check className="w-5 h-5 text-green-600 mx-auto" />
                  ) : (
                    <X className="w-5 h-5 text-gray-300 mx-auto" />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FAQ({ question, answer }: FAQProps) {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <span className="font-medium text-gray-900">{question}</span>
        {open ? (
          <ChevronUp className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 text-gray-600">
          {answer}
        </div>
      )}
    </div>
  );
}
