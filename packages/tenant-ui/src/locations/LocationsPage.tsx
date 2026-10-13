/**
 * Locations — ONE page for every CRM that offers `multi_location` as a list of branches (crm,
 * crm-fieldservice, crm-landscaping, crm-basic). The words name no trade (T61: the same screen serves a gym
 * and a field-service crew).
 *
 * Added beyond the copies: EDIT a branch, BRING BACK a deactivated one, and choose its MANAGER from the
 * account's people — the copies could only create and deactivate, and the manager field was never offered.
 * The buttons follow the server's permissions (T60: a manager reads locations; creating, editing and
 * deactivating are owner/admin), and every refusal is said out loud.
 */
import { useState, useEffect, useCallback } from 'react'
import { MapPin, Plus, Pencil } from 'lucide-react'
import { usePermissions } from '../auth/PermissionsContext'
import { useConfirm } from '../ui/ConfirmProvider'
import { PageHeader, Button, Modal, Field, inputCls, errMsg } from '../invoicing/ui'

export interface LocationsApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: unknown) => Promise<any>
  put: (path: string, body?: unknown) => Promise<any>
  delete: (path: string) => Promise<any>
}
export interface LocationsToast { success: (m: string) => void; error: (m: string) => void }
export interface LocationsPageProps { api: LocationsApi; toast: LocationsToast }

const listOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [])
const blank = { name: '', code: '', address: '', city: '', state: '', zip: '', phone: '', email: '', timezone: 'America/Chicago', serviceAreaRadiusMiles: '25', managerUserId: '', notes: '' }
type Form = typeof blank

