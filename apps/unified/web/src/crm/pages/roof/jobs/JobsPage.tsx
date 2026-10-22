// Moved from templates/crm-roof/frontend/src/pages/roofing/JobsPage.tsx — roofing's job list and New Job form, at /crm/jobs.
//
// Changes from the template:
//   · the server's names: `number` (was jobNumber), `address` (was propertyAddress), the homeowner's one `name` (the
//     template joined contact.firstName and lastName, which the list's { id, name } contact doesn't carry, so the Contact
//     column read "—" on every row), `estimatedValue` (was estimatedRevenue);
//   · GET /api/jobs/types is a list ({ data }); the template read it as a bare array;
//   · the Revenue column reads finalRevenue, then estimatedValue, then RCV. estimatedValue now sits under quotes:read
//     (the CRM's rule for a quoted figure) where the template's estimatedRevenue sat under invoices:read, so the column
//     shows for a seat that isn't refused either: with one of them refused, the fallback would print a different figure
//     as the job's revenue;
//   · New Job leaves Stories out when it's blank (the template sent null, which the server's number coercion reads as
//     0 stories) and shows the server's refusal — the address, city, state and zip are required there, and the form
//     said only "Failed to create job";
//   · people from GET /api/company/users (the template's /api/users), asked of a seat the server answers (team:read or
//     users:read, its own gate); contacts for the picker from the CRM's GET /api/contacts.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, ChevronLeft, ChevronRight, Briefcase } from 'lucide-react'
import { api } from '../../../../api'
import { useAuth, useMayWrite, useKnownPermission, usePermissions, useToast, errorText } from '../../../../shared'
import { formatDate } from '../../../date'
import { displayName } from '../lib/user'
import { JOB_TYPES, TERMINAL_STATUSES, formatStatus, pipelineFor, rowsOf } from './model'
import type { Crew, Person, RoofJob } from './model'

/**
 * The vocabulary, plus anything the data actually holds. `jobType` is a free string on the server, so a tenant can hold
 * values this list never had; a record must not go missing because its value is not on today's list. (roof T18)
 */
const typeOptions = (...present: Array<string | undefined | null>) =>
  [...new Set([...JOB_TYPES, ...present.filter((t): t is string => !!t)])]

const STATUS_COLORS: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  inspection_scheduled: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  inspected: 'bg-indigo-100 text-indigo-700 dark:text-indigo-300 dark:bg-indigo-950/40',
  measurement_ordered: 'bg-purple-100 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40',
  proposal_sent: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
  signed: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  material_ordered: 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40',
  in_production: 'bg-cyan-100 text-cyan-700 dark:text-cyan-300 dark:bg-cyan-950/40',
  final_inspection: 'bg-teal-100 text-teal-700 dark:text-teal-300 dark:bg-teal-950/40',
  invoiced: 'bg-pink-100 text-pink-700 dark:text-pink-300 dark:bg-pink-950/40',
  collected: 'bg-emerald-100 text-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/40',
}

const TYPE_COLORS: Record<string, string> = {
  insurance: 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40',
  retail: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  commercial: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  new_construction: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  emergency: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
}

interface ContactOption { id: string; name?: string | null }

interface JobForm {
  contactId: string; jobType: string; address: string; city: string; state: string; zip: string
  roofType: string; stories: string; totalSquares: string; scheduledDate: string; scheduledTime: string; notes: string
}
const EMPTY_FORM: JobForm = { contactId: '', jobType: 'retail', address: '', city: '', state: '', zip: '', roofType: '', stories: '', totalSquares: '', scheduledDate: '', scheduledTime: '', notes: '' }

