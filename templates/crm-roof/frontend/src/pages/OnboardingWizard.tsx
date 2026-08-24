import { useState } from 'react'
import { Check, ChevronRight, Rocket, Mail } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { EmailAliasesStep } from '../shared'

// Roof onboarding — deliberately minimal compared to the base crm wizard.
// crm-roof has no general company-update endpoint (only /features), so this
// wizard only touches APIs that exist here: the email-aliases CRUD and the
// shared POST /api/onboarding/complete (sets company.onboardingCompletedAt).
// Completion navigates with a full page load so AuthContext re-fetches
// /api/auth/me and the OnboardingGate sees the fresh flag.

const STEPS = ['Welcome', 'Branded Email', 'All Set!']

export default function OnboardingWizard() {
  const { company } = useAuth()
  const [currentStep, setCurrentStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleComplete = async () => {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('token') || '') },
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Could not save onboarding status')
      }
      // Full reload on purpose — AuthContext re-fetches /me on mount.
      window.location.assign('/crm')
    } catch (err: any) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Step indicators */}
      <div className="flex justify-center pt-10 pb-4 px-4">
        <div className="flex items-center gap-3">
          {STEPS.map((label, idx) => (
            <div key={label} className="flex items-center gap-3">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                  ${idx < currentStep ? 'bg-orange-500 text-white'
                    : idx === currentStep ? 'bg-orange-500 text-white ring-4 ring-orange-200'
                    : 'bg-gray-200 text-gray-500'}`}>
                  {idx < currentStep ? <Check className="w-4 h-4" /> : idx + 1}
                </div>
                <span className={`text-xs hidden sm:block ${idx <= currentStep ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{label}</span>
              </div>
              {idx < STEPS.length - 1 && <div className={`w-10 sm:w-16 h-0.5 ${idx < currentStep ? 'bg-orange-500' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          {currentStep === 0 && (
            <div className="bg-white rounded-xl shadow-sm p-8">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome{company?.name ? ', ' + company.name : ''} 👋</h1>
              <p className="text-gray-600 mb-6">
                Your roofing CRM is ready — pipeline, jobs, insurance claims, crews, and storm tools are all set up.
                Two quick things and you're in.
              </p>
              <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg mb-6">
                <Mail className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-gray-700">
                  Next, we'll set up branded email addresses on your domain — <span className="font-mono">sales@</span>,{' '}
                  <span className="font-mono">estimates@</span>, <span className="font-mono">support@</span> — forwarding
                  wherever you already read email. You can change everything later in Settings.
                </p>
              </div>
              <div className="flex justify-end">
                <button onClick={() => setCurrentStep(1)} className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg">
                  Let's go <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <EmailAliasesStep productId="crm-roof" onBack={() => setCurrentStep(0)} onNext={() => setCurrentStep(2)} />
          )}

          {currentStep === 2 && (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center">
              <div className="w-14 h-14 rounded-full bg-orange-500 text-white flex items-center justify-center mx-auto mb-4">
                <Rocket className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">You're all set</h1>
              <p className="text-gray-600 mb-6">Head to the pipeline and start working leads. Email addresses, features, and integrations live in Settings whenever you need them.</p>
              {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
              <button onClick={handleComplete} disabled={saving} className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 rounded-lg">
                {saving ? 'Saving…' : 'Go to your CRM'} <Rocket className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
