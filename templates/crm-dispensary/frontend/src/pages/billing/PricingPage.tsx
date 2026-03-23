import { useState, useEffect } from 'react';
import {
  Check, X, Leaf, Truck, Building2, Crown,
  CreditCard, Calendar, Users, HelpCircle,
  ChevronDown, ChevronUp, Loader2
} from 'lucide-react';
import api from '../../services/api';

/**
 * Pricing Page — Dispensary Vertical
 *
 * Shows all pricing options:
 * - Package comparison (Starter / Pro / Business / Enterprise)
 * - Monthly vs yearly toggle (20% savings)
 * - One-time purchase option
 * - Feature breakdown
 */
export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [pricing, setPricing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedFeatures, setExpandedFeatures] = useState(false);

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
        <Loader2 className="w-8 h-8 animate-spin text-green-500" />
      </div>
    );
  }

  const packages = pricing?.packages || {};
  const features = pricing?.features || {};

  // Fallback pricing when API data is unavailable
  const starterMonthly = packages.starter?.monthlyPrice ?? 299;
  const starterYearly = packages.starter?.yearlyPrice ?? 2868;
  const proMonthly = packages.pro?.monthlyPrice ?? 499;
  const proYearly = packages.pro?.yearlyPrice ?? 4788;
  const businessMonthly = packages.business?.monthlyPrice ?? 799;
  const businessYearly = packages.business?.yearlyPrice ?? 7668;
  const enterpriseMonthly = packages.enterprise?.monthlyPrice ?? 1299;
  const enterpriseYearly = packages.enterprise?.yearlyPrice ?? 12468;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Everything you need to run your dispensary. No hidden fees, no per-terminal charges.
          </p>

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
              <span className="ml-2 text-green-600 text-xs font-bold">Save 20%</span>
            </button>
          </div>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Starter */}
          <PricingCard
            name="Starter"
            description="Everything you need to open day one"
            icon={Leaf}
            price={billingCycle === 'yearly' ? Math.round(starterYearly / 12) : starterMonthly}
            billingCycle={billingCycle}
            yearlyTotal={starterYearly}
            users={packages.starter?.usersIncluded ?? 5}
            features={[
              'POS system',
              'Inventory management',
              'Cash sessions + reconciliation',
              'ID scanning + verification',
              'Customer check-in queue',
              'Purchase limit enforcement',
              'Product equivalency calculator',
              'Tip management',
              'EOD reconciliation reports',
              'QR code scanning',
              'Offline POS mode',
              'Team management',
              'Compliance basics',
              'Audit trail',
            ]}
            cta="Start Free Trial"
          />

          {/* Pro */}
          <PricingCard
            name="Pro"
            description="Same price as Dutchie with 3x the features"
            icon={Truck}
            price={billingCycle === 'yearly' ? Math.round(proYearly / 12) : proMonthly}
            billingCycle={billingCycle}
            yearlyTotal={proYearly}
            users={packages.pro?.usersIncluded ?? 15}
            popular
            features={[
              'Everything in Starter',
              'Metrc/BioTrack/Leaf Data integration',
              'Delivery + GPS driver tracking',
              'Loyalty program (4 tiers, referrals)',
              'Label printing + QR codes',
              'SMS + email marketing',
              'Analytics dashboard',
              'Employee scheduling + payroll export',
              'Budtender training LMS',
              'Online ordering + website',
              'SEO product pages',
              'Marketplace menu sync',
              'Batch/lot tracking',
              'Grow input tracking',
              'Approval workflows',
              'Purchase orders',
            ]}
            cta="Start Free Trial"
          />

          {/* Business */}
          <PricingCard
            name="Business"
            description="Replaces BLAZE + KayaPush + Alpine IQ"
            icon={Building2}
            price={billingCycle === 'yearly' ? Math.round(businessYearly / 12) : businessMonthly}
            billingCycle={billingCycle}
            yearlyTotal={businessYearly}
            users={packages.business?.usersIncluded ?? 30}
            features={[
              'Everything in Pro',
              'Multi-location (up to 10)',
              'AI budtender (Claude-powered)',
              'Self-service kiosk',
              'RFID inventory scanning',
              'BI dashboard + custom reports',
              'Predictive inventory + auto-reorder',
              'Gamified loyalty (challenges, streaks)',
              'Digital signage',
              'Curbside pickup',
              'Pay by Bank (Plaid ACH)',
              'Apple/Google Wallet passes',
              'Fraud + theft detection',
              'SOC 2 security controls',
              'API access',
            ]}
            cta="Start Free Trial"
          />

          {/* Enterprise */}
          <PricingCard
            name="Enterprise"
            description="One platform for seed-to-sale"
            icon={Crown}
            price={billingCycle === 'yearly' ? Math.round(enterpriseYearly / 12) : enterpriseMonthly}
            billingCycle={billingCycle}
            yearlyTotal={enterpriseYearly}
            users={packages.enterprise?.usersIncluded ?? 100}
            userLabel="100+ users"
            features={[
              'Everything in Business',
              'Cultivation/grow tracking',
              'Manufacturing/processing',
              'Wholesale/distribution',
              'Lab testing + CoA',
              'Franchise management',
              'Open API + marketplace',
              'Dedicated success manager',
              'Unlimited locations',
              'Consumer mobile app',
              'White-label option',
            ]}
            cta="Contact Sales"
            dark
          />
        </div>

        {/* One-Time Purchase Option */}
        <div className="mt-12 bg-gradient-to-r from-green-600 to-green-700 rounded-2xl p-8 text-white">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold mb-2">Prefer a One-Time Purchase?</h3>
              <p className="text-green-100">
                Own {{COMPANY_NAME}} forever with our lifetime license. Self-host on your own infrastructure for full control.
              </p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold">${packages.lifetime?.oneTimePrice?.toLocaleString() ?? '24,999'}</div>
              <div className="text-green-100">one-time payment</div>
              <button className="mt-4 px-6 py-2 bg-white text-green-700 rounded-lg font-medium hover:bg-green-50">
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
              className="mt-2 text-green-600 hover:text-green-700 flex items-center gap-1 mx-auto"
            >
              {expandedFeatures ? 'Hide' : 'Show'} full comparison
              {expandedFeatures ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {expandedFeatures && (
            <FeatureComparison packages={packages} features={features} />
          )}
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
              answer="The 14-day free trial includes full access to all features in your selected plan. No credit card required to start. We'll help you set up your inventory, connect to your state traceability system, and train your team."
            />
            <FAQ
              question="Do you charge per terminal or per register?"
              answer="No. Unlike Dutchie, BLAZE, and other POS providers, we don't charge per terminal. Your plan includes unlimited terminals and registers at each location."
            />
            <FAQ
              question="Which state traceability systems do you integrate with?"
              answer="We integrate with Metrc, BioTrack, and Leaf Data Systems. Our compliance team monitors regulatory changes in all active states and updates integrations automatically."
            />
            <FAQ
              question="How does the annual billing discount work?"
              answer="Annual billing saves you 20% compared to monthly billing. That's over 2 months free. You can switch between monthly and annual at any time."
            />
            <FAQ
              question="Can I migrate from Dutchie, BLAZE, or Treez?"
              answer="Yes. We offer free data migration from all major dispensary POS systems. Our team will handle inventory, customer data, sales history, and loyalty points. Most migrations are completed within 48 hours."
            />
            <FAQ
              question="Is my data compliant and secure?"
              answer="Absolutely. We maintain SOC 2 compliance, encrypt all data at rest and in transit, and provide a complete audit trail for every transaction. Our platform is designed to meet or exceed all state cannabis regulatory requirements."
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
  users, userLabel, features, cta, popular, dark
}) {
  return (
    <div className={`relative rounded-2xl p-6 ${
      dark
        ? 'bg-gray-900 text-white'
        : popular
          ? 'bg-white border-2 border-green-500 shadow-xl'
          : 'bg-white border shadow-sm'
    }`}>
      {popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-green-500 text-white text-xs font-bold rounded-full">
          MOST POPULAR
        </div>
      )}

      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
        dark ? 'bg-gray-800' : 'bg-green-100'
      }`}>
        <Icon className={`w-6 h-6 ${dark ? 'text-green-400' : 'text-green-600'}`} />
      </div>

      <h3 className="text-xl font-bold">{name}</h3>
      <p className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{description}</p>

      <div className="mt-4 mb-6">
        <span className="text-4xl font-bold">${Math.round(price)}</span>
        <span className={dark ? 'text-gray-400' : 'text-gray-500'}>/mo</span>
        {billingCycle === 'yearly' && (
          <div className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
            ${yearlyTotal?.toLocaleString()} billed annually
          </div>
        )}
      </div>

      <div className={`flex items-center gap-2 text-sm mb-6 ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
        <Users className="w-4 h-4" />
        {userLabel || `${users} users included`}
      </div>

      <ul className="space-y-3 mb-6">
        {features.map((feature, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${dark ? 'text-green-400' : 'text-green-600'}`} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <button className={`w-full py-3 rounded-lg font-medium transition-all ${
        dark
          ? 'bg-green-500 text-white hover:bg-green-600'
          : popular
            ? 'bg-green-500 text-white hover:bg-green-600'
            : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
      }`}>
        {cta}
      </button>
    </div>
  );
}

function FeatureComparison({ packages, features }) {
  const packageList = ['starter', 'pro', 'business', 'enterprise'];
  const packageNames = { starter: 'Starter', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' };
  const categories = {
    'POS & Sales': ['pos', 'inventory', 'cash', 'id_scanning', 'checkin', 'kiosk', 'tips', 'offline'],
    'Compliance': ['metrc', 'biotrack', 'leaf_data', 'labels', 'batches', 'equivalency', 'waste'],
    'Marketing': ['loyalty', 'referrals', 'sms', 'email', 'gamified', 'wallet_passes'],
    'Delivery': ['delivery', 'tracking', 'routing', 'curbside'],
    'Analytics': ['analytics', 'reports', 'bi_dashboard', 'budtender_perf', 'predictive', 'website_analytics'],
    'Supply Chain': ['cultivation', 'manufacturing', 'wholesale', 'lab_testing', 'grow_inputs'],
    'Enterprise': ['multi_location', 'franchise', 'open_api', 'marketplace', 'scheduling', 'training', 'fraud', 'soc2'],
  };

  const featureNames: Record<string, string> = {
    pos: 'POS System',
    inventory: 'Inventory Management',
    cash: 'Cash Sessions + Reconciliation',
    id_scanning: 'ID Scanning + Verification',
    checkin: 'Customer Check-in Queue',
    kiosk: 'Self-Service Kiosk',
    tips: 'Tip Management',
    offline: 'Offline POS Mode',
    metrc: 'Metrc Integration',
    biotrack: 'BioTrack Integration',
    leaf_data: 'Leaf Data Integration',
    labels: 'Label Printing + QR Codes',
    batches: 'Batch/Lot Tracking',
    equivalency: 'Product Equivalency Calculator',
    waste: 'Waste Tracking + Disposal',
    loyalty: 'Loyalty Program',
    referrals: 'Referral Program',
    sms: 'SMS Marketing',
    email: 'Email Marketing',
    gamified: 'Gamified Loyalty',
    wallet_passes: 'Apple/Google Wallet Passes',
    delivery: 'Delivery Management',
    tracking: 'GPS Driver Tracking',
    routing: 'Route Optimization',
    curbside: 'Curbside Pickup',
    analytics: 'Analytics Dashboard',
    reports: 'EOD + Custom Reports',
    bi_dashboard: 'BI Dashboard',
    budtender_perf: 'Budtender Performance',
    predictive: 'Predictive Inventory',
    website_analytics: 'Website Analytics',
    cultivation: 'Cultivation/Grow Tracking',
    manufacturing: 'Manufacturing/Processing',
    wholesale: 'Wholesale/Distribution',
    lab_testing: 'Lab Testing + CoA',
    grow_inputs: 'Grow Input Tracking',
    multi_location: 'Multi-Location',
    franchise: 'Franchise Management',
    open_api: 'Open API',
    marketplace: 'Marketplace',
    scheduling: 'Employee Scheduling',
    training: 'Budtender Training LMS',
    fraud: 'Fraud + Theft Detection',
    soc2: 'SOC 2 Security Controls',
  };

  // Define which features are included per tier
  const tierFeatures: Record<string, string[]> = {
    starter: ['pos', 'inventory', 'cash', 'id_scanning', 'checkin', 'tips', 'offline', 'equivalency'],
    pro: [
      'pos', 'inventory', 'cash', 'id_scanning', 'checkin', 'tips', 'offline', 'equivalency',
      'metrc', 'biotrack', 'leaf_data', 'labels', 'batches', 'waste', 'grow_inputs',
      'loyalty', 'referrals', 'sms', 'email',
      'delivery', 'tracking', 'routing',
      'analytics', 'reports', 'budtender_perf', 'website_analytics',
      'scheduling', 'training',
    ],
    business: [
      'pos', 'inventory', 'cash', 'id_scanning', 'checkin', 'tips', 'offline', 'equivalency',
      'metrc', 'biotrack', 'leaf_data', 'labels', 'batches', 'waste', 'grow_inputs',
      'loyalty', 'referrals', 'sms', 'email', 'gamified', 'wallet_passes',
      'delivery', 'tracking', 'routing', 'curbside',
      'analytics', 'reports', 'bi_dashboard', 'budtender_perf', 'predictive', 'website_analytics',
      'scheduling', 'training', 'fraud', 'soc2',
      'multi_location', 'kiosk', 'open_api',
    ],
    enterprise: [
      'pos', 'inventory', 'cash', 'id_scanning', 'checkin', 'tips', 'offline', 'equivalency',
      'metrc', 'biotrack', 'leaf_data', 'labels', 'batches', 'waste', 'grow_inputs',
      'loyalty', 'referrals', 'sms', 'email', 'gamified', 'wallet_passes',
      'delivery', 'tracking', 'routing', 'curbside',
      'analytics', 'reports', 'bi_dashboard', 'budtender_perf', 'predictive', 'website_analytics',
      'cultivation', 'manufacturing', 'wholesale', 'lab_testing', 'grow_inputs',
      'multi_location', 'franchise', 'open_api', 'marketplace',
      'scheduling', 'training', 'fraud', 'soc2', 'kiosk',
    ],
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left py-4 px-4 font-medium text-gray-500">Features</th>
            {packageList.map(pkg => (
              <th key={pkg} className="text-center py-4 px-4 font-bold text-gray-900">
                {packages[pkg]?.name || packageNames[pkg]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(categories).map(([category, featureIds]) => (
            <>
              <tr key={category} className="bg-gray-50">
                <td colSpan={5} className="py-3 px-4 font-bold text-gray-700">{category}</td>
              </tr>
              {featureIds.map(featureId => (
                <tr key={featureId} className="border-b">
                  <td className="py-3 px-4 text-gray-600">
                    {features[featureId]?.name || featureNames[featureId] || featureId}
                  </td>
                  {packageList.map(pkg => {
                    const hasFeature = packages[pkg]?.features?.includes(featureId)
                      ?? tierFeatures[pkg]?.includes(featureId)
                      ?? false;
                    return (
                      <td key={pkg} className="text-center py-3 px-4">
                        {hasFeature ? (
                          <Check className="w-5 h-5 text-green-600 mx-auto" />
                        ) : (
                          <X className="w-5 h-5 text-gray-300 mx-auto" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FAQ({ question, answer }) {
  const [open, setOpen] = useState(false);

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
