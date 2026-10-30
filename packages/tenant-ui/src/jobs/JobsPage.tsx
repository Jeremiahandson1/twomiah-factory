// Jobs list — one page for every CRM. Search / status filter, paged table (overdue flag), create/edit modal
// (also opened by /crm/jobs?edit=<id>; /crm/jobs?contactId=<id> opens "new" with the contact and their
// address on file), start / complete / delete row actions.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Edit, Trash2, Search, Play, CheckCircle, Wrench, MapPinned } from 'lucide-react'
import { DataTable, StatusBadge, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, dateOnly, errMsg, selectCls } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import { resolveJobsConfig, PRIORITY_COLORS } from './types'
import type { JobsPageProps, JobRow } from './types'
import { useMayWrite } from '../auth/PermissionsContext'
import { CUSTOMER_PICKER_PARAMS, customersOnly } from '../contacts/types'
import { isTravelWarning } from '../schedule/crew'

interface JobForm {
  title: string; description: string; status: string; priority: string; scheduledDate: string; scheduledTime: string; estimatedHours: string
  address: string; city: string; state: string; zip: string; projectId: string; contactId: string; assignedToId: string; equipmentId: string; siteId: string; notes: string; locationId: string
}
type Pick = { id: string; contactId?: string | null; name?: string; firstName?: string; lastName?: string; email?: string; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; manufacturer?: string | null; model?: string | null; serialNumber?: string | null }

const emptyForm = (status: string, priority: string): JobForm => ({ title: '', description: '', status, priority, scheduledDate: '', scheduledTime: '', estimatedHours: '', address: '', city: '', state: '', zip: '', projectId: '', contactId: '', assignedToId: '', equipmentId: '', siteId: '', notes: '', locationId: '' })
const label = (s: string) => s.replace(/_/g, ' ')

/**
 * How a new job repeats (JobsConfig.repeat). "none" is a single job, as before. The choices are the ones the server
 * takes — weekly × 1–4 or monthly — and an end: a number of visits, or a last day.
 */
type RepeatChoice = 'none' | 'w1' | 'w2' | 'w3' | 'w4' | 'm1'
const REPEAT_CHOICES: Array<{ value: RepeatChoice; label: string }> = [
  { value: 'none', label: 'Does not repeat' }, { value: 'w1', label: 'Every week' }, { value: 'w2', label: 'Every 2 weeks' },
  { value: 'w3', label: 'Every 3 weeks' }, { value: 'w4', label: 'Every 4 weeks' }, { value: 'm1', label: 'Every month' },
]
interface RepeatForm { choice: RepeatChoice; ends: 'count' | 'until'; count: string; until: string; weekdays: number[] }
const NO_REPEAT: RepeatForm = { choice: 'none', ends: 'count', count: '12', until: '', weekdays: [] }
/** Sunday-first, as the server counts them; shown Monday-first below. */
const WEEKDAY_BUTTONS: Array<{ n: number; label: string }> = [{ n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' }, { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' }]
const repeatBody = (r: RepeatForm, withDays = false) => r.choice === 'none' ? undefined : {
  frequency: r.choice === 'm1' ? 'monthly' : 'weekly', interval: r.choice === 'm1' ? 1 : Number(r.choice.slice(1)),
  ...(withDays && r.choice !== 'm1' && r.weekdays.length ? { weekdays: r.weekdays } : {}),
  ...(r.ends === 'count' ? { count: r.count === '' ? undefined : Number(r.count) } : { until: r.until || undefined }),
}

