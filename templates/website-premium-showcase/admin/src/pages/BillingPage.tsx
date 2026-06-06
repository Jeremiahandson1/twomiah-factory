import { useEffect, useState } from 'react'
import { CreditCard, ExternalLink, Loader2, Sparkles, CheckCircle2, Users, FileText, ClipboardList } from 'lucide-react'
import { api } from '../api/client'

export function BillingPage() {
  const [loading, setLoading] = useState(false)
  const [crmLoading, setCrmLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [crmError, setCrmError] = useState<string | null>(null)
  const [crmStatus, setCrmStatus] = useState<'inactive' | 'ordered' | 'active'>('inactive')

  // Read ?crm= status from URL (set by Stripe Checkout success/cancel
  // return). We don't store it client-side beyond the page load — the
  // tenants.products in Supabase is the source of truth long-term.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('crm') === 'ordered') setCrmStatus('ordered')
    // 'active' would be derived from /api/admin/me.products in V2 when
    // we wire that. V1 relies on the post-Checkout banner + email.
  }, [])

  const openPortal = async () => {
    setLoading(true); setError(null)
    try {
      const { url } = await api.get<{ url: string }>('/api/admin/billing-portal')
      window.location.href = url
    } catch (e: any) {
      setError(e.message); setLoading(false)
    }
  }

  const startCrmCheckout = async () => {
    setCrmLoading(true); setCrmError(null)
    try {
      const { url } = await api.get<{ url: string }>('/api/admin/checkout/crm-addon')
      window.location.href = url
    } catch (e: any) {
      setCrmError(e.message); setCrmLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl text-ink">Billing</h1>
        <p className="text-muted text-sm mt-1">Subscription, payment method, invoices, and add-ons.</p>
      </div>

      {crmStatus === 'ordered' && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-5 py-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-green-900 text-sm">Thanks — CRM is on the way.</div>
            <div className="text-green-800 text-sm mt-0.5">
              We'll provision your CRM within 24 hours and email you when it's live.
              Use the same email and password you sign in here with.
            </div>
          </div>
        </div>
      )}

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

      {crmStatus !== 'active' && (
        <section className="card card-padding mt-6 border-2 border-dashed border-orange-200">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-orange-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-baseline justify-between gap-4 mb-1">
                <h2 className="text-lg text-ink">Add the Twomiah CRM</h2>
                <span className="text-orange-600 font-semibold whitespace-nowrap">+ $49 / month</span>
              </div>
              <p className="text-sm text-ink-soft mb-4">
                Track contacts, run a sales pipeline, send quotes and invoices, schedule jobs — all wired
                into the leads and bookings already flowing through your site. Same login as your admin here.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                <div className="flex items-center gap-2 text-sm text-ink-soft"><Users className="w-4 h-4 text-orange-500" /> Contacts &amp; pipeline</div>
                <div className="flex items-center gap-2 text-sm text-ink-soft"><FileText className="w-4 h-4 text-orange-500" /> Quotes &amp; invoices</div>
                <div className="flex items-center gap-2 text-sm text-ink-soft"><ClipboardList className="w-4 h-4 text-orange-500" /> Jobs &amp; scheduling</div>
              </div>
              <button
                onClick={startCrmCheckout}
                disabled={crmLoading || crmStatus === 'ordered'}
                className="btn-primary btn-md inline-flex items-center gap-2 disabled:opacity-40"
              >
                {crmLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {crmLoading ? 'Starting checkout…' : crmStatus === 'ordered' ? 'CRM ordered' : 'Add CRM — $49/mo'}
              </button>
              {crmError && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">{crmError}</div>}
              <p className="text-xs text-muted mt-3">
                Cancel anytime from the billing portal — your website keeps running, only the CRM stops.
              </p>
            </div>
          </div>
        </section>
      )}

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
