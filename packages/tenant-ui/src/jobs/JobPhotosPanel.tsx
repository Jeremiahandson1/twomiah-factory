// A job's photos on its page: add one (camera or file, with a caption), see them, open one full size, remove one.
// Live test 2026-10-22 (contractor, landscaping): the page only ever showed photos already taken from Crew View, and
// on contractor not even those. Photos live where the business's phone app keeps them, one place each:
//   'job'      the job's own photos            GET/POST /api/jobs/:id/photos, DELETE …/photos/:photoId   (jobs:read / jobs:update)
//   'library'  the photo library, by the job   GET /api/photos?jobId, POST /api/photos { jobId }, DELETE /api/photos/:id
//                                                (documents:read / create / delete)
// Both are photo_capture's on the server, so the page shows this only with it on.
import { useState, useEffect, useCallback, type ChangeEvent } from 'react'
import { Camera, FolderPlus, Trash2 } from 'lucide-react'
import { Button, errMsg } from '../invoicing/ui'
import type { JobsApi, JobsToast } from './types'
import { useMayWrite } from '../auth/PermissionsContext'
import { useConfirm } from '../ui/ConfirmProvider'
import { PhotoViewer } from '../files/PhotoViewer'

export type JobPhotoStore = 'job' | 'library'
interface Shown { id: string; url: string; thumbnailUrl?: string | null; caption?: string | null; kind: string }

/**
 * PHOTO FOLDERS (parity tier 2 #2, 11/10 — Buildertrend's per-job folders; feature photo_folders, not ready): each store's own
 * kinds — the job's photos (job_photo.photo_type, tenant-backend jobs.ts JOB_PHOTO_KINDS) or the photo library's categories
 * (files/photos.ts PHOTO_CATEGORIES). 'general' / 'photo' / 'other' are a photo in no folder.
 */
const FOLDER_WORDS: Record<string, string> = {
  before: 'Before', during: 'During', after: 'After', progress: 'Progress', damage: 'Damage', inspection: 'Inspection', issue: 'Issues',
  material: 'Materials', equipment: 'Equipment', safety: 'Safety', permit: 'Permits',
}
const FOLDERS: Record<JobPhotoStore, string[]> = {
  job: ['before', 'during', 'after', 'progress', 'damage', 'inspection', 'issue'],
  library: ['before', 'during', 'after', 'progress', 'damage', 'inspection', 'issue', 'material', 'equipment', 'safety', 'permit'],
}
const UNFILED = 'none'
const kindOf = (store: JobPhotoStore, p: any): string => {
  const k = store === 'job' ? p.photoType : p.type
  return typeof k === 'string' && FOLDERS[store].includes(k) ? k : UNFILED
}
/** A folder the job's people named (GET /api/jobs/:id/photo-folders): its key in the panel is 'f:' + its id. */
interface Named { id: string; name: string }
const NAMED = 'f:'

const card = 'bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6'
const MAX_BYTES = 10 * 1024 * 1024

