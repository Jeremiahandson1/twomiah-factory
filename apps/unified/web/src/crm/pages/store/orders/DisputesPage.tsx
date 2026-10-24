// Chargebacks at /crm/disputes (2026-10-24, the store upgrade): each dispute Stripe told the store about — the order,
// the amount, the bank's reason, where it stands, and the deadline to send evidence (on the company's clock) — with the
// link to answer it in Stripe's dashboard, where the evidence is uploaded. The owner is emailed when one opens.
// GET /api/admin/disputes is orders:refund (server/crm/store/orders/disputes.ts), and so is the menu item.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../../../api'
import { PageError, errorText } from '../../../../shared'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { cents, listOf } from './lib'

interface Dispute {
  id: string; orderId: string | null; orderNumber: string | null; customerEmail: string | null; amountCents: number; currency: string
  reasonLabel: string; status: string; evidenceDueBy: string | null; respondUrl: string; createdAt: string
}

/** Still the shop's to answer: Stripe is waiting for evidence. */
const OPEN = ['warning_needs_response', 'needs_response']
const badge = (s: string) => OPEN.includes(s)
  ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300'
  : s === 'won' ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
    : s === 'lost' ? 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'

export default function DisputesPage() {
  const [rows, setRows] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.get('/api/admin/disputes').then((r) => setRows(listOf<Dispute>(r))).catch((e) => setError(errorText(e, 'Could not load the disputes'))).finally(() => setLoading(false))
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Disputes</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400">Chargebacks opened by a customer's bank. Answer each in Stripe before its deadline — the evidence (receipt, tracking, messages) is sent there.</p>
      </div>
      <PageError message={error} />
      {loading ? <p className="text-sm text-gray-600 dark:text-slate-400">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-gray-600 dark:text-slate-400">No disputes. When a bank opens one on a Stripe payment it shows here, and you are emailed.</p>
      ) : (
        <div className="card divide-y divide-gray-200 dark:divide-slate-800">
          {rows.map((d) => (
            <div key={d.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-gray-900 dark:text-slate-100">{cents(d.amountCents, d.currency)}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge(d.status)}`}>{codeLabel(d.status)}</span>
                </div>
                <div className="text-sm text-gray-700 dark:text-slate-300">
                  {d.orderId ? <Link to={`/crm/orders/${d.orderId}`} className="font-medium text-orange-900 hover:underline dark:text-orange-200">{d.orderNumber || 'Order'}</Link> : 'No matching order'}
                  {d.customerEmail ? <span className="break-all"> · {d.customerEmail}</span> : null}
                  {' · '}{d.reasonLabel}
                </div>
                <div className={`text-xs ${OPEN.includes(d.status) ? 'text-red-800 dark:text-red-300 font-medium' : 'text-gray-600 dark:text-slate-400'}`}>
                  {d.evidenceDueBy ? `Evidence due ${whenDateTime(d.evidenceDueBy)}` : 'No deadline given'} · opened {whenDateTime(d.createdAt)}
                </div>
              </div>
              <a href={d.respondUrl} target="_blank" rel="noreferrer" className="btn btn-secondary px-3 py-1.5 text-xs">{OPEN.includes(d.status) ? 'Respond in Stripe' : 'View in Stripe'}</a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
