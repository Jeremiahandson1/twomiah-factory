// Moved from templates/crm-roof/frontend/src/pages/roofing/JobDetailPage.tsx — a roofing job, at /crm/jobs/:id.
//
// Changes from the template:
//   · the server's names: `number` (was jobNumber), `address` (was propertyAddress); the homeowner is the CRM's contact —
//     one `name` (the template joined firstName / lastName), `source` (was leadSource), and `mobile` shown when there is
//     no `phone` (a canvassed homeowner often has only a mobile); the name links to the CRM's contact screen;
//   · the job's quotes and invoices are the CRM's (`number`, was quoteNumber / invoiceNumber); an invoice's balance is
//     worked out by the CRM's rule from total, paid and refunded (the template read a stored `balance`, which the CRM
//     doesn't keep); both lists come back on the job, empty for a seat without invoices:read, and the cards go for that
//     seat as before;
//   · a timeline is a list ({ data }); notes and photos come on the job;
//   · a photo upload refused with 503 storage_not_configured says so in a sentence; any other refusal shows the
//     server's own words;
//   · dropped: the Material Order card (it read `job.materialOrder` / `materialOrders`, which no job reply carried —
//     the template's server didn't either, so it never rendered), and the note's `authorName` / the timeline's
//     `userName` (never sent);
//   · people from GET /api/company/users (the template's /api/users), asked of a seat the server answers (team:read or
//     users:read, its own gate); crews are GET /api/crews' { data }.
//   · "New quote" opens the CRM's quote form filled in with the homeowner and this job (packages/tenant-ui
//     invoicing/QuotesPage.tsx, roofing's screens set quoteJobs; /crm/quotes?new=1&contactId=&jobId=) — a quote for a
//     job is how a roofing proposal is made, and the job's Quotes list reads them back.
//   · the homeowner's quotes and invoices on no job are offered under each card with an Attach button (./AttachDocuments,
//     POST /api/jobs/:id/attach) — the job read "No quotes" beside a QTE-00001 made from the Quotes page (2026-10-22);
//   · Materials: the job's material orders, and a New order form (../field/JobMaterials) — the Materials page had no way
//     to add one (2026-10-22).
import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, ChevronRight, Phone, Mail, Upload, Clock,
  User, Users, Ruler, Camera, FileText, MessageSquare, Activity,
  Receipt, Shield, Home,
} from 'lucide-react'
import { api } from '../../../../api'
import { useAuth, useMayWrite, useKnownPermission, usePermissions, useToast, errorText, ReviewRequestButton, TextButton } from '../../../../shared'
import { formatDate } from '../../../date'
import { displayName } from '../lib/user'
import { formatStatus, rowsOf, stageLabel } from './model'
import type { Crew, Person, RoofJob } from './model'
import AttachDocuments from './AttachDocuments'
import JobCommissionPeople from './JobCommissionPeople'
import JobBooks from './JobBooks'
import InspectionReports from './InspectionReports'
import PhotoDetails from './PhotoDetails'
import ShareWithHomeowner from './ShareWithHomeowner'
import JobMaterials from '../field/JobMaterials'
import JobWorkOrders from '../field/JobWorkOrders'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { money } from '@twomiah/tenant-ui/src/money'
import { mayBeGivenWork } from '@twomiah/tenant-ui/src/people/work'
import { codeLabel, codesInText } from '@twomiah/tenant-ui/src/labels/codes'
import { PhotoViewer } from '@twomiah/tenant-ui/src/files/PhotoViewer'

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

const JOB_TYPE_COLORS: Record<string, string> = {
  insurance: 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40',
  retail: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  commercial: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  new_construction: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  emergency: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
}

/** The photo tabs (server/crm/roof/validation.ts JOB_PHOTO_TYPES, less the default `general`). */
const PHOTO_TABS = ['before', 'damage', 'during', 'after'] as const

const MEASUREMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
  processing: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  complete: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  failed: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
}

/** The homeowner, the whole CRM contact on GET /api/jobs/:id. */
interface JobContact { id: string; name?: string | null; phone?: string | null; mobile?: string | null; email?: string | null; source?: string | null }
interface JobPhoto { id: string; url?: string | null; thumbnailUrl?: string | null; caption?: string | null; photoType?: string | null; takenAt?: string | null; latitude?: string | null; longitude?: string | null }
interface JobNote { id: string; body?: string | null; createdAt?: string | null }
interface JobQuote { id: string; number?: string | null; status?: string | null; total?: string | number | null }
interface JobInvoice { id: string; number?: string | null; status?: string | null; total?: string | number | null; amountPaid?: string | number | null; amountRefunded?: string | number | null }
interface TimelineEvent { id: string; type: string; body?: string | null; createdAt?: string | null }
interface Segment { name?: string; area?: number | string; pitch?: string | number }
interface Measurement { status: string; imageryQuality?: string | null; totalSquares?: string | number | null; totalArea?: string | number | null; segments?: Segment[] | null }

