// Wisconsin caregiver eligibility, read from the caregiver's latest WORCS background check against
// the statutory bar list (Wis. Stat. § 50.065 / § 48.685 / DHS 12). Ported from CVHC EligibilityCard.jsx.
// Rendered only for a Wisconsin agency — see isWisconsinAgency().
import { useEffect, useState, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

const STATUS_META: Record<string, { label: string; icon: string; cls: string }> = {
  clear:          { label: 'Cleared',                            icon: '✅', cls: 'bg-green-50 text-green-900 border-green-600 dark:bg-green-900/30 dark:text-green-100 dark:border-green-500' },
  flagged_review: { label: 'Flagged — admin review needed',      icon: '⚠️', cls: 'bg-amber-50 text-amber-900 border-amber-600 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-500' },
  rehab_review:   { label: 'Requires DHS rehabilitation review', icon: '🔎', cls: 'bg-orange-50 text-orange-900 border-orange-600 dark:bg-orange-900/30 dark:text-orange-100 dark:border-orange-500' },
  disqualified:   { label: 'Disqualified — cannot hire',         icon: '⛔', cls: 'bg-red-50 text-red-900 border-red-600 dark:bg-red-900/30 dark:text-red-100 dark:border-red-500' },
};
const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  permanent_bar: { label: 'Permanent bar',         cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
  rehab_review:  { label: 'Rehabilitation review', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200' },
  advisory:      { label: 'Advisory',              cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
};

export const isWisconsinAgency = (company: any) => String(company?.state || '').trim().toUpperCase() === 'WI';

export default function EligibilityCard({ caregiverId, token }: { caregiverId: string; token: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const hdr = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/background-checks/caregiver/${caregiverId}/eligibility`, { headers: hdr });
      if (!r.ok) throw new Error('Unable to load eligibility');
      setData(await r.json());
    } catch (err) {
      console.error('EligibilityCard load error:', err);
    } finally {
      setLoading(false);
    }
  }, [caregiverId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const pollNow = async () => {
    setPolling(true);
    try {
      await fetch(`${API_BASE_URL}/api/background-checks/poll-now`, { method: 'POST', headers: hdr });
      await load();
    } finally {
      setPolling(false);
    }
  };

  const card = 'rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 mb-4';
  if (loading) return <div className={`${card} text-gray-700 dark:text-slate-200`}>Loading eligibility analysis…</div>;
  if (!data) return null;
  const meta = STATUS_META[data.status] || STATUS_META.flagged_review;

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="font-extrabold text-gray-900 dark:text-slate-100">🛡️ Wisconsin Caregiver Eligibility Analysis</div>
        <button onClick={pollNow} disabled={polling}
          className="px-3 py-1.5 rounded-lg border-2 border-primary-600 bg-white dark:bg-slate-800 text-primary-700 dark:text-primary-300 text-sm font-bold disabled:opacity-60">
          {polling ? 'Checking…' : 'Poll WORCS Now'}
        </button>
      </div>
      <div className={`rounded-lg border-l-4 px-4 py-3 mb-3 ${meta.cls}`}>
        <div className="font-extrabold">{meta.icon} {meta.label}</div>
        <div className="mt-1 text-sm">{data.summary}</div>
      </div>
      {data.recommendation && (
        <div className="text-sm text-gray-700 dark:text-slate-200 mb-3"><strong>Recommendation:</strong> {data.recommendation}</div>
      )}
      {Array.isArray(data.matches) && data.matches.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-slate-300 mb-2">Matched statutes</div>
          {data.matches.map((m: any, i: number) => {
            const sev = SEVERITY_META[m.severity] || SEVERITY_META.advisory;
            return (
              <div key={i} className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 px-4 py-3 mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-gray-900 dark:text-slate-100">{m.statute}</strong>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${sev.cls}`}>{sev.label}</span>
                </div>
                <div className="text-sm text-gray-700 dark:text-slate-200 mt-1">{m.short_title}</div>
                {m.description && <div className="text-xs text-gray-600 dark:text-slate-300 mt-1">{m.description}</div>}
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 rounded-md bg-gray-100 dark:bg-slate-900 px-3 py-2 text-xs text-gray-600 dark:text-slate-300">
        This automated analysis is a review tool. The final hiring decision must be made by an agency administrator per
        Wisconsin caregiver law. If the applicant is disqualified, provide them a copy of the WORCS report and an FCRA summary
        of rights before taking final adverse action.
      </div>
    </div>
  );
}
