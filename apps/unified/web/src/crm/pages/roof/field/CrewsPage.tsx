// Moved from templates/crm-roof/frontend/src/pages/roofing/CrewsPage.tsx. Crews at /api/crews
// (server/crm/roof/field/crews.ts): the list is { data, pagination }; one crew (GET /:id) carries its activeJobs, each
// { id, number, address, … } — the jobs assigned to it that are not finished or closed.
//
// Changes from the template:
//   · "N active" was read from activeJobCount / jobCount, which no reply ever carried, so every crew read "0 active".
//     The list carries activeJobCount now (the server counts by the same rule as one crew's activeJobs), and opening
//     the count fetches that crew's jobs (GET /api/crews/:id), each linking to /crm/jobs/:id;
//   · the form marks Foreman Name, Foreman Phone and Crew Size required, as the server requires them (the template
//     sent them blank and showed the 400), and sends `size` alone (it also sent `crewSize`, which nothing reads);
//   · the Notes box is gone: a crew has no notes column, and the server dropped what was typed;
//   · the server's sentence is shown on a refusal; delete asks through the app's confirm dialog.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, HardHat, Phone, Plus, Users, X } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useConfirm, useMayWrite, useToast } from '../../../../shared'
import { listOf } from './http'

interface CrewJob {
  id: string
  number: string | null
  address: string | null
  city: string | null
  state: string | null
  status: string | null
}

interface Crew {
  id: string
  name: string
  foremanName: string | null
  foremanPhone: string | null
  size: number | null
  isSubcontractor: boolean
  activeJobs?: CrewJob[]
  /** Jobs assigned to the crew and not finished or closed (GET /api/crews). */
  activeJobCount?: number
  /** The logins on the crew (crew_login): each reads the crew's jobs as its own. */
  logins?: Array<{ id: string; name: string }>
}

