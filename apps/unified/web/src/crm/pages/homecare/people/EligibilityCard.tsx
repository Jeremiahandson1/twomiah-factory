// Moved from templates/crm-homecare/frontend/src/components/admin/EligibilityCard.tsx.
// Wisconsin caregiver eligibility, read from the caregiver's latest WORCS background check against the statutory bar
// list (Wis. Stat. § 50.065 / § 48.685 / DHS 12). Rendered only for a Wisconsin agency — see isWisconsinAgency().
//
// GET  /api/background-checks/caregiver/:id/eligibility (care-hr:read) → { status, matches, summary, recommendation }
//      (hr/backgroundChecks.ts → core/eligibilityEngine.ts; each match keeps the engine's own keys: statute,
//      short_title, description, severity).
// POST /api/background-checks/poll-now (care-hr:update).
import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/http'
import { useMay } from '../lib/useMay'

const STATUS_META: Record<string, { label: string; icon: string; cls: string }> = {
  clear:          { label: 'Cleared',                            icon: '✅', cls: 'bg-green-50 text-green-900 border-green-600 dark:bg-green-900/30 dark:text-green-100 dark:border-green-500' },
  flagged_review: { label: 'Flagged — admin review needed',      icon: '⚠️', cls: 'bg-amber-50 text-amber-900 border-amber-600 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-500' },
  rehab_review:   { label: 'Requires DHS rehabilitation review', icon: '🔎', cls: 'bg-yellow-50 text-yellow-900 border-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-100 dark:border-yellow-500' },
  disqualified:   { label: 'Disqualified — cannot hire',         icon: '⛔', cls: 'bg-red-50 text-red-900 border-red-600 dark:bg-red-900/30 dark:text-red-100 dark:border-red-500' },
}
const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  permanent_bar: { label: 'Permanent bar',         cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
  rehab_review:  { label: 'Rehabilitation review', cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200' },
  advisory:      { label: 'Advisory',              cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
}

interface EligibilityMatch { statute: string; short_title: string; description: string | null; severity: string }
interface Eligibility { status: string; summary: string; recommendation?: string | null; matches?: EligibilityMatch[] }

export const isWisconsinAgency = (company: { state?: string | null } | null | undefined) =>
  String(company?.state || '').trim().toUpperCase() === 'WI'

export default function EligibilityCard({ caregiverId }: { caregiverId: string }) {
  // Polling WORCS is care-hr:update, the server's check (lib/useMay.ts).
  const mayHr = useMay('care-hr')
  const [data, setData] = useState<Eligibility | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.get(`/api/background-checks/caregiver/${caregiverId}/eligibility`))
    } catch (err) {
      console.error('EligibilityCard load error:', err)
    } finally {
      setLoading(false)
    }
  }, [caregiverId])

  useEffect(() => { load() }, [load])

  const pollNow = async () => {
    setPolling(true)
    try {
      // As the template: a refused poll still reloads the card (its answer is the card's).
      await api.post('/api/background-checks/poll-now').catch(() => undefined)
      await load()
    } finally {
      setPolling(false)
    }
  }

  const card = 'rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 mb-4'
  if (loading) return <div className={`${card} text-gray-700 dark:text-slate-200`}>Loading eligibility analysis…</div>
  if (!data) return null
  const meta = STATUS_META[data.status] || STATUS_META.flagged_review

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="font-extrabold text-gray-900 dark:text-slate-100">🛡️ Wisconsin Caregiver Eligibility Analysis</div>
        {mayHr.update && <button onClick={pollNow} disabled={polling}
          className="px-3 py-1.5 rounded-lg border-2 border-primary-600 bg-white dark:bg-slate-800 text-primary-700 dark:text-primary-200 text-sm font-bold disabled:opacity-60">
          {polling ? 'Checking…' : 'Poll WORCS Now'}
        </button>}
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
          {data.matches.map((m, i) => {
            const sev = SEVERITY_META[m.severity] || SEVERITY_META.advisory
            return (
              <div key={i} className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 px-4 py-3 mb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-gray-900 dark:text-slate-100">{m.statute}</strong>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${sev.cls}`}>{sev.label}</span>
                </div>
                <div className="text-sm text-gray-700 dark:text-slate-200 mt-1">{m.short_title}</div>
                {m.description && <div className="text-xs text-gray-600 dark:text-slate-300 mt-1">{m.description}</div>}
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-3 rounded-md bg-gray-100 dark:bg-slate-900 px-3 py-2 text-xs text-gray-600 dark:text-slate-300">
        This automated analysis is a review tool. The final hiring decision must be made by an agency administrator per
        Wisconsin caregiver law. If the applicant is disqualified, provide them a copy of the WORCS report and an FCRA summary
        of rights before taking final adverse action.
      </div>
    </div>
  )
}
