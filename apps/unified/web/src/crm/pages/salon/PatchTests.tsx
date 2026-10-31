// A client's patch tests, as a history (salon parity row 22; server crm/salon/patchTests.ts): date, status (pending / passed / failed), who ran it,
// a title and a description. The latest passed-or-failed test is the one the booking rule reads. Add one, change a pending test's result, remove a
// wrong one. Every right is also checked by the server.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../api'
import { useConfirm, useToast, usePermissions } from '../../../shared'
import { staffName, fetchStaff, type StaffMember } from './staff'

interface PatchTestRow { id: string; testedAt: string; status: 'pending' | 'passed' | 'failed'; title: string | null; description: string | null; ranByName: string | null }
const WORDS: Record<string, string> = { pending: 'Pending', passed: 'Passed', failed: 'Failed' }
const TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  passed: 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
}

export function ClientPatchTests({ contactId, reload }: { contactId: string; reload?: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { can, known } = usePermissions()
  const mayEdit = known && can('contacts:update')
  const [tests, setTests] = useState<PatchTestRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ testedAt: '', status: 'pending', title: '', description: '', ranByUserId: '' })
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { api.get(`/api/clients/${contactId}/patch-tests`).then((r: { tests: PatchTestRow[] }) => setTests(r.tests)).catch(() => setTests([])) }, [contactId])
  useEffect(load, [load])
  useEffect(() => { fetchStaff().then(setStaff).catch(() => setStaff([])) }, [])

  const add = async () => {
    setBusy(true); setProblem('')
    try {
      await api.post(`/api/clients/${contactId}/patch-tests`, { ...(form.testedAt ? { testedAt: form.testedAt } : {}), status: form.status, title: form.title, description: form.description, ...(form.ranByUserId ? { ranByUserId: form.ranByUserId } : {}) })
      toast.success('Patch test added'); setAdding(false); setForm({ testedAt: '', status: 'pending', title: '', description: '', ranByUserId: '' }); load(); reload?.()
    } catch (e: any) { setProblem(Object.values(e?.data?.fields ?? {})[0] as string || e?.message || 'The patch test was not saved.') } finally { setBusy(false) }
  }
  const setStatus = async (t: PatchTestRow, status: string) => {
    try { await api.put(`/api/clients/${contactId}/patch-tests/${t.id}`, { status }); load(); reload?.() } catch (e: any) { toast.error(e?.message || 'The result was not saved.') }
  }
  const remove = async (t: PatchTestRow) => {
    if (!(await confirm(`Remove the patch test of ${t.testedAt}? This cannot be undone.`, { title: 'Remove patch test', confirmText: 'Remove' }))) return
    try { await api.delete(`/api/clients/${contactId}/patch-tests/${t.id}`); load(); reload?.() } catch (e: any) { toast.error(e?.message || 'It could not be removed.') }
  }

  if (tests === null) return null
  if (!tests.length && !mayEdit) return null
  return (
    <section className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-slate-700" aria-label="Patch tests">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-slate-100">Patch tests</h3>
        {mayEdit && !adding && <button type="button" onClick={() => setAdding(true)} className="text-sm font-medium text-teal-800 underline dark:text-teal-200">Add a patch test</button>}
      </div>
      {tests.length === 0 && <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">None on record.</p>}
      <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-slate-800">
        {tests.map((t) => (
          <li key={t.id} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="font-medium">{t.title || 'Patch test'}</span> · {t.testedAt}{t.ranByName ? ` · ${t.ranByName}` : ''}</span>
              <span className="flex items-center gap-2">
                {mayEdit && t.status === 'pending' ? (
                  <select aria-label={`Result of the ${t.testedAt} patch test`} value="pending" onChange={(e) => setStatus(t, e.target.value)} className="rounded border px-2 py-1 text-sm dark:bg-slate-800">
                    <option value="pending">Pending</option><option value="passed">Passed</option><option value="failed">Failed</option>
                  </select>
                ) : <span className={'rounded-full px-2 py-0.5 text-xs ' + TONE[t.status]}>{WORDS[t.status]}</span>}
                {mayEdit && <button type="button" onClick={() => remove(t)} className="text-xs text-gray-600 underline hover:text-red-700 dark:text-slate-400">Remove</button>}
              </span>
            </div>
            {t.description && <p className="mt-1 text-gray-700 dark:text-slate-300">{t.description}</p>}
          </li>
        ))}
      </ul>
      {adding && (
        <div className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <label>Date<input type="date" value={form.testedAt} onChange={(e) => setForm({ ...form, testedAt: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 dark:bg-slate-800" /></label>
          <label>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 dark:bg-slate-800"><option value="pending">Pending</option><option value="passed">Passed</option><option value="failed">Failed</option></select></label>
          <label>Title<input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 dark:bg-slate-800" placeholder="Patch test" /></label>
          <label>Run by<select value={form.ranByUserId} onChange={(e) => setForm({ ...form, ranByUserId: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 dark:bg-slate-800"><option value="">Me</option>{staff.map((m) => <option key={m.id} value={m.id}>{staffName(m)}</option>)}</select></label>
          <label className="sm:col-span-2">Description<textarea value={form.description} maxLength={1000} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 dark:bg-slate-800" rows={2} /></label>
          {problem && <p role="alert" className="text-red-700 dark:text-red-300 sm:col-span-2">{problem}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" onClick={add} disabled={busy} className="rounded-lg bg-teal-700 px-4 py-2 text-white hover:bg-teal-800 disabled:opacity-50">{busy ? 'Saving…' : 'Save patch test'}</button>
            <button type="button" onClick={() => { setAdding(false); setProblem('') }} className="rounded-lg border px-4 py-2 hover:bg-gray-50 dark:hover:bg-slate-800">Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}
