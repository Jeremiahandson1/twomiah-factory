import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Building, User, CreditCard, Check, X, ArrowLeft, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || '';

interface Plan {
  id: string;
  name: string;
  price: number;
  priceAnnual: number;
  description: string;
  users: number;
  popular?: boolean;
  highlights: string[];
}

interface FeatureComparisonItem {
  name: string;
  starter: boolean | string;
  pro: boolean | string;
  business: boolean | string;
  construction: boolean | string;
  [key: string]: boolean | string;
}

interface FeatureGroup {
  category: string;
  features: FeatureComparisonItem[];
}

interface FormData {
  companyName: string;
  industry: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  website: string;
  employeeCount: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

// Plan data (matches pricing config)
const PLANS: Record<string, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 49,
    priceAnnual: 39,
    description: 'Everything you need to run a service business',
    users: 2,
    highlights: [
      'Contacts / CRM',
      'Jobs & work orders',
      'Quotes & invoicing',
      'Payment processing',
      'Time & expense tracking',
      'Customer portal',
      'Mobile app access',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 149,
    priceAnnual: 119,
    description: 'Scale your field operations',
    users: 5,
    popular: true,
    highlights: [
      'Everything in Starter',
      'Team management',
      'Two-way SMS',
      'GPS tracking & geofencing',
      'Route optimization',
      'Online booking',
      'Service agreements',
      'QuickBooks sync',
      'Recurring jobs',
      'Job costing reports',
    ],
  },
  business: {
    id: 'business',
    name: 'Business',
    price: 299,
    priceAnnual: 239,
    description: 'Run your entire operation',
    users: 15,
    highlights: [
      'Everything in Pro',
      'Inventory management',
      'Equipment tracking',
      'Fleet management',
      'Email campaigns',
      'Workflow automations',
      'Custom forms',
      'Consumer financing',
      'Advanced reporting',
    ],
  },
  construction: {
    id: 'construction',
    name: 'Construction',
    price: 599,
    priceAnnual: 479,
    description: 'Complete construction management',
    users: 20,
    highlights: [
      'Everything in Business',
      'Projects & phases',
      'Change orders & RFIs',
      'Daily logs & inspections',
      'Punch lists',
      'Bid management',
      'Gantt charts',
      'Selections portal',
      'Draw schedules (AIA)',
      'Lien waivers',
    ],
  },
};

