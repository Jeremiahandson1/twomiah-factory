import { useEffect, useState } from 'react'
import { Check, ChevronRight, Rocket, CreditCard, Package, Mail, ExternalLink } from 'lucide-react'
import api from '../services/api'
import PaymentsPage from './PaymentsPage'
import { EmailAliasesStep } from '../shared'

// Store onboarding — follows the money: a store can't sell without a payment
// rail and at least one product. Payments embeds the real PaymentsPage (its
// backend at /api/admin/payments predates this wizard); Branded Email is the
// shared step (backed by /api/email-aliases). Completion sets
// store_settings.onboarding_completed_at and reloads so the OnboardingGate
// re-fetches settings and lets the owner through.

const STEPS = ['Welcome', 'Payments', 'First Product', 'Branded Email', 'All Set!']

const STEP_KEY = 'storeOnboardingStep'

export default function OnboardingWizard() {
  // Persist progress: closing the tab mid-setup used to drop you back to step 1.
  const [currentStep, setCurrentStep] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STEP_KEY))
    return Number.isInteger(saved) && saved >= 0 && saved <= STEPS.length - 1 ? saved : 0
  })
  const [storeName, setStoreName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { localStorage.setItem(STEP_KEY, String(currentStep)) }, [currentStep])

  useEffect(() => {
    api.getSettings().then(s => { if (s?.companyName) setStoreName(s.companyName) }).catch(() => {})
  }, [])

  const handleComplete = async () => {
    setSaving(true)
    setError('')
    try {
      await api.completeOnboarding()
      localStorage.removeItem(STEP_KEY)
      // Full reload on purpose — the OnboardingGate re-fetches settings on mount.
      window.location.assign('/')
    } catch (err: any) {
      setError(err?.message || 'Could not save onboarding status')
      setSaving(false)
    }
  }

  const Nav = ({ backTo, nextLabel, onNext }: { backTo: number | null; nextLabel: string; onNext: () => void }) => (
    <div className="flex justify-between mt-6">
      {backTo !== null
        ? <button onClick={() => setCurrentStep(backTo)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md text-sm">Back</button>
        : <div />}
      <button onClick={onNext} className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg">
        {nextLabel} <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex justify-center pt-10 pb-4 px-4">
        <div className="flex items-center gap-2 sm:gap-3">
          {STEPS.map((label, idx) => (
            <div key={label} className="flex items-center gap-2 sm:gap-3">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                  ${idx < currentStep ? 'bg-primary-600 text-white'
                    : idx === currentStep ? 'bg-primary-600 text-white ring-4 ring-primary-100'
                    : 'bg-gray-200 text-gray-500'}`}>
                  {idx < currentStep ? <Check className="w-4 h-4" /> : idx + 1}
                </div>
                <span className={`text-xs hidden sm:block ${idx <= currentStep ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>{label}</span>
              </div>
              {idx < STEPS.length - 1 && <div className={`w-6 sm:w-12 h-0.5 ${idx < currentStep ? 'bg-primary-600' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-3xl">
          {currentStep === 0 && (
            <div className="bg-white rounded-xl shadow-sm p-8 max-w-2xl mx-auto">
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome{storeName ? `, ${storeName}` : ''} 👋</h1>
              <p className="text-gray-600 mb-6">Your storefront and back-office are live. Three quick steps and you're ready to take orders.</p>
              <ul className="space-y-3 mb-6 text-sm text-gray-700">
                <li className="flex items-start gap-3"><CreditCard className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" /> Connect your payment account — Stripe, Square, or PayPal. You get paid directly; we never touch the money.</li>
                <li className="flex items-start gap-3"><Package className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" /> Add your first product so the storefront has something to sell.</li>
                <li className="flex items-start gap-3"><Mail className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" /> Set up branded email — <span className="font-mono">support@</span> and <span className="font-mono">orders@</span> on your domain, forwarding wherever you read mail.</li>
              </ul>
              <Nav backTo={null} nextLabel="Let's go" onNext={() => setCurrentStep(1)} />
            </div>
          )}

          {currentStep === 1 && (
            <div>
              <PaymentsPage />
              <div className="max-w-2xl mx-auto">
                <Nav backTo={0} nextLabel="Continue" onNext={() => setCurrentStep(2)} />
                <p className="text-xs text-gray-400 text-center mt-2">You can finish connecting payments later from the Payments page — but the storefront can't check anyone out until you do.</p>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="bg-white rounded-xl shadow-sm p-8 max-w-2xl mx-auto">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Add your first product</h2>
              <p className="text-gray-600 mb-6">The product editor opens in a new tab so you don't lose your place here. Name, price, photos, inventory — one product is enough to go live.</p>
              <button onClick={() => window.open('/products/new', '_blank', 'noopener')} className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg mb-2">
                Open the product editor <ExternalLink className="w-4 h-4" />
              </button>
              <Nav backTo={1} nextLabel="Continue" onNext={() => setCurrentStep(3)} />
            </div>
          )}

          {currentStep === 3 && (
            <div className="max-w-2xl mx-auto">
              <EmailAliasesStep productId="crm-store" onBack={() => setCurrentStep(2)} onNext={() => setCurrentStep(4)} />
            </div>
          )}

          {currentStep === 4 && (
            <div className="bg-white rounded-xl shadow-sm p-8 text-center max-w-2xl mx-auto">
              <div className="w-14 h-14 rounded-full bg-primary-600 text-white flex items-center justify-center mx-auto mb-4">
                <Rocket className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">You're all set</h1>
              <p className="text-gray-600 mb-6">Orders, customers, discounts, and everything else lives in the sidebar. Payments and email can be revisited any time from Settings.</p>
              {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
              <button onClick={handleComplete} disabled={saving} className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
                {saving ? 'Saving…' : 'Go to Dashboard'} <Rocket className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Escape hatch — nobody should be locked out of their own admin while
              they finish setup. Skipping marks onboarding done; every step can be
              revisited from Settings. */}
          {currentStep < 4 && (
            <div className="text-center mt-6">
              <button onClick={handleComplete} disabled={saving} className="text-sm text-gray-500 hover:text-gray-700 underline disabled:opacity-50">
                {saving ? 'Saving…' : "Skip setup for now — I'll finish from Settings later"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
