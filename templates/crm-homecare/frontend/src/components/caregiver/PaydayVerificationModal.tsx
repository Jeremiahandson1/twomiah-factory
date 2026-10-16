// Payday verification — the caregiver confirms or disputes last pay period's hours (ported from CVHC
// PaydayVerificationModal.jsx). Shown only when the agency has switched the prompt on, and it can be
// put off with "Remind me later": CVHC turned its version off because a modal that could not be
// dismissed stood between caregivers and the clock-in button.
import { useState } from 'react';
import { API_BASE_URL } from '../../config';
import { toast } from '../Toast';

const formatMinutes = (m: number) => { const h = Math.floor(m / 60); const r = m % 60; return r === 0 ? `${h}h` : `${h}h ${r}m`; };
const formatTime = (t: any) => {
  if (!t) return '';
  const [hh, mm] = String(t).split(':');
  const h = parseInt(hh, 10);
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h >= 12 ? 'PM' : 'AM'}`;
};
const formatDay = (d: any) => new Date(String(d).split('T')[0] + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtMoney = (n: any) => `$${parseFloat(n || 0).toFixed(2)}`;

export default function PaydayVerificationModal({ pending, token, onResolved, onLater }: { pending: any; token: string; onResolved: () => void; onLater: () => void }) {
  const [mode, setMode] = useState<'review' | 'dispute'>('review');
  const [disputeReason, setDisputeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (confirmed: boolean) => {
    if (!confirmed && !disputeReason.trim()) { toast('Please describe the issue so we can investigate.', 'warning'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/payroll-verification/me/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          payPeriodStart: pending.payPeriodStart, payPeriodEnd: pending.payPeriodEnd, confirmed,
          disputeReason: confirmed ? null : disputeReason.trim(),
          reportedTotalHours: pending.totalHours, reportedGrossPay: pending.grossPay,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to submit');
      toast(confirmed ? 'Thanks — hours confirmed.' : 'Dispute sent to admin. We will review shortly.', 'success');
      onResolved();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

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
              <div className="mb-2 text-sm font-semibold text-gray-800 dark:text-slate-100">Shifts ({pending.shifts.length})</div>
              <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-900 text-left text-gray-700 dark:text-slate-200">
                    <tr><th className="px-2.5 py-2">Date</th><th className="px-2.5 py-2">Client</th><th className="px-2.5 py-2">Scheduled</th><th className="px-2.5 py-2 text-right">Paid</th></tr>
                  </thead>
                  <tbody>
                    {pending.shifts.map((s: any) => (
                      <tr key={s.id} className="border-t border-gray-100 dark:border-slate-700 text-gray-900 dark:text-slate-100">
                        <td className="px-2.5 py-2">{formatDay(s.shift_date)}</td>
                        <td className="px-2.5 py-2">{s.client_first} {s.client_last?.[0]}{s.client_last ? '.' : ''}</td>
                        <td className="px-2.5 py-2 text-xs text-gray-600 dark:text-slate-300">{formatTime(s.scheduled_start)}–{formatTime(s.scheduled_end)}</td>
                        <td className="px-2.5 py-2 text-right font-semibold text-green-700 dark:text-green-300">{formatMinutes(s.payable_minutes || 0)}</td>
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
  );
}
