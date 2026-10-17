/**
 * The technician's / crew member's day — ONE page for every CRM that offers `tech_mobile_view` (crm,
 * crm-fieldservice, crm-landscaping). Mobile-first: today's jobs, directions, on my way → on site → done,
 * photos, and the template's own end-of-visit checklist. The server half is packages/tenant-backend/src/tech.
 *
 * Changed from crm-fieldservice/landscaping's identical copies:
 *   · A pending or confirmed job gets its first button. Only `scheduled` showed "On My Way", so a job booked as
 *     confirmed sat on the phone with no way to start it.
 *   · The checklist is the TEMPLATE's (config.checklist). Landscaping shipped "HVAC Inspection Checklist —
 *     refrigerant, coils, filter…" to lawn crews, and it was offered only on maintenance and repair jobs.
 *   · A refusal says why. The server now refuses a move out of order (a finished job cannot go back to
 *     "en route") and the page shows its words instead of "Failed to update status".
 *   · The job's type is read from either column (`jobType` in fs/landscaping, `type` in crm).
 *   · "Upgrade to the Small Shop plan" named a plan that no longer exists.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  MapPin, Phone, Clock, ChevronRight, ChevronLeft, Navigation, CheckCircle, AlertTriangle, Wrench, Zap,
  Shield, Settings2, Camera, ClipboardList, Loader2, Truck, Flag, X, Trash2, CalendarDays,
} from 'lucide-react'
import { todayKey } from '../time/day'
import { errMsg } from '../invoicing/ui'
import { useMayWrite } from '../auth/PermissionsContext'

export interface TechApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: unknown) => Promise<any>
  request: (path: string, init?: RequestInit) => Promise<any>
}
export interface TechToast { success: (m: string) => void; error: (m: string) => void }
export interface TechChecklistItemDef { id: string; label: string }
export interface TechViewConfig {
  hasFeature: (id: string) => boolean
  /** "My Jobs" / "My Visits" */
  title?: string
  checklist: { title: string; subtitle: string; items: TechChecklistItemDef[] }
}
export interface TechViewProps { api: TechApi; toast: TechToast; config: TechViewConfig }

type Job = {
  id: string; number: string; title: string; description?: string; status: string; priority: string
  jobType?: string; type?: string; scheduledDate: string; scheduledTime?: string; estimatedHours?: string
  address?: string; city?: string; state?: string; zip?: string; internalNotes?: string
  contact?: { id: string; name: string; phone?: string; email?: string } | null
  equipment?: { id: string; name: string; manufacturer?: string; model?: string; serialNumber?: string; location?: string } | null
}
type ChecklistItem = TechChecklistItemDef & { status: 'pass' | 'fail' | 'attention'; notes: string }

const PRIORITY_COLORS: Record<string, string> = {
  emergency: 'bg-red-100 text-red-800 dark:text-red-300 dark:bg-red-950/40',
  urgent: 'bg-red-100 text-red-800 dark:text-red-300 dark:bg-red-950/40',
  high: 'bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40',
  normal: 'bg-blue-100 text-blue-800 dark:text-blue-300 dark:bg-blue-950/40',
  medium: 'bg-blue-100 text-blue-800 dark:text-blue-300 dark:bg-blue-950/40',
  low: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
}
const JOB_TYPE_ICONS: Record<string, any> = { install: Settings2, installation: Settings2, repair: Wrench, maintenance: Shield, emergency: Zap }
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', confirmed: 'Confirmed', scheduled: 'Scheduled', dispatched: 'En route', in_progress: 'On site',
  on_hold: 'On hold', completed: 'Completed', cancelled: 'Cancelled',
}
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-800 dark:text-blue-300 dark:bg-blue-950/40',
  confirmed: 'bg-blue-100 text-blue-800 dark:text-blue-300 dark:bg-blue-950/40',
  scheduled: 'bg-blue-100 text-blue-800 dark:text-blue-300 dark:bg-blue-950/40',
  dispatched: 'bg-yellow-100 text-yellow-800 dark:text-yellow-300 dark:bg-yellow-950/40',
  in_progress: 'bg-green-100 text-green-800 dark:text-green-300 dark:bg-green-950/40',
  on_hold: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-slate-200',
  completed: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800',
  cancelled: 'bg-red-100 text-red-700 dark:text-red-300 dark:bg-red-950/40',
}
// Mirrors TECH_MOVES on the server: where each button may start from.
const NOT_STARTED = ['pending', 'confirmed', 'scheduled']
const isClosed = (s: string) => s === 'completed' || s === 'cancelled'
const kindOf = (j: Job) => String(j.jobType || j.type || '')

