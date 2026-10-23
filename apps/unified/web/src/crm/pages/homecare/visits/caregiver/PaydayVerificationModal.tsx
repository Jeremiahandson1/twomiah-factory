// Moved from templates/crm-homecare/frontend/src/components/caregiver/PaydayVerificationModal.tsx (ported there from CVHC
// PaydayVerificationModal.jsx).
// Payday verification — the caregiver confirms or disputes last pay period's hours. Shown only when the agency has
// switched the prompt on, and it can be put off with "Remind me later": CVHC turned its version off because a modal
// that could not be dismissed stood between caregivers and the clock-in button.
//
// Server: GET /api/payroll-verification/me/pending → { pending } (read by the dashboard) and POST
// /api/payroll-verification/me/verify (server/crm/homecare/payroll/payrollVerification.ts). Changes: no token prop (the
// app's client); the shifts are camelCase (shiftDate, clientFirst, clientLast, scheduledStart, scheduledEnd,
// payableMinutes); the app's toast; the day shown through lib/date (a calendar day, never a bare new Date()).
import { useState } from 'react'
import { api, errorMessage } from '../../lib/http'
import { formatDate } from '../../lib/date'
import { formatTime } from '../../lib/datetime'
import { useToast } from '../../../../../shared'
import { money } from '@twomiah/tenant-ui/src/money'

/** One shift of the period (payroll_shift_reviews). */
export interface PendingShift {
  id: string
  shiftDate: string
  scheduledStart: string | null
  scheduledEnd: string | null
  payableMinutes: number | null
  clientFirst: string | null
  clientLast: string | null
}

/** GET /api/payroll-verification/me/pending → pending. */
export interface PendingVerification {
  payPeriodStart: string
  payPeriodEnd: string
  payDate: string
  shifts: PendingShift[]
  totalHours: number
  hourlyRate: number
  grossPay: number
}

const formatMinutes = (m: number) => { const h = Math.floor(m / 60); const r = m % 60; return r === 0 ? `${h}h` : `${h}h ${r}m` }
const formatDay = (d: string | null | undefined) => formatDate(String(d || '').slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })
const fmtMoney = (n: unknown) => `${money((parseFloat(String(n ?? 0)) || 0))}`

