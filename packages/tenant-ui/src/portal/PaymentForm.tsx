// Portal card payment for an invoice. The publishable key and client secret both come from the public
// /api/stripe/portal/payment-intent call (the owner-side /api/stripe/config needs a login the customer does not have).
import React, { useState, useEffect } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { CreditCard, Lock, Loader2, Check, AlertCircle } from 'lucide-react'
import { API_URL } from './PortalContext'

const stripeByKey = new Map<string, Promise<Stripe | null>>()
export const getStripe = (publishableKey: string) => {
  let p = stripeByKey.get(publishableKey)
  if (!p) { p = loadStripe(publishableKey); stripeByKey.set(publishableKey, p) }
  return p
}

interface PaymentFormProps { invoiceId: string; amount: number; portalToken: string; onSuccess?: () => void; onCancel?: () => void; primaryColor?: string }

export function PortalPaymentForm({ invoiceId, amount, portalToken, onSuccess, onCancel, primaryColor }: PaymentFormProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [stripe, setStripe] = useState<Stripe | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/api/stripe/portal/payment-intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoiceId, portalToken, amount }) })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Could not start the payment')
        if (!body.publishableKey) throw new Error('Card payments are not set up yet. Please contact us to pay another way.')
        const s = await getStripe(body.publishableKey)
        if (cancelled) return
        setStripe(s)
        setClientSecret(body.clientSecret)
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to initialize payment')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [invoiceId, amount, portalToken])

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /><span className="ml-2 text-gray-500 dark:text-slate-400">Preparing payment...</span></div>
  if (error) return <div role="alert" className="bg-red-50 text-red-700 p-4 rounded-lg flex items-center gap-3 dark:bg-red-950/40 dark:text-red-300"><AlertCircle className="w-5 h-5 shrink-0" /><span>{error}</span></div>
  if (!clientSecret || !stripe) return null

  return (
    <Elements stripe={stripe} options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: primaryColor || '#f97316', colorBackground: '#ffffff', colorText: '#1f2937', colorDanger: '#dc2626', fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '8px' } } }}>
      <CheckoutForm amount={amount} onSuccess={onSuccess} onCancel={onCancel} />
    </Elements>
  )
}

function CheckoutForm({ amount, onSuccess, onCancel }: { amount: number; onSuccess?: () => void; onCancel?: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setProcessing(true)
    setError(null)
    const { error: submitError } = await elements.submit()
    if (submitError) { setError(submitError.message || 'Submission error'); setProcessing(false); return }
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.href }, redirect: 'if_required' })
    if (confirmError) { setError(confirmError.message || 'Payment confirmation error'); setProcessing(false); return }
    if (paymentIntent?.status === 'succeeded') { setSuccess(true); setTimeout(() => onSuccess?.(), 2000) }
    setProcessing(false)
  }

  if (success) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><Check className="w-8 h-8 text-green-600" /></div>
        <h3 className="text-xl font-bold text-gray-900 mb-2 dark:text-slate-100">Payment Successful!</h3>
        <p className="text-gray-500 dark:text-slate-400">Thank you for your payment.</p>
      </div>
    )
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-gray-50 rounded-lg p-4 text-center dark:bg-slate-800">
        <p className="text-sm text-gray-500 dark:text-slate-400">Payment Amount</p>
        <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
      </div>
      <div className="bg-white rounded-lg border p-4"><PaymentElement options={{ layout: 'tabs' }} /></div>
      {error && <div role="alert" className="bg-red-50 text-red-700 p-3 rounded-lg flex items-center gap-2 text-sm dark:bg-red-950/40 dark:text-red-300"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400"><Lock className="w-3 h-3" /><span>Your payment info is encrypted and secure</span></div>
      <div className="flex gap-3">
        {onCancel && <button type="button" onClick={onCancel} disabled={processing} className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-gray-900 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800">Cancel</button>}
        <button type="submit" disabled={!stripe || processing} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50">
          {processing ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</> : <><CreditCard className="w-4 h-4" /> Pay ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</>}
        </button>
      </div>
    </form>
  )
}

export function PortalPaymentModal({ isOpen, onClose, invoiceId, amount, portalToken, onSuccess, primaryColor }: { isOpen: boolean; onClose: () => void; invoiceId: string; amount: number; portalToken: string; onSuccess?: () => void; primaryColor?: string }) {
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-slate-900">
          <h2 className="text-xl font-bold text-gray-900 mb-6 dark:text-slate-100">Make Payment</h2>
          <PortalPaymentForm invoiceId={invoiceId} amount={amount} portalToken={portalToken} primaryColor={primaryColor} onSuccess={() => { onSuccess?.(); setTimeout(onClose, 2000) }} onCancel={onClose} />
        </div>
      </div>
    </div>
  )
}