export function TechView({ api, toast, config }: TechViewProps) {
  const [screen, setScreen] = useState<'list' | 'detail' | 'checklist'>('list')
  const [jobs, setJobs] = useState<Job[]>([])
  const [selected, setSelected] = useState<Job | null>(null)
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [listTab, setListTab] = useState<'today' | 'upcoming' | 'completed'>('today')

  const loadJobs = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get('/api/tech/my-jobs')
      setJobs(Array.isArray(data) ? data : data?.data || [])
    } catch (err) { toast.error(errMsg(err, 'Could not load your jobs')) } finally { setLoading(false) }
  }, [api])
  useEffect(() => { if (config.hasFeature('tech_mobile_view')) loadJobs() }, [loadJobs])

  const refreshSelected = (updated: Job) => {
    setSelected((prev) => (prev ? { ...prev, ...updated } : null))
    setJobs((prev) => prev.map((j) => (j.id === updated.id ? { ...j, ...updated } : j)))
  }
  const move = async (path: 'on-my-way' | 'on-site' | 'complete-job', done: string, notes?: string) => {
    if (!selected) return
    setActing(true)
    try {
      refreshSelected(await api.post(`/api/tech/${selected.id}/${path}`, notes ? { notes } : {}))
      toast.success(done)
    } catch (err) {
      toast.error(errMsg(err, 'The job could not be updated'))
      loadJobs()
    } finally { setActing(false) }
  }
  const navigateTo = (job: Job) => {
    const addr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ')
    if (addr) window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`, '_blank')
  }

  const today = todayKey()
  const todayJobs = jobs.filter((j) => j.scheduledDate?.startsWith(today) && !isClosed(j.status))
  const upcomingJobs = jobs.filter((j) => j.scheduledDate > today && !j.scheduledDate.startsWith(today) && !isClosed(j.status))
  const doneJobs = jobs.filter((j) => j.status === 'completed')
  const shown = listTab === 'today' ? todayJobs : listTab === 'upcoming' ? upcomingJobs : doneJobs

  if (!config.hasFeature('tech_mobile_view')) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center p-8">
          <Wrench className="w-16 h-16 text-gray-400 mx-auto mb-4 dark:text-slate-400" />
          <h2 className="text-xl font-semibold text-gray-800 mb-2 dark:text-slate-200">The field view is not switched on</h2>
          <p className="text-gray-600 dark:text-slate-400">An owner or admin can turn it on in Settings › Features.</p>
        </div>
      </div>
    )
  }

  if (screen === 'checklist' && selected) {
    return <ChecklistScreen api={api} toast={toast} job={selected} def={config.checklist} onBack={() => setScreen('detail')} onDone={() => { setScreen('detail'); loadJobs() }} />
  }
  if (screen === 'detail' && selected) {
    return (
      <JobDetail
        api={api} toast={toast} job={selected} checklist={config.checklist} acting={acting}
        onBack={() => { setScreen('list'); setSelected(null) }}
        onNavigate={() => navigateTo(selected)}
        onMyWay={() => move('on-my-way', 'On my way')}
        onSite={() => move('on-site', 'Arrived on site')}
        onComplete={(notes) => move('complete-job', 'Job completed', notes)}
        onChecklist={() => setScreen('checklist')}
      />
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-950">
      <div className="bg-white border-b border-gray-200 px-4 py-3 dark:bg-slate-900 dark:border-slate-700">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">{config.title || 'My Jobs'}</h1>
        <p className="text-sm text-gray-600 mt-0.5 dark:text-slate-400">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      </div>
      <div className="flex-1 overflow-y-auto pb-20">
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-orange-600 dark:text-orange-200" /></div>
        ) : shown.length === 0 ? (
          <div className="text-center py-20 text-gray-600 dark:text-slate-400">
            <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-lg font-medium">{listTab === 'today' ? 'No jobs for you today' : listTab === 'upcoming' ? 'No upcoming jobs' : 'No completed jobs'}</p>
            <p className="text-sm mt-1">Jobs assigned to you appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-slate-700">
            {shown.map((job) => <JobCard key={job.id} job={job} onTap={() => { setSelected(job); setScreen('detail') }} onNavigate={() => navigateTo(job)} />)}
          </div>
        )}
      </div>
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex z-40 dark:bg-slate-900 dark:border-slate-700" aria-label="Job lists">
        <TabButton active={listTab === 'today'} label="Today" count={todayJobs.length} icon={Clock} onClick={() => setListTab('today')} />
        <TabButton active={listTab === 'upcoming'} label="Upcoming" count={upcomingJobs.length} icon={CalendarDays} onClick={() => setListTab('upcoming')} />
        <TabButton active={listTab === 'completed'} label="Done" count={doneJobs.length} icon={CheckCircle} onClick={() => setListTab('completed')} />
      </nav>
    </div>
  )
}

function TabButton({ active, label, count, icon: Icon, onClick }: { active: boolean; label: string; count: number; icon: any; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active} className={`flex-1 flex flex-col items-center py-3 text-xs font-medium ${active ? 'text-orange-700 bg-orange-50 dark:text-orange-200 dark:bg-orange-950/40' : 'text-gray-600 dark:text-slate-400'}`}>
      <Icon className="w-5 h-5 mb-0.5" />
      {label}
      {count > 0 && <span className={`mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${active ? 'bg-orange-700 text-white' : 'bg-gray-200 text-gray-700 dark:text-slate-200 dark:bg-slate-700'}`}>{count}</span>}
    </button>
  )
}

function JobCard({ job, onTap, onNavigate }: { job: Job; onTap: () => void; onNavigate: () => void }) {
  const TypeIcon = JOB_TYPE_ICONS[kindOf(job)] || Wrench
  const addr = [job.address, job.city].filter(Boolean).join(', ')
  return (
    <div className="bg-white px-4 py-4 dark:bg-slate-900">
      <button onClick={onTap} className="w-full flex items-start gap-3 text-left">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center dark:bg-blue-950/40"><TypeIcon className="w-5 h-5 text-blue-700 dark:text-blue-300" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-xs font-mono text-gray-600 dark:text-slate-400">{job.number}</span>
            {job.priority && <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${PRIORITY_COLORS[job.priority] || PRIORITY_COLORS.normal}`}>{job.priority}</span>}
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_COLORS[job.status] || STATUS_COLORS.scheduled}`}>{STATUS_LABELS[job.status] || job.status}</span>
          </div>
          <h3 className="font-semibold text-gray-900 text-[15px] truncate dark:text-slate-100">{job.title}</h3>
          {job.contact && <p className="text-sm text-gray-700 mt-0.5 dark:text-slate-300">{job.contact.name}</p>}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-600 dark:text-slate-400 min-w-0">
            {job.scheduledTime && <span className="flex items-center gap-1 flex-shrink-0"><Clock className="w-3.5 h-3.5" />{job.scheduledTime}</span>}
            {addr && <span className="flex items-center gap-1 truncate"><MapPin className="w-3.5 h-3.5 flex-shrink-0" />{addr}</span>}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0 mt-2 dark:text-slate-400" />
      </button>
      {job.address && (
        <button onClick={onNavigate} className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 bg-orange-700 text-white rounded-lg font-medium text-sm">
          <Navigation className="w-4 h-4" />Directions
        </button>
      )}
    </div>
  )
}

function JobDetail({ api, toast, job, checklist, acting, onBack, onNavigate, onMyWay, onSite, onComplete, onChecklist }: {
  api: TechApi; toast: TechToast; job: Job; checklist: TechViewConfig['checklist']; acting: boolean
  onBack: () => void; onNavigate: () => void; onMyWay: () => void; onSite: () => void; onComplete: (notes?: string) => void; onChecklist: () => void
}) {
  /**
   * Every write here — the three moves, the checklist, adding or removing a photo — is jobs:update on the server.
   * A field seat holds it; a viewer who happens to be assigned a job sees it and its customer, and no buttons.
   */
  const mayMove = useMayWrite('jobs:update')
  const [completionNotes, setCompletionNotes] = useState('')
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [photos, setPhotos] = useState<any[]>([])
  const [uploading, setUploading] = useState(false)
  const [caption, setCaption] = useState('')
  const [previewFile, setPreviewFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [fullscreen, setFullscreen] = useState<any>(null)
  const addr = [job.address, job.city, job.state, job.zip].filter(Boolean).join(', ')

  const loadPhotos = useCallback(async () => {
    try { const data = await api.get(`/api/jobs/${job.id}/photos`); setPhotos(Array.isArray(data) ? data : data?.data || []) } catch { setPhotos([]) }
  }, [api, job.id])
  useEffect(() => { loadPhotos() }, [loadPhotos])

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { toast.error('A photo must be under 10 MB'); return }
    setPreviewFile(file); setPreviewUrl(URL.createObjectURL(file)); setCaption('')
  }
  const upload = async () => {
    if (!previewFile) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('photo', previewFile)
      if (caption) fd.append('caption', caption)
      await api.request(`/api/jobs/${job.id}/photos`, { method: 'POST', body: fd })
      toast.success('Photo added')
      setPreviewFile(null); setPreviewUrl('')
      loadPhotos()
    } catch (err) { toast.error(errMsg(err, 'The photo could not be uploaded')) } finally { setUploading(false) }
  }
  const removePhoto = async (photoId: string) => {
    try { await api.request(`/api/jobs/${job.id}/photos/${photoId}`, { method: 'DELETE' }); toast.success('Photo removed'); setFullscreen(null); loadPhotos() } catch (err) { toast.error(errMsg(err, 'The photo could not be removed')) }
  }

  const card = 'bg-white rounded-xl p-4 shadow-sm dark:bg-slate-900'
  const heading = 'text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase tracking-wider mb-2'
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-950">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 dark:bg-slate-900 dark:border-slate-700">
        <button aria-label="Back" onClick={onBack} className="p-2 -ml-2 rounded-lg"><ChevronLeft className="w-6 h-6 text-gray-700 dark:text-slate-300" /></button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-600 dark:text-slate-400 font-mono">{job.number}</p>
          <h2 className="text-lg font-bold text-gray-900 truncate dark:text-slate-100">{job.title}</h2>
        </div>
        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${STATUS_COLORS[job.status] || STATUS_COLORS.scheduled}`}>{STATUS_LABELS[job.status] || job.status}</span>
      </div>

      <div className="flex-1 overflow-y-auto pb-32 px-4 py-4 space-y-4">
        {job.contact && (
          <div className={card}>
            <h3 className={heading}>Customer</h3>
            <p className="font-semibold text-gray-900 text-lg dark:text-slate-100">{job.contact.name}</p>
            {job.contact.phone && <a href={`tel:${job.contact.phone}`} className="flex items-center gap-2 mt-2 py-2.5 px-4 bg-green-50 text-green-800 rounded-lg font-medium text-sm dark:text-green-300 dark:bg-green-950/40"><Phone className="w-4 h-4" />{job.contact.phone}</a>}
          </div>
        )}
        {addr && (
          <div className={card}>
            <h3 className={heading}>Where</h3>
            <p className="text-gray-800 dark:text-slate-200">{addr}</p>
            <button onClick={onNavigate} className="mt-3 w-full flex items-center justify-center gap-2 py-3 bg-orange-700 text-white rounded-lg font-semibold text-sm"><Navigation className="w-5 h-5" />Directions</button>
          </div>
        )}
        <div className={card}>
          <h3 className={heading}>Job</h3>
          <div className="space-y-2 text-sm">
            {kindOf(job) && <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Type</span><span className="font-medium text-gray-900 capitalize dark:text-slate-100">{kindOf(job).replace(/_/g, ' ')}</span></div>}
            {job.priority && <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Priority</span><span className={`px-2 py-0.5 rounded text-xs font-bold ${PRIORITY_COLORS[job.priority] || PRIORITY_COLORS.normal}`}>{job.priority}</span></div>}
            {job.scheduledTime && <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Time</span><span className="font-medium text-gray-900 dark:text-slate-100">{job.scheduledTime}</span></div>}
            {job.estimatedHours && <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Expected to take</span><span className="font-medium text-gray-900 dark:text-slate-100">{job.estimatedHours} h</span></div>}
          </div>
          {job.description && <p className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-700 dark:border-slate-700 dark:text-slate-300 whitespace-pre-wrap">{job.description}</p>}
        </div>
        {job.equipment && (
          <div className={`${card} border-l-4 border-l-orange-400`}>
            <h3 className={heading}>Equipment</h3>
            <p className="font-semibold text-gray-900 dark:text-slate-100">{job.equipment.name}</p>
            {(job.equipment.manufacturer || job.equipment.model) && <p className="text-sm text-gray-700 mt-0.5 dark:text-slate-300">{[job.equipment.manufacturer, job.equipment.model].filter(Boolean).join(' ')}</p>}
            {job.equipment.serialNumber && <p className="text-xs text-gray-600 dark:text-slate-400 font-mono mt-1">S/N: {job.equipment.serialNumber}</p>}
          </div>
        )}
        {mayMove && !isClosed(job.status) && (
          <button onClick={onChecklist} className={`${card} w-full flex items-center gap-3 border-l-4 border-l-purple-400 text-left`}>
            <ClipboardList className="w-6 h-6 text-purple-700 dark:text-purple-300" />
            <div className="flex-1">
              <p className="font-semibold text-gray-900 dark:text-slate-100">{checklist.title}</p>
              <p className="text-xs text-gray-600 mt-0.5 dark:text-slate-400">{checklist.subtitle}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 dark:text-slate-400" />
          </button>
        )}
        {job.internalNotes && (
          <div className={card}>
            <h3 className={heading}>Notes</h3>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans dark:text-slate-300">{job.internalNotes}</pre>
          </div>
        )}
        <div className={card}>
          <div className="flex items-center justify-between mb-3"><h3 className={heading}>Photos</h3><span className="text-xs text-gray-600 dark:text-slate-400">{photos.length}</span></div>
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              {photos.map((p) => <button key={p.id} onClick={() => setFullscreen(p)} className="aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-800"><img src={p.thumbnailUrl || p.url} alt={p.caption || 'Job photo'} className="w-full h-full object-cover" /></button>)}
            </div>
          )}
          {!mayMove ? null : previewUrl ? (
            <div className="space-y-2">
              <img src={previewUrl} alt="Photo to add" className="w-full rounded-lg max-h-48 object-cover" />
              <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600" />
              <div className="flex gap-2">
                <button onClick={() => { setPreviewFile(null); setPreviewUrl('') }} className="flex-1 py-2 text-sm text-gray-800 bg-gray-100 rounded-lg dark:text-slate-200 dark:bg-slate-800">Cancel</button>
                <button onClick={upload} disabled={uploading} className="flex-1 py-2 text-sm text-white bg-orange-700 rounded-lg disabled:opacity-50">{uploading ? 'Uploading…' : 'Add photo'}</button>
              </div>
            </div>
          ) : (
            <label className="flex items-center justify-center gap-2 w-full py-3 bg-gray-100 rounded-lg text-sm font-medium text-gray-800 cursor-pointer dark:bg-slate-800 dark:text-slate-200">
              <Camera className="w-5 h-5" />Take or add a photo
              <input type="file" accept="image/*" capture="environment" onChange={pick} className="hidden" />
            </label>
          )}
        </div>
      </div>

      {fullscreen && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col" role="dialog" aria-modal="true" aria-label="Photo">
          <div className="flex items-center justify-between p-4">
            <button aria-label="Close" onClick={() => setFullscreen(null)} className="p-2 text-white"><X className="w-6 h-6" /></button>
            {mayMove && <button aria-label="Remove photo" onClick={() => removePhoto(fullscreen.id)} className="p-2 text-red-300"><Trash2 className="w-5 h-5" /></button>}
          </div>
          <div className="flex-1 flex items-center justify-center p-4"><img src={fullscreen.url} alt={fullscreen.caption || ''} className="max-w-full max-h-full object-contain" /></div>
          {fullscreen.caption && <p className="text-white text-center p-4 text-sm">{fullscreen.caption}</p>}
        </div>
      )}

      {confirmComplete && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end" role="dialog" aria-modal="true" aria-label="Complete job">
          <div className="absolute inset-0" onClick={() => setConfirmComplete(false)} />
          <div className="relative bg-white w-full rounded-t-2xl p-6 space-y-4 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100">Complete job</h3>
              <button aria-label="Close" onClick={() => setConfirmComplete(false)} className="p-2 rounded-lg"><X className="w-5 h-5 text-gray-600 dark:text-slate-400" /></button>
            </div>
            <textarea value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} placeholder="What was done (optional)…" rows={3} className="w-full border border-gray-300 rounded-lg p-3 text-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600" />
            <button onClick={() => { onComplete(completionNotes); setConfirmComplete(false) }} disabled={acting} className="w-full py-4 bg-green-700 text-white rounded-xl font-bold text-lg disabled:opacity-50">{acting ? 'Completing…' : 'Confirm complete'}</button>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-40 dark:bg-slate-900 dark:border-slate-700">
        {!mayMove && !isClosed(job.status) && <div className="text-center py-3 text-gray-700 font-semibold dark:text-slate-300">You can see this job. The office updates its progress.</div>}
        {mayMove && NOT_STARTED.includes(job.status) && (
          <div className="flex gap-2">
            <button onClick={onMyWay} disabled={acting} className="flex-1 flex items-center justify-center gap-2 py-4 bg-yellow-700 text-white rounded-xl font-bold text-lg disabled:opacity-50">{acting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Truck className="w-5 h-5" />}On my way</button>
            <button onClick={onSite} disabled={acting} className="flex-1 flex items-center justify-center gap-2 py-4 bg-orange-700 text-white rounded-xl font-bold text-lg disabled:opacity-50"><Flag className="w-5 h-5" />On site</button>
          </div>
        )}
        {mayMove && job.status === 'dispatched' && (
          <button onClick={onSite} disabled={acting} className="w-full flex items-center justify-center gap-2 py-4 bg-orange-700 text-white rounded-xl font-bold text-lg disabled:opacity-50">{acting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Flag className="w-5 h-5" />}Arrived — on site</button>
        )}
        {mayMove && job.status === 'in_progress' && (
          <button onClick={() => setConfirmComplete(true)} disabled={acting} className="w-full flex items-center justify-center gap-2 py-4 bg-green-700 text-white rounded-xl font-bold text-lg disabled:opacity-50"><CheckCircle className="w-5 h-5" />Complete job</button>
        )}
        {job.status === 'completed' && <div className="text-center py-3 text-green-800 font-semibold flex items-center justify-center gap-2 dark:text-green-300"><CheckCircle className="w-5 h-5" />Job completed</div>}
        {(job.status === 'cancelled' || job.status === 'on_hold') && <div className="text-center py-3 text-gray-700 font-semibold dark:text-slate-300">This job is {STATUS_LABELS[job.status].toLowerCase()}. Ask the office before going.</div>}
      </div>
    </div>
  )
}