export function JobsPage({ api, toast, config }: JobsPageProps) {
  const cfg = resolveJobsConfig(config)
  // A technician's job is to work the calls, not to raise or assign them: `field` holds jobs:read and
  // jobs:update, and since the T30 blocker fix the API enforces that. The button stayed on the page.
  // useMayWrite, not cfg.can: `can` defaults to allow on the wrappers that never pass it. (T68)
  const mayCreate = useMayWrite('jobs:create')
  // Edit is PUT /:id, Start and Complete are POST /:id/start|complete — all jobs:update. The read-only seat was
  // offered all three in every row's menu. (T43 viewer round)
  const mayUpdate = useMayWrite('jobs:update')
  const maySeeRoster = cfg.can('team:read')
  // DELETE /api/jobs/:id asks jobs:delete; the row's Delete was offered to everyone. useMayWrite, not cfg.can —
  // most wrappers never set `can` on JobsConfig, so a cfg.can gate would never close. (T62)
  const mayDelete = useMayWrite('jobs:delete')
  // Who is on a job and when it is: jobs:dispatch (tenant-backend jobs/dispatch.ts). A field seat edits its own job's
  // status and notes; the assignee and the date and time are shown, not offered. (HVAC live role test 2026-10-24)
  const mayDispatch = useMayWrite('jobs:dispatch')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<JobRow[]>([])
  const [projects, setProjects] = useState<Pick[]>([])
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code?: string | null }>>([])
  const [branchFilter, setBranchFilter] = useState('')
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
  // The statuses the filter and the form offer: a vertical's own list if it set one, else the server's (one list —
  // JOB_STATUSES, sent with every page of jobs), else the same list built in until the first page arrives.
  const [serverStatuses, setServerStatuses] = useState<string[] | null>(null)
  const statuses = config?.statuses && config.statuses.length ? cfg.statuses : (serverStatuses || cfg.statuses)
  const [form, setForm] = useState<JobForm>(emptyForm(cfg.statuses[0], 'normal'))
  const [saving, setSaving] = useState(false)
  /**
   * The other people on the job, beside "Assigned To" — its lead (2026-10-24: several people per job, as Jobber and
   * Housecall Pro book a crew). Sent as otherAssigneeIds only when the roster could be read: a seat that cannot see the
   * team cannot pick, so its save leaves the crew as it is.
   */
  const [otherIds, setOtherIds] = useState<string[]>([])
  /** A save the server warned about (no time to drive between two jobs): asked about, then sent again with bookAnyway. */
  const [travelAsk, setTravelAsk] = useState<string | null>(null)
  const [repeat, setRepeat] = useState<RepeatForm>(NO_REPEAT)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [toDelete, setToDelete] = useState<JobRow | null>(null)

  /**
   * THE PROJECT THE LINK CAME FROM. (T51 contractor: "View All ignores the project")
   *
   * ProjectDetailPage's Jobs panel shows the first five and links to `/crm/jobs?projectId=<id>`.
   * This page read `?edit=` and `?contactId=` and not `?projectId=`, so View All landed on every job
   * in the company — and the one list it could not give you was the project you had just clicked out
   * of. GET /api/jobs has filtered on it since it was written (jobs.ts:366); only the screen never
   * asked. Reported against Change Orders; the same link, the same omission, on the panel above it.
   */
  const projectFilter = searchParams.get('projectId') || ''

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, limit: 25 }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      if (projectFilter) params.projectId = projectFilter
      if (branchFilter) params.locationId = branchFilter
      const res = await api.get('/api/jobs', params)
      setData(res?.data || [])
      setPagination(res?.pagination || null)
      if (Array.isArray(res?.statuses) && res.statuses.length) setServerStatuses(res.statuses)
    } catch (err) { toast.error(errMsg(err, `Failed to load ${cfg.labels.plural.toLowerCase()}`)) } finally { setLoading(false) }
  }, [page, search, statusFilter, projectFilter, branchFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Arriving on page 3 of the whole company and then filtering to one project would show nothing. */
  useEffect(() => { setPage(1) }, [projectFilter])

  /**
   * Projects load only where the tenant HAS projects — and this has its OWN effect, keyed on the answer.
   *
   * The fetch fired on every load of the Service Calls page and was refused 403 every time: a request the
   * app already knew the answer to, and console noise that hides real failures. But hasFeature() answers
   * false until /api/auth/me lands, so testing it inside the mount-once effect would have skipped the
   * fetch for tenants that DO have projects — trading a harmless 403 for an empty picker. Depending on
   * the answer means the fetch runs the moment it flips true. (Field Service T29 M1)
   */
  /** A job's branch — only where the tenant runs several (multi_location). Keyed on the answer, like projects. */
  const tenantHasBranches = cfg.hasFeature('multi_location')
  useEffect(() => {
    if (!tenantHasBranches) { setBranches([]); return }
    api.get('/api/locations', { active: 'true' }).then((r: any) => setBranches(r?.data || [])).catch(() => setBranches([]))
  }, [tenantHasBranches]) // eslint-disable-line react-hooks/exhaustive-deps
  const tenantHasProjects = cfg.hasFeature('projects')
  // Whether the project list has answered (either way): a job opened from a project waits for it, to fill the customer.
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [contactsLoaded, setContactsLoaded] = useState(false)
  useEffect(() => {
    if (!tenantHasProjects) { setProjects([]); setProjectsLoaded(true); return }
    api.get('/api/projects', { limit: 100 }).then((r: any) => setProjects(r?.data || [])).catch(() => setProjects([])).finally(() => setProjectsLoaded(true))
  }, [tenantHasProjects]) // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * A job made under a project is for the project's customer when none is chosen. "Add Job" on a project opened the form
   * with the project and no customer, and the saved job read "No customer" (contractor re-test 2026-10-22). The server
   * holds the same rule for every door (tenant-backend contacts/customer.ts).
   */
  const withProject = (f: JobForm, projectId: string): JobForm => {
    const next = { ...f, projectId }
    const pr = projects.find((p) => p.id === projectId)
    if (next.contactId || !pr?.contactId || !contacts.some((c) => c.id === pr.contactId)) return next
    loadForContact(String(pr.contactId))
    return applyContact(next, String(pr.contactId))
  }

  // pickers load once; a failure must not block the list
  useEffect(() => {
    // Customers only: a job is done for a customer, never a vendor (contacts/types.ts CUSTOMER_PICKER_PARAMS).
    api.get('/api/contacts', { limit: 200, ...CUSTOMER_PICKER_PARAMS }).then((r: any) => setContacts(customersOnly(r?.data || []))).catch(() => setContacts([])).finally(() => setContactsLoaded(true))
    // Assignable people: login users AND active roster crew (T21 M12 — crew without a login do the work). GET /api/team
    // drops users once a roster member exists, which erased everyone from the picker. (F-14 / assignee)
    // …and only for someone who may read the roster. `field` has no team:read, so this answered 403 on
    // every visit — swallowed by the catch, but printed in the console and paid for on every load.
    if (cfg.assignee && maySeeRoster) api.get('/api/team/assignable').then((r: any) => setTeam(r?.data || (Array.isArray(r) ? r : []))).catch(() => setTeam([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, statusFilter, branchFilter])

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

  const openCreate = (contactId?: string, projectId?: string) => {
    setEditing(null)
    let f = emptyForm(cfg.statuses[0], 'normal')
    setUseAddressOnFile(false)
    if (contactId) { f = applyContact(f, contactId); loadForContact(contactId) } else { setEquipment([]); setSites([]) }
    // Arrived from a project's Quick Action: that project is already the answer (T51), and so is its customer.
    if (projectId) f = withProject(f, projectId)
    setForm(f)
    setOtherIds([])
    setRepeat(NO_REPEAT)
    setModalOpen(true)
  }
  const lockSlot = !!editing && !mayDispatch
  /**
   * The picker's people, plus anyone the job being edited already has whom the picker leaves out — a switched-off login
   * (GET /api/team/assignable lists active ones only). Left out, the box read "Unassigned" for a job that still had its
   * person, and a field seat (no roster) saw "Unassigned" on its own job.
   */
  const pickable: Pick[] = [...team, ...((editing?.assignees || []) as any[]).filter((a) => a?.id && !team.some((u) => u.id === a.id)).map((a) => ({ id: a.id, name: a.name } as Pick))]
  const openEdit = (item: JobRow) => {
    setEditing(item)
    setForm({
      ...emptyForm(cfg.statuses[0], 'normal'),
      title: item.title || '', description: item.description || '', status: item.status || cfg.statuses[0], priority: item.priority || 'normal',
      scheduledDate: item.scheduledDate ? String(item.scheduledDate).slice(0, 10) : '', scheduledTime: item.scheduledTime || '', estimatedHours: item.estimatedHours != null ? String(item.estimatedHours) : '',
      address: item.address || '', city: item.city || '', state: item.state || '', zip: item.zip || '',
      // A job can be assigned to a login user OR a roster-only crew member; the picker holds whichever id it is, and
      // the API routes it back to the right column. Seeding only from assignedToId showed "Unassigned" for crew —
      // and saving the form would then have unassigned them for real. (T21 M12)
      projectId: item.projectId || '', contactId: item.contactId || '', assignedToId: item.assignedToId || item.assignedToMemberId || '', equipmentId: item.equipmentId || '', siteId: item.siteId || '', notes: item.notes || '', locationId: (item as any).locationId || '',
    })
    setOtherIds((item.assignees || []).filter((a) => !a.lead).map((a) => a.id))
    setUseAddressOnFile(false)
    loadForContact(item.contactId || '')
    setModalOpen(true)
  }

  /**
   * Deep links: ?edit=<id> from the detail page, ?contactId=<id> from a contact's quick actions, and
   * ?new=true from a project's — which was being sent and ignored, so "Create Job" on a project
   * opened nothing and left the person to find the Add button and re-pick the project. (T51)
   *
   * `new` is consumed here and `projectId` is NOT: the filter stays on, so closing the dialog leaves
   * you looking at that project's jobs rather than the whole company's.
   */
  useEffect(() => {
    const editId = searchParams.get('edit'), contactId = searchParams.get('contactId')
    const wantsNew = searchParams.get('new') === 'true'
    if (!editId && !contactId && !wantsNew) return
    if (contactId && contacts.length === 0) return // wait for the picker so the address can be applied
    if (wantsNew && projectFilter && (!projectsLoaded || !contactsLoaded)) return // wait for both, to bring the project's customer
    let cancelled = false
    const next = new URLSearchParams(searchParams); next.delete('edit'); next.delete('contactId'); next.delete('new')
    if (editId && mayUpdate) {
      api.get(`/api/jobs/${editId}`).then((row: JobRow) => { if (!cancelled && row) { openEdit(row); setSearchParams(next, { replace: true }) } }).catch(() => {})
    } else if (contactId && mayCreate) { openCreate(contactId, projectFilter || undefined); setSearchParams(next, { replace: true }) }
    else if (wantsNew && mayCreate) { openCreate(undefined, projectFilter || undefined); setSearchParams(next, { replace: true }) }
    return () => { cancelled = true }
  }, [searchParams, contacts.length, projectFilter, projectsLoaded, contactsLoaded, mayCreate, mayUpdate]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (bookAnyway = false) => {
    if (!form.title.trim()) { toast.error('Title is required'); return }
    const repeating = !editing && cfg.repeat && repeat.choice !== 'none'
    if (repeating && !form.scheduledDate) { toast.error('Pick the scheduled date — the first visit — to make it repeat'); return }
    setSaving(true)
    try {
      const payload: any = { ...form, estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : undefined }
      if (cfg.assignee && team.length > 0) payload.otherAssigneeIds = otherIds.filter((id) => id !== form.assignedToId)
      if (bookAnyway) payload.bookAnyway = true
      if (!cfg.equipment) delete payload.equipmentId
      if (!cfg.sites) delete payload.siteId
      if (!tenantHasBranches) delete payload.locationId
      if (editing) { await api.put(`/api/jobs/${editing.id}`, payload); toast.success(`${cfg.labels.singular} updated`) }
      else if (repeating) {
        // Every visit is made now and is on the calendar; a day the person is already booked is listed back.
        const r: any = await api.post('/api/jobs', { ...payload, repeat: repeatBody(repeat, cfg.repeatWeekdays) })
        const s = r?.series
        toast.success(s ? `${s.made} visits scheduled — ${s.summary.toLowerCase()}` : `${cfg.labels.singular} created`)
        if (s?.skipped?.length) toast.error(`${s.skipped.length} not booked: ${s.skipped.slice(0, 3).map((k: any) => `${dateOnly(k.date)} (${k.reason})`).join('; ')}`)
      }
      else { await api.post('/api/jobs', payload); toast.success(`${cfg.labels.singular} created`) }
      setModalOpen(false); load()
    } catch (err) {
      if (isTravelWarning(err)) setTravelAsk(errMsg(err, 'There is not enough time to get there.'))
      else toast.error(errMsg(err, 'Failed to save'))
    } finally { setSaving(false) }
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
    // a row with no customer said nothing at all — say so, so it can be found and fixed (T21 L2)
    { key: 'title', label: 'Title', render: (v: unknown, r: JobRow) => <div><p className="font-medium">{String(v || '')}</p><p className={`text-sm ${r.contact ? 'text-gray-500 dark:text-slate-400' : 'text-gray-500 italic dark:text-slate-400'}`}>{r.contact ? r.contact.name : 'No customer'}</p></div> },
    { key: 'status', label: 'Status', render: (v: unknown, r: JobRow) => <span className="inline-flex items-center gap-1"><StatusBadge status={String(v || '')} />{r.isOverdue ? <StatusBadge status="overdue" /> : null}</span> },
    { key: 'priority', label: 'Priority', render: (v: unknown) => <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${PRIORITY_COLORS[String(v)] || ''}`}>{String(v || '')}</span> },
    { key: 'scheduledDate', label: 'Scheduled', render: (v: unknown) => v ? dateOnly(v) : '-' },
    { key: 'assignedTo', label: 'Assigned To', render: (v: unknown) => { const a = v as any; return a ? (a.name || `${a.firstName || ''} ${a.lastName || ''}`.trim() || '-') : '-' } },
  ]
  const actions = [
    { label: 'Edit', icon: Edit, show: () => mayUpdate, onClick: openEdit },
    { label: 'Start', icon: Play, show: (r: JobRow) => mayUpdate && r.status !== 'in_progress' && r.status !== 'completed' && r.status !== 'cancelled', onClick: start },
    { label: 'Complete', icon: CheckCircle, show: (r: JobRow) => mayUpdate && r.status !== 'completed' && r.status !== 'cancelled', onClick: complete },
    { label: 'Delete', icon: Trash2, className: 'text-red-600', show: () => mayDelete, onClick: (r: JobRow) => { setToDelete(r); setDeleteOpen(true) } },
  ]
  const set = (k: keyof JobForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      <PageHeader title={cfg.labels.plural} action={mayCreate ? <Button onClick={() => openCreate()}><Plus className="w-4 h-4 mr-2 inline" />{cfg.labels.add}</Button> : undefined} />
      {/* A filter that is applied and not shown is indistinguishable from a project with no work on it. */}
      {projectFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-800 dark:bg-slate-800 dark:text-slate-100">
          <span>
            Showing {cfg.labels.plural.toLowerCase()} on{' '}
            <span className="font-semibold">{projects.find((p) => p.id === projectFilter)?.name || 'this project'}</span>
            {pagination ? ` — ${pagination.total} in total` : ''}
          </span>
          <button
            type="button"
            onClick={() => { const next = new URLSearchParams(searchParams); next.delete('projectId'); setSearchParams(next) }}
            className="font-semibold underline underline-offset-2 hover:no-underline"
          >
            Show all {cfg.labels.plural.toLowerCase()}
          </button>
        </div>
      )}
      <div className="mb-4 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} pl-10`} />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${selectCls} capitalize`}>
          <option value="">All Status</option>
          {statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
        {branches.length > 0 && (
          <select aria-label="Branch" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={selectCls}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      <DataTable<JobRow> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={(row) => navigate(`/crm/jobs/${row.id}`)} actions={actions}
        emptyMessage={search || statusFilter || projectFilter || branchFilter ? `No ${cfg.labels.plural.toLowerCase()} match` : `No ${cfg.labels.plural.toLowerCase()} yet`}
        emptyHint={search || statusFilter || projectFilter || branchFilter ? 'Try a different search or clear the filters.' : `Schedule work for a customer here — or turn an accepted quote into a ${cfg.labels.singular.toLowerCase()}.`}
        emptyAction={!search && !statusFilter && !projectFilter && !branchFilter && mayCreate ? <Button onClick={() => openCreate()}><Plus className="w-4 h-4 mr-2 inline" />{cfg.labels.add}</Button> : undefined}
      />

      {/* The dialog echoes the button that opened it, and keeps echoing it when a vertical renames the button:
          "Add Job" opened something headed "New Job". (T14 L3) */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${cfg.labels.singular}` : cfg.labels.add} size="lg">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><Field label="Title *"><input value={form.title} onChange={set('title')} className={inputCls} /></Field></div>
          <Field label="Status"><select value={form.status} onChange={set('status')} className={`${inputCls} capitalize`}>{statuses.map((s) => <option key={s} value={s}>{label(s)}</option>)}{!statuses.includes(form.status) && form.status && <option value={form.status}>{label(form.status)}</option>}</select></Field>
          <Field label="Priority"><select value={form.priority} onChange={set('priority')} className={`${inputCls} capitalize`}>{cfg.priorities.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          {branches.length > 0 && <Field label="Branch"><select value={form.locationId} onChange={set('locationId')} className={inputCls}><option value="">No branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}{form.locationId && !branches.some((b) => b.id === form.locationId) && <option value={form.locationId}>Inactive branch</option>}</select></Field>}
          {projects.length > 0 && <Field label="Project"><select value={form.projectId} onChange={(e) => setForm(withProject(form, e.target.value))} className={inputCls}><option value="">Select...</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          {cfg.assignee && <Field label="Assigned To"><select value={form.assignedToId} onChange={set('assignedToId')} disabled={lockSlot} className={inputCls}><option value="">Unassigned</option>{pickable.map((u) => <option key={u.id} value={u.id}>{(u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unnamed') + (!maySeeRoster || team.some((x) => x.id === u.id) ? '' : ' (switched off)')}</option>)}</select></Field>}
          {cfg.assignee && team.length > 1 && !lockSlot && (
            <fieldset className="md:col-span-2" data-testid="also-on-job">
              <legend className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Also on this {cfg.labels.singular.toLowerCase()}</legend>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto rounded-lg border border-gray-300 p-2 dark:border-slate-600">
                {team.filter((u) => u.id !== form.assignedToId).map((u) => {
                  const on = otherIds.includes(u.id)
                  return (
                    <label key={u.id} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm cursor-pointer ${on ? 'border-orange-600 bg-orange-50 text-orange-900 dark:border-orange-400 dark:bg-orange-950/40 dark:text-orange-100' : 'border-gray-300 text-gray-800 dark:border-slate-600 dark:text-slate-200'}`}>
                      <input type="checkbox" checked={on} onChange={() => setOtherIds((xs) => (on ? xs.filter((x) => x !== u.id) : [...xs, u.id]))} className="h-4 w-4" />
                      {u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || 'Unnamed'}
                    </label>
                  )
                })}
              </div>
              <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">Everyone ticked is booked, checked for clashes and told — "Assigned To" leads.</p>
            </fieldset>
          )}
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
            <Field label={<span><MapPinned className="w-3.5 h-3.5 inline mr-1" />{cfg.siteLabels.singular}</span>}>
              <select value={form.siteId} onChange={(e) => { const s = sites.find((x) => x.id === e.target.value); setForm((f) => ({ ...f, siteId: e.target.value, ...(s?.address ? { address: s.address, city: s.city || '', state: s.state || '', zip: s.zip || '' } : {}) })); if (s?.address) setUseAddressOnFile(true) }} className={inputCls}>
                <option value="">No specific {cfg.siteLabels.singular.toLowerCase()}</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` — ${s.address}` : ''}</option>)}
              </select>
            </Field>
          )}
          <Field label="Scheduled Date"><input type="date" value={form.scheduledDate} onChange={set('scheduledDate')} disabled={lockSlot} className={inputCls} /></Field>
          <Field label="Scheduled Time"><input type="time" value={form.scheduledTime} onChange={set('scheduledTime')} disabled={lockSlot} className={inputCls} /></Field>
          <Field label="Estimated Hours"><input type="number" min="0" step="0.25" value={form.estimatedHours} onChange={set('estimatedHours')} className={inputCls} /></Field>
          {/* Repeat — a new job only; an existing visit's series is shown and stopped on its own page. */}
          {!editing && cfg.repeat && (
            <div className="md:col-span-2 rounded-lg border border-gray-200 p-3 dark:border-slate-700" data-testid="job-repeat">
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Repeat">
                  <select aria-label="Repeat" value={repeat.choice} onChange={(e) => setRepeat((r) => ({ ...r, choice: e.target.value as RepeatChoice }))} className={inputCls}>
                    {REPEAT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                {repeat.choice !== 'none' && (
                  <>
                    <Field label="Ends">
                      <select aria-label="Ends" value={repeat.ends} onChange={(e) => setRepeat((r) => ({ ...r, ends: e.target.value as 'count' | 'until' }))} className={inputCls}>
                        <option value="count">After a number of visits</option>
                        <option value="until">On a date</option>
                      </select>
                    </Field>
                    {repeat.ends === 'count'
                      ? <Field label="Visits"><input aria-label="Visits" type="number" min={2} max={52} value={repeat.count} onChange={(e) => setRepeat((r) => ({ ...r, count: e.target.value }))} className={inputCls} /></Field>
                      : <Field label="Last day"><input aria-label="Last day" type="date" min={form.scheduledDate || undefined} value={repeat.until} onChange={(e) => setRepeat((r) => ({ ...r, until: e.target.value }))} className={inputCls} /></Field>}
                  </>
                )}
              </div>
              {cfg.repeatWeekdays && repeat.choice !== 'none' && repeat.choice !== 'm1' && (
                <fieldset className="mt-3" data-testid="job-repeat-days">
                  <legend className="text-xs font-medium text-gray-700 dark:text-slate-300">On these days (leave empty to repeat on the first visit's day)</legend>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {WEEKDAY_BUTTONS.map((d) => {
                      const on = repeat.weekdays.includes(d.n)
                      return (
                        <button key={d.n} type="button" aria-pressed={on} onClick={() => setRepeat((r) => ({ ...r, weekdays: on ? r.weekdays.filter((x) => x !== d.n) : [...r.weekdays, d.n] }))}
                          className={`rounded-md border px-3 py-1 text-sm ${on ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-slate-700 dark:text-orange-200' : 'border-gray-300 dark:border-slate-600'}`}>{d.label}</button>
                      )
                    })}
                  </div>
                </fieldset>
              )}
              {repeat.choice !== 'none' && (
                <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">
                  {form.scheduledDate
                    ? `Starts ${dateOnly(form.scheduledDate)}. Every visit goes on the Schedule now (up to 52), each its own ${cfg.labels.singular.toLowerCase()}; stop the series from any visit's page.`
                    : 'Pick the scheduled date above — it is the first visit.'}
                </p>
              )}
            </div>
          )}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Address</label>
              {useAddressOnFile && <button type="button" onClick={() => setUseAddressOnFile(false)} className="text-xs text-orange-500 hover:text-orange-600 dark:hover:text-orange-200 dark:text-orange-200">Using address on file — Use different address?</button>}
            </div>
            <input value={form.address} onChange={(e) => { setUseAddressOnFile(false); setForm((f) => ({ ...f, address: e.target.value })) }} className={inputCls} placeholder={useAddressOnFile ? 'From contact on file' : 'Street address'} />
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
          <Button onClick={() => save()} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button>
        </div>
      </Modal>

      <ConfirmModal isOpen={!!travelAsk} onClose={() => setTravelAsk(null)} onConfirm={() => { setTravelAsk(null); return save(true) }} danger={false}
        title="Not enough time to get there" message={travelAsk || ''} confirmText="Book anyway" />
      <ConfirmModal isOpen={deleteOpen} onClose={() => { setDeleteOpen(false); setToDelete(null) }} onConfirm={remove} title={`Delete ${cfg.labels.singular}`} message={`Delete "${toDelete?.title || ''}"?`} confirmText="Delete" />
    </div>
  )
}

export default JobsPage
