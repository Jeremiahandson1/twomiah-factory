// Job detail — one page for every CRM: header (start / complete / edit / delete), details, description,
// photos (when the vertical has them), notes (where the app mounts them), related project / contact / equipment.
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit, Trash2, MapPin, Calendar, Clock, User, Play, CheckCircle, Wrench, Camera, FileText } from 'lucide-react'
import { StatusBadge, ConfirmModal, Button, NavLink, dateOnly, errMsg } from '../invoicing/ui'
import { resolveJobsConfig, PRIORITY_COLORS } from './types'
import { useMayWrite } from '../auth/PermissionsContext'
import { useConfirm } from '../ui/ConfirmProvider'
import { JobPartsPanel } from '../inventory/JobPartsPanel'
import { JobNotesPanel } from './JobNotesPanel'
import { JobPhotosPanel } from './JobPhotosPanel'
import { PhotoViewer } from '../files/PhotoViewer'
import { ReviewRequestButton } from '../reviews/ReviewRequestButton'
import type { JobsPageProps, JobRow, JobPhoto } from './types'

const card = 'bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6'

export function JobDetailPage({ api, toast, config }: JobsPageProps) {
  const cfg = resolveJobsConfig(config)
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState<JobRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [photos, setPhotos] = useState<JobPhoto[]>([])
  const [fullscreen, setFullscreen] = useState<JobPhoto | null>(null)
  /** The permission POST /api/jobs/:id/invoice asks for. (T41) */
  const mayInvoice = useMayWrite('invoices:create')
  /** DELETE /api/jobs/:id asks jobs:delete — staff hold update, not delete, and were offered it. (T62) */
  const mayDelete = useMayWrite('jobs:delete')
  /** Start, Complete, Edit and removing a photo are jobs:update on the server. (T43 viewer round, T68) */
  const mayUpdate = useMayWrite('jobs:update')
  /**
   * Parts used on this job — wherever the tenant has inventory (or parts_tracking, which unlocks the same module).
   * Read off the template's OWN feature check, not resolveJobsConfig's fallback that answers yes to everything:
   * every CRM that can switch either feature on mounts /api/inventory, and one that cannot must never call it.
   */
  const showParts = !!config?.hasFeature && (config.hasFeature('inventory') || config.hasFeature('parts_tracking'))
  const confirm = useConfirm()
  /** Stop a repeating job from this visit on: the later visits still open are cancelled (POST /:id/series/stop). */
  const [stopping, setStopping] = useState(false)
  const stopSeries = async () => {
    const left = job?.series?.upcoming ?? 0
    if (!(await confirm(`The ${left} visit${left === 1 ? '' : 's'} after this one ${left === 1 ? 'is' : 'are'} cancelled. This visit and the earlier ones stay as they are.`, { title: 'Stop repeating?', confirmText: 'Stop the series' }))) return
    setStopping(true)
    try { const r = await api.post(`/api/jobs/${id}/series/stop`); toast.success(`Series stopped — ${r?.cancelled ?? 0} later visit${r?.cancelled === 1 ? '' : 's'} cancelled`); load() }
    catch (err) { toast.error(errMsg(err, 'Could not stop the series')) } finally { setStopping(false) }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setJob(await api.get(`/api/jobs/${id}`)) } catch (err) { setError(errMsg(err, 'Unknown error')); toast.error(`Failed to load ${cfg.labels.singular.toLowerCase()}`) } finally { setLoading(false) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadPhotos = useCallback(async () => {
    if (!cfg.photos || cfg.photoStore) return
    try { const r = await api.get(`/api/jobs/${id}/photos`); setPhotos(Array.isArray(r) ? r : []) } catch { setPhotos([]) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); loadPhotos() }, [load, loadPhotos])

  const act = async (path: string, done: string) => {
    try {
      const r = await api.post(`/api/jobs/${id}/${path}`)
      toast.success(done)
      if (r?.nextServiceDate) toast.success(`Next maintenance visit scheduled for ${dateOnly(r.nextServiceDate)}`)
      load()
    } catch (err) { toast.error(errMsg(err, 'Action failed')) }
  }
  const remove = async () => {
    try { await api.delete('/api/jobs', id); toast.success(`${cfg.labels.singular} deleted`); navigate('/crm/jobs') } catch (err) { toast.error(errMsg(err, 'Failed to delete')) }
  }
  /**
   * Bill this job. (T41)
   *
   * Goes straight to the new invoice, because the next thing anybody does after raising one is send
   * it. A second press is refused by the server (409, bill-once under a row lock) and that refusal
   * names the invoice already raised — which is the useful answer, not an error.
   */
  const [billing, setBilling] = useState(false)
  const invoiceJob = async () => {
    setBilling(true)
    try {
      const inv = await api.post(`/api/jobs/${id}/invoice`)
      const raised = inv?.data ?? inv
      toast.success(`Invoice ${raised?.number || ''} raised`.trim())
      if (raised?.id) navigate(`/crm/invoices/${raised.id}`)
      else load()
    } catch (err) { toast.error(errMsg(err, 'Could not raise an invoice for this job')) }
    finally { setBilling(false) }
  }
  const deletePhoto = async (photoId: string) => {
    try { await api.delete(`/api/jobs/${id}/photos`, photoId); toast.success('Photo deleted'); setFullscreen(null); loadPhotos() } catch (err) { toast.error(errMsg(err, 'Failed to delete photo')) }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" aria-busy="true">
        <div className="h-8 w-64 bg-gray-200 dark:bg-slate-800 rounded" />
        <div className="grid lg:grid-cols-3 gap-6"><div className="lg:col-span-2 h-48 bg-gray-200 dark:bg-slate-800 rounded-lg" /><div className="h-48 bg-gray-200 dark:bg-slate-800 rounded-lg" /></div>
      </div>
    )
  }
  if (error || !job) {
    return (
      <div className={`${card} text-center`}>
        <p className="font-medium text-gray-900 dark:text-slate-100">{error ? `Error loading ${cfg.labels.singular.toLowerCase()}` : `${cfg.labels.singular} not found`}</p>
        {error && <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{error}</p>}
        <div className="mt-4 flex justify-center gap-2"><Button variant="secondary" onClick={() => navigate('/crm/jobs')}>Back to {cfg.labels.plural.toLowerCase()}</Button>{error && <Button onClick={load}>Retry</Button>}</div>
      </div>
    )
  }

  const open = job.status !== 'completed' && job.status !== 'cancelled'
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => navigate('/crm/jobs')} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg" aria-label={`Back to ${cfg.labels.plural.toLowerCase()}`}><ArrowLeft className="w-5 h-5" /></button>
          <div>
            <p className="text-sm font-mono text-gray-500 dark:text-slate-400">{job.number}</p>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{job.title}</h1>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={job.status} />
              {job.isOverdue && <StatusBadge status="overdue" />}
              <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${PRIORITY_COLORS[job.priority] || ''}`}>{job.priority}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open && mayUpdate && job.status !== 'in_progress' && <Button onClick={() => act('start', `${cfg.labels.singular} started`)} className="bg-orange-500 hover:bg-orange-600"><Play className="w-4 h-4 inline mr-2" />Start</Button>}
          {open && mayUpdate && job.status === 'in_progress' && <Button variant="success" onClick={() => act('complete', `${cfg.labels.singular} completed`)}><CheckCircle className="w-4 h-4 inline mr-2" />Complete</Button>}
          {/*
            Invoicing the job. Gated on the vertical having the path AND the person holding
            invoices:create — the permission the server asks — so the button is not offered to
            somebody who would be refused. (T41)

            useMayWrite, not cfg.can: `can` defaults to () => true on JobsConfig and most wrappers
            never set it, so a cfg.can gate on a sensitive control is one that cannot close. The
            hook asks the permissions context, so this holds with nothing wired in the wrapper.
          */}
          {cfg.billing && mayInvoice && (
            <Button variant="secondary" onClick={invoiceJob} disabled={billing}>
              <FileText className="w-4 h-4 inline mr-2" />{billing ? 'Raising…' : 'Invoice'}
            </Button>
          )}
          {/* Ask the job's customer for a Google review now (Review Requests; reviews/ReviewRequestButton.tsx). */}
          {job.contactId && <ReviewRequestButton api={api} toast={toast} jobId={id} hasFeature={config?.hasFeature} />}
          {mayUpdate && <NavLink to={`/crm/jobs?edit=${id}`} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center gap-2"><Edit className="w-4 h-4" />Edit</NavLink>}
          {mayDelete && <Button variant="danger" onClick={() => setDeleteOpen(true)}><Trash2 className="w-4 h-4 inline mr-2" />Delete</Button>}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 min-w-0 space-y-6">
          <div className={card}>
            <h2 className="font-semibold mb-4 text-gray-900 dark:text-slate-100">{cfg.labels.singular} Details</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {/*
                * AN UNSCHEDULED JOB SAYS SO. (T34)
                *
                * Converting an approved quote deliberately leaves the job `pending` with no date —
                * "scheduled" is a promise to a customer about a day, and converting a quote does not
                * make one (T32 M15). But this row was hidden whenever the date was null, so the job
                * you land on after converting said nothing at all about scheduling, and the tester
                * read the deliberate state as a broken one. It now names the state and points at the
                * form that fixes it.
                */}
              {job.scheduledDate
                ? <div className="flex items-center gap-3"><Calendar className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Scheduled</p><p className="text-gray-900 dark:text-slate-100">{dateOnly(job.scheduledDate)} {job.scheduledTime}</p></div></div>
                : open && <div className="flex items-center gap-3"><Calendar className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Scheduled</p><p className="text-gray-500 dark:text-slate-400">Not scheduled yet — <NavLink to={`/crm/jobs?edit=${id}`} className="text-orange-600 dark:text-orange-200 hover:underline">pick a date</NavLink></p></div></div>}
              {job.estimatedHours != null && job.estimatedHours !== '' && <div className="flex items-center gap-3"><Clock className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Estimated</p><p className="text-gray-900 dark:text-slate-100">{job.estimatedHours} hours</p></div></div>}
              {(job.address || job.city) && <div className="flex items-center gap-3"><MapPin className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Location</p><p className="text-gray-900 dark:text-slate-100">{[job.address, job.city, [job.state, job.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p></div></div>}
              {(job as any).location && <div className="flex items-center gap-3"><MapPin className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Branch</p><p className="text-gray-900 dark:text-slate-100">{(job as any).location.name}</p></div></div>}
              {job.assignedTo && <div className="flex items-center gap-3"><User className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Assigned To</p><p className="text-gray-900 dark:text-slate-100">{job.assignedTo.firstName} {job.assignedTo.lastName}</p></div></div>}
            </div>
            {job.series && (
              <div className="mt-4 pt-4 border-t dark:border-slate-800 flex flex-wrap items-center justify-between gap-3" data-testid="job-series">
                <div>
                  <p className="text-sm text-gray-500 dark:text-slate-400">Repeats</p>
                  <p className="text-gray-900 dark:text-slate-100">{job.series.summary}{job.series.index ? ` — visit ${job.series.index} of ${job.series.total}` : ''}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{job.series.status === 'stopped' ? 'Stopped — no more visits will be added.' : `${job.series.upcoming} later visit${job.series.upcoming === 1 ? '' : 's'} on the Schedule`}</p>
                </div>
                {mayUpdate && job.series.status !== 'stopped' && job.series.upcoming > 0 && <Button variant="secondary" onClick={stopSeries} disabled={stopping}>{stopping ? 'Stopping…' : 'Stop the series'}</Button>}
              </div>
            )}
            {job.description && <div className="mt-4 pt-4 border-t dark:border-slate-800"><p className="text-sm text-gray-500 mb-2 dark:text-slate-400">Description</p><p className="text-gray-700 whitespace-pre-wrap dark:text-slate-200">{job.description}</p></div>}
            {job.notes && <div className="mt-4 pt-4 border-t dark:border-slate-800"><p className="text-sm text-gray-500 mb-2 dark:text-slate-400">Notes</p><p className="text-gray-700 whitespace-pre-wrap dark:text-slate-200">{job.notes}</p></div>}
          </div>

          {cfg.photos && cfg.photoStore && (
            <JobPhotosPanel api={api} toast={toast} jobId={id} store={cfg.photoStore} label={cfg.labels.singular} />
          )}
          {cfg.photos && !cfg.photoStore && photos.length > 0 && (
            <div className={card}>
              <h2 className="font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-slate-100"><Camera className="w-4 h-4" /> Photos ({photos.length})</h2>
              <div className="grid grid-cols-4 gap-3">
                {photos.map((p) => (
                  <button type="button" key={p.id} onClick={() => setFullscreen(p)} className="aspect-square rounded-lg overflow-hidden bg-gray-100 hover:opacity-80 transition-opacity dark:bg-slate-800">
                    <img src={p.thumbnailUrl || p.url} alt={p.caption || `${cfg.labels.singular} photo`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {cfg.notes && <JobNotesPanel api={api} toast={toast} jobId={id} timeZone={cfg.timeZone} />}

          {showParts && <JobPartsPanel api={api as any} toast={toast} jobId={id} />}
        </div>

        <div className="space-y-6">
          <div className={card}>
            <h2 className="font-semibold mb-4 text-gray-900 dark:text-slate-100">Related</h2>
            <div className="space-y-3">
              {job.project && <NavLink to={`/crm/projects/${job.project.id}`} className="block p-3 bg-gray-50 rounded-lg hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700"><p className="text-sm text-gray-500 dark:text-slate-400">Project</p><p className="font-medium text-gray-900 dark:text-slate-100">{job.project.name}</p></NavLink>}
              {job.contact && <NavLink to={`/crm/contacts/${job.contact.id}`} className="block p-3 bg-gray-50 rounded-lg hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-700"><p className="text-sm text-gray-500 dark:text-slate-400">Contact</p><p className="font-medium text-gray-900 dark:text-slate-100">{job.contact.name}</p></NavLink>}
              {cfg.equipment && job.equipment && (
                <NavLink to="/crm/equipment" className="block p-3 bg-orange-50 rounded-lg hover:bg-orange-100 dark:bg-orange-900/20 dark:hover:bg-orange-900/30">
                  <p className="text-sm text-gray-500 flex items-center gap-1 dark:text-slate-400"><Wrench className="w-3.5 h-3.5" /> Equipment</p>
                  <p className="font-medium text-gray-900 dark:text-slate-100">{job.equipment.name}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{[job.equipment.manufacturer, job.equipment.model].filter(Boolean).join(' ')}{job.equipment.serialNumber && <span className="ml-1 font-mono text-xs">S/N: {job.equipment.serialNumber}</span>}</p>
                  {job.equipment.location && <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{job.equipment.location}</p>}
                </NavLink>
              )}
              {!job.project && !job.contact && !(cfg.equipment && job.equipment) && <p className="text-sm text-gray-500 dark:text-slate-400">Nothing linked yet.</p>}
            </div>
          </div>
        </div>
      </div>

      {/* The shared full-size viewer (files/PhotoViewer.tsx): next and previous, the keyboard, a phone's swipe. */}
      <PhotoViewer
        label={`${cfg.labels.singular} photos`}
        photos={photos.map((p) => ({ id: p.id, src: p.url, caption: p.caption }))}
        index={fullscreen ? Math.max(0, photos.findIndex((p) => p.id === fullscreen.id)) : null}
        onIndex={(i) => setFullscreen(photos[i] ?? null)}
        onClose={() => setFullscreen(null)}
        actions={(p) => (mayUpdate && p.id ? <button type="button" onClick={() => deletePhoto(p.id as string)} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-red-300 hover:bg-white/20" aria-label="Delete photo"><Trash2 className="w-5 h-5" /></button> : null)}
      />

      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={remove} title={`Delete ${cfg.labels.singular}`} message={`Delete "${job.title}"?`} confirmText="Delete" />
    </div>
  )
}

export default JobDetailPage
