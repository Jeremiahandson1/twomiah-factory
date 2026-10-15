// The office's switch for the caregiver payday prompt ("confirm your hours"), plus who confirmed or
// disputed. Off by default — CVHC runs it off — and a dispute also lands in the office's notifications.
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../Toast';

export default function PaydayVerificationSetting() {
  const { token } = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/payroll-verification/settings`, { headers: hdr })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setOn(!!d.paydayVerification)).catch(() => {});
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async () => {
    const next = !on;
    const r = await fetch(`${API_BASE_URL}/api/payroll-verification/settings`, { method: 'PUT', headers: hdr, body: JSON.stringify({ paydayVerification: next }) });
    if (!r.ok) { toast('Could not change the setting', 'error'); return; }
    setOn(next);
    toast(next ? 'Caregivers will be asked to confirm their hours' : 'Payday prompt switched off', 'success');
  };

  const showResponses = async () => {
    setOpen((o) => !o);
    const r = await fetch(`${API_BASE_URL}/api/payroll-verification`, { headers: hdr });
    if (r.ok) setRows(await r.json());
  };

  if (on === null) return null;
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
          <button onClick={toggle} className={`px-3 py-1.5 rounded-lg text-sm font-bold text-white ${on ? 'bg-gray-600 hover:bg-gray-700' : 'bg-teal-700 hover:bg-teal-800'}`}>{on ? 'Turn off' : 'Turn on'}</button>
        </div>
      </div>
      {open && (
        <table className="w-full mt-3 text-sm">
          <thead className="text-left text-gray-600 dark:text-slate-300"><tr><th className="py-1">Caregiver</th><th>Period</th><th>Answer</th><th>Hours / Gross</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={4} className="py-2 text-gray-600 dark:text-slate-300">No responses yet.</td></tr> : rows.map((v) => (
              <tr key={v.id} className="border-t border-gray-100 dark:border-slate-700 text-gray-900 dark:text-slate-100">
                <td className="py-1.5">{v.first_name} {v.last_name}</td>
                <td>{v.pay_period_start} – {v.pay_period_end}</td>
                <td>{v.disputed_at ? <span className="text-red-700 dark:text-red-300 font-semibold">Disputed: {v.dispute_reason}</span> : <span className="text-green-700 dark:text-green-300 font-semibold">Confirmed</span>}</td>
                <td>{v.reported_total_hours ?? '—'}h / ${v.reported_gross_pay ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