interface Login { id: string; firstName?: string | null; lastName?: string | null; email?: string | null; role?: string | null; isActive?: boolean | null }
const loginName = (u: Login) => `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Login'

interface CrewForm { name: string; foremanName: string; foremanPhone: string; crewSize: string; isSubcontractor: boolean }

const EMPTY_FORM: CrewForm = { name: '', foremanName: '', foremanPhone: '', crewSize: '', isSubcontractor: false }

export default function CrewsPage() {
  // crews:* is manager and above. A crew member reads the roster — who is on which crew is the
  // point of the screen — and does not build, rename or disband one. (T42)
  const mayAddCrew = useMayWrite('crews:create')
  const mayEditCrew = useMayWrite('crews:update')
  const mayRemoveCrew = useMayWrite('crews:delete')
  const toast = useToast()
  const confirm = useConfirm()
  // The toast object is made afresh on every render of its provider: read through a ref, so a failed load's toast
  // does not remake `load` and load again.
  const toastRef = useRef(toast)
  toastRef.current = toast

  const [crews, setCrews] = useState<Crew[]>([])
  const [jobsOf, setJobsOf] = useState<Record<string, CrewJob[]>>({})
  const [openJobs, setOpenJobs] = useState<string | null>(null)
  /** One crew's active jobs, fetched when its count is opened (the list carries the count alone). */
  const toggleJobs = async (crew: Crew) => {
    if (openJobs === crew.id) { setOpenJobs(null); return }
    setOpenJobs(crew.id)
    if (jobsOf[crew.id]) return
    try {
      const detail = await api.get(`/api/crews/${encodeURIComponent(crew.id)}`) as Crew
      setJobsOf((m) => ({ ...m, [crew.id]: Array.isArray(detail?.activeJobs) ? detail.activeJobs : [] }))
    } catch (e) {
      toastRef.current.error(errorText(e, "Couldn't load the crew's jobs"))
    }
  }
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<CrewForm>(EMPTY_FORM)
  /**
   * Who signs in as this crew (PUT /api/crews/:id/logins, crews:update — the Edit button's own permission): a Field
   * login on a crew sees the crew's jobs as its own (crew scope, 2026-10-24). The people are GET /api/company/users,
   * which a seat holding crews:update (manager and up) reads.
   */
  const [people, setPeople] = useState<Login[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const loadPeople = () => {
    api.get('/api/company/users').then((r: unknown) => setPeople(listOf<Login>(r).filter((u) => u.isActive !== false && u.role !== 'viewer'))).catch(() => setPeople([]))
  }

  const load = useCallback(async () => {
    try {
      const list = listOf<Crew>(await api.get('/api/crews'))
      setCrews(list)
      setJobsOf({})
    } catch (e) {
      toastRef.current.error(errorText(e, 'Failed to load crews'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const openCreate = () => { setEditingId(null); setForm(EMPTY_FORM); setPicked([]); loadPeople(); setModalOpen(true) }
  const openEdit = (crew: Crew) => {
    setEditingId(crew.id)
    setPicked((crew.logins || []).map((l) => l.id))
    loadPeople()
    setForm({
      name: crew.name || '', foremanName: crew.foremanName || '', foremanPhone: crew.foremanPhone || '',
      crewSize: crew.size != null ? String(crew.size) : '', isSubcontractor: !!crew.isSubcontractor,
    })
    setModalOpen(true)
  }

  const deleteCrew = async (crew: Crew) => {
    if (!(await confirm(`Delete crew "${crew.name}"? This can't be undone.`, { title: 'Delete crew', confirmText: 'Delete' }))) return
    try {
      await api.delete(`/api/crews/${encodeURIComponent(crew.id)}`)
      toast.success('Crew deleted')
      load()
    } catch (e) {
      toast.error(errorText(e, 'Failed to delete crew'))
    }
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Crew name is required'); return }
    setSaving(true)
    try {
      const body = {
        name: form.name, foremanName: form.foremanName, foremanPhone: form.foremanPhone,
        size: form.crewSize ? Number(form.crewSize) : null, isSubcontractor: form.isSubcontractor,
      }
      let savedId = editingId
      if (editingId) await api.put(`/api/crews/${encodeURIComponent(editingId)}`, body)
      else savedId = ((await api.post('/api/crews', body)) as { id?: string } | null)?.id || null
      if (savedId && mayEditCrew) await api.put(`/api/crews/${encodeURIComponent(savedId)}/logins`, { userIds: picked })
      setModalOpen(false)
      setForm(EMPTY_FORM)
      setEditingId(null)
      toast.success(editingId ? 'Crew updated' : 'Crew created')
      load()
    } catch (e) {
      toast.error(errorText(e, 'Failed to save crew'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Crews</h1>
            <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">{crews.length} {crews.length === 1 ? 'crew' : 'crews'}</p>
          </div>
          {mayAddCrew && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700"
            >
              <Plus className="w-4 h-4" /> Add Crew
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {crews.map((crew) => {
            const jobs = jobsOf[crew.id] || []
            return (
              <div key={crew.id} className="bg-white rounded-xl shadow-sm border p-5 dark:bg-slate-900">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center dark:bg-blue-950/40">
                      <Users className="w-5 h-5 text-blue-600 dark:text-blue-300" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-slate-100">{crew.name}</h3>
                      {crew.isSubcontractor && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:text-amber-300 dark:bg-amber-950/40">Subcontractor</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {mayEditCrew && (<button onClick={() => openEdit(crew)} className="px-2 py-0.5 text-xs font-medium border border-gray-200 rounded text-gray-700 hover:bg-gray-50 dark:hover:bg-slate-800 dark:border-slate-700 dark:text-slate-200">Edit</button>)}
                    {mayRemoveCrew && (<button onClick={() => deleteCrew(crew)} className="px-2 py-0.5 text-xs font-medium border border-red-200 text-red-700 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-500/10">Delete</button>)}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  {crew.foremanName && (
                    <div className="flex items-center gap-2 text-gray-700 dark:text-slate-200">
                      <HardHat className="w-4 h-4 text-gray-400" />
                      <span>{crew.foremanName}</span>
                    </div>
                  )}
                  {crew.foremanPhone && (
                    <a href={`tel:${crew.foremanPhone}`} className="flex items-center gap-2 text-orange-600 dark:text-orange-200 hover:underline">
                      <Phone className="w-4 h-4" />
                      <span>{crew.foremanPhone}</span>
                    </a>
                  )}
                  {(crew.logins || []).length > 0 && (
                    <p className="text-xs text-gray-600 dark:text-slate-300" data-testid="crew-login-names">Logins: {(crew.logins || []).map((l) => l.name).join(', ')}</p>
                  )}
                  <div className="flex items-center gap-4 pt-2 border-t text-gray-500 dark:text-slate-400">
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5" />
                      {crew.size || '—'} members
                    </span>
                    <button
                      onClick={() => toggleJobs(crew)}
                      disabled={!crew.activeJobCount}
                      aria-expanded={openJobs === crew.id}
                      className="flex items-center gap-1 enabled:hover:underline"
                    >
                      <Briefcase className="w-3.5 h-3.5" />
                      {crew.activeJobCount ?? 0} active
                    </button>
                  </div>
                  {openJobs === crew.id && jobs.length > 0 && (
                    <ul className="space-y-1 pt-1">
                      {jobs.map((j) => (
                        <li key={j.id}>
                          <Link to={`/crm/jobs/${j.id}`} className="text-xs text-orange-600 dark:text-orange-200 hover:underline">
                            <span className="font-mono font-semibold">{j.number || 'Job'}</span>
                            {j.address ? ` — ${j.address}` : ''}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )
          })}

          {crews.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-500 dark:text-slate-400">
              No crews yet. Add your first crew to get started.
            </div>
          )}
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">{editingId ? 'Edit Crew' : 'Add Crew'}</h2>
              <button aria-label="Close" onClick={() => setModalOpen(false)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Crew Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Foreman Name *</label>
                <input value={form.foremanName} onChange={(e) => setForm({ ...form, foremanName: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Foreman Phone *</label>
                <input type="tel" value={form.foremanPhone} onChange={(e) => setForm({ ...form, foremanPhone: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Crew Size *</label>
                <input type="number" min={1} value={form.crewSize} onChange={(e) => setForm({ ...form, crewSize: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
                <input type="checkbox" checked={form.isSubcontractor} onChange={(e) => setForm({ ...form, isSubcontractor: e.target.checked })} className="rounded" />
                Subcontractor
              </label>
              {mayEditCrew && (
                <div>
                  <p className="text-xs text-gray-500 mb-1 dark:text-slate-400">Logins on this crew — each sees the crew's jobs as its own</p>
                  {people.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No logins to choose from.</p> : (
                    <div className="max-h-40 space-y-1 overflow-y-auto" data-testid="crew-logins">
                      {people.map((u) => (
                        <label key={u.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
                          <input type="checkbox" className="rounded" checked={picked.includes(u.id)} onChange={(e) => setPicked((p) => e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id))} />
                          {loginName(u)}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Crew'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
