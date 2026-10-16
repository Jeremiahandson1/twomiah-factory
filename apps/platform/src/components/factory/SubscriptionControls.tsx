import { useState } from 'react'
import { supabase, API_URL as API } from '../../supabase'
import { XCircle, RotateCcw, CalendarX, AlertTriangle } from 'lucide-react'

// Cancel a company's subscription from the Factory — the two ways the pros do it (10/14):
//   · at the end of the billing period: the normal one, what a customer asking to leave gets. The existing
//     /customers/:id/offboard — the same thing the customer's own "close account" runs. Reactivate undoes it.
//   · now: refunds, disputed or fraudulent payments, abuse, duplicates. /customers/:id/cancel-now, owner/admin only,
//     a reason, an optional refund of the last payment, and the company name typed to confirm. Cannot be undone —
//     Stripe cannot revive an ended subscription — so the dialog says so.

type Tenant = {
  id: string; name: string; status?: string; billing_status?: string
  stripe_subscription_id?: string | null; next_billing_date?: string | null
  offboard_started_at?: string | null; offboard_grace_ends_at?: string | null
}
type Props = { tenant: Tenant; showToast: (msg: string, type?: 'success' | 'error') => void; onChanged: () => void }

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'refund', label: 'Refund (money-back guarantee)' },
  { value: 'payment_dispute', label: 'Payment dispute / chargeback' },
  { value: 'fraud', label: 'Fraud or stolen card' },
  { value: 'abuse', label: 'Abuse of the service' },
  { value: 'duplicate', label: 'Duplicate sign-up' },
  { value: 'test_account', label: 'Test account' },
  { value: 'other', label: 'Other' },
]
const INPUT = 'w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500'
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—')

async function call(path: string, body: unknown): Promise<{ ok: boolean; data: any }> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { ok: false, data: { error: 'Not signed in' } }
  const res = await fetch(API + '/api/v1/factory/customers/' + path, {
    method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok && data?.success !== false, data }
}

