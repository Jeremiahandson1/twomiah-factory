// The Photos field of a site record's form — a daily log, a punch-list item (server: crm/siteRecords/recordPhotos.ts).
// Live test 2026-10-22, contractor: "Daily logs: no photo field". The photos already on the record are shown and can be
// removed; the ones picked here are held until the form is saved, because a new record has no id to put them on yet —
// the page saves, then calls uploadRecordPhotos with the id it got back.
import { useState } from 'react'
import { Camera, X } from 'lucide-react'
import { api } from '../../api'
import { PhotoViewer } from '@twomiah/tenant-ui/src/files/PhotoViewer'

export interface SavedPhoto { id: string; url: string; caption?: string | null; name?: string; uploadedById?: string }
export interface PendingPhoto { file: File; preview: string }

const MAX_BYTES = 15 * 1024 * 1024

/** Upload the held photos onto the record, one at a time. Answers the ones that did not go up, each with the reason. */
export async function uploadRecordPhotos(base: string, recordId: string, pending: PendingPhoto[]): Promise<{ failed: PendingPhoto[]; reasons: string[] }> {
  const failed: PendingPhoto[] = []
  const reasons: string[] = []
  for (const p of pending) {
    try {
      const fd = new FormData()
      fd.append('photo', p.file)
      await api.request(`${base}/${recordId}/photos`, { method: 'POST', body: fd })
      URL.revokeObjectURL(p.preview)
    } catch (err) { failed.push(p); reasons.push(`${p.file.name}: ${(err as Error).message}`) }
  }
  return { failed, reasons }
}

export function releasePending(pending: PendingPhoto[]) { pending.forEach((p) => URL.revokeObjectURL(p.preview)) }

export function RecordPhotosField({ base, recordId, photos, onPhotosChange, pending, onPendingChange, canEdit = true, canAdd = canEdit, canRemove, inputId }: {
  base: string
  /** The saved record's id, when editing one (a new record has none: its photos wait in `pending`). */
  recordId?: string
  photos: SavedPhoto[]
  onPhotosChange: (photos: SavedPhoto[]) => void
  pending: PendingPhoto[]
  onPendingChange: (pending: PendingPhoto[]) => void
  canEdit?: boolean
  /** May this person add photos? Default canEdit. (A daily log's crew adds photos without editing the log.) */
  canAdd?: boolean
  /** May this person remove this saved photo? Default canEdit for every photo (the server: recordPhotos.ts). */
  canRemove?: (photo: SavedPhoto) => boolean
  inputId: string
}) {
  const [error, setError] = useState('')
  // The saved photo open full size (the shared viewer), by its place in `photos`.
  const [viewing, setViewing] = useState<number | null>(null)
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    const tooBig = files.filter((f) => f.size > MAX_BYTES)
    setError(tooBig.length ? `${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over 15 MB and ${tooBig.length === 1 ? 'was' : 'were'} left out.` : '')
    onPendingChange([...pending, ...files.filter((f) => f.size <= MAX_BYTES).map((file) => ({ file, preview: URL.createObjectURL(file) }))])
  }
  const removeSaved = async (photoId: string) => {
    if (!recordId) return
    setError('')
    try {
      const updated = await api.delete(`${base}/${recordId}/photos/${photoId}`) as { photos?: SavedPhoto[] }
      onPhotosChange(updated?.photos || photos.filter((p) => p.id !== photoId))
    } catch (err) { setError((err as Error).message) }
  }
  const leaveOut = (i: number) => { URL.revokeObjectURL(pending[i].preview); onPendingChange(pending.filter((_, j) => j !== i)) }

  return (
    <div>
      <p className="block text-sm font-medium mb-1">Photos</p>
      {(photos.length > 0 || pending.length > 0) && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-2">
          {photos.map((p) => (
            <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-800">
              <button type="button" onClick={() => setViewing(photos.indexOf(p))} aria-label={`Open ${p.caption || p.name || 'photo'} full size`} className="block w-full h-full"><img src={p.url} alt={p.caption || p.name || 'Photo'} className="w-full h-full object-cover" /></button>
              {(canRemove ? canRemove(p) : canEdit) && <button type="button" onClick={() => removeSaved(p.id)} aria-label={`Remove ${p.name || 'photo'}`} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80"><X className="w-3 h-3" /></button>}
            </div>
          ))}
          {pending.map((p, i) => (
            <div key={p.preview} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-800 ring-2 ring-orange-400">
              <img src={p.preview} alt={`${p.file.name} (not saved yet)`} className="w-full h-full object-cover" />
              <button type="button" onClick={() => leaveOut(i)} aria-label={`Leave out ${p.file.name}`} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80"><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      {photos.length === 0 && pending.length === 0 && <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">No photos yet.</p>}
      {pending.length > 0 && <p className="text-xs text-gray-600 dark:text-slate-400 mb-2">{pending.length} photo{pending.length === 1 ? '' : 's'} will be added when you save.</p>}
      {canAdd && (
        <label htmlFor={inputId} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-800 cursor-pointer hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          <Camera className="w-4 h-4" />Add photos
          <input id={inputId} type="file" accept="image/*" multiple onChange={pick} className="sr-only" />
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <PhotoViewer
        photos={photos.map((p) => ({ id: p.id, src: p.url, caption: p.caption || p.name }))}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
      />
    </div>
  )
}
