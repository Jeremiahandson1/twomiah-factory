// The job page's "Share the revenue" card (server crm/field/teamReportRoutes.ts, /api/team-revenue/jobs/:id/split): when several
// people are on a job, the Team Revenue report shares the job's invoices and payments between them — equally, by the billable
// hours each logged on the job, or by percentages the office sets here. Shown only with the feature on and two or more people.
import { useCallback, useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { Button, errMsg } from '../invoicing/ui'
import { useMayWrite } from '../auth/PermissionsContext'

interface Api { get: (p: string, q?: any) => Promise<any>; put: (p: string, b?: any) => Promise<any> }
interface Toast { success: (m: string) => void; error: (m: string) => void }
interface Split { people: Array<{ key: string; name: string; hours: number }>; mode: 'equal' | 'hours' | 'percent'; percents: Record<string, number>; applied: string; shares: Record<string, number>; note: string | null }

const MODES: Array<['equal' | 'hours' | 'percent', string, string]> = [
  ['equal', 'Equal shares', 'Everyone on the job gets the same part.'],
  ['hours', 'By billable hours', 'Each person’s part follows the billable hours they logged on this job.'],
  ['percent', 'By percent', 'You set each person’s percentage; they must add up to 100.'],
]

export function JobRevenueSplitPanel({ api, toast, jobId, mayUpdate: mayUpdateProp, crewSize }: { api: Api; toast: Toast; jobId: string; mayUpdate: boolean; crewSize: number }) {
  // PUT /api/team-revenue/jobs/:id/split asks jobs:update.
  const mayUpdate = mayUpdateProp && useMayWrite('jobs:update')
  const [split, setSplit] = useState<Split | null>(null)
  const [mode, setMode] = useState<Split['mode']>('equal')
  const [percents, setPercents] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  const load = useCallback(() => api.get(`/api/team-revenue/jobs/${jobId}/split`).then((r) => {
    const s = (r?.data ?? r) as Split
    setSplit(s); setMode(s.mode)
    const even = s.people.length ? Math.floor((10000 / s.people.length)) / 100 : 0
    setPercents(Object.fromEntries(s.people.map((p) => [p.key, String(s.percents?.[p.key] ?? even)])))
  }).catch(() => setSplit(null)), [api, jobId])
  useEffect(() => { void load() }, [load, crewSize])
  if (!split || split.people.length < 2) return null

  const total = split.people.reduce((n, p) => n + (Number(percents[p.key]) || 0), 0)
  const save = async () => {
    setSaving(true); setProblem('')
    try {
      const body = mode === 'percent' ? { mode, percents: Object.fromEntries(split.people.map((p) => [p.key, Number(percents[p.key]) || 0])) } : { mode }
      await api.put(`/api/team-revenue/jobs/${jobId}/split`, body)
      toast.success('Revenue split saved'); await load()
    } catch (e) { setProblem(errMsg(e, 'The split could not be saved')) } finally { setSaving(false) }
  }
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6" data-testid="job-revenue-split">
      <h2 className="font-semibold mb-1 flex items-center gap-2 text-gray-900 dark:text-slate-100"><Users className="w-4 h-4" aria-hidden /> Share the revenue</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-slate-400">How this job’s invoices and payments are shared between the people on it in the Team Revenue report.</p>
      <fieldset disabled={!mayUpdate} className="space-y-2">
        <legend className="sr-only">How to share the revenue</legend>
        {MODES.map(([id, label, hint]) => (
          <label key={id} className="flex items-start gap-2 text-sm text-gray-900 dark:text-slate-100">
            <input type="radio" name={`split-${jobId}`} checked={mode === id} onChange={() => setMode(id)} className="mt-1" />
            <span><span className="font-medium">{label}</span><span className="block text-gray-600 dark:text-slate-400">{hint}</span></span>
          </label>
        ))}
      </fieldset>
      <ul className="mt-3 space-y-2">
        {split.people.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 text-sm text-gray-900 dark:text-slate-100">
            <span>{p.name}{p.hours > 0 ? <span className="text-gray-600 dark:text-slate-400"> · {p.hours} billable h</span> : null}</span>
            {mode === 'percent'
              ? <label className="flex items-center gap-1">
                  <span className="sr-only">Percent for {p.name}</span>
                  <input type="number" min="0" max="100" step="0.01" disabled={!mayUpdate} value={percents[p.key] ?? ''} onChange={(e) => setPercents((x) => ({ ...x, [p.key]: e.target.value }))}
                    className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-right dark:border-slate-600 dark:bg-slate-800" />%
                </label>
              : <span className="tabular-nums text-gray-700 dark:text-slate-300">{Math.round((split.shares[p.key] ?? 0) * 10000) / 100}%</span>}
          </li>
        ))}
      </ul>
      {mode === 'percent' && <p className={`mt-2 text-sm ${Math.abs(total - 100) < 0.005 ? 'text-gray-600 dark:text-slate-400' : 'text-red-700 dark:text-red-300'}`}>Total: {Math.round(total * 100) / 100}%{Math.abs(total - 100) < 0.005 ? '' : ' — must be 100'}</p>}
      {split.note && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{split.note}</p>}
      {problem && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{problem}</p>}
      {mayUpdate && <div className="mt-3"><Button onClick={save} disabled={saving || (mode === 'percent' && Math.abs(total - 100) >= 0.005)}>{saving ? 'Saving…' : 'Save split'}</Button></div>}
    </div>
  )
}
