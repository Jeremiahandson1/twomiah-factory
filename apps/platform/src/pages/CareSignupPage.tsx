import React, { useState } from 'react'
import { Heart, Shield, Check, ArrowLeft, ArrowRight, Loader2, Eye, EyeOff, Clock, FileCheck, MapPin, CreditCard, Building, User } from 'lucide-react'
import { API_URL } from '../supabase'

// ─── Care-specific pricing ─────────────────────────────────────────────────
const PLANS = {
  essentials: {
    id: 'essentials',
    name: 'Essentials',
    price: 79,
    priceAnnual: 63,
    description: 'Core tools for small home care agencies',
    users: 3,
    features: [
      'Client & caregiver management',
      'Basic scheduling',
      'Care plan documentation',
      'Caregiver mobile app',
      'Secure messaging',
    ],
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    price: 149,
    priceAnnual: 119,
    description: 'Full-featured for growing agencies',
    users: 10,
    popular: true,
    features: [
      'Everything in Essentials',
      'EVV compliance tracking',
      'Automated shift matching',
      'Family portal access',
      'Billing & invoicing',
      'Custom care assessments',
    ],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 299,
    priceAnnual: 239,
    description: 'Multi-location agency operations',
    users: 25,
    features: [
      'Everything in Professional',
      'Multi-location support',
      'Advanced reporting & analytics',
      'API access & integrations',
      'Payroll export',
      'Dedicated account manager',
      'Custom onboarding',
    ],
  },
}

const ADDONS = [
  { id: 'evv', name: 'EVV Integration', price: 29, description: 'GPS-verified clock-in/out for Medicaid compliance' },
  { id: 'homecare_billing', name: 'Advanced Billing', price: 49, description: 'Insurance claims, Medicaid billing, batch invoicing' },
  { id: 'caregiver_training', name: 'Training & Compliance', price: 39, description: 'Certification tracking, in-app training modules' },
  { id: 'family_portal', name: 'Family Portal', price: 29, description: 'Real-time updates, care notes, and visit logs for families' },
  { id: 'marketing_site', name: 'Marketing Website', price: 49, description: 'SEO-optimized agency website with lead capture' },
]

const CAREGIVER_COUNTS = [
  { value: '1-5', label: '1–5 caregivers' },
  { value: '6-15', label: '6–15 caregivers' },
  { value: '16-30', label: '16–30 caregivers' },
  { value: '31-50', label: '31–50 caregivers' },
  { value: '51-100', label: '51–100 caregivers' },
  { value: '100+', label: '100+ caregivers' },
]

const STEPS = [
  { id: 'plan', title: 'Choose Plan', icon: Heart },
  { id: 'agency', title: 'Agency Info', icon: Building },
  { id: 'account', title: 'Your Account', icon: User },
  { id: 'review', title: 'Review & Start', icon: CreditCard },
]