const FEATURE_COMPARISON: FeatureGroup[] = [
  { category: 'Core', features: [
    { name: 'Contacts / CRM', starter: true, pro: true, business: true, construction: true },
    { name: 'Jobs & Work Orders', starter: true, pro: true, business: true, construction: true },
    { name: 'Quotes & Estimates', starter: true, pro: true, business: true, construction: true },
    { name: 'Invoicing & Payments', starter: true, pro: true, business: true, construction: true },
    { name: 'Time & Expense Tracking', starter: true, pro: true, business: true, construction: true },
    { name: 'Customer Portal', starter: true, pro: true, business: true, construction: true },
    { name: 'Mobile App', starter: true, pro: true, business: true, construction: true },
  ]},
  { category: 'Field Operations', features: [
    { name: 'Team Management', starter: false, pro: true, business: true, construction: true },
    { name: 'Two-Way SMS', starter: false, pro: true, business: true, construction: true },
    { name: 'GPS Tracking & Geofencing', starter: false, pro: true, business: true, construction: true },
    { name: 'Route Optimization', starter: false, pro: true, business: true, construction: true },
    { name: 'Online Booking', starter: false, pro: true, business: true, construction: true },
    { name: 'Service Agreements', starter: false, pro: true, business: true, construction: true },
    { name: 'Pricebook / Flat Rate', starter: false, pro: true, business: true, construction: true },
    { name: 'QuickBooks Sync', starter: false, pro: true, business: true, construction: true },
    { name: 'Recurring Jobs', starter: false, pro: true, business: true, construction: true },
  ]},
  { category: 'Operations & Marketing', features: [
    { name: 'Inventory Management', starter: false, pro: false, business: true, construction: true },
    { name: 'Equipment Tracking', starter: false, pro: false, business: true, construction: true },
    { name: 'Fleet Management', starter: false, pro: false, business: true, construction: true },
    { name: 'Email Campaigns', starter: false, pro: false, business: true, construction: true },
    { name: 'Workflow Automations', starter: false, pro: false, business: true, construction: true },
    { name: 'Custom Forms', starter: false, pro: false, business: true, construction: true },
    { name: 'Consumer Financing', starter: false, pro: false, business: true, construction: true },
    { name: 'Advanced Reporting', starter: false, pro: false, business: true, construction: true },
  ]},
  { category: 'Construction Management', features: [
    { name: 'Projects & Phases', starter: false, pro: false, business: false, construction: true },
    { name: 'Change Orders & RFIs', starter: false, pro: false, business: false, construction: true },
    { name: 'Daily Logs & Inspections', starter: false, pro: false, business: false, construction: true },
    { name: 'Punch Lists', starter: false, pro: false, business: false, construction: true },
    { name: 'Gantt Charts', starter: false, pro: false, business: false, construction: true },
    { name: 'Selections Portal', starter: false, pro: false, business: false, construction: true },
    { name: 'Draw Schedules (AIA)', starter: false, pro: false, business: false, construction: true },
    { name: 'Lien Waivers', starter: false, pro: false, business: false, construction: true },
  ]},
  { category: 'Limits', features: [
    { name: 'Contacts', starter: '500', pro: '2,500', business: '10,000', construction: '25,000' },
    { name: 'Jobs / month', starter: '100', pro: '500', business: '2,000', construction: '5,000' },
    { name: 'Storage', starter: '5 GB', pro: '25 GB', business: '100 GB', construction: '250 GB' },
    { name: 'SMS Credits', starter: '—', pro: '500', business: '2,000', construction: '5,000' },
  ]},
];

const INDUSTRIES: { value: string; label: string }[] = [
  { value: 'plumber', label: 'Plumbing' },
  { value: 'hvac', label: 'HVAC' },
  { value: 'electrician', label: 'Electrical' },
  { value: 'remodeler', label: 'Remodeling' },
  { value: 'general_contractor', label: 'General Contracting' },
  { value: 'home_builder', label: 'Home Building' },
  { value: 'cleaning', label: 'Cleaning Services' },
  { value: 'landscaping', label: 'Landscaping' },
  { value: 'pest_control', label: 'Pest Control' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'painting', label: 'Painting' },
  { value: 'flooring', label: 'Flooring' },
  { value: 'other', label: 'Other' },
];

