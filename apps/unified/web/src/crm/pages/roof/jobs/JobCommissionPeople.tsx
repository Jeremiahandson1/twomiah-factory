// The other people whose commission a roofing job carries (GET/PUT /api/job-people, server/crm/roof/jobPeople.ts): the estimator, the
// canvasser, the office person, the production manager and the sales manager — beside the job's sales rep, who is set under
// Assignment. A plan that pays one of these roles pays everyone holding it, automatically, when the job is paid (roofing parity row 2).
// Seen by a seat that reads the pay structure (commissions:read); changed by a seat that dispatches (jobs:dispatch) — what the
// server asks. Nothing is saved until Save is pressed, so a half-made change never reaches a plan.
import { useCallback, useEffect, useState } from 'react'
import { Percent, X } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useMayWrite, useToast } from '../../../../shared'
import { displayName } from '../lib/user'
import { listOf } from '../field/http'
import type { Person } from './model'

export const PEOPLE_ROLES: Array<[string, string]> = [
  ['estimator', 'Estimator'], ['canvasser', 'Canvasser'], ['office', 'Office'], ['production_manager', 'Production manager'], ['sales_manager', 'Sales manager'],
]
interface Held { role: string; userId: string }

export default function JobCommissionPeople({ jobId, users }: { jobId: string; users: Person[] }) {
  const toast = useToast()
  const mayDispatch = useMayWrite('jobs:dispatch')
  const [held, setHeld] = useState<Held[]>([])
  const [saved, setSaved] = useState<Held[]>([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const rows = listOf<Held>(await api.get('/api/job-people', { jobId })).map((r) => ({ role: r.role, userId: r.userId }))
      setHeld(rows); setSaved(rows)
    } catch { setHeld([]); setSaved([]) }
    setLoaded(true)
  }, [jobId])
  useEffect(() => { load() }, [load])

  const nameOf = (id: string) => displayName(users.find((u) => u.id === id))
  const dirty = JSON.stringify([...held].sort((a, b) => (a.role + a.userId).localeCompare(b.role + b.userId))) !== JSON.stringify([...saved].sort((a, b) => (a.role + a.userId).localeCompare(b.role + b.userId)))
  const save = async () => {
    setBusy(true)
    try {
      const rows = listOf<Held>(await api.put(`/api/job-people/${jobId}`, { people: held }))
      const next = rows.map((r) => ({ role: r.role, userId: r.userId }))
      setHeld(next); setSaved(next)
      toast.success('Commission people saved')
    } catch (e) { toast.error(errorText(e, 'The people could not be saved')) } finally { setBusy(false) }
  }

  if (!loaded) return null
  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900" data-card="commission-people">
      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-1 dark:text-slate-100">
        <Percent className="w-4 h-4 text-gray-400" /> Commission people
      </h2>
      <p className="text-xs text-gray-500 mb-4 dark:text-slate-400">Besides the sales rep. A commission plan for a role pays everyone holding it when the job is paid.</p>
      <div className="space-y-3">
        {PEOPLE_ROLES.map(([role, label]) => {
          const here = held.filter((h) => h.role === role)
          return (
            <div key={role}>
              <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">{label}</label>
              <div className="flex flex-wrap gap-1 mb-1">
                {here.length === 0 && <span className="text-sm text-gray-500 dark:text-slate-400">Nobody</span>}
                {here.map((h) => (
                  <span key={h.userId} className="inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-100">
                    {nameOf(h.userId)}
                    {mayDispatch && <button type="button" aria-label={`Take ${nameOf(h.userId)} off as ${label}`} onClick={() => setHeld((prev) => prev.filter((x) => !(x.role === role && x.userId === h.userId)))}><X className="w-3 h-3" /></button>}
                  </span>
                ))}
              </div>
              {mayDispatch && (
                <select aria-label={`Add a ${label}`} value="" onChange={(e) => { const id = e.target.value; if (id) setHeld((prev) => [...prev, { role, userId: id }]) }} className="w-full text-sm border rounded-lg px-3 py-2">
                  <option value="">Add…</option>
                  {users.filter((u) => !here.some((h) => h.userId === u.id)).map((u) => <option key={u.id} value={u.id}>{displayName(u)}</option>)}
                </select>
              )}
            </div>
          )
        })}
      </div>
      {mayDispatch && dirty && (
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={() => setHeld(saved)} className="px-3 py-1.5 text-sm border rounded-lg">Undo</button>
          <button type="button" disabled={busy} onClick={save} className="px-3 py-1.5 text-sm font-medium rounded-lg bg-orange-600 text-white disabled:opacity-50">Save</button>
        </div>
      )}
    </div>
  )
}
