// Moved from templates/crm-roof/frontend/src/pages/roofing/AdjusterDirectoryPage.tsx (docs/UNIFIED_ROOF_SCREENS.md, the
// insurance group). The company's insurance adjusters, over /api/insurance/adjusters (server/crm/roof/insurance/
// insurance.ts): the list is { data, pagination }; a refused save reads the server's sentence, which names the box.
import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Phone, Mail } from 'lucide-react'
import { api } from '../../../../api'
import { useMayWrite, useToast, errorText } from '../../../../shared'

/** An adjuster as GET /api/insurance/adjusters answers it. */
interface Adjuster {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  adjusterCompany?: string | null
  insuranceCarrier: string
  territory?: string | null
  notes?: string | null
  jobsWorkedTogether?: number | null
}

interface ListReply<T> { data: T[]; pagination: { page: number; limit: number; total: number; pages: number } }

const EMPTY = { name: '', phone: '', email: '', adjusterCompany: '', insuranceCarrier: '', territory: '', notes: '' }

export default function AdjusterDirectoryPage() {
  // Each control asks what its own route asks: POST /adjusters is create, PUT /adjusters/:id is update. A crew seat
  // sees the directory (it needs the adjuster's phone number) and cannot rewrite it. (T42)
  const mayAddAdjuster = useMayWrite('insurance:create')
  const mayEditAdjuster = useMayWrite('insurance:update')
  const toast = useToast()

  const [adjusters, setAdjusters] = useState<Adjuster[]>([])
  const [loading, setLoading] = useState(true)
  // A list that failed to load is said as such, not drawn as an empty directory.
  const [loadFailed, setLoadFailed] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  // PUT /api/insurance/adjusters/:id: a mistyped carrier or a moved phone number is fixed in place. (roof T17)
  const [editId, setEditId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res: ListReply<Adjuster> = await api.get('/api/insurance/adjusters')
      setAdjusters(res?.data ?? [])
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
      toast.error('Failed to load adjusters')
    } finally {
      setLoading(false)
    }
    // Not `toast`: the provider makes a new one on every render, so a failed load's own toast would load it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => { setEditId(null); setForm(EMPTY); setAddOpen(true) }
  const openEdit = (adj: Adjuster) => {
    setEditId(adj.id)
    setForm({
      name: adj.name || '', phone: adj.phone || '', email: adj.email || '',
      adjusterCompany: adj.adjusterCompany || '',
      insuranceCarrier: adj.insuranceCarrier || '', territory: adj.territory || '', notes: adj.notes || '',
    })
    setAddOpen(true)
  }

  const saveAdjuster = async () => {
    if (!form.name.trim() || !form.insuranceCarrier.trim()) {
      toast.error('Name and carrier required')
      return
    }
    setSubmitting(true)
    try {
      if (editId) await api.put(`/api/insurance/adjusters/${editId}`, form)
      else await api.post('/api/insurance/adjusters', form)
      setAddOpen(false)
      setEditId(null)
      setForm(EMPTY)
      load()
      toast.success(editId ? 'Adjuster updated' : 'Adjuster added')
    } catch (e) {
      // The server names the box it refused ("phone: must be a phone number with 10 to 15 digits").
      toast.error(errorText(e, editId ? 'Failed to update adjuster' : 'Failed to add adjuster'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Adjuster Directory</h1>
            <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">{adjusters.length} adjusters</p>
          </div>
          {mayAddAdjuster && (<button onClick={openAdd} className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700">
            <Plus className="w-4 h-4" /> Add Adjuster
          </button>)}
        </div>

        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b dark:bg-slate-900">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Company</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Carrier</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Territory</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Email</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Jobs Together</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-slate-400"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-12 text-gray-500 dark:text-slate-400">Loading...</td></tr>
                ) : loadFailed ? (
                  <tr><td colSpan={8} className="text-center py-12 text-amber-700 dark:text-amber-300">The directory could not be loaded. Reload the page to try again.</td></tr>
                ) : adjusters.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-gray-500 dark:text-slate-400">No adjusters in directory yet. They'll be added as you log insurance claims.</td></tr>
                ) : (
                  adjusters.map((adj) => (
                    <tr key={adj.id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">{adj.name}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{adj.adjusterCompany || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{adj.insuranceCarrier}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{adj.territory || '—'}</td>
                      <td className="px-4 py-3">
                        {adj.phone ? (
                          <a href={`tel:${adj.phone}`} className="flex items-center gap-1 text-orange-600 dark:text-orange-200 hover:underline">
                            <Phone className="w-3 h-3" /> {adj.phone}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {adj.email ? (
                          <a href={`mailto:${adj.email}`} className="flex items-center gap-1 text-orange-600 dark:text-orange-200 hover:underline">
                            <Mail className="w-3 h-3" /> {adj.email}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-50 text-blue-700 text-xs font-bold dark:text-blue-300 dark:bg-blue-950/40">
                          {adj.jobsWorkedTogether || 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {mayEditAdjuster && (<button onClick={() => openEdit(adj)} className="text-xs font-medium text-orange-700 dark:text-orange-200 hover:text-orange-900 dark:hover:text-orange-100">Edit</button>)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Add / edit modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">{editId ? 'Edit Adjuster' : 'Add Adjuster'}</h2>
              <button aria-label="Close" onClick={() => setAddOpen(false)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Insurance Carrier *</label>
                <input value={form.insuranceCarrier} onChange={(e) => setForm({ ...form, insuranceCarrier: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="e.g. State Farm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Phone</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Email</label>
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Company</label>
                  <input value={form.adjusterCompany} onChange={(e) => setForm({ ...form, adjusterCompany: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Territory</label>
                  <input value={form.territory} onChange={(e) => setForm({ ...form, territory: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="e.g. Midwest" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setAddOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400">Cancel</button>
              <button onClick={saveAdjuster} disabled={submitting} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {submitting ? 'Saving...' : editId ? 'Save Changes' : 'Add Adjuster'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