export function LocationsPage({ api, toast }: LocationsPageProps) {
  const { can, known } = usePermissions()
  const confirm = useConfirm()
  // Hide only when we KNOW the person cannot (PermissionsContext's convention) — the server refuses either way.
  const mayCreate = !known || can('locations:create')
  const mayEdit = !known || can('locations:update')
  const mayDeactivate = !known || can('locations:delete')
  const [locations, setLocations] = useState<any[]>([])
  const [people, setPeople] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState<Form>(blank)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setLocations(listOf(await api.get('/api/locations'))) } catch (e) { toast.error(errMsg(e, 'Could not load locations')) } finally { setLoading(false) }
  }, [api])
  useEffect(() => { load() }, [load])

  const loadPeople = async () => {
    try { setPeople(listOf(await api.get('/api/company/users')).filter((u: any) => u.isActive !== false)) } catch { setPeople([]) }
  }
  const openNew = () => { setEditing(null); setForm(blank); setOpen(true); loadPeople() }
  const openEdit = (l: any) => {
    setEditing(l)
    setForm({
      name: l.name || '', code: l.code || '', address: l.address || '', city: l.city || '', state: l.state || '', zip: l.zip || '',
      phone: l.phone || '', email: l.email || '', timezone: l.timezone || 'America/Chicago',
      serviceAreaRadiusMiles: String(l.serviceAreaRadiusMiles ?? 25), managerUserId: l.managerUserId || '', notes: l.notes || '',
    })
    setOpen(true)
    loadPeople()
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = { ...form, serviceAreaRadiusMiles: Number(form.serviceAreaRadiusMiles || 0), managerUserId: form.managerUserId || null }
    setBusy(true)
    try {
      if (editing) await api.put(`/api/locations/${editing.id}`, body)
      else await api.post('/api/locations', body)
    } catch (err) {
      // The form stays open with what was typed, so the person can fix it and try again.
      toast.error(errMsg(err, editing ? 'The location could not be saved.' : 'The location could not be created.'))
      setBusy(false)
      return
    }
    setBusy(false)
    setOpen(false)
    toast.success(editing ? 'Location saved.' : 'Location created.')
    load()
  }
  const deactivate = async (l: any) => {
    if (!(await confirm(`${l.name} stays on record and can be brought back.`, { title: 'Deactivate this location?', confirmText: 'Deactivate' }))) return
    try { await api.delete(`/api/locations/${l.id}`); load() } catch (err) { toast.error(errMsg(err, 'The location could not be deactivated.')) }
  }
  const reactivate = async (l: any) => {
    try { await api.put(`/api/locations/${l.id}`, { isActive: true }); toast.success(`${l.name} is active again.`); load() } catch (err) { toast.error(errMsg(err, 'The location could not be brought back.')) }
  }
  const managerName = (id?: string | null) => {
    const p = people.find((u) => u.id === id)
    return p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email : null
  }

  if (loading) return <div className="p-6 text-sm text-gray-500 dark:text-slate-400">Loading locations…</div>

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader title="Locations" subtitle="Your branches — each with its own address, phone and time zone" action={mayCreate ? <Button onClick={openNew}><Plus className="w-4 h-4" />New location</Button> : null} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {locations.length === 0 ? (
          <div className="col-span-full bg-white border border-gray-200 rounded-lg p-12 text-center text-sm text-gray-600 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-400">
            {mayCreate ? 'No locations yet. Add your first branch.' : 'No locations yet. An owner or admin can add branches.'}
          </div>
        ) : locations.map((l) => (
          <div key={l.id} className={`bg-white border rounded-lg p-5 dark:bg-slate-900 ${l.isActive ? 'border-gray-200 dark:border-slate-700' : 'border-dashed border-gray-300 dark:border-slate-600'}`}>
            <div className="flex items-start justify-between mb-3 gap-2">
              <div className="min-w-0">
                <div className="text-xs font-mono text-gray-600 mb-1 dark:text-slate-400">{l.code}</div>
                <h3 className="font-bold text-lg text-gray-900 break-words dark:text-slate-100">{l.name}</h3>
              </div>
              <div className="flex items-center gap-1">
                {!l.isActive && <span className="text-xs font-semibold uppercase px-2 py-0.5 rounded-full bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200">Inactive</span>}
                {mayEdit && <button aria-label={`Edit ${l.name}`} onClick={() => openEdit(l)} className="p-1 rounded text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"><Pencil className="w-4 h-4" /></button>}
              </div>
            </div>
            <div className="text-sm text-gray-700 space-y-1 dark:text-slate-300">
              {l.address && <div>{l.address}</div>}
              {(l.city || l.state) && <div>{l.city}{l.city && l.state ? ', ' : ''}{l.state} {l.zip}</div>}
              {l.phone && <div>{l.phone}</div>}
              <div className="text-xs text-gray-600 mt-2 dark:text-slate-400">Service radius: {l.serviceAreaRadiusMiles} mi · {l.timezone}</div>
            </div>
            {l.isActive
              ? (mayDeactivate && <button onClick={() => deactivate(l)} className="mt-3 text-sm text-red-700 underline dark:text-red-300">Deactivate</button>)
              : (mayEdit && <button onClick={() => reactivate(l)} className="mt-3 text-sm text-gray-700 underline dark:text-slate-300">Bring back</button>)}
          </div>
        ))}
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editing ? `Edit ${editing.name}` : 'New location'}>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name"><input required placeholder="e.g. Main office" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>
            <Field label="Short code" hint="Up to 10 letters, unique to this location."><input required placeholder="e.g. MAIN" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={10} className={`${inputCls} font-mono`} /></Field>
          </div>
          <Field label="Address"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputCls} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City"><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputCls} /></Field>
            <Field label="State"><input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} maxLength={2} className={inputCls} /></Field>
            <Field label="ZIP"><input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Phone"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} /></Field>
            <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Time zone"><input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className={inputCls} /></Field>
            <Field label="Service radius (miles)"><input type="number" min="0" step="1" value={form.serviceAreaRadiusMiles} onChange={(e) => setForm({ ...form, serviceAreaRadiusMiles: e.target.value })} className={inputCls} /></Field>
          </div>
          <Field label="Manager (optional)">
            <select value={form.managerUserId} onChange={(e) => setForm({ ...form, managerUserId: e.target.value })} className={inputCls}>
              <option value="">No manager</option>
              {people.map((u) => <option key={u.id} value={u.id}>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</option>)}
              {form.managerUserId && !managerName(form.managerUserId) && <option value={form.managerUserId}>Current manager</option>}
            </select>
          </Field>
          <Field label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{editing ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
