// Jobs list — one page for every CRM. Search / status filter, paged table (overdue flag), create/edit modal
// (also opened by /crm/jobs?edit=<id>; /crm/jobs?contactId=<id> opens "new" with the contact and their
// address on file), start / complete / delete row actions.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Edit, Trash2, Search, Play, CheckCircle, Wrench, MapPinned } from 'lucide-react'
import { DataTable, StatusBadge, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, dateOnly, errMsg } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import { resolveJobsConfig, PRIORITY_COLORS } from './types'
import type { JobsPageProps, JobRow } from './types'

interface JobForm {
  title: string; description: string; status: string; priority: string; scheduledDate: string; scheduledTime: string; estimatedHours: string
  address: string; city: string; state: string; zip: string; projectId: string; contactId: string; assignedToId: string; equipmentId: string; siteId: string; notes: string
}
type Pick = { id: string; name?: string; firstName?: string; lastName?: string; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; manufacturer?: string | null; model?: string | null; serialNumber?: string | null }

const emptyForm = (status: string, priority: string): JobForm => ({ title: '', description: '', status, priority, scheduledDate: '', scheduledTime: '', estimatedHours: '', address: '', city: '', state: '', zip: '', projectId: '', contactId: '', assignedToId: '', equipmentId: '', siteId: '', notes: '' })
const label = (s: string) => s.replace(/_/g, ' ')