function ChecklistScreen({ api, toast, job, def, onBack, onDone }: { api: TechApi; toast: TechToast; job: Job; def: TechViewConfig['checklist']; onBack: () => void; onDone: () => void }) {
  const [items, setItems] = useState<ChecklistItem[]>(def.items.map((i) => ({ ...i, status: 'pass' as const, notes: '' })))
  const [overallNotes, setOverallNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const update = (id: string, patch: Partial<ChecklistItem>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const submit = async () => {
    setSaving(true)
    try {
      await api.post(`/api/tech/${job.id}/checklist`, { items: items.map(({ id, label, status, notes }) => ({ id, label, status, notes: notes || undefined })), overallNotes: overallNotes || undefined })
      toast.success(`${def.title} saved`)
      onDone()
    } catch (err) { toast.error(errMsg(err, 'The checklist could not be saved')) } finally { setSaving(false) }
  }
  const icon = (s: string) => s === 'pass' ? <CheckCircle className="w-6 h-6 text-green-700 dark:text-green-300" /> : s === 'fail' ? <X className="w-6 h-6 text-red-700 dark:text-red-300" /> : <AlertTriangle className="w-6 h-6 text-yellow-700 dark:text-yellow-300" />
  const choice = (current: string, target: string) => {
    const base = 'flex-1 py-3 rounded-lg font-semibold text-sm'
    if (current !== target) return `${base} bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-200`
    return `${base} ${target === 'pass' ? 'bg-green-700' : target === 'fail' ? 'bg-red-700' : 'bg-yellow-700'} text-white`
  }
  const fail = items.filter((i) => i.status === 'fail').length
  const attention = items.filter((i) => i.status === 'attention').length
  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-slate-950">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 dark:bg-slate-900 dark:border-slate-700">
        <button aria-label="Back" onClick={onBack} className="p-2 -ml-2 rounded-lg"><ChevronLeft className="w-6 h-6 text-gray-700 dark:text-slate-300" /></button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">{def.title}</h2>
          <p className="text-xs text-gray-600 truncate dark:text-slate-400">{job.number} — {job.title}</p>
        </div>
      </div>
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-4 text-xs font-semibold dark:bg-slate-900 dark:border-slate-700">
        <span className="text-green-800 dark:text-green-300">{items.length - fail - attention} pass</span>
        <span className="text-yellow-800 dark:text-yellow-300">{attention} attention</span>
        <span className="text-red-700 dark:text-red-300">{fail} fail</span>
      </div>
      <div className="flex-1 overflow-y-auto pb-28 px-4 py-4 space-y-3">
        {items.map((item) => (
          <div key={item.id} className="bg-white rounded-xl shadow-sm overflow-hidden dark:bg-slate-900">
            <button onClick={() => setOpen(open === item.id ? null : item.id)} aria-expanded={open === item.id} className="w-full flex items-center gap-3 p-4 text-left">
              <ClipboardList className="w-5 h-5 text-gray-500 flex-shrink-0 dark:text-slate-400" />
              <span className="flex-1 font-medium text-gray-900 dark:text-slate-100">{item.label}</span>
              {icon(item.status)}
            </button>
            {open === item.id && (
              <div className="px-4 pb-4 border-t border-gray-200 space-y-3 dark:border-slate-700">
                <div className="flex gap-2 pt-3">
                  <button onClick={() => update(item.id, { status: 'pass' })} className={choice(item.status, 'pass')}>Pass</button>
                  <button onClick={() => update(item.id, { status: 'attention' })} className={choice(item.status, 'attention')}>Attention</button>
                  <button onClick={() => update(item.id, { status: 'fail' })} className={choice(item.status, 'fail')}>Fail</button>
                </div>
                <textarea value={item.notes} onChange={(e) => update(item.id, { notes: e.target.value })} placeholder="Notes for this item…" rows={2} className="w-full border border-gray-300 rounded-lg p-3 text-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600" />
              </div>
            )}
          </div>
        ))}
        <div className="bg-white rounded-xl p-4 shadow-sm dark:bg-slate-900">
          <h3 className="text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase tracking-wider mb-2">Overall notes</h3>
          <textarea value={overallNotes} onChange={(e) => setOverallNotes(e.target.value)} placeholder="Anything else the office should know…" rows={3} className="w-full border border-gray-300 rounded-lg p-3 text-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600" />
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-40 dark:bg-slate-900 dark:border-slate-700">
        <button onClick={submit} disabled={saving} className="w-full flex items-center justify-center gap-2 py-4 bg-purple-700 text-white rounded-xl font-bold text-lg disabled:opacity-50">{saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <ClipboardList className="w-5 h-5" />}Save checklist</button>
      </div>
    </div>
  )
}
