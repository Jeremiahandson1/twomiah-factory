// A company's own pipeline boards (roofing parity row 19; JobNimbus boards; pipeline_custom_boards, not ready). Server:
// crm/roof/pipeline.ts (/api/roof-pipeline/boards; boardMatches is the same rule as below). The Pipeline shows one tab per board the
// seat may see; "New board" makes one — "Just me" for anyone, "Everyone" or chosen roles for the office.
import { useState } from 'react'
import { api } from '../../../../api'
import { useToast, useConfirm } from '../../../../shared'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'
import { JOB_TYPES } from './model'

export interface CustomBoard {
  id: string; name: string; color: string; jobTypes: string[]
  filters: { assignedToId?: string[]; salesRepId?: string[]; locationId?: string[]; subcontractorId?: string[] }
  visibility: 'all' | 'me' | 'roles'; roles: string[]; ownerId: string | null; mayEdit?: boolean
}
type JobLike = { jobType?: string | null; assignedToId?: string | null; assignedSalesRepId?: string | null; locationId?: string | null; subcontractorId?: string | null }

/** A job is on a board when it matches every filter the board sets (server/crm/roof/pipeline.ts boardMatches). */
export function boardMatches(b: Pick<CustomBoard, 'jobTypes' | 'filters'>, j: JobLike): boolean {
  const has = (list: string[] | undefined, v: string | null | undefined) => !list?.length || (!!v && list.includes(v))
  return has(b.jobTypes, j.jobType) && has(b.filters.assignedToId, j.assignedToId) && has(b.filters.salesRepId, j.assignedSalesRepId)
    && has(b.filters.locationId, j.locationId) && has(b.filters.subcontractorId, j.subcontractorId)
}

const ROLES: Array<[string, string]> = [['admin', 'Admins'], ['manager', 'Managers'], ['field', 'Field'], ['viewer', 'Viewers']]
const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback

function Picks({ label, options, value, onChange }: { label: string; options: Array<{ id: string; name: string }>; value: string[]; onChange: (v: string[]) => void }) {
  if (!options.length) return null
  return (
    <fieldset className="text-sm">
      <legend className="font-medium mb-1">{label} <span className="font-normal text-gray-500 dark:text-slate-400">(none ticked = any)</span></legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-1"><input type="checkbox" checked={value.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))} />{o.name}</label>
        ))}
      </div>
    </fieldset>
  )
}

/** Make or change a board. `people` are the roster; `subs` and `locations` the ones the jobs name. */
export function BoardEditor({ board, people, subs, locations, mayShare, onDone, onClose }: {
  board: CustomBoard | null; people: Array<{ id: string; name: string }>; subs: Array<{ id: string; name: string }>; locations: Array<{ id: string; name: string }>
  mayShare: boolean; onDone: () => void; onClose: () => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [f, setF] = useState<Omit<CustomBoard, 'id' | 'ownerId'>>(board ?? { name: '', color: '#ea580c', jobTypes: [], filters: {}, visibility: mayShare ? 'all' : 'me', roles: [] })
  const [busy, setBusy] = useState(false)
  const setFilter = (k: keyof CustomBoard['filters'], v: string[]) => setF({ ...f, filters: { ...f.filters, [k]: v } })
  const save = async () => {
    setBusy(true)
    try {
      if (board) await api.put(`/api/roof-pipeline/boards/${board.id}`, f)
      else await api.post('/api/roof-pipeline/boards', f)
      toast.success(board ? 'Board saved' : 'Board made'); onDone()
    } catch (e) { toast.error(errorText(e, 'Could not save the board')) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!board || !(await confirm('Its jobs stay where they are; only the board goes.', { title: `Delete the board “${board.name}”?`, confirmText: 'Delete board' }))) return
    try { await api.delete(`/api/roof-pipeline/boards/${board.id}`); toast.success('Board deleted'); onDone() }
    catch (e) { toast.error(errorText(e, 'Could not delete the board')) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={board ? 'Change board' : 'New board'}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-5 space-y-4 dark:bg-slate-900">
        <h2 className="text-lg font-semibold">{board ? 'Change board' : 'New board'}</h2>
        <div className="flex gap-2 items-end">
          <label className="text-sm flex-1">Name<input className="input w-full mt-1" maxLength={30} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="text-sm">Colour<input type="color" className="block h-9 w-12 mt-1" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></label>
        </div>
        <Picks label="Job types" options={JOB_TYPES.map((t) => ({ id: t, name: codeLabel(t) }))} value={f.jobTypes} onChange={(v) => setF({ ...f, jobTypes: v })} />
        <Picks label="Sales rep" options={people} value={f.filters.salesRepId ?? []} onChange={(v) => setFilter('salesRepId', v)} />
        <Picks label="Assigned to" options={people} value={f.filters.assignedToId ?? []} onChange={(v) => setFilter('assignedToId', v)} />
        <Picks label="Subcontractor" options={subs} value={f.filters.subcontractorId ?? []} onChange={(v) => setFilter('subcontractorId', v)} />
        <Picks label="Location" options={locations} value={f.filters.locationId ?? []} onChange={(v) => setFilter('locationId', v)} />
        <fieldset className="text-sm">
          <legend className="font-medium mb-1">Who sees it</legend>
          <div className="flex flex-wrap gap-4">
            {mayShare && <label className="flex items-center gap-1"><input type="radio" checked={f.visibility === 'all'} onChange={() => setF({ ...f, visibility: 'all' })} />Everyone</label>}
            <label className="flex items-center gap-1"><input type="radio" checked={f.visibility === 'me'} onChange={() => setF({ ...f, visibility: 'me' })} />Just me</label>
            {mayShare && <label className="flex items-center gap-1"><input type="radio" checked={f.visibility === 'roles'} onChange={() => setF({ ...f, visibility: 'roles' })} />These roles</label>}
          </div>
          {f.visibility === 'roles' && <div className="mt-1"><Picks label="Roles" options={ROLES.map(([id, name]) => ({ id, name }))} value={f.roles} onChange={(v) => setF({ ...f, roles: v })} /></div>}
        </fieldset>
        <div className="flex flex-wrap gap-2 justify-end">
          {board && <button className="mr-auto text-sm text-red-700 dark:text-red-400" onClick={remove}>Delete board</button>}
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !f.name.trim()} onClick={save}>{board ? 'Save' : 'Make board'}</button>
        </div>
      </div>
    </div>
  )
}
