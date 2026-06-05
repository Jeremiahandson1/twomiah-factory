import { useState } from 'react'
import { CreditCard, ExternalLink, Loader2 } from 'lucide-react'
import { api } from '../api/client'

export function BillingPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openPortal = async () => {
    setLoading(true)
    setError(null)
    try {
      const { url } = await api.get<{ url: string }>('/api/admin/billing-portal')
      window.location.href = url
    } catch (e: any) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl text-ink">Billing</h1>
        <p className="text-muted text-sm mt-1">Subscription, payment method, and invoices.</p>
      </div>

      <section className="card card-padding">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-5 h-5 text-orange-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg text-ink mb-1">Manage your subscription</h2>
            <p className="text-sm text-ink-soft mb-5">
              Open the secure Stripe portal to update your payment method, see past invoices, change billing email,
              or cancel. You'll come back here when you're done.
            </p>
            <button onClick={openPortal} disabled={loading} className="btn-primary btn-md inline-flex items-center gap-2 disabled:opacity-40">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
              {loading ? 'Opening Stripe…' : 'Open billing portal'}
            </button>
            {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">{error}</div>}
          </div>
        </div>
      </section>

      <section className="card card-padding mt-6">
        <h2 className="text-lg text-ink mb-2">Need help?</h2>
        <p className="text-sm text-ink-soft mb-2">
          Subscription questions, refund requests, or anything weird with billing — email
          {' '}<a className="text-orange-600 underline" href="mailto:hello@twomiah.com">hello@twomiah.com</a>{' '}
          and a real person will respond.
        </p>
      </section>
    </div>
  )
}