export default function PaydayVerificationModal({ pending, onResolved, onLater }: { pending: PendingVerification; onResolved: () => void; onLater: () => void }) {
  const toast = useToast()
  const [mode, setMode] = useState<'review' | 'dispute'>('review')
  const [disputeReason, setDisputeReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (confirmed: boolean) => {
    if (!confirmed && !disputeReason.trim()) { toast.warning('Please describe the issue so we can investigate.'); return }
    setSubmitting(true)
    try {
      await api.post('/api/payroll-verification/me/verify', {
        payPeriodStart: pending.payPeriodStart, payPeriodEnd: pending.payPeriodEnd, confirmed,
        disputeReason: confirmed ? null : disputeReason.trim(),
        reportedTotalHours: pending.totalHours, reportedGrossPay: pending.grossPay,
      })
      toast.success(confirmed ? 'Thanks — hours confirmed.' : 'Dispute sent to admin. We will review shortly.')
      onResolved()
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to submit'))
    } finally {
      setSubmitting(false)
    }
  }

  const shifts = Array.isArray(pending.shifts) ? pending.shifts : []
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-xl max-h-[90vh] flex-col rounded-2xl bg-white dark:bg-slate-800 shadow-2xl">
        <div className="rounded-t-2xl bg-teal-700 px-6 py-5 text-white">
          <div className="text-sm font-medium text-teal-50">Payday Verification</div>
          <div className="mt-1 text-xl font-bold text-white">Please review your hours</div>
          <div className="mt-2 text-sm text-teal-50">
            Pay period: <strong>{formatDay(pending.payPeriodStart)} – {formatDay(pending.payPeriodEnd)}</strong>
            <br />Expected pay date: <strong>{formatDay(pending.payDate)}</strong>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {mode === 'review' ? (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="rounded-lg bg-gray-100 dark:bg-slate-900 p-3 text-center">
                  <div className="text-xs font-semibold uppercase text-gray-600 dark:text-slate-300">Hours</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-slate-100">{Number(pending.totalHours).toFixed(2)}h</div>
                </div>
                <div className="rounded-lg bg-gray-100 dark:bg-slate-900 p-3 text-center">
                  <div className="text-xs font-semibold uppercase text-gray-600 dark:text-slate-300">Rate</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-slate-100">{fmtMoney(pending.hourlyRate)}</div>
                </div>
                <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30 p-3 text-center">
                  <div className="text-xs font-semibold uppercase text-green-800 dark:text-green-200">Gross Pay</div>
                  <div className="text-xl font-bold text-green-800 dark:text-green-200">{fmtMoney(pending.grossPay)}</div>
                </div>
              </div>
              <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">Shifts ({shifts.length})</div>
              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-900 text-left text-gray-700 dark:text-slate-200">
                    <tr><th className="px-2.5 py-2">Date</th><th className="px-2.5 py-2">Client</th><th className="px-2.5 py-2">Scheduled</th><th className="px-2.5 py-2 text-right">Paid</th></tr>
                  </thead>
                  <tbody>
                    {shifts.map((s) => (
                      <tr key={s.id} className="border-t border-gray-100 dark:border-slate-700 text-gray-900 dark:text-slate-100">
                        <td className="px-2.5 py-2">{formatDay(s.shiftDate)}</td>
                        <td className="px-2.5 py-2">{s.clientFirst} {s.clientLast?.[0]}{s.clientLast ? '.' : ''}</td>
                        <td className="px-2.5 py-2 text-xs text-gray-600 dark:text-slate-300">{formatTime(s.scheduledStart)}–{formatTime(s.scheduledEnd)}</td>
                        <td className="px-2.5 py-2 text-right font-semibold text-green-700 dark:text-green-300">{formatMinutes(s.payableMinutes || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3 text-sm text-amber-900 dark:text-amber-100">
                Gross pay shown is before taxes. Your actual net check will be slightly less after federal, FICA, and state deductions.
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 text-gray-800 dark:text-slate-100">Tell us what's wrong. Be specific — which shift, what date, what you expected vs. what you see.</div>
              <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} rows={6}
                placeholder="e.g. Tuesday with my client — I worked 4 hours but only 3 are showing."
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 p-3" />
              <div className="mt-2 text-sm text-gray-600 dark:text-slate-300">An admin will review and reach out. Payroll for this period may be held until resolved.</div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 dark:border-slate-700 px-6 py-4">
          {mode === 'review' ? (
            <>
              <button onClick={() => setMode('dispute')} disabled={submitting} className="rounded-lg border border-red-600 bg-white dark:bg-slate-800 px-4 py-2.5 font-semibold text-red-700 dark:text-red-300">Something's Wrong</button>
              <button onClick={onLater} disabled={submitting} className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 font-semibold text-gray-700 dark:text-slate-200">Remind me later</button>
              <button onClick={() => submit(true)} disabled={submitting} className="flex-1 rounded-lg bg-teal-700 hover:bg-teal-800 px-5 py-2.5 font-bold text-white">{submitting ? 'Submitting…' : 'Looks Right — Confirm'}</button>
            </>
          ) : (
            <>
              <button onClick={() => setMode('review')} disabled={submitting} className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2.5 font-semibold text-gray-700 dark:text-slate-200">Back</button>
              <button onClick={() => submit(false)} disabled={submitting || !disputeReason.trim()} className="flex-1 rounded-lg bg-red-700 hover:bg-red-800 px-5 py-2.5 font-bold text-white disabled:opacity-50">{submitting ? 'Sending…' : 'Submit Dispute'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