// ─── Component ──────────────────────────────────────────────────────────────
export default function CareSignupPage() {
  const [step, setStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [selectedPlan, setSelectedPlan] = useState('professional')
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const [selectedAddons, setSelectedAddons] = useState<string[]>([])

  const [formData, setFormData] = useState({
    companyName: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    website: '',
    caregiverCount: '1-5',
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  })

  const [showPassword, setShowPassword] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)

  const updateForm = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setError('')
  }

  const toggleAddon = (id: string) => {
    setSelectedAddons(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  const validateStep = () => {
    switch (step) {
      case 0:
        if (!selectedPlan) { setError('Please select a plan'); return false }
        return true
      case 1:
        if (!formData.companyName.trim()) { setError('Agency name is required'); return false }
        if (!formData.phone.trim()) { setError('Phone number is required'); return false }
        return true
      case 2:
        if (!formData.firstName.trim() || !formData.lastName.trim()) { setError('First and last name are required'); return false }
        if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) { setError('Valid email is required'); return false }
        if (formData.password.length < 8) { setError('Password must be at least 8 characters'); return false }
        if (formData.password !== formData.confirmPassword) { setError('Passwords do not match'); return false }
        if (!agreedToTerms) { setError('You must agree to the terms and privacy policy'); return false }
        return true
      default:
        return true
    }
  }

  const handleNext = () => {
    if (validateStep()) setStep(step + 1)
  }

  const handleBack = () => {
    setError('')
    setStep(step - 1)
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError('')

    // Build feature list from plan + addons
    const features = [
      'scheduling', 'care_plans', 'caregiver_app', 'messaging',
      ...selectedAddons,
    ]
    if (selectedPlan !== 'essentials') {
      features.push('evv_basic', 'billing', 'family_portal_basic', 'assessments')
    }
    if (selectedPlan === 'enterprise') {
      features.push('multi_location', 'analytics', 'api_access', 'payroll_export')
    }

    // Determine products
    const products = ['crm']
    if (selectedAddons.includes('marketing_site')) {
      products.push('website')
    }

    try {
      const res = await fetch(`${API_URL}/api/v1/factory/public/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.companyName.trim(),
          email: formData.email.trim(),
          admin_email: formData.email.trim(),
          phone: formData.phone.trim(),
          industry: 'home_care',
          address: formData.address || null,
          city: formData.city || null,
          state: formData.state || null,
          zip: formData.zip || null,
          domain: formData.website || null,
          primary_color: '#14b8a6',
          plan: selectedPlan,
          deployment_model: 'saas',
          billing_type: 'subscription',
          products,
          features,
          website_theme: 'clean-professional',
          admin_password: formData.password,
          notes: `Caregiver count: ${formData.caregiverCount}. Add-ons: ${selectedAddons.join(', ') || 'none'}. Billing: ${billingCycle}.`,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create account')

      setSuccess(true)

      // If Stripe checkout URL was returned, redirect after brief delay
      if (data.checkoutUrl) {
        setTimeout(() => { window.location.href = data.checkoutUrl }, 2000)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const plan = PLANS[selectedPlan as keyof typeof PLANS]
  const price = billingCycle === 'annual' ? plan?.priceAnnual : plan?.price
  const addonsTotal = selectedAddons.reduce((sum, id) => {
    const addon = ADDONS.find(a => a.id === id)
    return sum + (addon?.price || 0)
  }, 0)

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-teal-50 to-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check className="w-8 h-8 text-teal-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Twomiah Care!</h2>
          <p className="text-gray-600 mb-6">
            Your agency account has been created. Our team will provision your system and send you login credentials within 24 hours.
          </p>
          <p className="text-sm text-gray-500">Check your email at <strong>{formData.email}</strong> for next steps.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-teal-50/30">
      {/* Header */}
      <header className="bg-white border-b border-teal-100">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center">
                <Heart className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-xl font-bold text-gray-900">Twomiah</span>
                <span className="text-xl font-bold text-teal-600"> Care</span>
              </div>
            </div>
            <span className="text-sm text-gray-500 hidden sm:block">
              Home Care Agency Management Platform
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero tagline */}
        {step === 0 && (
          <div className="text-center mb-8">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              Run your home care agency <span className="text-teal-600">with confidence</span>
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Scheduling, EVV compliance, caregiver management, client care plans, and billing — all in one platform built for home care.
            </p>
          </div>
        )}

        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between max-w-lg mx-auto">
            {STEPS.map((s, i) => {
              const Icon = s.icon
              const isActive = i === step
              const isComplete = i < step
              return (
                <React.Fragment key={s.id}>
                  <div className="flex flex-col items-center">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                      isComplete ? 'bg-teal-500 text-white' :
                      isActive ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-400'
                    }`}>
                      {isComplete ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                    </div>
                    <span className={`mt-2 text-xs ${isActive ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                      {s.title}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-3 rounded ${i < step ? 'bg-teal-500' : 'bg-gray-200'}`} />
                  )}
                </React.Fragment>
              )
            })}
          </div>
        </div>

        {error && (
          <div className="mb-6 max-w-2xl mx-auto bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 md:p-8 max-w-4xl mx-auto">
          {step === 0 && (
            <PlanStep
              selectedPlan={selectedPlan}
              setSelectedPlan={setSelectedPlan}
              billingCycle={billingCycle}
              setBillingCycle={setBillingCycle}
              selectedAddons={selectedAddons}
              toggleAddon={toggleAddon}
            />
          )}
          {step === 1 && <AgencyInfoStep formData={formData} updateForm={updateForm} />}
          {step === 2 && (
            <AccountStep
              formData={formData}
              updateForm={updateForm}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              agreedToTerms={agreedToTerms}
              setAgreedToTerms={setAgreedToTerms}
            />
          )}
          {step === 3 && (
            <ReviewStep
              plan={plan}
              price={price!}
              billingCycle={billingCycle}
              addonsTotal={addonsTotal}
              selectedAddons={selectedAddons}
              formData={formData}
              onSubmit={handleSubmit}
              loading={loading}
            />
          )}
        </div>

        {step < 3 && (
          <div className="flex justify-between mt-6 max-w-4xl mx-auto">
            <button
              onClick={handleBack}
              disabled={step === 0}
              className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition ${
                step === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={handleNext}
              disabled={loading}
              className="flex items-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-teal-700 disabled:opacity-50 transition"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Trust bar */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-gray-400 text-sm">
          <div className="flex items-center gap-2"><Shield className="w-4 h-4" /> HIPAA-ready platform</div>
          <div className="flex items-center gap-2"><Clock className="w-4 h-4" /> 14-day free trial</div>
          <div className="flex items-center gap-2"><FileCheck className="w-4 h-4" /> EVV compliant</div>
          <div className="flex items-center gap-2"><MapPin className="w-4 h-4" /> GPS visit verification</div>
        </div>
      </main>
    </div>
  )
}

// ─── Step Components ────────────────────────────────────────────────────────

function PlanStep({ selectedPlan, setSelectedPlan, billingCycle, setBillingCycle, selectedAddons, toggleAddon }: any) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Choose your plan</h2>
      <p className="text-gray-500 mb-6">All plans include a 14-day free trial. No credit card required.</p>

      {/* Billing toggle */}
      <div className="flex justify-center items-center gap-4 mb-8">
        <span className={billingCycle === 'monthly' ? 'text-gray-900 font-medium' : 'text-gray-400'}>Monthly</span>
        <button
          onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'annual' : 'monthly')}
          className={`relative w-14 h-7 rounded-full transition ${billingCycle === 'annual' ? 'bg-teal-500' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${billingCycle === 'annual' ? 'translate-x-8' : 'translate-x-1'}`} />
        </button>
        <span className={billingCycle === 'annual' ? 'text-gray-900 font-medium' : 'text-gray-400'}>Annual</span>
        {billingCycle === 'annual' && (
          <span className="bg-teal-100 text-teal-700 text-xs font-semibold px-2.5 py-1 rounded-full">Save 20%</span>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid md:grid-cols-3 gap-4 mb-10">
        {Object.values(PLANS).map((plan) => {
          const p = billingCycle === 'annual' ? plan.priceAnnual : plan.price
          const isSelected = selectedPlan === plan.id
          return (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`relative p-5 rounded-xl border-2 text-left transition-all ${
                isSelected
                  ? 'border-teal-500 bg-teal-50/50 shadow-md'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {(plan as any).popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-teal-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  Most Popular
                </span>
              )}
              <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
              <div className="mt-2 mb-1">
                <span className="text-3xl font-bold text-gray-900">${p}</span>
                <span className="text-gray-500 text-sm">/mo</span>
              </div>
              <p className="text-xs text-gray-500 mb-3">Up to {plan.users} users</p>
              <p className="text-sm text-gray-600 mb-4">{plan.description}</p>
              <ul className="space-y-1.5">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check className="w-4 h-4 text-teal-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex justify-center">
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  isSelected ? 'border-teal-500 bg-teal-500' : 'border-gray-300'
                }`}>
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {/* Add-ons */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 mb-1">Optional Add-ons</h3>
        <p className="text-sm text-gray-500 mb-4">Enhance your platform with specialized modules.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ADDONS.map((addon) => {
            const isSelected = selectedAddons.includes(addon.id)
            return (
              <button
                key={addon.id}
                onClick={() => toggleAddon(addon.id)}
                className={`p-4 rounded-lg border text-left transition ${
                  isSelected
                    ? 'border-teal-500 bg-teal-50/60'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between mb-1">
                  <span className="font-semibold text-sm text-gray-900">{addon.name}</span>
                  <span className="text-sm font-bold text-teal-600">+${addon.price}/mo</span>
                </div>
                <p className="text-xs text-gray-500">{addon.description}</p>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function AgencyInfoStep({ formData, updateForm }: any) {
  const inputClass = 'w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-gray-900 text-sm'
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Tell us about your agency</h2>
      <p className="text-gray-500 mb-6">We'll use this to set up your care management platform.</p>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Agency Name *</label>
          <input type="text" value={formData.companyName} onChange={(e) => updateForm('companyName', e.target.value)}
            className={inputClass} placeholder="Sunrise Home Care LLC" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
          <input type="tel" value={formData.phone} onChange={(e) => updateForm('phone', e.target.value)}
            className={inputClass} placeholder="(555) 123-4567" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Number of Caregivers</label>
          <select value={formData.caregiverCount} onChange={(e) => updateForm('caregiverCount', e.target.value)}
            className={inputClass}>
            {CAREGIVER_COUNTS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
          <input type="text" value={formData.address} onChange={(e) => updateForm('address', e.target.value)}
            className={inputClass} placeholder="456 Care Street, Suite 200" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
          <input type="text" value={formData.city} onChange={(e) => updateForm('city', e.target.value)}
            className={inputClass} placeholder="Austin" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <input type="text" value={formData.state} onChange={(e) => updateForm('state', e.target.value)}
              className={inputClass} placeholder="TX" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
            <input type="text" value={formData.zip} onChange={(e) => updateForm('zip', e.target.value)}
              className={inputClass} placeholder="78701" />
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Website (optional)</label>
          <input type="url" value={formData.website} onChange={(e) => updateForm('website', e.target.value)}
            className={inputClass} placeholder="https://sunrisehomecare.com" />
        </div>
      </div>
    </div>
  )
}

function AccountStep({ formData, updateForm, showPassword, setShowPassword, agreedToTerms, setAgreedToTerms }: any) {
  const inputClass = 'w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 text-gray-900 text-sm'
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Create your admin account</h2>
      <p className="text-gray-500 mb-6">You'll be the primary administrator of your agency's platform.</p>

      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
          <input type="text" value={formData.firstName} onChange={(e) => updateForm('firstName', e.target.value)}
            className={inputClass} placeholder="Sarah" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
          <input type="text" value={formData.lastName} onChange={(e) => updateForm('lastName', e.target.value)}
            className={inputClass} placeholder="Johnson" />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
          <input type="email" value={formData.email} onChange={(e) => updateForm('email', e.target.value)}
            className={inputClass} placeholder="sarah@sunrisehomecare.com" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={(e) => updateForm('password', e.target.value)}
              className={`${inputClass} pr-12`}
              placeholder="Minimum 8 characters"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
          <input type={showPassword ? 'text' : 'password'} value={formData.confirmPassword}
            onChange={(e) => updateForm('confirmPassword', e.target.value)}
            className={inputClass} placeholder="Re-enter password" />
        </div>

        <div className="md:col-span-2 mt-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500 mt-0.5" />
            <span className="text-sm text-gray-600">
              I agree to the <a href="/terms" className="text-teal-600 hover:underline">Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" className="text-teal-600 hover:underline">Privacy Policy</a>,
              including HIPAA-related data handling terms.
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}

function ReviewStep({ plan, price, billingCycle, addonsTotal, selectedAddons, formData, onSubmit, loading }: any) {
  const total = price + addonsTotal
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Review & start your free trial</h2>
      <p className="text-gray-500 mb-6">14 days free, no credit card required. Cancel anytime.</p>

      <div className="bg-teal-50/50 rounded-xl border border-teal-100 p-6 mb-6">
        <h3 className="font-semibold text-gray-900 mb-4">Order Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">{plan.name} Plan ({plan.users} users)</span>
            <span className="font-medium">${price}/mo</span>
          </div>
          {selectedAddons.map((id: string) => {
            const addon = ADDONS.find(a => a.id === id)
            return addon ? (
              <div key={id} className="flex justify-between">
                <span className="text-gray-600">{addon.name}</span>
                <span className="font-medium">+${addon.price}/mo</span>
              </div>
            ) : null
          })}
          <div className="flex justify-between text-xs text-gray-400">
            <span>Billing</span>
            <span className="capitalize">{billingCycle}</span>
          </div>
          <hr className="my-3 border-teal-200" />
          <div className="flex justify-between text-base">
            <span className="text-gray-600">After trial</span>
            <span className="font-bold text-gray-900">${total}/mo</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Due today</span>
            <span className="text-lg font-bold text-teal-600">$0.00</span>
          </div>
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-5 mb-6 text-sm">
        <h4 className="font-medium text-gray-900 mb-2">Agency Details</h4>
        <div className="grid grid-cols-2 gap-2 text-gray-600">
          <div><span className="text-gray-400">Agency:</span> {formData.companyName}</div>
          <div><span className="text-gray-400">Email:</span> {formData.email}</div>
          <div><span className="text-gray-400">Phone:</span> {formData.phone}</div>
          <div><span className="text-gray-400">Admin:</span> {formData.firstName} {formData.lastName}</div>
          {formData.city && <div><span className="text-gray-400">Location:</span> {formData.city}, {formData.state}</div>}
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading}
        className="w-full bg-teal-600 text-white py-4 rounded-xl font-semibold hover:bg-teal-700 disabled:opacity-50 flex items-center justify-center gap-2 text-lg transition"
      >
        {loading ? (
          <><Loader2 className="w-5 h-5 animate-spin" /> Creating your account...</>
        ) : (
          <><Heart className="w-5 h-5" /> Start 14-Day Free Trial</>
        )}
      </button>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-5 text-gray-400 text-xs">
        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Cancel anytime</div>
        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> No credit card needed</div>
        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Full platform access</div>
        <div className="flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Free onboarding call</div>
      </div>
    </div>
  )
}
