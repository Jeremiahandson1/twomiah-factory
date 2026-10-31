// A job's photos in words: each one's caption (what an inspection report prints under it), when it was taken and, where
// the phone said, where (docs/parity/roof-inspection-report.md). A caption is jobs:update, as the photo upload is.
// With `photo_markup` on, each photo can be drawn on (./PhotoMarkupEditor.tsx): the marked copy sits beside the original.
import { useState } from 'react'
import { MapPin, PenLine } from 'lucide-react'
import { api } from '../../../../api'
import { useAuth, useMayWrite, useToast, errorText } from '../../../../shared'
import PhotoMarkupEditor, { type MarkedResult } from './PhotoMarkupEditor'
import type { MarkupShape } from '../../../photoMarkup'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'

export interface DetailPhoto {
  id: string; url?: string | null; thumbnailUrl?: string | null; caption?: string | null; photoType?: string | null
  takenAt?: string | null; latitude?: string | number | null; longitude?: string | number | null
  /** On a marked copy: the photo it was drawn on, and the drawing. */
  sourcePhotoId?: string | null; markup?: MarkupShape[] | null
}

export default function PhotoDetails({ jobId, photos, allPhotos, onSaved, onMarked }: {
  jobId: string; photos: DetailPhoto[]; onSaved: (p: DetailPhoto) => void
  /** Every photo of the job (a marked copy's original may be on another tab); with `onMarked`, drawing is offered. */
  allPhotos?: DetailPhoto[]; onMarked?: (r: MarkedResult) => void
}) {
  const toast = useToast()
  const mayEdit = useMayWrite('jobs:update')
  const { hasFeature } = useAuth()
  const [drawing, setDrawing] = useState<string | null>(null)
  const canDraw = mayEdit && !!onMarked && hasFeature('photo_markup')
  const every = allPhotos || photos
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<Record<string, string>>({})
  if (photos.length === 0) return null
  const save = async (p: DetailPhoto) => {
    const next = (text[p.id] ?? p.caption ?? '').trim()
    if (next === (p.caption ?? '')) return
    try { onSaved((await api.put(`/api/jobs/${jobId}/photos/${p.id}`, { caption: next || null })) as DetailPhoto) } catch (e) { toast.error(errorText(e, 'Could not save the caption')) }
  }
  return (
    <div className="mb-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-sm text-orange-700 hover:underline dark:text-orange-300">
        {open ? 'Hide captions and details' : canDraw ? 'Captions, drawing and details' : 'Captions and details'}
      </button>
      {open && (
        <ul className="mt-3 space-y-3">
          {photos.map((p) => {
            const place = p.latitude != null && p.longitude != null && p.latitude !== '' ? `${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}` : ''
            return (
              <li key={p.id} className="flex gap-3 items-start">
                <img src={p.thumbnailUrl || p.url || ''} alt="" className="w-14 h-14 rounded-md object-cover shrink-0 bg-gray-100 dark:bg-slate-800" />
                <div className="flex-1 min-w-0">
                  <input aria-label="Caption" maxLength={500} disabled={!mayEdit} placeholder="Caption, e.g. Hail hits, north slope" value={text[p.id] ?? p.caption ?? ''}
                    onChange={(e) => setText({ ...text, [p.id]: e.target.value })} onBlur={() => save(p)}
                    className="w-full text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100" />
                  <p className="mt-1 text-xs text-gray-500 flex flex-wrap items-center gap-x-3 dark:text-slate-400">
                    {p.takenAt && <span>{whenDateTime(p.takenAt)}</span>}
                    {place ? <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{place}</span> : <span>No location</span>}
                    {p.sourcePhotoId && <span className="font-medium text-orange-700 dark:text-orange-300">Marked copy</span>}
                  </p>
                  {canDraw && (
                    <button type="button" onClick={() => setDrawing(p.sourcePhotoId || p.id)} className="mt-1 inline-flex items-center gap-1 text-sm text-orange-700 hover:underline dark:text-orange-300">
                      <PenLine className="w-3.5 h-3.5" aria-hidden="true" /> {p.sourcePhotoId || every.some((o) => o.sourcePhotoId === p.id) ? 'Change the marks' : 'Draw on this photo'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {drawing && (() => {
        const original = every.find((o) => o.id === drawing)
        if (!original) return null
        const copy = every.find((o) => o.sourcePhotoId === original.id)
        return <PhotoMarkupEditor original={original} shapes={(copy?.markup as MarkupShape[] | null) || []} onClose={() => setDrawing(null)} onSaved={(r) => { setDrawing(null); onMarked?.(r) }} />
      })()}
    </div>
  )
}
