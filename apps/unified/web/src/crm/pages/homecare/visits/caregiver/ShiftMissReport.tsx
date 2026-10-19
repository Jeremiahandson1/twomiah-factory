// Moved from templates/crm-homecare/frontend/src/components/caregiver/ShiftMissReport.tsx — 24/7 self-service shift miss
// reporting.
//
// Server (server/crm/homecare/clients/emergency.ts): GET /api/emergency/my-shifts ({ data }: id (the schedule), date,
// startTime, endTime, clientFirstName, clientLastName — visits still ahead, the next 14 days) and POST
// /api/emergency/miss-report { scheduleId, date, reason, alternativeContact }.
// Changes from the template: no token; the rows are { data } and camelCase (client_first_name → clientFirstName …); the
// app's toast; every colour a light/dark pair (the brand button is the frame's deep brand, white on it in both themes).
import { useEffect, useState } from 'react'
import { api, rows, errorMessage } from '../../lib/http'
import { formatDate, toLocalYMD } from '../../lib/date'
import { formatTime } from '../../lib/datetime'
import { useToast } from '../../../../../shared'

/** A row of GET /api/emergency/my-shifts. */
interface MyShift {
  id: string
  scheduleId?: string
  date: string | null
  startTime: string | null
  endTime: string | null
  clientFirstName: string | null
  clientLastName: string | null
}

const LABEL = 'mb-2 block text-sm font-bold text-gray-700 dark:text-slate-200'
const FIELD = 'w-full rounded-lg border-2 border-gray-200 bg-white p-3 text-base text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

const ShiftMissReport = ({ onClose }: { onClose: () => void }) => {
  const toast = useToast()
  const [upcomingShifts, setUpcomingShifts] = useState<MyShift[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({ scheduleId: '', date: '', reason: '', alternativeContact: '' })

  useEffect(() => {
    api.get('/api/emergency/my-shifts')
      .then((reply) => setUpcomingShifts(rows<MyShift>(reply)))
      .catch(() => { /* the date can still be typed */ })
      .finally(() => setLoading(false))
  }, [])

  const handleShiftSelect = (shift: MyShift) => {
    const dateStr = shift.date ? shift.date.split('T')[0] : ''
    setForm((prev) => ({ ...prev, scheduleId: shift.id, date: dateStr }))
  }

  const handleSubmit = async () => {
    if (!form.date) { toast.warning('Please select a date'); return }
    if (!form.reason.trim()) { toast.warning('Please provide a reason'); return }
    setSubmitting(true)
    try {
      await api.post('/api/emergency/miss-report', form)
      setSubmitted(true)
    } catch (e) {
      // A refusal says why (e.g. that visit is not on your schedule) — show it, not a generic error.
      toast.error(`${errorMessage(e, 'Failed to submit.')} If this is urgent, please call the office directly.`)
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return (
    <div className="p-8 text-center">
      <div className="mb-4 text-5xl" aria-hidden="true">✅</div>
      <h3 className="mb-2 text-lg font-bold text-gray-900 dark:text-slate-100">Report Submitted</h3>
      <p className="mb-6 text-gray-600 dark:text-slate-300">
        Your supervisor has been notified and will contact you shortly about coverage arrangements.
      </p>
      <p className="text-sm text-gray-600 dark:text-slate-400">
        If you don't hear back within 30 minutes, call the office directly.
      </p>
      <button onClick={onClose} className="mt-4 rounded-xl px-6 py-3 text-base font-bold text-white" style={{ background: 'var(--hc-brand-deep)' }}>Done</button>
    </div>
  )

  const canSubmit = !submitting && !!form.date && !!form.reason
  return (
    <div>
      <div className="mb-6 text-center">
        <div className="mb-2 text-4xl" aria-hidden="true">🚨</div>
        <h3 className="m-0 text-xl font-bold text-gray-900 dark:text-slate-100">Report a Missed Shift</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Submit this form to notify your supervisor immediately</p>
      </div>

      {/* Select from upcoming shifts */}
      {!loading && upcomingShifts.length > 0 && (
        <div className="mb-5">
          <label className={LABEL}>Select your shift (optional)</label>
          <div className="flex flex-col gap-2">
            {upcomingShifts.slice(0, 5).map((shift) => {
              // The server lists only visits still ahead (not clocked into, not already over today).
              const shiftDate = shift.date ? formatDate(shift.date, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Recurring'
              // One row per dated visit (a weekly pattern appears once per week): the pattern id AND the date pick it.
              const isSelected = form.scheduleId === shift.id && form.date === (shift.date || '').split('T')[0]
              return (
                <button key={`${shift.id}:${shift.date}`} type="button" onClick={() => handleShiftSelect(shift)}
                  className="rounded-lg border-2 p-3 text-left"
                  style={isSelected
                    ? { borderColor: 'var(--hc-primary)', background: 'var(--color-teal-light)' }
                    : { borderColor: 'var(--hc-line)', background: 'var(--hc-surface)' }}>
                  <div className="text-sm font-semibold" style={{ color: 'var(--hc-ink)' }}>
                    {shift.clientFirstName} {shift.clientLastName}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--hc-ink-soft)' }}>
                    {shiftDate} • {formatTime(shift.startTime)} – {formatTime(shift.endTime)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="mb-4">
        <label className={LABEL}>Date you cannot work *</label>
        <input type="date" value={form.date} className={FIELD}
          onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
          min={toLocalYMD(new Date())} />
      </div>

      <div className="mb-4">
        <label className={LABEL}>Reason *</label>
        <select value={form.reason} className={FIELD} onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}>
          <option value="">Select reason...</option>
          <option value="Illness - not feeling well">Illness — not feeling well</option>
          <option value="Family emergency">Family emergency</option>
          <option value="Car trouble / transportation issue">Car trouble / transportation issue</option>
          <option value="Personal emergency">Personal emergency</option>
          <option value="Prior commitment conflict">Prior commitment conflict</option>
          <option value="Other">Other (add note below)</option>
        </select>
      </div>

      <div className="mb-5">
        <label className={LABEL}>Additional notes (optional)</label>
        <textarea placeholder="Any additional details..." value={form.alternativeContact} rows={3}
          className={`${FIELD} resize-y text-sm`}
          onChange={(e) => setForm((p) => ({ ...p, alternativeContact: e.target.value }))} />
      </div>

      <div className="mb-5 rounded-lg border border-red-300 bg-red-50 p-3.5 dark:border-red-800 dark:bg-red-900/30">
        <p className="m-0 text-sm font-semibold text-red-700 dark:text-red-200">
          ⚠️ Submitting this report notifies your supervisor immediately. If this is an emergency, please also call the office directly.
        </p>
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onClose}
          className="flex-1 rounded-xl border-2 border-gray-300 bg-white py-3.5 text-base font-semibold text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
          Cancel
        </button>
        <button type="button" onClick={handleSubmit} disabled={!canSubmit}
          className="flex-[2] rounded-xl bg-red-700 py-3.5 text-base font-bold text-white disabled:opacity-60 dark:bg-red-700">
          {submitting ? 'Submitting...' : '🚨 Submit Miss Report'}
        </button>
      </div>
    </div>
  )
}

export default ShiftMissReport
