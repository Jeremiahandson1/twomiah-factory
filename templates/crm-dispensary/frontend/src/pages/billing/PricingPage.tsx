import { useState, useEffect } from 'react';
import { 
  Check, X, Zap, Building2, Wrench, Crown, 
  CreditCard, Calendar, Users, HelpCircle,
  ChevronDown, ChevronUp, Loader2
} from 'lucide-react';
import api from '../../services/api';

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
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  const packages = pricing?.packages || {};
  const features = pricing?.features || {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Choose the plan that fits your business. No hidden fees, no surprises.
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
              <span className="ml-2 text-green-600 text-xs font-bold">Save 17%</span>
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
            description="Core CRM for small teams"
            icon={Zap}
            price={billingCycle === 'yearly' ? packages.starter?.yearlyPrice / 12 : packages.starter?.monthlyPrice}
            billingCycle={billingCycle}
            yearlyTotal={packages.starter?.yearlyPrice}
            users={packages.starter?.usersIncluded}
            features={[
              'Contacts & CRM',
              'Jobs & Scheduling',
              'Quotes & Invoices',
              'Time Tracking',
              'Document Storage',
              '500 contacts limit',
            ]}
            cta="Start Free Trial"
          />

          {/* Service Pro */}
          <PricingCard
            name="Service Pro"
            description="Complete service trade solution"
            icon={Wrench}
            price={billingCycle === 'yearly' ? packages.servicePro?.yearlyPrice / 12 : packages.servicePro?.monthlyPrice}
            billingCycle={billingCycle}
            yearlyTotal={packages.servicePro?.yearlyPrice}
            users={packages.servicePro?.usersIncluded}
            popular
            features={[
              'Everything in Starter',
              'GPS Time Tracking',
              'Route Optimization',
              'Equipment Tracking',
              'Service Agreements',
              'Pricebook & Flat Rate',
              'Two-Way SMS',
              'Customer Portal',
              'Online Booking',
              'QuickBooks Sync',
            ]}
            cta="Start Free Trial"
          />

          {/* Construction */}
          <PricingCard
            name="Construction"
            description="Complete construction management"
            icon={Building2}
            price={billingCycle === 'yearly' ? packages.construction?.yearlyPrice / 12 : packages.construction?.monthlyPrice}
            billingCycle={billingCycle}
            yearlyTotal={packages.construction?.yearlyPrice}
            users={packages.construction?.usersIncluded}
            features={[
              'Everything in Starter',
              'Project Management',
              'Change Orders',
              'RFIs & Daily Logs',
              'Punch Lists',
              'Gantt Charts',
              'Selections Management',
              'Material Takeoffs',
              'Lien Waivers',
              'Draw Schedules',
            ]}
            cta="Start Free Trial"
          />

          {/* Enterprise */}
          <PricingCard
            name="Enterprise"
            description="Everything, unlimited"
            icon={Crown}
            price={billingCycle === 'yearly' ? packages.enterprise?.yearlyPrice / 12 : packages.enterprise?.monthlyPrice}
            billingCycle={billingCycle}
            yearlyTotal={packages.enterprise?.yearlyPrice}
            users={packages.enterprise?.usersIncluded}
            features={[
              'All features included',
              'Unlimited contacts',
              'Unlimited jobs',
              'Priority support',
              'Custom integrations',
              'Dedicated account manager',
              'Custom training',
              'SLA guarantee',
            ]}
            cta="Contact Sales"
            dark
          />
        </div>

        {/* One-Time Purchase Option */}
        <div className="mt-12 bg-gradient-to-r from-orange-500 to-orange-600 rounded-2xl p-8 text-white">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold mb-2">Prefer a One-Time Purchase?</h3>
              <p className="text-orange-100">
                Own {{COMPANY_NAME}} forever with our lifetime license. No monthly fees, self-hosted option available.
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
            <FeatureComparison packages={packages} features={features} />
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
              answer="The 14-day free trial includes full access to all features in your selected plan. No credit card required to start."
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
  users, features, cta, popular, dark 
}) {
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

      <div className="mt-4 mb-6">
        <span className="text-4xl font-bold">${Math.round(price)}</span>
        <span className={dark ? 'text-gray-400' : 'text-gray-500'}>/mo</span>
        {billingCycle === 'yearly' && (
          <div className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
            ${yearlyTotal} billed annually
          </div>
        )}
      </div>

      <div className={`flex items-center gap-2 text-sm mb-6 ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
        <Users className="w-4 h-4" />
        {users} users included
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

function AddonCard({ name, description, monthlyPrice, oneTimePrice, oneTimeOnly }) {
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

function FeatureComparison({ packages, features }) {
  const packageList = ['starter', 'servicePro', 'construction', 'enterprise'];
  const categories = {
    'Core': ['contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'team'],
    'Service Trade': ['timeTracking', 'gpsTracking', 'routing', 'equipment', 'agreements', 'pricebook', 'fleet'],
    'Construction': ['projects', 'changeOrders', 'rfis', 'dailyLogs', 'punchLists', 'gantt', 'selections', 'takeoffs', 'lienWaivers', 'drawSchedules'],
    'Communication': ['sms', 'emailCampaigns', 'reviews', 'callTracking', 'customerPortal', 'onlineBooking'],
    'Financial': ['payments', 'financing', 'quickbooks', 'expenses', 'jobCosting'],
    'Advanced': ['customForms', 'documents', 'reporting', 'inventory'],
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className="text-left py-4 px-4 font-medium text-gray-500">Features</th>
            {packageList.map(pkg => (
              <th key={pkg} className="text-center py-4 px-4 font-bold text-gray-900">
                {packages[pkg]?.name}
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
                    {features[featureId]?.name || featureId}
                  </td>
                  {packageList.map(pkg => (
                    <td key={pkg} className="text-center py-3 px-4">
                      {packages[pkg]?.features?.includes(featureId) ? (
                        <Check className="w-5 h-5 text-green-600 mx-auto" />
                      ) : (
                        <X className="w-5 h-5 text-gray-300 mx-auto" />
                      )}
                    </td>
                  ))}
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
