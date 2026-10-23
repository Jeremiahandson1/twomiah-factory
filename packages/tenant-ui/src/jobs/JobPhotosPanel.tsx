// A job's photos on its page: add one (camera or file, with a caption), see them, open one full size, remove one.
// Live test 2026-10-22 (contractor, landscaping): the page only ever showed photos already taken from Crew View, and
// on contractor not even those. Photos live where the business's phone app keeps them, one place each:
//   'job'      the job's own photos            GET/POST /api/jobs/:id/photos, DELETE …/photos/:photoId   (jobs:read / jobs:update)
//   'library'  the photo library, by the job   GET /api/photos?jobId, POST /api/photos { jobId }, DELETE /api/photos/:id
//                                                (documents:read / create / delete)
// Both are photo_capture's on the server, so the page shows this only with it on.
import { useState, useEffect, useCallback, type ChangeEvent } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { Button, errMsg } from '../invoicing/ui'
import type { JobsApi, JobsToast } from './types'
import { useMayWrite } from '../auth/PermissionsContext'
import { useConfirm } from '../ui/ConfirmProvider'
import { PhotoViewer } from '../files/PhotoViewer'

export type JobPhotoStore = 'job' | 'library'
interface Shown { id: string; url: string; thumbnailUrl?: string | null; caption?: string | null }

const card = 'bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6'
const MAX_BYTES = 10 * 1024 * 1024

export function JobPhotosPanel({ api, toast, jobId, store, label = 'Job' }: {
  api: JobsApi; toast: JobsToast; jobId: string; store: JobPhotoStore; label?: string
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
  const send = (path: string, init: any) => (api.request ? api.request(path, init) : Promise.reject(new Error('Uploading is not available here')))

  const load = useCallback(async () => {
    setFailed(null)
    try {
      const r = store === 'job' ? await api.get(`/api/jobs/${jobId}/photos`) : await api.get('/api/photos', { jobId, limit: 200 })
      const rows: any[] = Array.isArray(r) ? r : r?.data || []
      setPhotos(rows.map((p) => ({ id: p.id, url: p.url, thumbnailUrl: p.thumbnailUrl, caption: p.caption ?? p.description ?? null })))
    } catch (err) { setPhotos([]); setFailed(errMsg(err, 'The photos could not be loaded')) }
  }, [jobId, store]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_BYTES) { toast.error('A photo must be under 10 MB'); return }
    setFile(f); setPreview(URL.createObjectURL(f)); setCaption('')
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
      await send(store === 'job' ? `/api/jobs/${jobId}/photos` : '/api/photos', { method: 'POST', body: fd })
      toast.success('Photo added')
      cancel()
      load()
    } catch (err) { toast.error(errMsg(err, 'The photo could not be uploaded')) } finally { setUploading(false) }
  }
  const remove = async (p: Shown) => {
    if (!(await confirm('The photo is removed from this job for everyone.', { title: 'Delete this photo?', confirmText: 'Delete photo' }))) return
    try {
      await send(store === 'job' ? `/api/jobs/${jobId}/photos/${p.id}` : `/api/photos/${p.id}`, { method: 'DELETE' })
      toast.success('Photo removed'); setOpen(null); load()
    } catch (err) { toast.error(errMsg(err, 'The photo could not be removed')) }
  }

  return (
    <div className={card}>
      <h2 className="font-semibold mb-4 flex items-center gap-2 text-gray-900 dark:text-slate-100"><Camera className="w-4 h-4" /> Photos{photos && photos.length ? ` (${photos.length})` : ''}</h2>
      {failed && <p role="alert" className="text-sm text-red-700 dark:text-red-300 mb-3">{failed}</p>}
      {photos === null && !failed && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}
      {photos && !photos.length && !failed && <p className="text-sm text-gray-500 dark:text-slate-400 mb-3">No photos yet.</p>}
      {photos && photos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mb-4">
          {photos.map((p) => (
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
        photos={(photos || []).map((p) => ({ id: p.id, src: p.url, caption: p.caption }))}
        index={open && photos ? Math.max(0, photos.findIndex((p) => p.id === open.id)) : null}
        onIndex={(i) => setOpen(photos?.[i] ?? null)}
        onClose={() => setOpen(null)}
        actions={(p) => {
          const shown = photos?.find((x) => x.id === p.id)
          return mayRemove && shown ? <button type="button" onClick={() => remove(shown)} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-red-300 hover:bg-white/20" aria-label="Delete photo"><Trash2 className="w-5 h-5" /></button> : null
        }}
      />
    </div>
  )
}