export default function JobsPage() {
  // Offer a write only where it is allowed: POST /api/jobs asks jobs:create.
  const mayCreateJob = useMayWrite('jobs:create')
  const { hasFeature } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [jobs, setJobs] = useState<RoofJob[]>([])
  const [knownTypes, setKnownTypes] = useState<string[]>([])
  const [users, setUsers] = useState<Person[]>([])
  const [crews, setCrews] = useState<Crew[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [crewFilter, setCrewFilter] = useState('')
  const [repFilter, setRepFilter] = useState('')
  // "My jobs" — the jobs I'm the sales rep on; everyone still sees every job (owner's decision, T63).
  const [mineOnly, setMineOnly] = useState(false)
  // The rep list is GET /api/company/users — users:read or team:read. Asked only of a seat it answers, once known;
  // the picker only when it has names. (T63, T64)
  const { known, can } = usePermissions()
  const maySeeRoster: boolean | null = known ? (can('team:read') || can('users:read')) : null
  // The column's figures: finalRevenue / RCV are invoices:read, estimatedValue quotes:read (jobs/jobMoney.ts). It goes
  // for a seat refused either, and stays while the answer is unknown.
  const maySeeInvoices = useKnownPermission('invoices:read')
  const maySeeQuotes = useKnownPermission('quotes:read')
  const maySeeMoney = maySeeInvoices !== false && maySeeQuotes !== false
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<JobForm>(EMPTY_FORM)
  const [contacts, setContacts] = useState<ContactOption[]>([])

  const limit = 25

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, limit }
      if (search) params.search = search
      if (statusFilter) params.status = statusFilter
      if (typeFilter) params.jobType = typeFilter
      if (crewFilter) params.assignedCrewId = crewFilter
      if (repFilter) params.assignedSalesRepId = repFilter
      if (mineOnly) params.mine = '1'

      const [jobsRes, usersRes, crewsRes] = await Promise.all([
        api.get('/api/jobs', params) as Promise<{ data?: RoofJob[]; pagination?: { total?: number } }>,
        maySeeRoster ? api.get('/api/company/users') : Promise.resolve([]),
        api.get('/api/crews'),
      ])
      setJobs(rowsOf<RoofJob>(jobsRes))
      // The distinct set for the whole tenant, not just this page — a legacy type further down the list would
      // otherwise be unselectable and its jobs unreachable. (roof T18)
      try {
        setKnownTypes(rowsOf<string>(await api.get('/api/jobs/types')))
      } catch { /* the filter still works from the vocabulary + this page */ }
      setTotal(jobsRes?.pagination?.total || 0)
      setUsers(rowsOf<Person>(usersRes))
      setCrews(rowsOf<Crew>(crewsRes))
    } catch {
      toast.error('Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }, [page, search, statusFilter, typeFilter, crewFilter, repFilter, mineOnly, maySeeRoster]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, statusFilter, typeFilter, crewFilter, repFilter, mineOnly])

  const openCreate = async () => {
    setForm(EMPTY_FORM)
    try {
      setContacts(rowsOf<ContactOption>(await api.get('/api/contacts', { limit: 200 })))
    } catch { setContacts([]) }
    setModalOpen(true)
  }

  const handleCreate = async () => {
    if (!form.contactId) { toast.error('Select a contact'); return }
    setSaving(true)
    try {
      const { address, stories, roofType, totalSquares, scheduledDate, scheduledTime, ...rest } = form
      // The day and time on the calendar (the company's clock) and the roof's squares, each only when filled in.
      const job = await api.post('/api/jobs', {
        ...rest, propertyAddress: address, ...(stories ? { stories: Number(stories) } : {}), ...(roofType && { roofType }),
        ...(totalSquares ? { totalSquares: Number(totalSquares) } : {}),
        ...(scheduledDate ? { scheduledDate } : {}), ...(scheduledDate && scheduledTime ? { scheduledTime } : {}),
      }) as RoofJob
      toast.success('Job created')
      setModalOpen(false)
      navigate(`/crm/jobs/${job.id}`)
    } catch (err) {
      toast.error(errorText(err, 'Failed to create job'))
    } finally {
      setSaving(false)
    }
  }

  const crewMap: Record<string, string> = {}
  crews.forEach((c) => (crewMap[c.id] = c.name))

  const totalPages = Math.ceil(total / limit) || 1
  const revenueOf = (job: RoofJob) => job.finalRevenue ?? job.estimatedValue ?? job.rcv

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Jobs</h1>
            <p className="text-sm text-gray-500 mt-0.5 dark:text-slate-400">{total} total jobs</p>
          </div>
          {mayCreateJob && (
            <button
              onClick={openCreate}
              className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700"
            >
              <Plus className="w-4 h-4" /> New Job
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs..."
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg"
            />
          </div>
          <button type="button" onClick={() => setMineOnly(!mineOnly)} aria-pressed={mineOnly}
            className={`text-sm px-3 py-2 rounded-lg border font-medium ${mineOnly ? 'bg-orange-100 border-orange-300 text-orange-900 dark:bg-orange-950/40 dark:border-orange-700 dark:text-orange-200' : 'bg-white border-gray-300 text-gray-700 dark:bg-slate-900 dark:border-slate-600 dark:text-slate-200'}`}>
            My jobs
          </button>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Statuses</option>
            {[...pipelineFor(hasFeature, jobs), ...TERMINAL_STATUSES].map((s) => <option key={s} value={s}>{formatStatus(s)}</option>)}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Types</option>
            {typeOptions(...knownTypes, ...jobs.map((j) => j.jobType)).map((t) => <option key={t} value={t}>{formatStatus(t)}</option>)}
          </select>
          <select value={crewFilter} onChange={(e) => setCrewFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Crews</option>
            {crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {users.length > 0 && <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="text-sm border rounded-lg px-3 py-2">
            <option value="">All Sales Reps</option>
            {users.map((u) => <option key={u.id} value={u.id}>{displayName(u)}</option>)}
          </select>}
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b dark:bg-slate-900">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Job #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Address</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Crew</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Squares</th>
                  {maySeeMoney && <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Revenue</th>}
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-slate-400">Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={maySeeMoney ? 9 : 8} className="text-center py-12 text-gray-500 dark:text-slate-400">Loading...</td></tr>
                ) : jobs.length === 0 ? (
                  <tr><td colSpan={maySeeMoney ? 9 : 8} className="text-center py-12 text-gray-500 dark:text-slate-400">No jobs found</td></tr>
                ) : jobs.map((job) => {
                  const revenue = revenueOf(job)
                  return (
                    <tr
                      key={job.id}
                      onClick={() => navigate(`/crm/jobs/${job.id}`)}
                      className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-700 dark:text-slate-200">
                        {job.number || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-slate-100">{job.contact?.name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate dark:text-slate-400">{job.address || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${TYPE_COLORS[job.jobType || ''] || 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'}`}>
                          {(job.jobType || 'retail').replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'}`}>
                          {formatStatus(job.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-400">{(job.assignedCrewId && crewMap[job.assignedCrewId]) || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-600 dark:text-slate-400">{job.totalSquares || '—'}</td>
                      {maySeeMoney && (
                        <td className="px-4 py-3 text-right text-gray-900 font-medium dark:text-slate-100">
                          {revenue != null
                            ? `$${Number(revenue).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                            : '—'}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-500 text-xs dark:text-slate-400">
                        {job.createdAt ? formatDate(job.createdAt) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50 dark:bg-slate-900">
              <p className="text-xs text-gray-500 dark:text-slate-400">Page {page} of {totalPages}</p>
              <div className="flex gap-1">
                <button aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button aria-label="Next page" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2 dark:text-slate-100">
              <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" /> New Job
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Contact *</label>
                <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                  <option value="">Select contact...</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name || '—'}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Job Type</label>
                <select value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                  {typeOptions(form.jobType).map((t) => <option key={t} value={t}>{formatStatus(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Address</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">City</label>
                  <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">State</label>
                  <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Zip</label>
                  <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Roof Type</label>
                  <input value={form.roofType} onChange={(e) => setForm({ ...form, roofType: e.target.value })} placeholder="e.g. Asphalt Shingle" className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Stories</label>
                  <input type="number" value={form.stories} onChange={(e) => setForm({ ...form, stories: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="roof-new-squares" className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Squares</label>
                  <input id="roof-new-squares" type="number" min={0} step="0.01" value={form.totalSquares} onChange={(e) => setForm({ ...form, totalSquares: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label htmlFor="roof-new-date" className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Scheduled</label>
                  <input id="roof-new-date" type="date" value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label htmlFor="roof-new-time" className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Time</label>
                  <input id="roof-new-time" type="time" value={form.scheduledTime} disabled={!form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2 disabled:opacity-50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
