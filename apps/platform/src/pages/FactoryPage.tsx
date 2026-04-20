import { useState, useEffect } from 'react'
import { useSearchParams, useParams } from 'react-router-dom'
import { CheckCircle, Users, Package, Building2, Globe, Palette, LayoutTemplate, Settings2, Zap, Sparkles, Download, CreditCard } from 'lucide-react'
import { supabase } from '../supabase'
import { DEFAULT_CONFIG, type FactoryConfig } from '../components/factory/types'
import StepPlan from '../components/factory/StepPlan'
import StepCustomer from '../components/factory/StepCustomer'
import StepProducts from '../components/factory/StepProducts'
import StepCompany from '../components/factory/StepCompany'
import StepDomain from '../components/factory/StepDomain'
import StepBranding from '../components/factory/StepBranding'
import StepWebsiteTemplate from '../components/factory/StepWebsiteTemplate'
import StepFeatures from '../components/factory/StepFeatures'
import StepIntegrations from '../components/factory/StepIntegrations'
import StepContent from '../components/factory/StepContent'
import StepGenerate from '../components/factory/StepGenerate'
import { type ProductLine, type PlanSelection, PLANS_BY_PRODUCT } from '../components/factory/planData'

const WIZARD_STEPS = [
  { label: 'Customer', icon: Users },
  { label: 'Products', icon: Package },
  { label: 'Company', icon: Building2 },
  { label: 'Domain', icon: Globe },
  { label: 'Branding', icon: Palette },
  { label: 'Template', icon: LayoutTemplate },
  { label: 'Features', icon: Settings2 },
  { label: 'Integrations', icon: Zap },
  { label: 'Content', icon: Sparkles },
  { label: 'Generate', icon: Download },
]

const DEFAULT_PLAN: PlanSelection = {
  product: 'build',
  planId: '',
  billingCycle: 'monthly',
  setupTierId: 'basic',
  addonIds: [],
}