/**
 * GET /api/jobs/:id (server/crm/roof/jobs.ts). Its `notes` are the job's notes (job_note rows), which the reply puts
 * over the job row's own notes text — as the template's did.
 */
interface JobDetail extends Omit<RoofJob, 'contact' | 'notes'> {
  contact: JobContact | null
  photos?: JobPhoto[]
  notes?: JobNote[]
  quotes?: JobQuote[]
  invoices?: JobInvoice[]
}

/** What is still owed on an invoice — the CRM's rule (packages/tenant-backend invoicing/money.ts invoiceBalance). */
function balanceOf(inv: JobInvoice): number {
  if (inv.status === 'void') return 0
  const total = Number(inv.total) || 0, paid = Number(inv.amountPaid || 0), refunded = Number(inv.amountRefunded || 0)
  if (total > 0 && refunded >= total - 0.005) return 0
  if (paid >= total - 0.005) return 0
  return Math.max(0, total - (paid - refunded))
}

function daysSince(date: string | null | undefined): number {
  if (!date) return 0
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24))
}

/** A photo upload's refusal, in a sentence. */
function uploadRefusal(err: unknown): string {
  const e = err as { status?: number; data?: { code?: string } } | null
  if (e?.status === 503 && e.data?.code === 'storage_not_configured') {
    return 'Photos can’t be saved yet — photo storage hasn’t been set up for this account. Please contact support.'
  }
  return errorText(err, 'Failed to upload photos')
}

