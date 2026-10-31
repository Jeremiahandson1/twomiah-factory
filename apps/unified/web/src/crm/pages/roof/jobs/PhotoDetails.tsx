// A job's photos in words: each one's caption (what an inspection report prints under it), when it was taken and, where
// the phone said, where (docs/parity/roof-inspection-report.md). A caption is jobs:update, as the photo upload is.
import { useState } from 'react'
import { MapPin } from 'lucide-react'
import { api } from '../../../../api'
import { useMayWrite, useToast, errorText } from '../../../../shared'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'

export interface DetailPhoto {
  id: string; url?: string | null; thumbnailUrl?: string | null; caption?: string | null; photoType?: string | null
  takenAt?: string | null; latitude?: string | number | null; longitude?: string | number | null
}

export default function PhotoDetails({ jobId, photos, onSaved }: { jobId: string; photos: DetailPhoto[]; onSaved: (p: DetailPhoto) => void }) {
  const toast = useToast()
  const mayEdit = useMayWrite('jobs:update')
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
        {open ? 'Hide captions and details' : 'Captions and details'}
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
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
