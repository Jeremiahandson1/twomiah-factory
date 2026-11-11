// The company-wide schedule baseline report (parity tier 3, contractor — Buildertrend's baseline report; server
// crm/projects/baselines.ts GET /api/project-baselines/report; feature schedule_baseline, not ready): every project with a saved
// baseline, its planned finish against its finish now, and how many tasks run late, early, were added or taken out since. The
// latest slip first. Opened from the Gantt chart; a project's own comparison is its baseline panel there.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from '../../api'

interface Row {
  projectId: string; name: string; number: string | null; status: string | null
  baseline: { id: string; name: string; createdAt: string }
  planFinish: string | null; nowFinish: string | null; finishSlip: number | null
  late: number; early: number; added: number; removed: number
}
const day = (k: string | null) => (k ? new Date(`${k}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—')
const slipWords = (n: number | null) => (n == null ? '—' : n === 0 ? 'On plan' : n > 0 ? `${n} day${n === 1 ? '' : 's'} late` : `${-n} day${n === -1 ? '' : 's'} early`)

export function BaselineReport() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.get('/api/project-baselines/report').then((r: any) => setRows(r?.projects || [])).catch((e: Error) => setError(e.message || 'The report could not be loaded.'))
  }, [])
  if (error) return <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>
  if (!rows) return <Loader2 className="mt-3 h-5 w-5 animate-spin text-gray-500 dark:text-slate-300" aria-label="Loading" />
  if (!rows.length) return <p className="mt-3 text-sm text-gray-700 dark:text-slate-300">No project has a saved baseline yet. Save one from a project&rsquo;s Baseline button below.</p>
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900" data-testid="baseline-report">
      <table className="w-full text-left text-sm">
        <thead><tr className="text-gray-600 dark:text-slate-300">
          <th className="px-3 py-2 font-medium">Project</th><th className="px-3 py-2 font-medium">Baseline</th><th className="px-3 py-2 font-medium">Planned finish</th>
          <th className="px-3 py-2 font-medium">Finish now</th><th className="px-3 py-2 font-medium">Slip</th><th className="px-3 py-2 font-medium">Tasks late</th>
          <th className="px-3 py-2 font-medium">Early</th><th className="px-3 py-2 font-medium">Added</th><th className="px-3 py-2 font-medium">Taken out</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
          {rows.map((r) => (
            <tr key={r.projectId} className="text-gray-900 dark:text-slate-100">
              <td className="px-3 py-2"><Link to={`/crm/projects/${r.projectId}`} className="underline">{r.number ? `${r.number} · ` : ''}{r.name}</Link></td>
              <td className="px-3 py-2">{r.baseline.name} <span className="block text-xs text-gray-600 dark:text-slate-400">saved {day(r.baseline.createdAt.slice(0, 10))}</span></td>
              <td className="px-3 py-2">{day(r.planFinish)}</td><td className="px-3 py-2">{day(r.nowFinish)}</td>
              <td className={`px-3 py-2 font-medium ${(r.finishSlip ?? 0) > 0 ? 'text-red-700 dark:text-red-300' : (r.finishSlip ?? 0) < 0 ? 'text-green-800 dark:text-green-300' : ''}`}>{slipWords(r.finishSlip)}</td>
              <td className="px-3 py-2">{r.late}</td><td className="px-3 py-2">{r.early}</td><td className="px-3 py-2">{r.added}</td><td className="px-3 py-2">{r.removed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
