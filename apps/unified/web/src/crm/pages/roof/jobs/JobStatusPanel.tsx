// A roofing job's status inside its milestone, and that status's checklist (roofing parity row 20; AccuLynx Workflow Manager;
// pipeline_statuses, not ready). Server: crm/roof/pipeline.ts (/api/roof-pipeline/jobs/:id/status|checks). The milestone itself is the
// pipeline's (Advance); a status is a step inside it, for this kind of job. The company's statuses are set in Settings › Pipeline.
import { useCallback, useEffect, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { api } from '../../../../api'
import { useAuth, useMayWrite, useToast } from '../../../../shared'
import { stageLabel } from './model'

interface View { milestone: string; choices: Array<{ id: string; name: string }>; current: { id: string; name: string; checklist: Array<{ id: string; text: string }> } | null; checks: Record<string, { at: string; by: string }> }
const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback

export default function JobStatusPanel({ jobId, jobStatus, jobType }: { jobId: string; jobStatus: string; jobType?: string | null }) {
  const toast = useToast()
  const on = useAuth().hasFeature('pipeline_statuses')
  const mayChange = useMayWrite('jobs:update')
  const [v, setV] = useState<View | null>(null)
  const load = useCallback(async () => {
    try { setV(await api.get(`/api/roof-pipeline/jobs/${jobId}/status`) as View) } catch { setV(null) }
  }, [jobId])
  useEffect(() => { if (on) load() }, [on, load, jobStatus, jobType])
  if (!on || !v || (!v.choices.length && !v.current)) return null
  const pick = async (statusId: string) => {
    try { setV(await api.put(`/api/roof-pipeline/jobs/${jobId}/status`, { statusId: statusId || null }) as View) } catch (e) { toast.error(errorText(e, 'Could not change the status')) }
  }
  const tick = async (itemId: string, done: boolean) => {
    try { setV(await api.put(`/api/roof-pipeline/jobs/${jobId}/checks`, { itemId, done }) as View) } catch (e) { toast.error(errorText(e, 'Could not tick it')) }
  }
  const total = v.current?.checklist.length ?? 0
  const done = v.current ? v.current.checklist.filter((c) => v.checks[c.id]).length : 0
  return (
    <section aria-label="Status and checklist" className="rounded-lg border p-4 dark:border-slate-700">
      <h3 className="font-semibold flex items-center gap-2 mb-2"><ListChecks className="w-4 h-4" /> Status in {stageLabel(v.milestone, jobType === 'insurance' ? 'insurance' : 'retail')}</h3>
      <select className="input w-full" aria-label="Status" disabled={!mayChange} value={v.current?.id ?? ''} onChange={(e) => pick(e.target.value)}>
        <option value="">No status yet</option>
        {v.choices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {v.current && total > 0 && (
        <div className="mt-3">
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">{done} of {total} done</p>
          <ul className="space-y-1 text-sm">
            {v.current.checklist.map((c) => (
              <li key={c.id}><label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" disabled={!mayChange} checked={!!v.checks[c.id]} onChange={(e) => tick(c.id, e.target.checked)} /><span className={v.checks[c.id] ? 'line-through text-gray-500 dark:text-slate-400' : ''}>{c.text}</span></label></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
