// Settings › Statuses and checklists (roofing parity row 20; AccuLynx Workflow Manager; pipeline_statuses, not ready). Server:
// crm/roof/pipeline.ts (/api/roof-pipeline/statuses). A status is a step inside one of the fixed milestones — the milestones stay what the
// homeowner texts, the review request and "paid means Collected" read — for every job type or only some, with its own checklist.
import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '../../../../api'
import { useMayWrite, useToast, useConfirm } from '../../../../shared'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'
import { JOB_TYPES, stageLabel } from './model'

interface Status { id: string; milestone: string; name: string; jobTypes: string[]; checklist: Array<{ id: string; text: string }> }
const MILESTONES = ['lead', 'inspection_scheduled', 'inspected', 'measurement_ordered', 'proposal_sent', 'signed', 'material_ordered', 'in_production', 'final_inspection', 'invoiced', 'collected']
const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
const EMPTY = { name: '', jobTypes: [] as string[], checklist: '' }

export default function PipelineStatusesPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const mayEdit = useMayWrite('company:update')
  const [rows, setRows] = useState<Status[] | null>(null)
  const [milestone, setMilestone] = useState('inspected')
  const [form, setForm] = useState(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/roof-pipeline/statuses'); setRows(Array.isArray(r?.data) ? r.data : []) } catch (e) { toast.error(errorText(e, 'Could not load the statuses')); setRows([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  if (!rows) return <div className="p-6 text-sm text-gray-500 dark:text-slate-400">Loading…</div>
  const here = rows.filter((r) => r.milestone === milestone)
  const startEdit = (s: Status) => { setEditing(s.id); setForm({ name: s.name, jobTypes: s.jobTypes, checklist: s.checklist.map((c) => c.text).join('\n') }) }
  const save = async () => {
    const had = rows.find((r) => r.id === editing)
    const lines = form.checklist.split('\n').map((x) => x.trim()).filter(Boolean)
    // Keep each kept item's id (its ticks on jobs stay); new lines are new items.
    const checklist = lines.map((text) => had?.checklist.find((c) => c.text === text) ?? { text })
    try {
      if (editing) await api.put(`/api/roof-pipeline/statuses/${editing}`, { milestone, name: form.name, jobTypes: form.jobTypes, checklist })
      else await api.post('/api/roof-pipeline/statuses', { milestone, name: form.name, jobTypes: form.jobTypes, checklist })
      toast.success('Status saved'); setEditing(null); setForm(EMPTY); await load()
    } catch (e) { toast.error(errorText(e, 'Could not save the status')) }
  }
  const remove = async (s: Status) => {
    if (!(await confirm('Jobs at it go back to no status inside the milestone. The milestone does not change.', { title: `Delete the status “${s.name}”?`, confirmText: 'Delete status' }))) return
    try { await api.delete(`/api/roof-pipeline/statuses/${s.id}`); toast.success('Status deleted'); await load() } catch (e) { toast.error(errorText(e, 'Could not delete it')) }
  }
  return (
    <div className="p-6 max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold">Statuses and checklists</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-1 max-w-prose">Add your own steps inside each pipeline milestone, each with a checklist. The milestones themselves — what the homeowner is texted, the review request, “paid means Collected” — work exactly as before.</p>
      </div>
      <label className="text-sm">Milestone
        <select className="input ml-2 w-auto" value={milestone} onChange={(e) => { setMilestone(e.target.value); setEditing(null); setForm(EMPTY) }}>
          {MILESTONES.map((m) => <option key={m} value={m}>{stageLabel(m)} ({rows.filter((r) => r.milestone === m).length})</option>)}
        </select>
      </label>
      <ul className="divide-y rounded border dark:divide-slate-700 dark:border-slate-700">
        {here.length === 0 && <li className="p-3 text-sm text-gray-500 dark:text-slate-400">No statuses under {stageLabel(milestone)} yet.</li>}
        {here.map((s) => (
          <li key={s.id} className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span><span className="font-medium">{s.name}</span> <span className="text-gray-500 dark:text-slate-400">· {s.jobTypes.length ? s.jobTypes.map((x) => codeLabel(x)).join(', ') : 'every job type'} · {s.checklist.length} checklist item{s.checklist.length === 1 ? '' : 's'}</span></span>
            {mayEdit && <span className="flex gap-3"><button className="text-orange-700 hover:underline dark:text-orange-300" onClick={() => startEdit(s)}>Change</button><button aria-label={`Delete ${s.name}`} className="text-red-700 dark:text-red-400" onClick={() => remove(s)}><Trash2 className="w-4 h-4" /></button></span>}
          </li>
        ))}
      </ul>
      {mayEdit && (
        <div className="rounded border p-4 space-y-3 dark:border-slate-700">
          <p className="font-medium">{editing ? 'Change the status' : `New status under ${stageLabel(milestone)}`}</p>
          <input className="input w-full" aria-label="Status name" maxLength={40} placeholder="e.g. Adjuster meeting set" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <fieldset className="text-sm"><legend className="mb-1">For which jobs <span className="text-gray-500 dark:text-slate-400">(none ticked = every job type)</span></legend>
            <div className="flex flex-wrap gap-4">{JOB_TYPES.map((t) => <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={form.jobTypes.includes(t)} onChange={(e) => setForm({ ...form, jobTypes: e.target.checked ? [...form.jobTypes, t] : form.jobTypes.filter((x) => x !== t) })} />{codeLabel(t)}</label>)}</div>
          </fieldset>
          <label className="block text-sm">Checklist — one item per line
            <textarea className="input w-full mt-1" rows={5} value={form.checklist} onChange={(e) => setForm({ ...form, checklist: e.target.value })} />
          </label>
          <div className="flex gap-2">
            <button className="btn-primary flex items-center gap-1" disabled={!form.name.trim()} onClick={save}><Plus className="w-4 h-4" />{editing ? 'Save' : 'Add status'}</button>
            {editing && <button className="btn-secondary" onClick={() => { setEditing(null); setForm(EMPTY) }}>Cancel</button>}
          </div>
        </div>
      )}
    </div>
  )
}