export default function SubscriptionControls({ tenant, showToast, onChanged }: Props) {
  const [dialog, setDialog] = useState<null | 'period_end' | 'now'>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [refund, setRefund] = useState<'none' | 'last_payment'>('none')
  const [typed, setTyped] = useState('')

  const ended = !tenant.stripe_subscription_id && (tenant.billing_status === 'canceled' || tenant.status === 'suspended')
  const scheduled = !!tenant.offboard_started_at && !!tenant.stripe_subscription_id
  if (!tenant.stripe_subscription_id && !ended) return null

  const close = () => { setDialog(null); setReason(''); setNote(''); setRefund('none'); setTyped('') }

  const cancelAtPeriodEnd = async () => {
    setBusy(true)
    const r = await call(tenant.id + '/offboard', { confirm: true, reason: reason || undefined })
    setBusy(false)
    if (r.ok) { showToast('Cancellation scheduled for the end of the billing period'); close(); onChanged() }
    else showToast(r.data?.error || 'Could not schedule the cancellation', 'error')
  }
  const cancelNow = async () => {
    setBusy(true)
    const r = await call(tenant.id + '/cancel-now', { confirm: true, reason, refund, note: note || undefined })
    setBusy(false)
    if (r.ok) {
      const refunded = r.data?.refund?.refunded ? ` and $${(r.data.refund.refunded / 100).toFixed(2)} refunded` : r.data?.refund?.skipped ? ` (no refund: ${r.data.refund.skipped})` : ''
      // Ended in Stripe is not the same as locked in the CRM: the CRM is told by a push that can fail (asleep, or — as
      // home care was until Run 3 — no route to receive it). Say so, rather than "The CRM is locked".
      const lockStep = Array.isArray(r.data?.steps) ? r.data.steps.find((s: any) => s?.step === 'crm_locked') : null
      if (lockStep && lockStep.status !== 'ok') showToast('Subscription ended' + refunded + ' — but the CRM did not confirm the lock: ' + (lockStep.detail || 'it locks on its next subscription sync'), 'error')
      else showToast('Subscription ended' + refunded + (lockStep ? '. The CRM is locked.' : ''))
      close(); onChanged()
    } else showToast(r.data?.error || 'Could not cancel the subscription', 'error')
  }
  const reactivate = async () => {
    setBusy(true)
    const r = await call(tenant.id + '/reactivate', {})
    setBusy(false)
    if (r.ok) { showToast('Cancellation undone — the subscription renews as normal'); onChanged() }
    else showToast(r.data?.error || 'Could not reactivate', 'error')
  }

  return (
    <div className="mt-5 pt-5 border-t border-gray-800">
      <h4 className="text-sm font-semibold text-white mb-2">Subscription</h4>
      {ended ? (
        <p className="text-sm text-gray-400">Ended. The CRM is locked; the company's data is kept until {day(tenant.offboard_grace_ends_at)}. To come back, they subscribe again.</p>
      ) : scheduled ? (
        <div className="space-y-2">
          <p className="text-sm text-amber-300">Cancels at the end of the billing period{tenant.next_billing_date ? ` (${day(tenant.next_billing_date)})` : ''}. No further charges. Data kept until {day(tenant.offboard_grace_ends_at)}.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={reactivate} disabled={busy} className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50"><RotateCcw size={14} />{busy ? 'Working…' : 'Undo cancellation'}</button>
            <button onClick={() => setDialog('now')} disabled={busy} className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-red-700 hover:bg-red-600 text-white rounded-lg disabled:opacity-50"><XCircle size={14} />Cancel now instead…</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setDialog('period_end')} className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-gray-700 hover:bg-gray-600 text-white rounded-lg"><CalendarX size={14} />Cancel at end of billing period…</button>
          <button onClick={() => setDialog('now')} className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-red-700 hover:bg-red-600 text-white rounded-lg"><XCircle size={14} />Cancel now…</button>
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => !busy && close()}>
          <div role="dialog" aria-modal="true" aria-label={dialog === 'now' ? 'Cancel now' : 'Cancel at end of billing period'} className="w-full max-w-md mx-4 p-6 rounded-xl bg-gray-900 border border-gray-700 space-y-4" onClick={(e) => e.stopPropagation()}>
            {dialog === 'period_end' ? (<>
              <h3 className="text-lg font-semibold text-white">Cancel at the end of the billing period</h3>
              <p className="text-sm text-gray-300"><strong className="text-white">{tenant.name}</strong> keeps working until {tenant.next_billing_date ? day(tenant.next_billing_date) : 'the end of what they have paid for'} and is not charged again. They are emailed, their data export is sent, and you can undo it any time before then.</p>
              <label className="block text-xs text-gray-400">Reason (optional)
                <select value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT + ' mt-1'}>
                  <option value="">—</option>
                  {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={close} disabled={busy} className="px-3 py-2 text-sm text-gray-300 hover:text-white">Keep subscription</button>
                <button onClick={cancelAtPeriodEnd} disabled={busy} className="px-3 py-2 text-sm font-medium bg-gray-200 hover:bg-white text-gray-900 rounded-lg disabled:opacity-50">{busy ? 'Scheduling…' : 'Schedule cancellation'}</button>
              </div>
            </>) : (<>
              <h3 className="text-lg font-semibold text-white flex items-center gap-2"><AlertTriangle size={18} className="text-red-400" />Cancel now</h3>
              <p className="text-sm text-gray-300">Ends <strong className="text-white">{tenant.name}</strong>'s subscription immediately. Their CRM locks straight away. Their data is kept and exported for 30 days. <strong className="text-white">This cannot be undone</strong> — to come back they subscribe again.</p>
              <label className="block text-xs text-gray-400">Reason
                <select value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT + ' mt-1'}>
                  <option value="">Choose a reason…</option>
                  {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              <fieldset className="text-sm text-gray-300 space-y-1">
                <legend className="text-xs text-gray-400 mb-1">Refund</legend>
                <label className="flex items-center gap-2"><input type="radio" name="refund" checked={refund === 'none'} onChange={() => setRefund('none')} />No refund</label>
                <label className="flex items-center gap-2"><input type="radio" name="refund" checked={refund === 'last_payment'} onChange={() => setRefund('last_payment')} />Refund their last payment in full</label>
              </fieldset>
              <label className="block text-xs text-gray-400">Note for the audit log (optional)
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={INPUT + ' mt-1'} />
              </label>
              <label className="block text-xs text-gray-400">Type <strong className="text-white">{tenant.name}</strong> to confirm
                <input value={typed} onChange={(e) => setTyped(e.target.value)} className={INPUT + ' mt-1'} autoComplete="off" />
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={close} disabled={busy} className="px-3 py-2 text-sm text-gray-300 hover:text-white">Keep subscription</button>
                <button onClick={cancelNow} disabled={busy || !reason || typed.trim() !== tenant.name.trim()} className="px-3 py-2 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg disabled:opacity-40">{busy ? 'Cancelling…' : refund === 'last_payment' ? 'Refund and cancel now' : 'Cancel now'}</button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  )
}