interface StepDef {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEPS: StepDef[] = [
  { id: 'plan', title: 'Select Plan', icon: Building },
  { id: 'company', title: 'Company Info', icon: Building },
  { id: 'account', title: 'Your Account', icon: User },
  { id: 'payment', title: 'Payment', icon: CreditCard },
];

export default function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Form state
  const [selectedPlan, setSelectedPlan] = useState<string>(searchParams.get('plan') || 'pro');
  const [billingCycle, setBillingCycle] = useState<string>('monthly');
  const [formData, setFormData] = useState<FormData>({
    companyName: '',
    industry: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    website: '',
    employeeCount: '1-5',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [agreedToTerms, setAgreedToTerms] = useState<boolean>(false);

  useEffect(() => {
    if (searchParams.get('plan')) {
      setStep(1);
    }
  }, [searchParams]);

  const updateForm = (field: string, value: string) => {
    setFormData((prev: FormData) => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateStep = (): boolean => {
    switch (step) {
      case 0:
        if (!selectedPlan) {
          setError('Please select a plan');
          return false;
        }
        return true;

      case 1:
        if (!formData.companyName.trim()) {
          setError('Company name is required');
          return false;
        }
        if (!formData.industry) {
          setError('Please select your industry');
          return false;
        }
        if (!formData.phone.trim()) {
          setError('Phone number is required');
          return false;
        }
        return true;

      case 2:
        if (!formData.firstName.trim() || !formData.lastName.trim()) {
          setError('First and last name are required');
          return false;
        }
        if (!formData.email.trim()) {
          setError('Email is required');
          return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
          setError('Please enter a valid email address');
          return false;
        }
        if (formData.password.length < 8) {
          setError('Password must be at least 8 characters');
          return false;
        }
        if (formData.password !== formData.confirmPassword) {
          setError('Passwords do not match');
          return false;
        }
        if (!agreedToTerms) {
          setError('You must agree to the terms and privacy policy');
          return false;
        }
        return true;

      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep()) {
      if (step === 2) {
        handleCreateAccount();
      } else {
        setStep(step + 1);
      }
    }
  };

  const handleBack = () => {
    setError('');
    setStep(step - 1);
  };

  const handleCreateAccount = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          plan: selectedPlan,
          billingCycle,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create account');
      }

      // Store tokens properly for the API client
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      sessionStorage.setItem('signup_company_id', data.company.id);
      setStep(3);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartTrial = async () => {
    // Trial is already started on signup (14-day trial built in).
    // Just navigate to the app — tokens are already in localStorage.
    sessionStorage.removeItem('signup_company_id');
    navigate('/?welcome=true');
  };

  const handleSubscribe = async () => {
    setLoading(true);
    setError('');

    try {
      const token = localStorage.getItem('accessToken');

      const response = await fetch(`${API_URL}/api/billing/create-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: selectedPlan,
          billingCycle,
          successUrl: `${window.location.origin}/signup/success`,
          cancelUrl: `${window.location.origin}/signup?plan=${selectedPlan}&step=payment`,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      window.location.href = data.checkoutUrl;
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const plan = PLANS[selectedPlan];
  const price = billingCycle === 'annual' ? plan?.priceAnnual : plan?.price;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
                <Building className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold text-gray-900">{'{{COMPANY_NAME}}'}</span>
            </Link>
            <Link to="/login" className="text-gray-600 hover:text-gray-900">
              Already have an account? Log in
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {STEPS.map((s: StepDef, i: number) => {
              const Icon = s.icon;
              const isActive = i === step;
              const isComplete = i < step;

              return (
                <React.Fragment key={s.id}>
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        isComplete ? 'bg-green-500 text-white' :
                        isActive ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isComplete ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                    </div>
                    <span className={`mt-2 text-sm ${isActive ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                      {s.title}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-1 mx-4 ${i < step ? 'bg-green-500' : 'bg-gray-200'}`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border p-6 md:p-8">
          {step === 0 && (
            <PlanSelection
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              billingCycle={billingCycle}
              setBillingCycle={setBillingCycle}
            />
          )}
          {step === 1 && <CompanyInfo formData={formData} updateForm={updateForm} />}
          {step === 2 && (
            <AccountInfo
              formData={formData}
              updateForm={updateForm}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              agreedToTerms={agreedToTerms}
              setAgreedToTerms={setAgreedToTerms}
            />
          )}
          {step === 3 && (
            <PaymentStep
              plan={plan}
              price={price}
              billingCycle={billingCycle}
              onStartTrial={handleStartTrial}
              onSubscribe={handleSubscribe}
              loading={loading}
            />
          )}
        </div>

        {step < 3 && (
          <div className="flex justify-between mt-6">
            <button
              onClick={handleBack}
              disabled={step === 0}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium ${
                step === 0 ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 hover:bg-gray-100'
              }`}
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <button
              onClick={handleNext}
              disabled={loading}
              className="flex items-center gap-2 bg-orange-500 text-white px-6 py-3 rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {step === 2 ? 'Create Account' : 'Continue'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

interface PlanSelectionProps {
  selectedPlan: string;
  setSelectedPlan: (plan: string) => void;
  billingCycle: string;
  setBillingCycle: (cycle: string) => void;
}

function PlanSelection({ selectedPlan, setSelectedPlan, billingCycle, setBillingCycle }: PlanSelectionProps) {
  const [showComparison, setShowComparison] = useState<boolean>(false);
  const tierKeys: string[] = ['starter', 'pro', 'business', 'construction'];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Choose Your Plan</h2>
      <p className="text-gray-600 mb-6">Start with a 14-day free trial. No credit card required.</p>

      <div className="flex justify-center items-center gap-4 mb-8">
        <span className={billingCycle === 'monthly' ? 'text-gray-900 font-medium' : 'text-gray-500'}>Monthly</span>
        <button
          onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
          className={`relative w-14 h-7 rounded-full transition ${billingCycle === 'annual' ? 'bg-orange-500' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${billingCycle === 'annual' ? 'translate-x-8' : 'translate-x-1'}`} />
        </button>
        <span className={billingCycle === 'annual' ? 'text-gray-900 font-medium' : 'text-gray-500'}>Annual</span>
        {billingCycle === 'annual' && (
          <span className="bg-green-100 text-green-700 text-sm px-2 py-1 rounded-full">Save 20%</span>
        )}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.values(PLANS).map((plan: Plan) => {
          const price = billingCycle === 'annual' ? plan.priceAnnual : plan.price;
          const isSelected = selectedPlan === plan.id;

          return (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`relative p-4 rounded-lg border-2 text-left transition ${
                isSelected ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-semibold px-3 py-0.5 rounded-full">Most Popular</span>
              )}
              <h3 className="text-lg font-bold text-gray-900 mt-1">{plan.name}</h3>
              <div className="mt-2">
                <span className="text-2xl font-bold text-gray-900">${price}</span>
                <span className="text-gray-500">/mo</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{plan.users} users included</p>
              <p className="text-sm text-gray-600 mt-2 mb-3">{plan.description}</p>
              <ul className="space-y-1 mb-3">
                {plan.highlights.map((h: string, i: number) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                    <Check className="w-3.5 h-3.5 text-orange-500 mt-0.5 shrink-0" />
                    {h}
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-center">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  isSelected ? 'border-orange-500 bg-orange-500' : 'border-gray-300'
                }`}>
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Compare all features toggle */}
      <div className="mt-6 text-center">
        <button
          onClick={() => setShowComparison(!showComparison)}
          className="text-sm text-orange-600 hover:text-orange-700 font-medium"
        >
          {showComparison ? 'Hide full comparison' : 'Compare all features across plans'}
        </button>
      </div>

      {showComparison && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-3 pr-4 font-medium text-gray-500 w-1/3">Feature</th>
                {tierKeys.map((k: string) => (
                  <th key={k} className={`text-center py-3 px-2 font-semibold ${selectedPlan === k ? 'text-orange-600' : 'text-gray-700'}`}>
                    {PLANS[k].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_COMPARISON.map((group: FeatureGroup) => (
                <React.Fragment key={group.category}>
                  <tr>
                    <td colSpan={5} className="pt-4 pb-2 font-semibold text-gray-900 text-xs uppercase tracking-wider">
                      {group.category}
                    </td>
                  </tr>
                  {group.features.map((f: FeatureComparisonItem) => (
                    <tr key={f.name} className="border-b border-gray-100">
                      <td className="py-2 pr-4 text-gray-700">{f.name}</td>
                      {tierKeys.map((k: string) => {
                        const val = f[k];
                        return (
                          <td key={k} className={`text-center py-2 px-2 ${selectedPlan === k ? 'bg-orange-50/50' : ''}`}>
                            {val === true ? <Check className="w-4 h-4 text-green-500 mx-auto" /> :
                             val === false ? <X className="w-4 h-4 text-gray-300 mx-auto" /> :
                             <span className="text-gray-700 font-medium">{val as string}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface CompanyInfoProps {
  formData: FormData;
  updateForm: (field: string, value: string) => void;
}

function CompanyInfo({ formData, updateForm }: CompanyInfoProps) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Company Information</h2>
      <p className="text-gray-600 mb-6">Tell us about your business.</p>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
          <input
            type="text"
            value={formData.companyName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('companyName', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="Acme Plumbing Co."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Industry *</label>
          <select
            value={formData.industry}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateForm('industry', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
          >
            <option value="">Select your industry</option>
            {INDUSTRIES.map((ind: { value: string; label: string }) => (
              <option key={ind.value} value={ind.value}>{ind.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('phone', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="(555) 123-4567"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
          <input
            type="text"
            value={formData.address}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('address', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="123 Main Street"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
          <input
            type="text"
            value={formData.city}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('city', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="Austin"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <input
              type="text"
              value={formData.state}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('state', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
              placeholder="TX"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ZIP Code</label>
            <input
              type="text"
              value={formData.zip}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('zip', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
              placeholder="78701"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
          <input
            type="url"
            value={formData.website}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('website', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="https://acmeplumbing.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Number of Employees</label>
          <select
            value={formData.employeeCount}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateForm('employeeCount', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
          >
            <option value="1-5">1-5</option>
            <option value="6-10">6-10</option>
            <option value="11-25">11-25</option>
            <option value="26-50">26-50</option>
            <option value="51-100">51-100</option>
            <option value="100+">100+</option>
          </select>
        </div>
      </div>
    </div>
  );
}

interface AccountInfoProps {
  formData: FormData;
  updateForm: (field: string, value: string) => void;
  showPassword: boolean;
  setShowPassword: (show: boolean) => void;
  agreedToTerms: boolean;
  setAgreedToTerms: (agreed: boolean) => void;
}

function AccountInfo({ formData, updateForm, showPassword, setShowPassword, agreedToTerms, setAgreedToTerms }: AccountInfoProps) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Create Your Account</h2>
      <p className="text-gray-600 mb-6">You'll be the admin of your company's account.</p>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
          <input
            type="text"
            value={formData.firstName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('firstName', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="John"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('lastName', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="Smith"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('email', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="john@acmeplumbing.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('password', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 pr-12 text-gray-900"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">Minimum 8 characters</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={formData.confirmPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('confirmPassword', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="••••••••"
          />
        </div>

        <div className="md:col-span-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAgreedToTerms(e.target.checked)}
              className="w-5 h-5 text-orange-500 border-gray-300 rounded focus:ring-orange-500 mt-0.5 text-gray-900"
            />
            <span className="text-sm text-gray-600">
              I agree to the{' '}
              <a href="/terms" className="text-orange-500 hover:underline">Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className="text-orange-500 hover:underline">Privacy Policy</a>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}

interface PaymentStepProps {
  plan: Plan;
  price: number | undefined;
  billingCycle: string;
  onStartTrial: () => void;
  onSubscribe: () => void;
  loading: boolean;
}

function PaymentStep({ plan, price, billingCycle, onStartTrial, onSubscribe, loading }: PaymentStepProps) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Start Your Free Trial</h2>
      <p className="text-gray-600 mb-6">Try {'{{COMPANY_NAME}}'} free for 14 days. No credit card required.</p>

      <div className="bg-gray-50 rounded-lg p-6 mb-8">
        <h3 className="font-semibold text-gray-900 mb-4">Order Summary</h3>
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-600">{plan.name} Plan</span>
          <span className="font-medium">${price}/mo</span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-600">Billing Cycle</span>
          <span className="font-medium capitalize">{billingCycle}</span>
        </div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-600">Users Included</span>
          <span className="font-medium">{plan.users}</span>
        </div>
        <hr className="my-4" />
        <div className="flex justify-between items-center">
          <span className="text-gray-600">Due Today</span>
          <span className="text-xl font-bold text-green-600">$0.00</span>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          Your trial ends in 14 days. You can add payment info anytime.
        </p>
      </div>

      <div className="space-y-4">
        <button
          onClick={onStartTrial}
          disabled={loading}
          className="w-full bg-orange-500 text-white py-4 rounded-lg font-semibold hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Starting Trial...
            </>
          ) : (
            <>
              Start 14-Day Free Trial
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>

        <div className="text-center text-gray-500">or</div>

        <button
          onClick={onSubscribe}
          disabled={loading}
          className="w-full border-2 border-gray-300 text-gray-700 py-4 rounded-lg font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          Subscribe Now & Skip Trial
        </button>
      </div>

      <div className="mt-8 flex items-center justify-center gap-6 text-gray-400">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span className="text-sm">Cancel anytime</span>
        </div>
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span className="text-sm">No credit card</span>
        </div>
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span className="text-sm">Full access</span>
        </div>
      </div>
    </div>
  );
}
