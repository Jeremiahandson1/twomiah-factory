import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Building, User, CreditCard, Check, ArrowLeft, ArrowRight, Loader2, Eye, EyeOff } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Plan data (matches pricing config)
const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 49,
    priceAnnual: 39,
    description: 'Everything you need to run a service business',
    users: 2,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 149,
    priceAnnual: 119,
    description: 'Scale your field operations',
    users: 5,
    popular: true,
  },
  business: {
    id: 'business',
    name: 'Business',
    price: 299,
    priceAnnual: 239,
    description: 'Run your entire operation',
    users: 15,
  },
  construction: {
    id: 'construction',
    name: 'Construction',
    price: 599,
    priceAnnual: 479,
    description: 'Complete construction management',
    users: 20,
  },
};

const INDUSTRIES = [
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

const STEPS = [
  { id: 'plan', title: 'Select Plan', icon: Building },
  { id: 'company', title: 'Company Info', icon: Building },
  { id: 'account', title: 'Your Account', icon: User },
  { id: 'payment', title: 'Payment', icon: CreditCard },
];

export default function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Form state
  const [selectedPlan, setSelectedPlan] = useState(searchParams.get('plan') || 'pro');
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [formData, setFormData] = useState({
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
  
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => {
    if (searchParams.get('plan')) {
      setStep(1);
    }
  }, [searchParams]);

  const updateForm = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateStep = () => {
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

      sessionStorage.setItem('signup_token', data.token);
      sessionStorage.setItem('signup_company_id', data.company.id);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStartTrial = async () => {
    setLoading(true);
    setError('');

    try {
      const token = sessionStorage.getItem('signup_token');
      
      const response = await fetch(`${API_URL}/api/billing/start-trial`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ plan: selectedPlan }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to start trial');
      }

      localStorage.setItem('token', token);
      sessionStorage.removeItem('signup_token');
      sessionStorage.removeItem('signup_company_id');
      navigate('/?welcome=true');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubscribe = async () => {
    setLoading(true);
    setError('');

    try {
      const token = sessionStorage.getItem('signup_token');
      
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
    } catch (err) {
      setError(err.message);
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
              <span className="text-2xl font-bold text-gray-900">{{COMPANY_NAME}}</span>
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
            {STEPS.map((s, i) => {
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

function PlanSelection({ selectedPlan, setSelectedPlan, billingCycle, setBillingCycle }) {
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
        {Object.values(PLANS).map((plan) => {
          const price = billingCycle === 'annual' ? plan.priceAnnual : plan.price;
          const isSelected = selectedPlan === plan.id;

          return (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`p-4 rounded-lg border-2 text-left transition ${
                isSelected ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {plan.popular && (
                <span className="text-xs font-semibold text-orange-500 uppercase">Most Popular</span>
              )}
              <h3 className="text-lg font-bold text-gray-900 mt-1">{plan.name}</h3>
              <div className="mt-2">
                <span className="text-2xl font-bold text-gray-900">${price}</span>
                <span className="text-gray-500">/mo</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">{plan.users} users included</p>
              <p className="text-sm text-gray-600 mt-2">{plan.description}</p>
              <div className="mt-3 flex items-center justify-center">
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
    </div>
  );
}

function CompanyInfo({ formData, updateForm }) {
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
            onChange={(e) => updateForm('companyName', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="Acme Plumbing Co."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Industry *</label>
          <select
            value={formData.industry}
            onChange={(e) => updateForm('industry', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
          >
            <option value="">Select your industry</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind.value} value={ind.value}>{ind.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => updateForm('phone', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="(555) 123-4567"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
          <input
            type="text"
            value={formData.address}
            onChange={(e) => updateForm('address', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="123 Main Street"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
          <input
            type="text"
            value={formData.city}
            onChange={(e) => updateForm('city', e.target.value)}
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
              onChange={(e) => updateForm('state', e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
              placeholder="TX"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ZIP Code</label>
            <input
              type="text"
              value={formData.zip}
              onChange={(e) => updateForm('zip', e.target.value)}
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
            onChange={(e) => updateForm('website', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="https://acmeplumbing.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Number of Employees</label>
          <select
            value={formData.employeeCount}
            onChange={(e) => updateForm('employeeCount', e.target.value)}
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

function AccountInfo({ formData, updateForm, showPassword, setShowPassword, agreedToTerms, setAgreedToTerms }) {
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
            onChange={(e) => updateForm('firstName', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="John"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
          <input
            type="text"
            value={formData.lastName}
            onChange={(e) => updateForm('lastName', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="Smith"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => updateForm('email', e.target.value)}
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
              onChange={(e) => updateForm('password', e.target.value)}
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
            onChange={(e) => updateForm('confirmPassword', e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
            placeholder="••••••••"
          />
        </div>

        <div className="md:col-span-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
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

function PaymentStep({ plan, price, billingCycle, onStartTrial, onSubscribe, loading }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Start Your Free Trial</h2>
      <p className="text-gray-600 mb-6">Try {{COMPANY_NAME}} free for 14 days. No credit card required.</p>

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
