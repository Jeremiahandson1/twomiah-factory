// Job detail — one page for every CRM: header (start / complete / edit / delete), details, description,
// photos (when the vertical has them), related project / contact / equipment.
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Edit, Trash2, MapPin, Calendar, Clock, User, Play, CheckCircle, Wrench, Camera, X, FileText } from 'lucide-react'
import { StatusBadge, ConfirmModal, Button, NavLink, dateOnly, errMsg } from '../invoicing/ui'
import { resolveJobsConfig, PRIORITY_COLORS } from './types'
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

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setJob(await api.get(`/api/jobs/${id}`)) } catch (err) { setError(errMsg(err, 'Unknown error')); toast.error(`Failed to load ${cfg.labels.singular.toLowerCase()}`) } finally { setLoading(false) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const loadPhotos = useCallback(async () => {
    if (!cfg.photos) return
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
        <div className="flex items-center gap-2">
          {open && job.status !== 'in_progress' && <Button onClick={() => act('start', `${cfg.labels.singular} started`)} className="bg-blue-500 hover:bg-blue-600"><Play className="w-4 h-4 inline mr-2" />Start</Button>}
          {open && job.status === 'in_progress' && <Button variant="success" onClick={() => act('complete', `${cfg.labels.singular} completed`)}><CheckCircle className="w-4 h-4 inline mr-2" />Complete</Button>}
          {/*
            Invoicing the job. Gated on the vertical having the path AND the person holding
            invoices:create — the permission the server asks — so the button is not offered to
            somebody who would be refused. (T41)
          */}
          {cfg.billing && cfg.can('invoices:create') && (
            <Button variant="secondary" onClick={invoiceJob} disabled={billing}>
              <FileText className="w-4 h-4 inline mr-2" />{billing ? 'Raising…' : 'Invoice'}
            </Button>
          )}
          <NavLink to={`/crm/jobs?edit=${id}`} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center gap-2"><Edit className="w-4 h-4" />Edit</NavLink>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}><Trash2 className="w-4 h-4 inline mr-2" />Delete</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
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
                : open && <div className="flex items-center gap-3"><Calendar className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Scheduled</p><p className="text-gray-500 dark:text-slate-400">Not scheduled yet — <NavLink to={`/crm/jobs?edit=${id}`} className="text-blue-600 dark:text-blue-400 hover:underline">pick a date</NavLink></p></div></div>}
              {job.estimatedHours != null && job.estimatedHours !== '' && <div className="flex items-center gap-3"><Clock className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Estimated</p><p className="text-gray-900 dark:text-slate-100">{job.estimatedHours} hours</p></div></div>}
              {(job.address || job.city) && <div className="flex items-center gap-3"><MapPin className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Location</p><p className="text-gray-900 dark:text-slate-100">{[job.address, job.city, [job.state, job.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p></div></div>}
              {job.assignedTo && <div className="flex items-center gap-3"><User className="w-5 h-5 text-gray-400" /><div><p className="text-sm text-gray-500 dark:text-slate-400">Assigned To</p><p className="text-gray-900 dark:text-slate-100">{job.assignedTo.firstName} {job.assignedTo.lastName}</p></div></div>}
            </div>
            {job.description && <div className="mt-4 pt-4 border-t dark:border-slate-800"><p className="text-sm text-gray-500 mb-2 dark:text-slate-400">Description</p><p className="text-gray-700 whitespace-pre-wrap dark:text-slate-200">{job.description}</p></div>}
            {job.notes && <div className="mt-4 pt-4 border-t dark:border-slate-800"><p className="text-sm text-gray-500 mb-2 dark:text-slate-400">Notes</p><p className="text-gray-700 whitespace-pre-wrap dark:text-slate-200">{job.notes}</p></div>}
          </div>

          {cfg.photos && photos.length > 0 && (
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

      {fullscreen && (
        <div className="fixed inset-0 bg-black/90 z-50 flex flex-col" role="dialog" aria-modal="true" aria-label="Photo">
          <div className="flex items-center justify-between p-4">
            <button type="button" onClick={() => setFullscreen(null)} className="p-2 text-white hover:text-gray-300" aria-label="Close"><X className="w-6 h-6" /></button>
            <button type="button" onClick={() => deletePhoto(fullscreen.id)} className="p-2 text-red-400 hover:text-red-300" aria-label="Delete photo"><Trash2 className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4"><img src={fullscreen.url} alt={fullscreen.caption || ''} className="max-w-full max-h-full object-contain" /></div>
          {fullscreen.caption && <p className="text-white text-center p-4 text-sm">{fullscreen.caption}</p>}
        </div>
      )}

      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={remove} title={`Delete ${cfg.labels.singular}`} message={`Delete "${job.title}"?`} confirmText="Delete" />
    </div>
  )
}

export default JobDetailPage
