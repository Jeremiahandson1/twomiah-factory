// Moved from templates/crm-homecare/frontend/src/components/admin/PaydayVerificationSetting.tsx (shown on Payroll).
// The office's switch for the caregiver payday prompt ("confirm your hours"), plus who confirmed or disputed. Off by
// default — CVHC runs it off — and a dispute also lands in the office's notifications.
//
// GET/PUT /api/payroll-verification/settings (care-payroll:update) → { paydayVerification }
// GET     /api/payroll-verification (care-payroll:update) → { data }: firstName, lastName, payPeriodStart, payPeriodEnd,
//         disputedAt, disputeReason, reportedTotalHours, reportedGrossPay (payroll/payrollVerification.ts)
import { useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, rows } from '../lib/http'
import { useMay } from '../lib/useMay'

interface Response {
  id: string
  firstName: string | null
  lastName: string | null
  payPeriodStart: string
  payPeriodEnd: string
  disputedAt: string | null
  disputeReason: string | null
  reportedTotalHours: string | null
  reportedGrossPay: string | null
}

export default function PaydayVerificationSetting() {
  // The switch is care-payroll:update, the server's check (lib/useMay.ts).
  const mayPayroll = useMay('care-payroll')
  const toast = useToast()
  const [on, setOn] = useState<boolean | null>(null)
  const [responses, setResponses] = useState<Response[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    api.get('/api/payroll-verification/settings')
      .then((d: { paydayVerification?: boolean }) => d && setOn(!!d.paydayVerification))
      .catch(() => {})
  }, [])

  const toggle = async () => {
    const next = !on
    try {
      await api.put('/api/payroll-verification/settings', { paydayVerification: next })
    } catch {
      toast.error('Could not change the setting'); return
    }
    setOn(next)
    toast.success(next ? 'Caregivers will be asked to confirm their hours' : 'Payday prompt switched off')
  }

  const showResponses = async () => {
    setOpen((o) => !o)
    try { setResponses(rows<Response>(await api.get('/api/payroll-verification'))) } catch { /* as the template: the list stays */ }
  }

  if (on === null) return null
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-bold text-gray-900 dark:text-slate-100">Payday hours confirmation</div>
          <div className="text-sm text-gray-600 dark:text-slate-300">
            {on ? 'On — after each pay date, caregivers are asked to confirm or dispute last period’s hours. They can put it off, so it never blocks clocking in.'
              : 'Off — caregivers are not asked to confirm their hours.'}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={showResponses} className="px-3 py-1.5 rounded-lg border-2 border-gray-400 bg-white dark:bg-slate-800 text-sm font-bold text-gray-700 dark:text-slate-200">{open ? 'Hide responses' : 'Responses'}</button>
          {mayPayroll.update && <button onClick={toggle} className={`px-3 py-1.5 rounded-lg text-sm font-bold text-white ${on ? 'bg-gray-600 hover:bg-gray-700' : 'bg-teal-700 hover:bg-teal-800'}`}>{on ? 'Turn off' : 'Turn on'}</button>}
        </div>
      </div>
      {open && (
        <table className="w-full mt-3 text-sm">
          <thead className="text-left text-gray-600 dark:text-slate-300"><tr><th className="py-1">Caregiver</th><th>Period</th><th>Answer</th><th>Hours / Gross</th></tr></thead>
          <tbody>
            {responses.length === 0 ? <tr><td colSpan={4} className="py-2 text-gray-600 dark:text-slate-300">No responses yet.</td></tr> : responses.map((v) => (
              <tr key={v.id} className="border-t border-gray-100 dark:border-slate-700 text-gray-900 dark:text-slate-100">
                <td className="py-1.5">{v.firstName} {v.lastName}</td>
                <td>{v.payPeriodStart} – {v.payPeriodEnd}</td>
                <td>{v.disputedAt ? <span className="text-red-700 dark:text-red-300 font-semibold">Disputed: {v.disputeReason}</span> : <span className="text-green-700 dark:text-green-300 font-semibold">Confirmed</span>}</td>
                <td>{v.reportedTotalHours ?? '—'}h / ${v.reportedGrossPay ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
