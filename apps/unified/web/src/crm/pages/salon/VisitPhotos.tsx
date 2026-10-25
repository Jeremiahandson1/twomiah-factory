// A visit's before and after photos (server: crm/salon/visitPhotos.ts). Salon live test, 2026-10-25: the service record
// had photo columns and no way anywhere to add one or to see one. A photo is UPLOADED to the visit — never typed in —
// so a new record holds its picks until it is saved and has an id (as RecordPhotosField does for a daily log), then the
// editor calls uploadVisitPhotos with the id it got back. A saved photo is removed with its own button.
import { useState } from 'react'
import { Camera, X } from 'lucide-react'
import { api } from '../../../api'
import { useConfirm } from '../../../shared'
import { PhotoViewer } from '@twomiah/tenant-ui/src/files/PhotoViewer'

export type VisitPhotoSlot = 'before' | 'after'
export const VISIT_PHOTO_SLOTS: VisitPhotoSlot[] = ['before', 'after']
export const SLOT_LABEL: Record<VisitPhotoSlot, string> = { before: 'Before', after: 'After' }
export type PendingVisitPhotos = Partial<Record<VisitPhotoSlot, { file: File; preview: string }>>
/** The photos a saved visit holds, at the addresses the server serves them from (null: none). */
export interface VisitPhotoUrls { photoBeforeUrl?: string | null; photoAfterUrl?: string | null }
export const urlOf = (r: VisitPhotoUrls | null | undefined, slot: VisitPhotoSlot) => (slot === 'before' ? r?.photoBeforeUrl : r?.photoAfterUrl) || null

// The server's ceiling (siteRecords/recordPhotos.ts MAX_PHOTO_BYTES): refused here rather than after the upload.
const MAX_BYTES = 15 * 1024 * 1024

/** Upload the held photos onto the saved visit. Answers a sentence for each that did not go up. */
export async function uploadVisitPhotos(recordId: string, pending: PendingVisitPhotos): Promise<string[]> {
  const failed: string[] = []
  for (const slot of VISIT_PHOTO_SLOTS) {
    const p = pending[slot]
    if (!p) continue
    try {
      const fd = new FormData()
      fd.append('photo', p.file)
      await api.request(`/api/service-records/${recordId}/photos/${slot}`, { method: 'POST', body: fd })
      URL.revokeObjectURL(p.preview)
    } catch (err) { failed.push(`${SLOT_LABEL[slot]} photo (${p.file.name}): ${(err as Error).message}`) }
  }
  return failed
}

export function releaseVisitPhotos(pending: PendingVisitPhotos) { for (const p of Object.values(pending)) if (p) URL.revokeObjectURL(p.preview) }

/** The Before / After field of the service record form. */
export function VisitPhotosField({ recordId, saved, onSavedChange, pending, onPendingChange, canEdit }: {
  /** The saved visit's id (a new one has none: its photos wait in `pending`). */
  recordId?: string
  saved: VisitPhotoUrls
  onSavedChange: (saved: VisitPhotoUrls) => void
  pending: PendingVisitPhotos
  onPendingChange: (pending: PendingVisitPhotos) => void
  /** schedule:update — what the server asks to add or remove a visit's photo. */
  canEdit: boolean
}) {
  const confirm = useConfirm()
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState<number | null>(null)
  const shown = VISIT_PHOTO_SLOTS.flatMap((slot) => {
    const src = pending[slot]?.preview || urlOf(saved, slot)
    return src ? [{ id: slot, src, caption: `${SLOT_LABEL[slot]}${pending[slot] ? ' (not saved yet)' : ''}` }] : []
  })

  const pick = (slot: VisitPhotoSlot) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) { setError(`${file.name} is over 15 MB and was left out.`); return }
    setError('')
    const was = pending[slot]
    if (was) URL.revokeObjectURL(was.preview)
    onPendingChange({ ...pending, [slot]: { file, preview: URL.createObjectURL(file) } })
  }
  const leaveOut = (slot: VisitPhotoSlot) => {
    const was = pending[slot]
    if (was) URL.revokeObjectURL(was.preview)
    const next = { ...pending }
    delete next[slot]
    onPendingChange(next)
  }
  const removeSaved = async (slot: VisitPhotoSlot) => {
    if (!recordId) return
    if (!(await confirm(`Remove the ${slot} photo from this visit? This cannot be undone.`, { title: 'Remove photo', confirmText: 'Remove it' }))) return
    setError('')
    try {
      const updated = await api.delete(`/api/service-records/${recordId}/photos/${slot}`) as VisitPhotoUrls
      onSavedChange({ photoBeforeUrl: updated?.photoBeforeUrl ?? null, photoAfterUrl: updated?.photoAfterUrl ?? null })
    } catch (err) { setError((err as Error).message) }
  }

  return (
    <div>
      <p className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Photos</p>
      <div className="grid grid-cols-2 gap-3">
        {VISIT_PHOTO_SLOTS.map((slot) => {
          const held = pending[slot]
          const url = held?.preview || urlOf(saved, slot)
          const inputId = `visit-photo-${slot}`
          return (
            <div key={slot}>
              <p className="text-xs font-medium text-gray-600 mb-1 dark:text-slate-300">{SLOT_LABEL[slot]}</p>
              {url ? (
                <div className={`relative aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-slate-800 ${held ? 'ring-2 ring-teal-500 dark:ring-teal-300' : ''}`}>
                  <button type="button" onClick={() => setViewing(shown.findIndex((p) => p.id === slot))} aria-label={`Open the ${slot} photo full size`} className="block w-full h-full">
                    <img src={url} alt={`${SLOT_LABEL[slot]} photo${held ? ' (not saved yet)' : ''}`} className="w-full h-full object-cover" />
                  </button>
                  {canEdit && (held
                    ? <button type="button" onClick={() => leaveOut(slot)} aria-label={`Leave out the new ${slot} photo`} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80"><X className="w-3 h-3" /></button>
                    : <button type="button" onClick={() => removeSaved(slot)} aria-label={`Remove the ${slot} photo`} className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80"><X className="w-3 h-3" /></button>)}
                </div>
              ) : (
                <div className="aspect-square rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-500 dark:border-slate-600 dark:text-slate-400">No {slot} photo</div>
              )}
              {canEdit && (
                <label htmlFor={inputId} className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-800 cursor-pointer hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                  <Camera className="w-4 h-4" />{url ? 'Replace' : `Add ${slot} photo`}
                  <input id={inputId} type="file" accept="image/*" onChange={pick(slot)} className="sr-only" />
                </label>
              )}
            </div>
          )
        })}
      </div>
      {Object.keys(pending).length > 0 && <p className="mt-2 text-xs text-gray-600 dark:text-slate-400">New photos are added when you save the record.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <PhotoViewer photos={shown} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} label="Visit photos" />
    </div>
  )
}
