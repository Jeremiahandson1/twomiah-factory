// A project's schedule baseline on the Gantt chart (parity tier 3, contractor; server crm/projects/baselines.ts,
// /api/project-baselines; feature schedule_baseline, not ready): save the schedule as the baseline, then each task's plan against
// where it stands now — days late (+) or early (−) — and the project's finish.
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '../../api'
import { useToast } from '../../shared'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'

interface Row { taskId: string; name: string; state: 'kept' | 'new' | 'removed'; planStart: string | null; planEnd: string | null; nowStart: string | null; nowEnd: string | null; startSlip: number | null; finishSlip: number | null; durationChange: number | null }
interface Compare { baseline: { id: string; name: string; createdAt: string }; rows: Row[]; projectFinishSlip: number | null; planFinish: string | null; nowFinish: string | null }

/** '2026-11-26' → 'Nov 26' — a calendar day, read as written (never through the reader's time zone). */
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—')
const slip = (n: number | null) => (n == null ? '—' : n === 0 ? 'on plan' : n > 0 ? `${n} day${n === 1 ? '' : 's'} late` : `${-n} day${n === -1 ? '' : 's'} early`)
const tone = (n: number | null) => (n == null || n === 0 ? 'text-gray-700 dark:text-slate-300' : n > 0 ? 'text-red-700 dark:text-red-300' : 'text-green-700 dark:text-green-300')

export function ScheduleBaselinePanel({ projectId, projectName, mayPlan }: { projectId: string; projectName: string; mayPlan: boolean }) {
  const toast = useToast()
  const [cmp, setCmp] = useState<Compare | null>(null)
  const [none, setNone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    return api.get(`/api/project-baselines/${projectId}/compare`)
      .then((r: Compare) => { setCmp(r); setNone(false) })
      .catch(() => { setCmp(null); setNone(true) })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true)
    try { await api.post(`/api/project-baselines/${projectId}`, {}); toast.success('Baseline saved'); await load() }
    catch (e: any) { toast.error(e?.message || 'The baseline could not be saved.') } finally { setSaving(false) }
  }

  return (
    <div className="border-b bg-gray-50 px-4 py-3 dark:bg-slate-800 dark:border-slate-700" aria-label={`Baseline for ${projectName}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
          {cmp ? <>Against the {cmp.baseline.name.toLowerCase()} saved {momentDate(cmp.baseline.createdAt, { month: 'short', day: 'numeric' })} — finish {day(cmp.planFinish)} planned, {day(cmp.nowFinish)} now: <span className={tone(cmp.projectFinishSlip)}>{slip(cmp.projectFinishSlip)}</span></> : 'No baseline saved yet.'}
        </p>
        {mayPlan && <button type="button" disabled={saving} onClick={save} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 hover:bg-gray-100 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-700">{saving ? 'Saving…' : cmp ? 'Save a new baseline' : 'Save as baseline'}</button>}
      </div>
      {loading && <Loader2 className="mt-2 h-4 w-4 animate-spin text-gray-500 dark:text-slate-300" />}
      {none && !loading && <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">Save the schedule as its baseline when the plan is agreed; afterwards each task shows how far it has moved.</p>}
      {cmp && !loading && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-gray-600 dark:text-slate-300"><th className="py-1 pr-3 font-medium">Task</th><th className="py-1 pr-3 font-medium">Planned</th><th className="py-1 pr-3 font-medium">Now</th><th className="py-1 pr-3 font-medium">Start</th><th className="py-1 pr-3 font-medium">Finish</th></tr></thead>
            <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
              {cmp.rows.map((r) => (
                <tr key={r.taskId} className="text-gray-900 dark:text-slate-100">
                  <td className="py-1 pr-3">{r.name}{r.state !== 'kept' && <span className="ml-1 text-gray-600 dark:text-slate-400">({r.state === 'new' ? 'added since' : 'removed since'})</span>}</td>
                  <td className="py-1 pr-3">{r.state === 'new' ? '—' : `${day(r.planStart)} – ${day(r.planEnd)}`}</td>
                  <td className="py-1 pr-3">{r.state === 'removed' ? '—' : `${day(r.nowStart)} – ${day(r.nowEnd)}`}</td>
                  <td className={`py-1 pr-3 ${tone(r.startSlip)}`}>{slip(r.startSlip)}</td>
                  <td className={`py-1 pr-3 ${tone(r.finishSlip)}`}>{slip(r.finishSlip)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
