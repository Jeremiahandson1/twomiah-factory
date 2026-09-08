import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { Label, TextField, TextAreaField, ImageUrlField } from '../Field'

interface Photo { url: string; alt?: string; caption?: string }

interface Props {
  data: { heading?: string; intro?: string; photos?: Photo[] }
  onChange: (data: any) => void
}

export function GalleryGridForm({ data, onChange }: Props) {
  const photos = Array.isArray(data.photos) ? data.photos : []
  const update = (patch: Partial<Props['data']>) => onChange({ ...data, ...patch })
  const updatePhoto = (i: number, patch: Partial<Photo>) => {
    const next = [...photos]
    next[i] = { ...next[i], ...patch }
    update({ photos: next })
  }
  const addPhoto = () => update({ photos: [...photos, { url: '', alt: '', caption: '' }] })
  const removePhoto = (i: number) => update({ photos: photos.filter((_, j) => j !== i) })
  const movePhoto = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= photos.length) return
    const next = [...photos]
    ;[next[i], next[j]] = [next[j], next[i]]
    update({ photos: next })
  }

  return (
    <div className="space-y-4">
      <TextField label="Heading (optional)" value={data.heading || ''} onChange={(e) => update({ heading: e.target.value })} />
      <TextAreaField label="Intro (optional)" rows={2} value={data.intro || ''} onChange={(e) => update({ intro: e.target.value })} />

      <div>
        <Label>Photos</Label>
        <p className="text-xs text-muted mb-3">Best with 6–12 images. They auto-flow into a responsive 3-column grid.</p>
        <div className="space-y-3">
          {photos.map((p, i) => (
            <div key={i} className="border border-line rounded-lg p-3 bg-paper">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-mono text-muted">{String(i + 1).padStart(2, '0')}</div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => movePhoto(i, -1)} disabled={i === 0} className="btn-secondary btn-sm disabled:opacity-30"><ChevronUp className="w-3 h-3" /></button>
                  <button type="button" onClick={() => movePhoto(i, 1)} disabled={i === photos.length - 1} className="btn-secondary btn-sm disabled:opacity-30"><ChevronDown className="w-3 h-3" /></button>
                  <button type="button" onClick={() => removePhoto(i)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
              <ImageUrlField label="Image" value={p.url || ''} onChange={(v) => updatePhoto(i, { url: v })} uploadTag="gallery" />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <TextField label="Alt text" value={p.alt || ''} onChange={(e) => updatePhoto(i, { alt: e.target.value })} />
                <TextField label="Caption (optional)" value={p.caption || ''} onChange={(e) => updatePhoto(i, { caption: e.target.value })} />
              </div>
            </div>
          ))}
          {photos.length === 0 && (
            <div className="text-sm text-muted bg-paper border border-line rounded-lg p-4 text-center">
              No photos yet. Click below to add the first one.
            </div>
          )}
        </div>
        <button type="button" onClick={addPhoto} className="btn-secondary btn-sm mt-3 inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Add photo
        </button>
      </div>
    </div>
  )
}
