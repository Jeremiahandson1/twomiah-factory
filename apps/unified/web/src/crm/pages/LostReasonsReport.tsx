// Why enquiries were lost (feature lead_lost; server crm/leads/leadLost.ts GET /api/lead-lost/reasons): each reason and how many
// enquiries were lost to it in the last 90 days, the most first (contractor live test 11/07: "There is no report of lost reasons").
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'

interface Reason { id: string; label: string; lost: number; days: number }

export function LostReasonsReport() {
  const [rows, setRows] = useState<Reason[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.get('/api/lead-lost/reasons').then((r: any) => setRows((r?.data || []) as Reason[])).catch((e: Error) => setError(e.message || 'Could not load the lost reasons'))
  }, [])
  const total = (rows || []).reduce((n, r) => n + r.lost, 0)
  const days = rows?.[0]?.days ?? 90
  const shown = (rows || []).filter((r) => r.lost > 0).sort((a, b) => b.lost - a.lost)
  return (
    <section aria-label="Why leads were lost" data-testid="lost-reasons-report" className="mb-6 rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Why leads were lost</h2>
      <p className="text-sm text-gray-600 dark:text-slate-400">The last {days} days{rows ? ` · ${total} lost` : ''}. <Link to="/crm/leads?status=lost" className="text-orange-600 hover:underline dark:text-orange-300">See the lost leads</Link></p>
      {error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows && total === 0 && <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">No leads were marked lost in this time.</p>}
      {shown.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-left text-gray-500 dark:text-slate-400"><th className="py-1 font-medium">Reason</th><th className="py-1 font-medium text-right">Lost</th><th className="py-1 font-medium text-right">Share</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 dark:border-slate-800">
                <td className="py-1.5 text-gray-900 dark:text-slate-100">{r.label}</td>
                <td className="py-1.5 text-right">{r.lost}</td>
                <td className="py-1.5 text-right">{Math.round((r.lost / total) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