export default function JobDetailPage() {
  // jobs:update: the field rung holds it, so a crew keeps closing and advancing its own work, uploading photos and
  // adding notes; the read-only office seat holds jobs:read only, and loses all of it. (T42)
  const mayWorkJob = useMayWrite('jobs:update')
  // Who is on the job and when it is: jobs:dispatch (tenant-backend jobs/dispatch.ts) — a Field seat works its own job,
  // it does not reassign it or move its day (live role tests 2026-10-24).
  const mayDispatchJob = useMayWrite('jobs:dispatch')
  const mayQuote = useMayWrite('quotes:create')
  // The roster is GET /api/company/users — users:read or team:read; asked once known. (T64)
  const { known, can } = usePermissions()
  const maySeeRoster: boolean | null = known ? (can('team:read') || can('users:read')) : null
  // The claim's money and the job's quotes and invoices are invoices:read on the server. Left out for a seat refused
  // it, shown while the answer is unknown, so an owner never sees them flicker away.
  const maySeeJobMoney = useKnownPermission('invoices:read') !== false
  // Ordering a measurement is a different module with its own route and its own verb.
  const mayOrderMeasurement = useMayWrite('measurements:create')
  const { id } = useParams<{ id: string }>()
  const { hasFeature } = useAuth()
  // The claims module is optional — a retail-only roofer never touches a carrier.
  const hasInsurance = hasFeature('insurance_workflow')
  // Photo Capture is a switch with a real API behind it, so the card follows it. (roof T18 L9)
  const hasPhotos = hasFeature('photo_capture')
  const toast = useToast()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [job, setJob] = useState<JobDetail | null>(null)
  const [users, setUsers] = useState<Person[]>([])
  const [crews, setCrews] = useState<Crew[]>([])
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [photos, setPhotos] = useState<JobPhoto[]>([])
  const [notes, setNotes] = useState<JobNote[]>([])
  const [quotes, setQuotes] = useState<JobQuote[]>([])
  const [invoices, setInvoices] = useState<JobInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [photoTab, setPhotoTab] = useState<string>('before')
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [uploading, setUploading] = useState(false)
  // The open photo in the full-size viewer: its place in the tab's photos.
  const [viewing, setViewing] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [jobData, usersRes, crewsRes, timelineRes] = await Promise.all([
        api.get(`/api/jobs/${id}`) as Promise<JobDetail>,
        maySeeRoster ? api.get('/api/company/users') : Promise.resolve([]),
        // Crews are the crews switch's (GET /api/crews refuses when off): the lists, filters and pickers go with it.
        hasFeature('crews') ? api.get('/api/crews') : Promise.resolve({ data: [] }),
        api.get(`/api/jobs/${id}/timeline`).catch(() => null),
      ])
      setJob(jobData)
      setUsers(rowsOf<Person>(usersRes))
      setCrews(rowsOf<Crew>(crewsRes))
      setTimeline(rowsOf<TimelineEvent>(timelineRes))
      setPhotos(jobData.photos || [])
      setNotes(jobData.notes || [])
      setQuotes(jobData.quotes || [])
      setInvoices(jobData.invoices || [])
    } catch {
      toast.error('Failed to load job')
    } finally {
      setLoading(false)
    }
  }, [id, maySeeRoster]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  /** The timeline again, after something that adds to it (a stage move, closing, reopening, a photo). */
  const reloadTimeline = async () => {
    try { setTimeline(rowsOf<TimelineEvent>(await api.get(`/api/jobs/${id}/timeline`))) } catch { /* the page keeps what it had */ }
  }

  /** A write's reply is the job row alone: keep what came with the page (the contact, the lists). */
  const merge = (updated: RoofJob) => {
    const { contact: _contact, notes: _notes, ...row } = updated
    setJob((prev) => (prev ? { ...prev, ...row } : prev))
  }

  const advanceStage = async () => {
    setAdvancing(true)
    try {
      merge(await api.post(`/api/jobs/${id}/advance`) as RoofJob)
      toast.success('Stage advanced')
      reloadTimeline()
    } catch (err) {
      toast.error(errorText(err, 'Failed to advance stage'))
    } finally {
      setAdvancing(false)
    }
  }

  // Closing a job that will not be paid, with a required reason — close-rate by reason is what tells a roofer whether
  // they are losing on price or on response time.
  const [closeOpen, setCloseOpen] = useState(false)
  const [closeStatus, setCloseStatus] = useState<'lost' | 'cancelled'>('lost')
  const [closeReason, setCloseReason] = useState('')
  const [closing, setClosing] = useState(false)
  const isClosed = job?.status === 'lost' || job?.status === 'cancelled'

  const closeJob = async () => {
    if (!closeReason.trim()) { toast.error('A reason is required'); return }
    setClosing(true)
    try {
      merge(await api.post(`/api/jobs/${id}/close`, { status: closeStatus, lostReason: closeReason.trim() }) as RoofJob)
      setCloseOpen(false)
      setCloseReason('')
      toast.success(closeStatus === 'lost' ? 'Job closed as lost' : 'Job cancelled')
      reloadTimeline()
    } catch (err) {
      toast.error(errorText(err, 'Failed to close the job'))
    } finally {
      setClosing(false)
    }
  }

  const reopenJob = async () => {
    setClosing(true)
    try {
      merge(await api.post(`/api/jobs/${id}/reopen`, { status: 'lead' }) as RoofJob)
      toast.success('Job reopened')
      reloadTimeline()
    } catch (err) {
      toast.error(errorText(err, 'Failed to reopen the job'))
    } finally {
      setClosing(false)
    }
  }

  const updateAssignment = async (field: 'assignedSalesRepId' | 'assignedCrewId', value: string) => {
    try {
      // The job's own field names; '' clears. (T63)
      await api.put(`/api/jobs/${id}`, { [field]: value || '' })
      setJob((prev) => (prev ? { ...prev, [field]: value || null } : prev))
      toast.success('Assignment updated')
    } catch (err) {
      toast.error(errorText(err, 'Failed to update'))
    }
  }

  const [measurement, setMeasurement] = useState<Measurement | null>(null)

  // Measurements are their own switch (measurement_reports, not ready): with it off there is no Measurement card at all —
  // the job's squares are its own field, on the Schedule card.
  const measurementsOn = hasFeature('measurement_reports')
  const loadMeasurement = useCallback(async () => {
    if (!measurementsOn) { setMeasurement(null); return }
    try {
      setMeasurement(await api.get(`/api/measurements/job/${id}`) as Measurement)
    } catch { setMeasurement(null) /* 404: none filed on this job */ }
  }, [id, measurementsOn])

  useEffect(() => { if (id) loadMeasurement() }, [id, loadMeasurement])

  const orderMeasurement = async () => {
    if (!job) return
    try {
      await api.post('/api/measurements/order', { jobId: id, address: job.address, city: job.city, state: job.state, zip: job.zip })
      toast.success('Measurement report ordered! Processing...')
      load()
      loadMeasurement()
    } catch (err) {
      toast.error(errorText(err, 'Failed to order measurement'))
    }
  }

  const uploadPhotos = async (files: FileList) => {
    setUploading(true)
    try {
      // The API takes ONE file per request under the field `photo`, tagged with `photoType`.
      const created: JobPhoto[] = []
      for (const f of Array.from(files)) {
        const formData = new FormData()
        formData.append('photo', f)
        formData.append('photoType', photoTab)
        created.push(await api.request(`/api/jobs/${id}/photos`, { method: 'POST', body: formData, timeoutMs: 300000 }) as JobPhoto)
      }
      setPhotos((prev) => [...prev, ...created])
      toast.success(created.length > 1 ? `${created.length} photos uploaded` : 'Photo uploaded')
      reloadTimeline()
    } catch (err) {
      toast.error(uploadRefusal(err))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const addNote = async () => {
    if (!noteText.trim()) return
    setSavingNote(true)
    try {
      const note = await api.post(`/api/jobs/${id}/notes`, { body: noteText }) as JobNote
      // Newest first, as the server lists them.
      setNotes((prev) => [note, ...prev])
      setNoteText('')
      toast.success('Note added')
    } catch (err) {
      toast.error(errorText(err, 'Failed to add note'))
    } finally {
      setSavingNote(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="p-6 text-center text-gray-500 dark:text-slate-400">Job not found</div>
    )
  }

  const daysOpen = daysSince(job.createdAt)
  const statusColor = STATUS_COLORS[job.status] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'
  const typeColor = JOB_TYPE_COLORS[job.jobType || ''] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'
  const filteredPhotos = photos.filter((p) => p.photoType === photoTab)
  const contact = job.contact
  const contactPhone = contact?.phone || contact?.mobile

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Top Bar */}
      <div className="bg-white border-b px-6 py-4 dark:bg-slate-900">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 mb-3 dark:text-slate-400">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">
              {job.number || '—'}
            </h1>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor}`}>
              {stageLabel(job.status, job.jobType)}
            </span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${typeColor}`}>
              {(job.jobType || 'retail').replace('_', ' ')}
            </span>
            <span className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {daysOpen} days open
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isClosed ? (
              <>
                <span className="text-sm text-gray-600 dark:text-slate-300">
                  Closed as <span className="font-semibold">{codeLabel(job.status)}</span>
                  {job.lostReason ? ` — ${job.lostReason}` : ''}
                </span>
                {mayWorkJob && (<button
                  onClick={reopenJob}
                  disabled={closing}
                  className="px-4 py-2 border border-gray-300 dark:border-slate-700 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  {closing ? 'Reopening…' : 'Reopen'}
                </button>)}
              </>
            ) : (
              <>
                {job.status !== 'collected' && mayWorkJob && (
                  <button
                    onClick={() => { setCloseStatus(job.status === 'signed' || job.status === 'material_ordered' || job.status === 'in_production' ? 'cancelled' : 'lost'); setCloseOpen(true) }}
                    className="px-4 py-2 border border-gray-300 dark:border-slate-700 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"
                  >
                    Close Job
                  </button>
                )}
                {mayWorkJob && (<button
                  onClick={advanceStage}
                  disabled={advancing || job.status === 'collected'}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 disabled:opacity-50"
                >
                  <ChevronRight className="w-4 h-4" />
                  {advancing ? 'Advancing...' : 'Advance Stage'}
                </button>)}
              </>
            )}
            {/* Ask the homeowner for a Google review now (Review Requests; the shared button the other trades' job page has). */}
            {job.contactId && <ReviewRequestButton api={api as any} toast={toast} jobId={job.id} hasFeature={hasFeature} className="px-4 py-2 border border-gray-300 dark:border-slate-700 text-sm font-medium rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 disabled:opacity-50" />}
          </div>
        </div>
      </div>

      {/* Close a job that will not be paid. Not a delete — the quotes, photos, supplements and claim trail stay attached. */}
      {closeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCloseOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-1">Close this job</h2>
            <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
              It comes off the pipeline board and out of pipeline reports. Nothing is deleted.
            </p>

            <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Outcome</label>
            <div className="flex gap-2 mb-4">
              {([['lost', 'Lost', 'Never signed'], ['cancelled', 'Cancelled', 'Signed, then fell through']] as const).map(([v, label, hint]) => (
                <button
                  key={v}
                  onClick={() => setCloseStatus(v)}
                  className={`flex-1 p-3 rounded-lg border-2 text-left transition-colors ${closeStatus === v ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-200' : 'border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300'}`}
                >
                  <p className="font-semibold text-sm">{label}</p>
                  <p className="text-xs">{hint}</p>
                </button>
              ))}
            </div>

            <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Why? *</label>
            <input
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              placeholder="Went with a competitor · price · carrier denied · unresponsive"
              className="w-full text-sm border rounded-lg px-3 py-2"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
              Required. Close-rate by reason is what tells you whether you&rsquo;re losing on price or on response time.
            </p>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setCloseOpen(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
              <button onClick={closeJob} disabled={closing} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {closing ? 'Closing…' : `Close as ${formatStatus(closeStatus)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column */}
          <div className="lg:col-span-2 min-w-0 space-y-6">
            {/* Property */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <Home className="w-4 h-4 text-gray-400" /> Property
              </h2>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500 dark:text-slate-400">Address</p>
                  <p className="font-medium text-gray-900 dark:text-slate-100">{job.address || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-slate-400">Roof Age</p>
                  <p className="font-medium text-gray-900 dark:text-slate-100">{job.roofAge ? `${job.roofAge} years` : '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-slate-400">Roof Type</p>
                  <p className="font-medium text-gray-900 dark:text-slate-100">{job.roofType || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-500 dark:text-slate-400">Stories</p>
                  <p className="font-medium text-gray-900 dark:text-slate-100">{job.stories || '—'}</p>
                </div>
              </div>
            </div>

            {/* Insurance Claim Link - ONLY for insurance jobs (the insurance group's page) */}
            {job.jobType === 'insurance' && hasInsurance && (
              <Link
                to={`/crm/jobs/${id}/insurance`}
                className="block bg-orange-50 rounded-xl shadow-sm border border-orange-200 p-4 hover:border-orange-400 transition-colors dark:bg-orange-950/40"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center dark:bg-orange-950/40">
                      <Shield className="w-5 h-5 text-orange-600 dark:text-orange-200" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Insurance Claim</h2>
                      <p className="text-xs text-gray-500 dark:text-slate-400">View claim details, supplements, Xactimate export</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-orange-400" />
                </div>
              </Link>
            )}

            {/* Insurance Details - ONLY for insurance jobs */}
            {job.jobType === 'insurance' && hasInsurance && (
              <div className="bg-white rounded-xl shadow-sm border border-yellow-300 p-6 dark:bg-slate-900">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                  <Shield className="w-4 h-4 text-yellow-500 dark:text-yellow-300" /> Insurance
                </h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-slate-400">Claim Number</p>
                    <p className="font-medium text-gray-900 dark:text-slate-100">{job.claimNumber || '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-slate-400">Insurance Company</p>
                    <p className="font-medium text-gray-900 dark:text-slate-100">{job.insuranceCompany || '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-slate-400">Adjuster Name</p>
                    <p className="font-medium text-gray-900 dark:text-slate-100">{job.adjusterName || '—'}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-slate-400">Adjuster Phone</p>
                    <p className="font-medium text-gray-900 dark:text-slate-100">
                      {job.adjusterPhone ? (
                        <a href={`tel:${job.adjusterPhone}`} className="text-orange-600 dark:text-orange-200 hover:underline">{job.adjusterPhone}</a>
                      ) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-slate-400">Date of Loss</p>
                    <p className="font-medium text-gray-900 dark:text-slate-100">
                      {job.dateOfLoss ? formatDate(job.dateOfLoss) : '—'}
                    </p>
                  </div>
                  {maySeeJobMoney && (<>
                    <div>
                      <p className="text-gray-500 dark:text-slate-400">Deductible</p>
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {job.deductible != null ? `${money(Number(job.deductible))}` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-slate-400">RCV</p>
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {job.rcv != null ? `${money(Number(job.rcv))}` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500 dark:text-slate-400">ACV</p>
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {job.acv != null ? `${money(Number(job.acv))}` : '—'}
                      </p>
                    </div>
                  </>)}
                </div>
                {job.approvedScope !== undefined && (
                  <div className="mt-4">
                    <p className="text-gray-500 text-sm mb-1 dark:text-slate-400">Approved Scope</p>
                    <p className="text-sm text-gray-900 whitespace-pre-wrap bg-yellow-50 rounded-lg p-3 border border-yellow-200 dark:text-slate-100 dark:bg-yellow-950/40">
                      {job.approvedScope || 'Not yet defined'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* When the job is on the calendar, and the roof's size — what the insurance scope is built from. */}
            <ScheduleCard job={job} mayEdit={mayWorkJob} mayMove={mayDispatchJob} onSaved={merge} />

            {/* Measurement — the satellite report's card, only while measurement reports are on (a not-ready feature). */}
            {measurementsOn && (
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <Ruler className="w-4 h-4 text-gray-400" /> Measurement
              </h2>
              {measurement ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${MEASUREMENT_STATUS_COLORS[measurement.status] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'} dark:text-slate-200`}>
                      {formatStatus(measurement.status)}
                    </span>
                    {measurement.imageryQuality && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        measurement.imageryQuality === 'HIGH' ? 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' :
                        measurement.imageryQuality === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40' :
                        'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40'
                      }`}>
                        {measurement.imageryQuality}
                      </span>
                    )}
                  </div>
                  {measurement.status === 'complete' && (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-purple-50 rounded-lg p-2.5 text-center dark:bg-purple-950/40">
                          <p className="text-lg font-bold text-purple-700 dark:text-purple-300">{measurement.totalSquares}</p>
                          <p className="text-[10px] text-purple-600 dark:text-purple-300">Squares</p>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-2.5 text-center dark:bg-blue-950/40">
                          <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{measurement.totalArea ? Number(measurement.totalArea).toLocaleString() : '—'}</p>
                          <p className="text-[10px] text-blue-600 dark:text-blue-300">Sqft</p>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-2.5 text-center dark:bg-slate-900">
                          <p className="text-lg font-bold text-gray-700 dark:text-slate-200">{Array.isArray(measurement.segments) ? measurement.segments.length : '—'}</p>
                          <p className="text-[10px] text-gray-600 dark:text-slate-400">Segments</p>
                        </div>
                      </div>
                      {Array.isArray(measurement.segments) && measurement.segments.length > 0 && (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b text-gray-500 dark:text-slate-400">
                              <th className="text-left pb-1 font-medium">Segment</th>
                              <th className="text-right pb-1 font-medium">Sqft</th>
                              <th className="text-right pb-1 font-medium">Pitch</th>
                            </tr>
                          </thead>
                          <tbody>
                            {measurement.segments.map((s, i) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-1 text-gray-900 dark:text-slate-100">{s.name}</td>
                                <td className="py-1 text-right text-gray-600 dark:text-slate-400">{Number(s.area).toLocaleString()}</td>
                                <td className="py-1 text-right text-gray-600 dark:text-slate-400">{s.pitch}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {job.totalSquares ? (
                      <span className="text-sm text-gray-700 dark:text-slate-200">
                        <span className="font-semibold">{job.totalSquares}</span> total squares
                      </span>
                    ) : <p className="text-sm text-gray-500 dark:text-slate-400">No measurement report</p>}
                  </div>
                  {mayOrderMeasurement && measurementsOn && (<button
                    onClick={orderMeasurement}
                    className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  >
                    Order Report
                  </button>)}
                </div>
              )}
            </div>
            )}

            {/* Photos */}
            {hasPhotos && (
              <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                  <Camera className="w-4 h-4 text-gray-400" /> Photos
                </h2>
                <div className="flex items-center gap-1 mb-4 border-b">
                  {PHOTO_TABS.map((tab) => (
                    <button
                      key={tab}
                      onClick={() => { setPhotoTab(tab); setViewing(null) }}
                      className={`px-3 py-2 text-sm font-medium border-b-2 capitalize ${
                        photoTab === tab
                          ? 'border-orange-600 text-orange-600 dark:text-orange-200'
                          : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
                  {filteredPhotos.map((photo, i) => (
                    <button
                      type="button"
                      key={photo.id || i}
                      onClick={() => setViewing(i)}
                      aria-label={`Open ${photo.caption || `${photoTab} photo ${i + 1}`} full size`}
                      className="aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-800 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                    >
                      <img
                        src={photo.thumbnailUrl || photo.url || ''}
                        alt={photo.caption || `Photo ${i + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                  {filteredPhotos.length === 0 && (
                    <p className="text-sm text-gray-500 dark:text-slate-400 col-span-full">No {photoTab} photos yet</p>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && uploadPhotos(e.target.files)}
                />
                <PhotoDetails jobId={job.id} photos={filteredPhotos} onSaved={(saved) => setPhotos((prev) => prev.map((p) => (p.id === saved.id ? { ...p, ...saved } as JobPhoto : p)))} />
                <PhotoViewer
                  label={`${formatStatus(photoTab)} photos`}
                  photos={filteredPhotos.map((p) => ({ id: p.id, src: p.url || p.thumbnailUrl, caption: p.caption }))}
                  index={viewing}
                  onIndex={setViewing}
                  onClose={() => setViewing(null)}
                />
                {mayWorkJob && (<button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Upload className="w-4 h-4" />
                  {uploading ? 'Uploading...' : 'Upload Photos'}
                </button>)}
              </div>
            )}

            {/* Inspection report — behind its own switch (not ready); the photos above are what it is built from. */}
            {hasPhotos && hasFeature('inspection_reports') && <InspectionReports jobId={job.id} photos={photos} />}

            {/* What the homeowner's portal shows of this job — behind its own switch (not ready); off for each file until chosen. */}
            {hasFeature('portal_job_files') && job.contact && <ShareWithHomeowner jobId={job.id} homeowner={job.contact.name || null} refreshKey={photos.length} />}

            {/* Notes */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <MessageSquare className="w-4 h-4 text-gray-400" /> Notes
              </h2>
              <div className="space-y-3 mb-4">
                {notes.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No notes yet</p>}
                {notes.map((note, i) => (
                  <div key={note.id || i} className="bg-gray-50 rounded-lg p-3 dark:bg-slate-900">
                    <p className="text-sm text-gray-900 whitespace-pre-wrap dark:text-slate-100">{codesInText(note.body)}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500 dark:text-slate-400">
                      {note.createdAt && <span>{whenDateTime(note.createdAt)}</span>}
                    </div>
                  </div>
                ))}
              </div>
              {/* The box goes with its button: POST /:id/notes is jobs:update. (T43, T68) */}
              {mayWorkJob && <div className="flex gap-2">
                <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addNote()}
                  placeholder="Add a note..."
                  className="flex-1 text-sm border rounded-lg px-3 py-2"
                />
                <button
                  onClick={addNote}
                  disabled={savingNote || !noteText.trim()}
                  className="px-3 py-2 bg-orange-600 text-white text-sm rounded-lg hover:bg-orange-700 disabled:opacity-50"
                >
                  {savingNote ? '...' : 'Add'}
                </button>
              </div>}
            </div>

            {/* Timeline */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <Activity className="w-4 h-4 text-gray-400" /> Timeline
              </h2>
              {timeline.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {timeline.map((event, i) => (
                    <div key={event.id || i} className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-gray-900 dark:text-slate-100">{codesInText(event.body)}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                          {event.createdAt ? whenDateTime(event.createdAt) : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Contact */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <User className="w-4 h-4 text-gray-400" /> Contact
              </h2>
              {contact ? (
                <Link to={`/crm/contacts/${contact.id}`} className="font-medium text-gray-900 hover:underline dark:text-slate-100">
                  {contact.name || '—'}
                </Link>
              ) : (
                <p className="font-medium text-gray-900 dark:text-slate-100">—</p>
              )}
              {contactPhone && (
                <a href={`tel:${contactPhone}`} className="flex items-center gap-1.5 text-sm text-orange-600 dark:text-orange-200 hover:underline mt-1.5">
                  <Phone className="w-3.5 h-3.5" /> {contactPhone}
                </a>
              )}
              {contactPhone && (
                <TextButton phone={contactPhone} name={contact?.name} record={contact?.id ? { entity: 'contact', id: contact.id } : undefined} compact className="mt-1.5" />
              )}
              {contact?.email && (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 text-sm text-orange-600 dark:text-orange-200 hover:underline mt-1">
                  <Mail className="w-3.5 h-3.5" /> {contact.email}
                </a>
              )}
              {contact?.source && (
                <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400">
                  {codeLabel(contact.source)}
                </span>
              )}
            </div>

            {/* Assignment */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <Users className="w-4 h-4 text-gray-400" /> Assignment
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Sales Rep</label>
                  <select disabled={!mayWorkJob || !mayDispatchJob}
                    value={job.assignedSalesRepId || ''}
                    onChange={(e) => updateAssignment('assignedSalesRepId', e.target.value)}
                    className="w-full text-sm border rounded-lg px-3 py-2"
                  >
                    <option value="">Unassigned</option>
                    {/* Only a seat that can do the work (people/work.ts; the server asks the same) — the rep on it now stays shown. */}
                    {users.filter((u) => mayBeGivenWork(u as any) || u.id === job.assignedSalesRepId).map((u) => (
                      <option key={u.id} value={u.id}>{displayName(u)}</option>
                    ))}
                  </select>
                </div>
                {hasFeature('crews') && <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Crew</label>
                  <select disabled={!mayWorkJob || !mayDispatchJob}
                    value={job.assignedCrewId || ''}
                    onChange={(e) => updateAssignment('assignedCrewId', e.target.value)}
                    className="w-full text-sm border rounded-lg px-3 py-2"
                  >
                    <option value="">Unassigned</option>
                    {crews.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>}
              </div>
            </div>

            {/* The other people whose commission this job carries (roof/jobPeople.ts) — a seat that reads the pay structure */}
            {hasFeature('commission_tracking') && can('commissions:read') && <JobCommissionPeople jobId={job.id} users={users} />}

            {/* The job's profit in the roofer's QuickBooks books, read-only (roof/jobBooks.ts) — a seat that reads job costing, where QuickBooks is on */}
            {hasFeature('job_costing') && hasFeature('quickbooks') && can('reports:read') && <JobBooks jobId={job.id} />}

            {/* Quotes — withheld from a seat without invoices:read (see maySeeJobMoney) */}
            {maySeeJobMoney && (
              <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-100">
                    <FileText className="w-4 h-4 text-gray-400" /> Quotes
                  </h2>
                  {mayQuote && job && (
                    <Link to={`/crm/quotes?new=1&jobId=${encodeURIComponent(job.id)}${job.contactId ? `&contactId=${encodeURIComponent(job.contactId)}` : ''}`}
                      className="text-sm font-medium text-orange-700 hover:underline dark:text-orange-300">New quote</Link>
                  )}
                </div>
                {quotes.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-slate-400">No quotes</p>
                ) : (
                  <div className="space-y-2">
                    {quotes.map((q) => (
                      <Link
                        key={q.id}
                        to={`/crm/quotes/${q.id}`}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-slate-100">Quote #{q.number || q.id}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            q.status === 'approved' ? 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' :
                            q.status === 'sent' ? 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40' :
                            q.status === 'declined' ? 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40' :
                            'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'
                          }`}>
                            {formatStatus(q.status)}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
                          {money(Number(q.total || 0))}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
                {job && <AttachDocuments kind="quote" jobId={job.id} contactId={job.contactId} onAttached={load} />}
              </div>
            )}

            {/* Invoice — withheld from a seat without invoices:read (see maySeeJobMoney) */}
            {maySeeJobMoney && (
              <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                  <Receipt className="w-4 h-4 text-gray-400" /> Invoice
                </h2>
                {invoices.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-slate-400">No invoices</p>
                ) : (
                  <div className="space-y-2">
                    {invoices.map((inv) => {
                      const balance = balanceOf(inv)
                      return (
                        <Link
                          key={inv.id}
                          to={`/crm/invoices/${inv.id}`}
                          className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800"
                        >
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-slate-100">Invoice #{inv.number || inv.id}</p>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              inv.status === 'paid' ? 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40' :
                              inv.status === 'overdue' ? 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40' :
                              inv.status === 'sent' ? 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40' :
                              'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800'
                            }`}>
                              {formatStatus(inv.status)}
                            </span>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{money(Number(inv.total || 0))}</p>
                            {balance > 0 && (
                              <p className="text-xs text-red-600 dark:text-red-400">Bal: {money(balance)}</p>
                            )}
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                )}
                {job && <AttachDocuments kind="invoice" jobId={job.id} contactId={job.contactId} onAttached={load} />}
              </div>
            )}

            {/* Materials ordered for this job (the materials feature; GET/POST /api/materials?jobId=). */}
            {job && hasFeature('materials') && <JobMaterials jobId={job.id} jobAddress={job.address} />}
            {job && hasFeature('roof_work_orders') && <JobWorkOrders jobId={job.id} jobAddress={job.address} />}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The job's day and time on the calendar and its roof size in squares, set here (PUT /api/jobs/:id, jobs:update). The day
 * is a calendar day and the time the company's wall clock, as every job on the shared Schedule is; blank clears.
 */
function ScheduleCard({ job, mayEdit, mayMove, onSaved }: { job: Pick<RoofJob, 'id' | 'scheduledDate' | 'scheduledTime' | 'totalSquares'>; mayEdit: boolean; mayMove: boolean; onSaved: (j: RoofJob) => void }) {
  const toast = useToast()
  const dayOf = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : '')
  const [date, setDate] = useState(dayOf(job.scheduledDate))
  const [time, setTime] = useState(job.scheduledTime || '')
  const [squares, setSquares] = useState(job.totalSquares != null ? String(job.totalSquares) : '')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setDate(dayOf(job.scheduledDate)); setTime(job.scheduledTime || ''); setSquares(job.totalSquares != null ? String(job.totalSquares) : '')
  }, [job.id, job.scheduledDate, job.scheduledTime, job.totalSquares])
  const changed = date !== dayOf(job.scheduledDate) || time !== (job.scheduledTime || '') || squares !== (job.totalSquares != null ? String(job.totalSquares) : '')
  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.put(`/api/jobs/${job.id}`, {
        scheduledDate: date, scheduledTime: date ? time : '', totalSquares: squares === '' ? '' : Number(squares),
      }) as RoofJob
      onSaved(updated)
      toast.success('Job updated')
    } catch (err) {
      toast.error(errorText(err, 'Failed to update the job'))
    } finally {
      setSaving(false)
    }
  }
  const input = 'w-full text-sm border rounded-lg px-3 py-2 disabled:opacity-60'
  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
        <Clock className="w-4 h-4 text-gray-400" /> Schedule &amp; roof size
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <label htmlFor="roof-job-date" className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Scheduled</label>
          <input id="roof-job-date" type="date" value={date} disabled={!mayEdit || !mayMove} onChange={(e) => setDate(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="roof-job-time" className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Time</label>
          <input id="roof-job-time" type="time" value={time} disabled={!mayEdit || !mayMove || !date} onChange={(e) => setTime(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="roof-job-squares" className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Squares</label>
          <input id="roof-job-squares" type="number" min={0} step="0.01" value={squares} disabled={!mayEdit} onChange={(e) => setSquares(e.target.value)} className={input} />
        </div>
      </div>
      {mayEdit && changed && (
        <div className="flex justify-end mt-3">
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