export default function FactoryPage() {
  const [searchParams] = useSearchParams()
  const { product: urlProduct } = useParams<{ product?: string }>()

  // Determine if we entered via /signup/:product (customer-facing signup)
  const signupProduct = (urlProduct || searchParams.get('product')) as ProductLine | null
  const hasPlanStep = !!signupProduct && ['build', 'care', 'wrench', 'roof', 'leaf'].includes(signupProduct)
  const isPublicSignup = hasPlanStep // public signup = light theme, friendly language

  const [plan, setPlan] = useState<PlanSelection>(() => {
    const p: PlanSelection = { ...DEFAULT_PLAN }
    if (hasPlanStep) {
      p.product = signupProduct!
      // Pre-select plan from URL param if provided
      const urlPlan = searchParams.get('plan')
      if (urlPlan) {
        const match = PLANS_BY_PRODUCT[signupProduct!]?.find(
          pl => pl.id === `${signupProduct}-${urlPlan}` || pl.id === urlPlan
        )
        if (match) p.planId = match.id
      }
    }
    return p
  })

  // Step 0 = Plan (only when hasPlanStep), then normal wizard steps
  const [step, setStep] = useState(hasPlanStep ? -1 : 0)
  const [config, setConfig] = useState<FactoryConfig>(DEFAULT_CONFIG)

  const STEPS = hasPlanStep
    ? [{ label: 'Plan', icon: CreditCard }, ...WIZARD_STEPS]
    : WIZARD_STEPS

  // Map internal step (-1 for plan step) to display index
  const displayStep = hasPlanStep ? step + 1 : step

  useEffect(() => {
    const tenantId = searchParams.get('tenant')
    if (tenantId) {
      Promise.resolve(supabase.from('tenants').select('*').eq('id', tenantId).single()).then(({ data }) => {
        if (data) {
          setConfig(prev => ({
            ...prev,
            tenant_id: data.id,
            tenant_name: data.name,
            tenant_slug: data.slug,
            company: { ...prev.company, name: data.name, email: data.email || '', phone: data.phone || '', city: data.city || '', state: data.state || '', industry: data.industry || '' },
          }))
        }
      }).catch(() => {})
    }
  }, [searchParams])

  const update = (patch: Partial<FactoryConfig>) =>
    setConfig(prev => ({ ...prev, ...patch }))

  const updateNested = <K extends keyof FactoryConfig>(key: K, patch: Partial<FactoryConfig[K]>) =>
    setConfig(prev => ({ ...prev, [key]: { ...(prev[key] as object), ...patch } }))

  const maxStep = hasPlanStep ? WIZARD_STEPS.length - 1 : WIZARD_STEPS.length - 1
  const minStep = hasPlanStep ? -1 : 0
  const next = () => setStep(s => Math.min(s + 1, maxStep))
  const back = () => setStep(s => Math.max(s - 1, minStep))
  const reset = () => {
    setStep(hasPlanStep ? -1 : 0)
    setConfig(DEFAULT_CONFIG)
    setPlan(p => ({ ...DEFAULT_PLAN, product: p.product }))
  }

  // Each vertical's signup matches its default website theme
  const PRODUCT_STYLES: Record<string, { label: string; accent: string; accentLight: string; bg: string; font: string; fontUrl: string; tagline: string }> = {
    build: { label: 'Contractor', accent: '#f5a623', accentLight: '#fef3c7', bg: '#1a1a1a', font: "'Oswald', sans-serif", fontUrl: 'Oswald:wght@400;600;700', tagline: 'CRM, website, and project management for contractors.' },
    care: { label: 'Home Care', accent: '#be185d', accentLight: '#fdf2f8', bg: '#fdf8f4', font: "'Playfair Display', serif", fontUrl: 'Playfair+Display:wght@400;600;700', tagline: 'Scheduling, care plans, and compliance for home care agencies.' },
    wrench: { label: 'Field Service', accent: '#0ea5e9', accentLight: '#e0f2fe', bg: '#0f1729', font: "'Rajdhani', sans-serif", fontUrl: 'Rajdhani:wght@400;500;600;700', tagline: 'Dispatch, invoicing, and fleet management for service companies.' },
    roof: { label: 'Roofing', accent: '#f5a623', accentLight: '#fef3c7', bg: '#111111', font: "'Oswald', sans-serif", fontUrl: 'Oswald:wght@400;600;700', tagline: 'Estimates, storm tracking, and measurement tools for roofers.' },
    leaf: { label: 'Dispensary', accent: '#a855f7', accentLight: '#f3e8ff', bg: '#0a0a0a', font: "'Outfit', sans-serif", fontUrl: 'Outfit:wght@400;500;600;700', tagline: 'POS, menu management, and compliance for dispensaries.' },
  }
  const ps = isPublicSignup ? PRODUCT_STYLES[signupProduct!] || PRODUCT_STYLES.build : null

  return (
    <div className={`p-8 max-w-5xl mx-auto ${isPublicSignup ? 'min-h-screen' : ''}`}
      style={isPublicSignup ? { background: '#fff' } : undefined}>
      <div className="mb-8">
        <h1 className={`text-2xl font-bold ${isPublicSignup ? 'text-gray-900' : 'text-white'}`}>
          {isPublicSignup && ps ? `Get Started — ${ps.label} Software` : 'Twomiah Factory'}
        </h1>
        <p className={`text-sm mt-1 ${isPublicSignup ? 'text-gray-500' : 'text-gray-400'}`}>
          {isPublicSignup && ps ? ps.tagline : 'Generate a deployable software package for your customer'}
        </p>
        {displayStep > 0 && (
          <button onClick={reset} className={`text-xs underline mt-1 transition-colors ${isPublicSignup ? 'text-gray-400 hover:text-gray-600' : 'text-gray-600 hover:text-gray-400'}`}>
            Start over
          </button>
        )}
      </div>
      <div className="flex items-center flex-wrap gap-y-2 mb-8">
        {STEPS.map(({ label, icon: Icon }, i) => {
          const isDone = i < displayStep
          const isActive = i === displayStep
          return (
            <div key={label} className="flex items-center">
              <div
                className={'flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ' + (
                  isPublicSignup
                    ? (isDone ? 'border-green-500 bg-green-50' : !isActive ? 'border-gray-200 bg-white' : '')
                    : (isActive ? 'border-orange-500 bg-orange-500/10' : isDone ? 'border-green-600 bg-green-600/10' : 'border-gray-800 bg-gray-900')
                )}
                style={isPublicSignup && isActive && ps ? { borderColor: ps.accent, backgroundColor: ps.accentLight } : undefined}
              >
                {isDone ? <CheckCircle size={15} className={isPublicSignup ? 'text-green-600' : 'text-green-500'} /> : <Icon size={15}
                  style={isPublicSignup && isActive && ps ? { color: ps.accent } : undefined}
                  className={!isPublicSignup ? (isActive ? 'text-orange-400' : 'text-gray-600') : (!isActive ? 'text-gray-400' : '')}
                />}
                <span
                  className={'text-xs font-medium ' + (
                    isPublicSignup
                      ? (isDone ? 'text-green-700' : !isActive ? 'text-gray-400' : '')
                      : (isActive ? 'text-orange-400' : isDone ? 'text-green-400' : 'text-gray-600')
                  )}
                  style={isPublicSignup && isActive && ps ? { color: ps.accent } : undefined}
                >{label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={'h-px w-4 ' + (
                isPublicSignup
                  ? (isDone ? 'bg-green-400' : 'bg-gray-200')
                  : (isDone ? 'bg-green-700' : 'bg-gray-800')
              )} />}
            </div>
          )
        })}
      </div>
      {isPublicSignup && ps && (
        <>
        <link href={`https://fonts.googleapis.com/css2?family=${ps.fontUrl}&display=swap`} rel="stylesheet" />
        <style>{`
          .signup-light { font-family: ${ps.font}; }
          .signup-light h1, .signup-light h2, .signup-light h3 { font-family: ${ps.font}; }
          .signup-light .text-white { color: #111827 !important; }
          .signup-light .text-gray-400 { color: #6b7280 !important; }
          .signup-light .text-gray-500 { color: #6b7280 !important; }
          .signup-light .text-gray-600 { color: #4b5563 !important; }
          .signup-light .text-gray-300 { color: #374151 !important; }
          .signup-light .bg-gray-800 { background-color: ${ps.accentLight} !important; }
          .signup-light .bg-gray-900 { background-color: #ffffff !important; }
          .signup-light .bg-gray-800\\/50 { background-color: ${ps.accentLight} !important; }
          .signup-light .border-gray-700 { border-color: #e5e7eb !important; }
          .signup-light .border-gray-800 { border-color: #e5e7eb !important; }
          .signup-light .hover\\:border-gray-600:hover { border-color: ${ps.accent} !important; }
          .signup-light .hover\\:border-gray-500:hover { border-color: ${ps.accent} !important; }
          .signup-light .border-orange-500 { border-color: ${ps.accent} !important; }
          .signup-light .ring-orange-500\\/20 { --tw-ring-color: ${ps.accent}33 !important; }
          .signup-light .text-orange-400 { color: ${ps.accent} !important; }
          .signup-light .text-red-400 { color: #dc2626 !important; }
          .signup-light .text-green-400 { color: #16a34a !important; }
          .signup-light input[type="color"] { background: #fff !important; border-color: #d1d5db !important; }
          .signup-light input:not([type="color"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]) {
            background: #fff !important; border-color: #d1d5db !important; color: #111827 !important;
          }
          .signup-light input:focus { border-color: ${ps.accent} !important; }
          .signup-light select { background: #fff !important; border-color: #d1d5db !important; color: #111827 !important; }
          .signup-light textarea { background: #fff !important; border-color: #d1d5db !important; color: #111827 !important; }
          .signup-light .font-mono { color: #374151 !important; }
        `}</style>
        </>
      )}
      <div className={
        isPublicSignup
          ? 'signup-light bg-white border border-gray-200 rounded-xl p-8 shadow-sm'
          : 'bg-gray-900 border border-gray-800 rounded-xl p-8'
      }>
        {step === -1 && hasPlanStep && (
          <StepPlan product={signupProduct!} config={config} setConfig={setConfig} plan={plan} setPlan={setPlan} onNext={next} />
        )}
        {step === 0 && <StepCustomer config={config} update={update} onNext={next} />}
        {step === 1 && <StepProducts config={config} update={update} onNext={next} onBack={back} />}
        {step === 2 && <StepCompany config={config} updateNested={updateNested} onNext={next} onBack={back} />}
        {step === 3 && <StepDomain config={config} updateNested={updateNested} onNext={next} onBack={back} />}
        {step === 4 && <StepBranding config={config} updateNested={updateNested} onNext={next} onBack={back} />}
        {step === 5 && <StepWebsiteTemplate config={config} update={update} onNext={next} onBack={back} />}
        {step === 6 && <StepFeatures config={config} setConfig={setConfig} plan={plan} onNext={next} onBack={back} />}
        {step === 7 && <StepIntegrations config={config} updateNested={updateNested} onNext={next} onBack={back} />}
        {step === 8 && <StepContent config={config} setConfig={setConfig} onNext={next} onBack={back} />}
        {step === 9 && <StepGenerate config={config} onBack={back} onReset={reset} />}
      </div>
    </div>
  )
}
