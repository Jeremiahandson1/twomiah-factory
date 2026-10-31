// A roofing job's permits (roofing parity, row 11; server/crm/roof/insurance/permits.ts at /api/permits, behind the not-ready feature
// roof_permits): each with its type, the office that issues it, number, fee, the day it was applied for, issued, expires and was
// finaled, and the status it is at. Adding asks jobs:create, changing and moving a permit jobs:update, removing jobs:delete; the
// fee is what the shop pays the city, so it is shown to and typed by a seat that reads cost (margin:read) only — for any other it is
// absent, never $0. The board across every job is ./PermitsPage.
import { useCallback, useEffect, useState } from 'react'
import { FileCheck2, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useConfirm, useMayWrite, usePermissions, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { moneyCents } from '@twomiah/tenant-ui/src/money'
import { NEXT_STEP, PERMIT_STATUS_WORDS, PERMIT_TYPE_SUGGESTIONS, centsFromText, textFromCents } from './permitModel'
import type { JobPermitRow } from './permitModel'

const BTN = 'px-3 py-1.5 text-xs rounded-lg font-medium disabled:opacity-50'
export const STATUS_CHIP: Record<string, string> = {
  needed: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300',
  applied: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  issued: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  finaled: 'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
}
export const day = (v?: string | null) => (v ? formatDate(v) : '')

export interface PermitFormState { permitType: string; jurisdiction: string; permitNumber: string; fee: string; feePaidOn: string; expiresOn: string; notes: string }
const blank: PermitFormState = { permitType: '', jurisdiction: '', permitNumber: '', fee: '', feePaidOn: '', expiresOn: '', notes: '' }
const fromRow = (p: JobPermitRow): PermitFormState => ({
  permitType: p.permitType ?? '', jurisdiction: p.jurisdiction ?? '', permitNumber: p.permitNumber ?? '', fee: textFromCents(p.feeCents),
  feePaidOn: p.feePaidOn ?? '', expiresOn: p.expiresOn ?? '', notes: p.notes ?? '',
})

/** The permit's boxes, for a new one or an edit. `showFee` is a seat that reads cost. Saves through `onSave`, which says what the server refused. */
export function PermitForm({ initial, showFee, saving, onSave, onCancel }: {
  initial: PermitFormState; showFee: boolean; saving: boolean; onSave: (f: PermitFormState, feeCents: number | null | undefined) => void; onCancel: () => void
}) {
  const [f, setF] = useState(initial)
  const cents = centsFromText(f.fee)
  const feeBad = showFee && cents === undefined
  const set = (k: keyof PermitFormState) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const input = 'block w-full text-sm border rounded-lg px-2 py-1.5 mt-0.5'
  return (
    <div className="grid grid-cols-2 gap-2 mb-4" data-testid="permit-form">
      <label className="text-xs text-gray-500 dark:text-slate-400">Permit type
        <input value={f.permitType} onChange={set('permitType')} list="permit-types" maxLength={80} placeholder="Building" className={input} />
        <datalist id="permit-types">{PERMIT_TYPE_SUGGESTIONS.map((x) => <option key={x} value={x} />)}</datalist>
      </label>
      <label className="text-xs text-gray-500 dark:text-slate-400">Issued by (city or county)
        <input value={f.jurisdiction} onChange={set('jurisdiction')} maxLength={120} className={input} />
      </label>
      <label className="text-xs text-gray-500 dark:text-slate-400">Permit number
        <input value={f.permitNumber} onChange={set('permitNumber')} maxLength={80} className={input} />
      </label>
      {showFee ? (
        <label className="text-xs text-gray-500 dark:text-slate-400">Fee ($)
          <input value={f.fee} onChange={set('fee')} inputMode="decimal" placeholder="0.00" aria-invalid={feeBad} className={input} />
          {feeBad && <span className="text-red-600">Enter dollars and cents, like 125.50.</span>}
        </label>
      ) : <span />}
      {showFee && (
        <label className="text-xs text-gray-500 dark:text-slate-400">Fee paid on
          <input type="date" value={f.feePaidOn} onChange={set('feePaidOn')} className={input} />
        </label>
      )}
      <label className="text-xs text-gray-500 dark:text-slate-400">Expires on
        <input type="date" value={f.expiresOn} onChange={set('expiresOn')} className={input} />
      </label>
      <label className="col-span-2 text-xs text-gray-500 dark:text-slate-400">Notes
        <textarea value={f.notes} onChange={set('notes')} rows={2} maxLength={2000} className={input} />
      </label>
      <div className="col-span-2 flex gap-2">
        <button type="button" disabled={saving || feeBad} onClick={() => onSave(f, showFee ? cents : undefined)} className={`${BTN} bg-orange-600 text-white hover:bg-orange-700`}>Save permit</button>
        <button type="button" onClick={onCancel} className={`${BTN} border`}>Cancel</button>
      </div>
    </div>
  )
}

/** The days a permit has reached, in the order they happened. */
export function permitDays(p: JobPermitRow): string {
  return [
    p.appliedOn && `applied ${day(p.appliedOn)}`, p.issuedOn && `issued ${day(p.issuedOn)}`, p.expiresOn && `${p.expired ? 'expired' : 'expires'} ${day(p.expiresOn)}`, p.finaledOn && `finaled ${day(p.finaledOn)}`,
  ].filter(Boolean).join(' · ')
}

export default function JobPermits({ jobId }: { jobId: string }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { can } = usePermissions()
  const mayAdd = useMayWrite('jobs:create')
  const mayMove = useMayWrite('jobs:update')
  const mayDelete = useMayWrite('jobs:delete')
  const showFee = can('margin:read')
  const [permits, setPermits] = useState<JobPermitRow[]>([])
  const [editing, setEditing] = useState<JobPermitRow | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setPermits(((await api.get('/api/permits', { jobId })) as { data: JobPermitRow[] }).data ?? []) } catch { setPermits([]) }
  }, [jobId])
  useEffect(() => { load() }, [load])

  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    try { await fn(); await load(); return true } catch (e) { toast.error(errorText(e, fallback)); return false } finally { setBusy(false) }
  }
  const save = async (f: PermitFormState, feeCents: number | null | undefined) => {
    const body: Record<string, unknown> = {
      permitType: f.permitType.trim(), jurisdiction: f.jurisdiction.trim(), permitNumber: f.permitNumber.trim(), notes: f.notes.trim(),
      expiresOn: f.expiresOn || null, ...(feeCents !== undefined ? { feeCents, feePaidOn: f.feePaidOn || null } : {}),
    }
    const ok = await run(() => (editing === 'new' ? api.post('/api/permits', { jobId, ...body }) : api.put(`/api/permits/${(editing as JobPermitRow).id}`, body)), 'That did not save')
    if (ok) setEditing(null)
  }
  const move = (p: JobPermitRow, status: string) => run(() => api.post(`/api/permits/${p.id}/status`, { status }), 'Could not move the permit')
  const remove = async (p: JobPermitRow) => {
    if (!(await confirm(`Remove ${p.permitNumber ? `permit ${p.permitNumber}` : 'this permit'} from the job?`, { title: 'Remove permit', confirmText: 'Remove' }))) return
    await run(() => api.delete(`/api/permits/${encodeURIComponent(p.id)}`), 'Could not remove the permit')
  }

  if (!permits.length && !mayAdd) return null
  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900" data-testid="job-permits">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-100"><FileCheck2 className="w-4 h-4 text-gray-400" /> Permits</h2>
        {mayAdd && editing === null && (
          <button type="button" onClick={() => setEditing('new')} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300"><Plus className="w-4 h-4" /> Add permit</button>
        )}
      </div>
      {editing === 'new' && <PermitForm initial={blank} showFee={showFee} saving={busy} onSave={save} onCancel={() => setEditing(null)} />}
      {!permits.length && editing !== 'new' && <p className="text-sm text-gray-500 dark:text-slate-400">No permits on this job.</p>}
      <ul className="space-y-3">
        {permits.map((p) => {
          const next = NEXT_STEP[p.status]
          return (
            <li key={p.id} className="text-sm border-b last:border-0 pb-3 dark:border-slate-700" data-testid="job-permit">
              {editing && editing !== 'new' && editing.id === p.id ? (
                <PermitForm initial={fromRow(p)} showFee={showFee} saving={busy} onSave={save} onCancel={() => setEditing(null)} />
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900 dark:text-slate-100">{p.permitType || 'Permit'}{p.permitNumber ? ` · ${p.permitNumber}` : ''}</span>
                    <span className="flex items-center gap-2">
                      {p.expired && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Expired</span>}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CHIP[p.status] || STATUS_CHIP.needed}`}>{PERMIT_STATUS_WORDS[p.status] ?? p.status}</span>
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {[p.jurisdiction, p.moneyWithheld ? null : p.feeCents != null ? `fee ${moneyCents(p.feeCents)}${p.feePaidOn ? ` paid ${day(p.feePaidOn)}` : ' not paid yet'}` : null, permitDays(p)].filter(Boolean).join(' · ')}
                  </p>
                  {p.notes && <p className="text-xs text-gray-600 dark:text-slate-300 mt-1">{p.notes}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {mayMove && next && <button type="button" disabled={busy} onClick={() => move(p, next.status)} className={`${BTN} bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-100`}>{next.label}</button>}
                    {mayMove && p.status === 'applied' && <button type="button" disabled={busy} onClick={() => move(p, 'rejected')} className={`${BTN} border text-red-700`}>Mark rejected</button>}
                    {mayMove && <button type="button" aria-label={`Edit ${p.permitType || 'permit'}`} onClick={() => setEditing(p)} className={`${BTN} border inline-flex items-center gap-1`}><Pencil className="w-3.5 h-3.5" /> Edit</button>}
                    {mayDelete && <button type="button" aria-label={`Remove ${p.permitType || 'permit'}`} disabled={busy} onClick={() => remove(p)} className={`${BTN} border text-red-700`}><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