export function JobPhotosPanel({ api, toast, jobId, store, label = 'Job', folders = false }: {
  api: JobsApi; toast: JobsToast; jobId: string; store: JobPhotoStore; label?: string; folders?: boolean
}) {
  // Each control asks what ITS route asks (the table above): the job's own photos are jobs:update, the library's are
  // documents:create / documents:delete.
  const mayEditJob = useMayWrite('jobs:update')
  const mayAddDocument = useMayWrite('documents:create')
  const mayRemoveDocument = useMayWrite('documents:delete')
  const mayAdd = store === 'job' ? mayEditJob : mayAddDocument
  const mayRemove = store === 'job' ? mayEditJob : mayRemoveDocument
  const confirm = useConfirm()
  const [photos, setPhotos] = useState<Shown[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [caption, setCaption] = useState('')
  const [uploading, setUploading] = useState(false)
  const [open, setOpen] = useState<Shown | null>(null)
  // The folder being looked at ('' = every photo), and the one a new photo goes in.
  const [folder, setFolder] = useState('')
  const [addTo, setAddTo] = useState(UNFILED)
  // The job's own named folders (job photos only — live test 11/11: Buildertrend and CompanyCam let you make one), and the
  // name being typed for a new one or a rename.
  const own = folders && store === 'job'
  const [named, setNamed] = useState<Named[]>([])
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null)
  const folderWord = (k: string) => (k.startsWith(NAMED) ? named.find((f) => NAMED + f.id === k)?.name || 'Folder' : FOLDER_WORDS[k] || k)
  const folderKeys = [...FOLDERS[store], ...named.map((f) => NAMED + f.id)]
  const send = (path: string, init: any) => (api.request ? api.request(path, init) : Promise.reject(new Error('Uploading is not available here')))

  const load = useCallback(async () => {
    setFailed(null)
    try {
      const r = store === 'job' ? await api.get(`/api/jobs/${jobId}/photos`) : await api.get('/api/photos', { jobId, limit: 200 })
      const rows: any[] = Array.isArray(r) ? r : r?.data || []
      setPhotos(rows.map((p) => ({ id: p.id, url: p.url, thumbnailUrl: p.thumbnailUrl, caption: p.caption ?? p.description ?? null, kind: own && p.folderId ? NAMED + p.folderId : kindOf(store, p) })))
      if (own) setNamed(((await api.get(`/api/jobs/${jobId}/photo-folders`).catch(() => null)) as any)?.data || [])
    } catch (err) { setPhotos([]); setFailed(errMsg(err, 'The photos could not be loaded')) }
  }, [jobId, store, own]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_BYTES) { toast.error('A photo must be under 10 MB'); return }
    setFile(f); setPreview(URL.createObjectURL(f)); setCaption(''); setAddTo(folder || UNFILED)
  }
  const cancel = () => { if (preview) URL.revokeObjectURL(preview); setFile(null); setPreview('') }
  const upload = async () => {
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('photo', file)
      if (caption.trim()) fd.append('caption', caption.trim())
      if (store === 'library') fd.append('jobId', jobId)
      if (folders && addTo.startsWith(NAMED)) fd.append('folderId', addTo.slice(NAMED.length))
      else if (folders && addTo !== UNFILED) fd.append(store === 'job' ? 'kind' : 'category', addTo)
      await send(store === 'job' ? `/api/jobs/${jobId}/photos` : '/api/photos', { method: 'POST', body: fd })
      toast.success('Photo added')
      cancel()
      load()
    } catch (err) { toast.error(errMsg(err, 'The photo could not be uploaded')) } finally { setUploading(false) }
  }
  /** File a photo in another folder (or none). */
  const move = async (p: Shown, to: string) => {
    try {
      if (store === 'job') await send(`/api/jobs/${jobId}/photos/${p.id}`, { method: 'PATCH', body: JSON.stringify(to.startsWith(NAMED) ? { folderId: to.slice(NAMED.length) } : { kind: to === UNFILED ? 'general' : to }), headers: { 'Content-Type': 'application/json' } })
      else await send(`/api/photos/${p.id}`, { method: 'PUT', body: JSON.stringify({ category: to === UNFILED ? 'photo' : to }), headers: { 'Content-Type': 'application/json' } })
      toast.success(to === UNFILED ? 'Photo taken out of its folder' : `Photo moved to ${folderWord(to)}`)
      setPhotos((list) => (list || []).map((x) => (x.id === p.id ? { ...x, kind: to } : x)))
    } catch (err) { toast.error(errMsg(err, 'The photo could not be moved')) }
  }
  /** Make a folder, or rename one (naming.id). */
  const saveName = async () => {
    if (!naming) return
    const name = naming.name.trim()
    if (!name) { toast.error('Name the folder'); return }
    try {
      const r: any = await send(naming.id ? `/api/jobs/${jobId}/photo-folders/${naming.id}` : `/api/jobs/${jobId}/photo-folders`, { method: naming.id ? 'PATCH' : 'POST', body: JSON.stringify({ name }), headers: { 'Content-Type': 'application/json' } })
      const f: Named | null = r && typeof r.json === 'function' ? await r.json().catch(() => null) : r
      toast.success(naming.id ? 'Folder renamed' : `Folder "${name}" made`)
      setNaming(null)
      await load()
      if (!naming.id && f?.id) setFolder(NAMED + f.id)
    } catch (err) { toast.error(errMsg(err, 'The folder could not be saved')) }
  }
  const removeFolder = async (key: string) => {
    const word = folderWord(key)
    if (!(await confirm(`Its photos stay on the ${label.toLowerCase()}, in no folder.`, { title: `Delete the folder "${word}"?`, confirmText: 'Delete folder' }))) return
    try {
      await send(`/api/jobs/${jobId}/photo-folders/${key.slice(NAMED.length)}`, { method: 'DELETE' })
      toast.success('Folder deleted'); setFolder(''); load()
    } catch (err) { toast.error(errMsg(err, 'The folder could not be deleted')) }
  }
  const remove = async (p: Shown) => {
    if (!(await confirm('The photo is removed from this job for everyone.', { title: 'Delete this photo?', confirmText: 'Delete photo' }))) return
    try {
      await send(store === 'job' ? `/api/jobs/${jobId}/photos/${p.id}` : `/api/photos/${p.id}`, { method: 'DELETE' })
      toast.success('Photo removed'); setOpen(null); load()
    } catch (err) { toast.error(errMsg(err, 'The photo could not be removed')) }
  }

  const shownPhotos = (photos || []).filter((p) => !folders || !folder || p.kind === folder)
  const counted = (k: string) => (photos || []).filter((p) => p.kind === k).length
  const tabs: Array<[string, string]> = !folders || !photos || (!photos.length && !named.length) ? [] : [
    ['', `All (${photos.length})`],
    ...FOLDERS[store].filter((k) => counted(k) > 0).map((k): [string, string] => [k, `${folderWord(k)} (${counted(k)})`]),
    // A named folder is listed even while empty (it was made to put photos in).
    ...named.map((f): [string, string] => [NAMED + f.id, `${f.name} (${counted(NAMED + f.id)})`]),
    ...(counted(UNFILED) > 0 && counted(UNFILED) < photos.length ? [[UNFILED, `Not in a folder (${counted(UNFILED)})`] as [string, string]] : []),
  ]

  return (
    <div className={card}>
      <h2 className="font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-slate-100"><Camera className="w-4 h-4" /> Photos{photos && photos.length ? ` (${photos.length})` : ''}</h2>
      {failed && <p role="alert" className="text-sm text-red-700 dark:text-red-300 mb-3">{failed}</p>}
      {photos === null && !failed && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}
      {photos && !photos.length && !failed && <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">No photos yet.</p>}
      {tabs.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Photo folders">
          {tabs.map(([k, words]) => (
            <button key={k || 'all'} type="button" aria-pressed={folder === k} onClick={() => setFolder(k)} className={`rounded-full px-3 py-1 text-sm ${folder === k ? 'bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}>{words}</button>
          ))}
        </div>
      )}
      {own && mayEditJob && photos && (
        <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
          {naming ? (
            <>
              <label htmlFor={`photo-folder-name-${jobId}`} className="sr-only">Folder name</label>
              <input id={`photo-folder-name-${jobId}`} autoFocus value={naming.name} maxLength={60} placeholder="Folder name"
                onChange={(e) => setNaming({ ...naming, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveName() } if (e.key === 'Escape') setNaming(null) }}
                className="border border-gray-300 rounded-lg px-2 py-1 bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600" />
              <Button type="button" onClick={saveName}>{naming.id ? 'Rename' : 'Make folder'}</Button>
              <Button type="button" variant="secondary" onClick={() => setNaming(null)}>Cancel</Button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setNaming({ id: null, name: '' })} className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-3 py-1 text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"><FolderPlus className="w-4 h-4" />New folder</button>
              {folder.startsWith(NAMED) && (
                <>
                  <button type="button" onClick={() => setNaming({ id: folder.slice(NAMED.length), name: folderWord(folder) })} className="rounded-full border border-gray-300 px-3 py-1 text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Rename</button>
                  <button type="button" onClick={() => removeFolder(folder)} className="rounded-full border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 dark:border-red-500/50 dark:text-red-300 dark:hover:bg-red-950/40">Delete folder</button>
                </>
              )}
            </>
          )}
        </div>
      )}
      {photos && photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
          {shownPhotos.map((p) => (
            <button type="button" key={p.id} onClick={() => setOpen(p)} className="aspect-square rounded-lg overflow-hidden bg-gray-100 hover:opacity-80 transition-opacity dark:bg-slate-800">
              <img src={p.thumbnailUrl || p.url} alt={p.caption || `${label} photo`} className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
      {mayAdd && (preview ? (
        <div className="space-y-2">
          <img src={preview} alt="Photo to add" className="w-full rounded-lg max-h-56 object-cover" />
          <label htmlFor={`job-photo-caption-${jobId}`} className="sr-only">Caption</label>
          {folders && (
            <label className="block text-sm text-gray-800 dark:text-slate-200">Folder
              <select className="ml-2 border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600" value={addTo} onChange={(e) => setAddTo(e.target.value)}>
                <option value={UNFILED}>No folder</option>
                {folderKeys.map((k) => <option key={k} value={k}>{folderWord(k)}</option>)}
              </select>
            </label>
          )}
          <input id={`job-photo-caption-${jobId}`} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} placeholder="Caption (optional)"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600" />
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="secondary" onClick={cancel}>Cancel</Button>
            <Button type="button" onClick={upload} disabled={uploading}>{uploading ? 'Uploading…' : 'Add photo'}</Button>
          </div>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-2 w-full py-3 bg-gray-100 rounded-lg text-sm font-medium text-gray-800 cursor-pointer hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
          <Camera className="w-5 h-5" />Take or add a photo
          <input type="file" accept="image/*" capture="environment" onChange={pick} className="sr-only" />
        </label>
      ))}

      {/* The shared full-size viewer (files/PhotoViewer.tsx): next and previous, the keyboard, a phone's swipe. */}
      <PhotoViewer
        label={`${label} photos`}
        photos={shownPhotos.map((p) => ({ id: p.id, src: p.url, caption: p.caption }))}
        index={open ? Math.max(0, shownPhotos.findIndex((p) => p.id === open.id)) : null}
        onIndex={(i) => setOpen(shownPhotos[i] ?? null)}
        onClose={() => setOpen(null)}
        actions={(p) => {
          const shown = photos?.find((x) => x.id === p.id)
          const mover = folders && shown && (store === 'job' ? mayEditJob : mayAddDocument) ? (
            <select aria-label="Move to folder" value={shown.kind} onChange={(e) => void move(shown, e.target.value)} className="h-11 rounded-full bg-white/10 px-3 text-sm text-white">
              <option value={UNFILED} className="text-gray-900 dark:text-slate-100 dark:bg-slate-800">No folder</option>
              {folderKeys.map((k) => <option key={k} value={k} className="text-gray-900 dark:text-slate-100 dark:bg-slate-800">{folderWord(k)}</option>)}
            </select>
          ) : null
          if (!(mayRemove && shown)) return mover
          return <span className="inline-flex items-center gap-2">{mover}<button type="button" onClick={() => remove(shown)} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-red-300 hover:bg-white/20" aria-label="Delete photo"><Trash2 className="w-5 h-5" /></button></span>
        }}
      />
    </div>
  )
}