export function JobsPage({ api, toast, config }: JobsPageProps) {
  const cfg = resolveJobsConfig(config)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<JobRow[]>([])
  const [projects, setProjects] = useState<Pick[]>([])
  const [team, setTeam] = useState<Pick[]>([])
  const [contacts, setContacts] = useState<Pick[]>([])
  const [equipment, setEquipment] = useState<Pick[]>([])
  const [sites, setSites] = useState<Pick[]>([])
  const [useAddressOnFile, setUseAddressOnFile] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<JobRow | null>(null)
  const [form, setForm] = useState<JobForm>(emptyForm(cfg.statuses[0], 'normal'))
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [toDelete, setToDelete] = useState<JobRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, limit: 25 }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      const res = await api.get('/api/jobs', params)
      setData(res?.data || [])
      setPagination(res?.pagination || null)
    } catch (err) { toast.error(errMsg(err, `Failed to load ${cfg.labels.plural.toLowerCase()}`)) } finally { setLoading(false) }
  }, [page, search, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // pickers load once; a failure must not block the list
  useEffect(() => {
    api.get('/api/projects', { limit: 100 }).then((r: any) => setProjects(r?.data || [])).catch(() => setProjects([]))
    api.get('/api/contacts', { limit: 200 }).then((r: any) => setContacts(r?.data || [])).catch(() => setContacts([]))
    if (cfg.assignee) api.get('/api/team').then((r: any) => setTeam(r?.data || (Array.isArray(r) ? r : []))).catch(() => setTeam([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, statusFilter])

  const loadForContact = async (contactId: string) => {
    if (!contactId) { setEquipment([]); setSites([]); return }
    if (cfg.equipment) api.get('/api/equipment', { contactId, limit: 100 }).then((r: any) => setEquipment(r?.data || [])).catch(() => setEquipment([]))
    if (cfg.sites) api.get(`/api/contacts/${contactId}/sites`).then((r: any) => setSites(Array.isArray(r) ? r : [])).catch(() => setSites([]))
  }
  const applyContact = (f: JobForm, contactId: string): JobForm => {
    const ct = contacts.find((c) => c.id === contactId)
    const hasAddress = !!(ct?.address || ct?.city)
    setUseAddressOnFile(hasAddress)
    return { ...f, contactId, equipmentId: '', siteId: '', ...(hasAddress ? { address: ct?.address || '', city: ct?.city || '', state: ct?.state || '', zip: ct?.zip || '' } : {}) }
  }

  const openCreate = (contactId?: string) => {
    setEditing(null)
    let f = emptyForm(cfg.statuses[0], 'normal')
    setUseAddressOnFile(false)
    if (contactId) { f = applyContact(f, contactId); loadForContact(contactId) } else { setEquipment([]); setSites([]) }
    setForm(f)
    setModalOpen(true)
  }
  const openEdit = (item: JobRow) => {
    setEditing(item)
    setForm({
      ...emptyForm(cfg.statuses[0], 'normal'),
      title: item.title || '', description: item.description || '', status: item.status || cfg.statuses[0], priority: item.priority || 'normal',
      scheduledDate: item.scheduledDate ? String(item.scheduledDate).slice(0, 10) : '', scheduledTime: item.scheduledTime || '', estimatedHours: item.estimatedHours != null ? String(item.estimatedHours) : '',
      address: item.address || '', city: item.city || '', state: item.state || '', zip: item.zip || '',
      projectId: item.projectId || '', contactId: item.contactId || '', assignedToId: item.assignedToId || '', equipmentId: item.equipmentId || '', siteId: item.siteId || '', notes: item.notes || '',
    })
    setUseAddressOnFile(false)
    loadForContact(item.contactId || '')
    setModalOpen(true)
  }

  // Deep links: ?edit=<id> from the detail page, ?contactId=<id> from a contact's quick actions.
  useEffect(() => {
    const editId = searchParams.get('edit'), contactId = searchParams.get('contactId')
    if (!editId && !contactId) return
    if (contactId && contacts.length === 0) return // wait for the picker so the address can be applied
    let cancelled = false
    const next = new URLSearchParams(searchParams); next.delete('edit'); next.delete('contactId')
    if (editId) {
      api.get(`/api/jobs/${editId}`).then((row: JobRow) => { if (!cancelled && row) { openEdit(row); setSearchParams(next, { replace: true }) } }).catch(() => {})
    } else if (contactId) { openCreate(contactId); setSearchParams(next, { replace: true }) }
    return () => { cancelled = true }
  }, [searchParams, contacts.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    try {
      const payload: any = { ...form, estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : undefined }
      if (!cfg.equipment) delete payload.equipmentId
      if (!cfg.sites) delete payload.siteId
      if (editing) { await api.put(`/api/jobs/${editing.id}`, payload); toast.success(`${cfg.labels.singular} updated`) }
      else { await api.post('/api/jobs', payload); toast.success(`${cfg.labels.singular} created`) }
      setModalOpen(false); load()
    } catch (err) { toast.error(errMsg(err, 'Failed to save')) } finally { setSaving(false) }
  }
  const remove = async () => {
    if (!toDelete) return
    try { await api.delete('/api/jobs', toDelete.id); toast.success(`${cfg.labels.singular} deleted`); setDeleteOpen(false); setToDelete(null); load() }
    catch (err) { toast.error(errMsg(err, 'Failed to delete')) }
  }
  const start = async (job: JobRow) => { try { await api.post(`/api/jobs/${job.id}/start`); toast.success(`${cfg.labels.singular} started`); load() } catch (err) { toast.error(errMsg(err, 'Failed to start')) } }
  const complete = async (job: JobRow) => {
    try {
      const r = await api.post(`/api/jobs/${job.id}/complete`)
      toast.success(`${cfg.labels.singular} completed`)
      if (r?.nextServiceDate) toast.success(`Next maintenance visit scheduled for ${dateOnly(r.nextServiceDate)}`)
      load()
    } catch (err) { toast.error(errMsg(err, 'Failed to complete')) }
  }

  const columns = [
    { key: 'number', label: 'Number', render: (v: unknown) => <span className="font-mono text-sm">{String(v || '')}</span> },
    { key: 'title', label: 'Title', render: (v: unknown, r: JobRow) => <div><p className="font-medium">{String(v || '')}</p>{r.contact && <p className="text-sm text-gray-500 dark:text-slate-400">{r.contact.name}</p>}</div> },
    { key: 'status', label: 'Status', render: (v: unknown, r: JobRow) => <span className="inline-flex items-center gap-1"><StatusBadge status={String(v || '')} />{r.isOverdue ? <StatusBadge status="overdue" /> : null}</span> },
    { key: 'priority', label: 'Priority', render: (v: unknown) => <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PRIORITY_COLORS[String(v)] || ''}`}>{String(v || '')}</span> },
    { key: 'scheduledDate', label: 'Scheduled', render: (v: unknown) => v ? dateOnly(v) : '-' },
    { key: 'assignedTo', label: 'Assigned To', render: (v: unknown) => v ? `${(v as any).firstName} ${(v as any).lastName}` : '-' },
  ]
  const actions = [
    { label: 'Edit', icon: Edit, onClick: openEdit },
    { label: 'Start', icon: Play, show: (r: JobRow) => r.status !== 'in_progress' && r.status !== 'completed' && r.status !== 'cancelled', onClick: start },
    { label: 'Complete', icon: CheckCircle, show: (r: JobRow) => r.status !== 'completed' && r.status !== 'cancelled', onClick: complete },
    { label: 'Delete', icon: Trash2, className: 'text-red-600', onClick: (r: JobRow) => { setToDelete(r); setDeleteOpen(true) } },
  ]
  const set = (k: keyof JobForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value })

  return (
    <div>
      <PageHeader title={cfg.labels.plural} action={<Button onClick={() => openCreate()}><Plus className="w-4 h-4 mr-2 inline" />{cfg.labels.add}</Button>} />
      <div className="mb-4 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} pl-10`} />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputCls} w-auto capitalize`}>
          <option value="">All Status</option>
          {cfg.statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>

      <DataTable<JobRow> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={(row) => navigate(`/crm/jobs/${row.id}`)} actions={actions} emptyMessage={`No ${cfg.labels.plural.toLowerCase()} found`} />

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${cfg.labels.singular}` : `New ${cfg.labels.singular}`} size="lg">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><Field label="Title *"><input value={form.title} onChange={set('title')} className={inputCls} /></Field></div>
          <Field label="Status"><select value={form.status} onChange={set('status')} className={`${inputCls} capitalize`}>{cfg.statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}{!cfg.statuses.includes(form.status) && form.status && <option value={form.status}>{label(form.status)}</option>}</select></Field>
          <Field label="Priority"><select value={form.priority} onChange={set('priority')} className={`${inputCls} capitalize`}>{cfg.priorities.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          {projects.length > 0 && <Field label="Project"><select value={form.projectId} onChange={set('projectId')} className={inputCls}><option value="">Select...</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          {cfg.assignee && <Field label="Assigned To"><select value={form.assignedToId} onChange={set('assignedToId')} className={inputCls}><option value="">Unassigned</option>{team.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}</select></Field>}
          <Field label="Contact">
            <select value={form.contactId} onChange={(e) => { setForm(applyContact(form, e.target.value)); loadForContact(e.target.value) }} className={inputCls}>
              <option value="">Select...</option>{contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {cfg.equipment && equipment.length > 0 && (
            <Field label={<span><Wrench className="w-3.5 h-3.5 inline mr-1" />Equipment</span>}>
              <select value={form.equipmentId} onChange={set('equipmentId')} className={inputCls}>
                <option value="">No specific unit</option>
                {equipment.map((eq) => <option key={eq.id} value={eq.id}>{eq.name}{eq.manufacturer ? ` — ${eq.manufacturer}` : ''}{eq.model ? ` ${eq.model}` : ''}{eq.serialNumber ? ` (${eq.serialNumber})` : ''}</option>)}
              </select>
            </Field>
          )}
          {cfg.sites && sites.length > 0 && (
            <Field label={<span><MapPinned className="w-3.5 h-3.5 inline mr-1" />Location</span>}>
              <select value={form.siteId} onChange={(e) => { const s = sites.find((x) => x.id === e.target.value); setForm({ ...form, siteId: e.target.value, ...(s?.address ? { address: s.address, city: s.city || '', state: s.state || '', zip: s.zip || '' } : {}) }); if (s?.address) setUseAddressOnFile(true) }} className={inputCls}>
                <option value="">No specific location</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` — ${s.address}` : ''}</option>)}
              </select>
            </Field>
          )}
          <Field label="Scheduled Date"><input type="date" value={form.scheduledDate} onChange={set('scheduledDate')} className={inputCls} /></Field>
          <Field label="Scheduled Time"><input type="time" value={form.scheduledTime} onChange={set('scheduledTime')} className={inputCls} /></Field>
          <Field label="Estimated Hours"><input type="number" min="0" step="0.25" value={form.estimatedHours} onChange={set('estimatedHours')} className={inputCls} /></Field>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Address</label>
              {useAddressOnFile && <button type="button" onClick={() => setUseAddressOnFile(false)} className="text-xs text-orange-500 hover:text-orange-600">Using address on file — Use different address?</button>}
            </div>
            <input value={form.address} onChange={(e) => { setUseAddressOnFile(false); setForm({ ...form, address: e.target.value }) }} className={inputCls} placeholder={useAddressOnFile ? 'From contact on file' : 'Street address'} />
          </div>
          <Field label="City"><input value={form.city} onChange={set('city')} className={inputCls} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State"><input value={form.state} onChange={set('state')} className={inputCls} /></Field>
            <Field label="ZIP"><input value={form.zip} onChange={set('zip')} className={inputCls} /></Field>
          </div>
          <div className="md:col-span-2"><Field label="Notes"><textarea value={form.notes} onChange={set('notes')} rows={3} className={inputCls} /></Field></div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
        </div>
      </Modal>

      <ConfirmModal isOpen={deleteOpen} onClose={() => { setDeleteOpen(false); setToDelete(null) }} onConfirm={remove} title={`Delete ${cfg.labels.singular}`} message={`Delete "${toDelete?.title || ''}"?`} confirmText="Delete" />
    </div>
  )
}

export default JobsPage
