import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle, Users, Package, Building2, Palette, LayoutTemplate, Settings2, Zap, Sparkles, Download } from 'lucide-react'
import { supabase } from '../supabase'
import { DEFAULT_CONFIG, type FactoryConfig } from '../components/factory/types'
import StepCustomer from '../components/factory/StepCustomer'
import StepProducts from '../components/factory/StepProducts'
import StepCompany from '../components/factory/StepCompany'
import StepBranding from '../components/factory/StepBranding'
import StepWebsiteTemplate from '../components/factory/StepWebsiteTemplate'
import StepFeatures from '../components/factory/StepFeatures'
import StepIntegrations from '../components/factory/StepIntegrations'
import StepContent from '../components/factory/StepContent'
import StepGenerate from '../components/factory/StepGenerate'

const STEPS = [
  { label: 'Customer', icon: Users },
  { label: 'Products', icon: Package },
  { label: 'Company', icon: Building2 },
  { label: 'Branding', icon: Palette },
  { label: 'Template', icon: LayoutTemplate },
  { label: 'Features', icon: Settings2 },
  { label: 'Integrations', icon: Zap },
  { label: 'Content', icon: Sparkles },
  { label: 'Generate', icon: Download },
]

export default function FactoryPage() {
  const [searchParams] = useSearchParams()
  const [step, setStep] = useState(0)
  const [config, setConfig] = useState<FactoryConfig>(DEFAULT_CONFIG)

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

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep(s => Math.max(s - 1, 0))
  const reset = () => { setStep(0); setConfig(DEFAULT_CONFIG) }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Twomiah Factory</h1>
        <p className="text-gray-400 text-sm mt-1">Generate a deployable software package for your customer</p>
        {step > 0 && (
          <button onClick={reset} className="text-xs text-gray-600 hover:text-gray-400 underline mt-1 transition-colors">
            Start over
          </button>
        )}
      </div>
      <div className="flex items-center flex-wrap gap-y-2 mb-8">
        {STEPS.map(({ label, icon: Icon }, i) => {
          const isDone = i < step
          const isActive = i === step
          return (
            <div key={label} className="flex items-center">
              <div className={'flex items-center gap-2 px-3 py-2 rounded-lg border-2 transition-all ' + (isActive ? 'border-orange-500 bg-orange-500/10' : isDone ? 'border-green-600 bg-green-600/10' : 'border-gray-800 bg-gray-900')}>
                {isDone ? <CheckCircle size={15} className="text-green-500" /> : <Icon size={15} className={isActive ? 'text-orange-400' : 'text-gray-600'} />}
                <span className={'text-xs font-medium ' + (isActive ? 'text-orange-400' : isDone ? 'text-green-400' : 'text-gray-600')}>{label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={'h-px w-4 ' + (isDone ? 'bg-green-700' : 'bg-gray-800')} />}
            </div>
          )
        })}
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8">
        {step === 0 && <StepCustomer config={config} update={update} onNext={next} />}
        {step === 1 && <StepProducts config={config} update={update} onNext={next} onBack={back} />}
        {step === 2 && <StepCompany config={config} updateNested={updateNested} onNext={next} onBack={back} />}
        {step === 3 && <StepBranding config={config} updateNested={updateNested} onNext={next} onBack={back} />}
        {step === 4 && <StepWebsiteTemplate config={config} update={update} onNext={next} onBack={back} />}
        {step === 5 && <StepFeatures config={config} setConfig={setConfig} onNext={next} onBack={back} />}
        {step === 6 && <StepIntegrations config={config} updateNested={updateNested} onNext={next} onBack={back} />}
        {step === 7 && <StepContent config={config} setConfig={setConfig} onNext={next} onBack={back} />}
        {step === 8 && <StepGenerate config={config} onBack={back} onReset={reset} />}
      </div>
    </div>
  )
}
