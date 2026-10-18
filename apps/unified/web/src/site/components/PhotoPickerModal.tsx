import { useEffect, useState, type FormEvent } from 'react'
import { X, Upload, Check } from 'lucide-react'
import clsx from 'clsx'
import { PageError } from '../../shared'
import { usePhotoPicker } from '../contexts/PhotoPickerContext'
import { listPhotos, uploadPhoto, type Photo } from '../photos'

export function PhotoPickerModal() {
  const { open, close } = usePhotoPicker()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedUrl, setSelectedUrl] = useState<string>('')
  const [urlInput, setUrlInput] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setSelectedUrl(open.initialUrl)
    setUrlInput(open.initialUrl)
    setError(null)
    setLoading(true)
    listPhotos()
      .then(setPhotos)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const onUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const photo = await uploadPhoto(file, open.initialTag)
      setPhotos((p) => [photo, ...p])
      setSelectedUrl(photo.url)
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const onUrlSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!urlInput.trim()) return
    close(urlInput.trim())
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 sm:p-6" onClick={() => close(null)}>
      <div role="dialog" aria-modal="true" aria-labelledby="photo-picker-title" className="bg-white dark:bg-slate-900 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h2 id="photo-picker-title" className="text-xl text-ink">Choose a photo</h2>
            <p className="text-xs text-muted mt-0.5">Pick from your library, upload a new one, or paste a URL.</p>
          </div>
          <button type="button" onClick={() => close(null)} className="btn-secondary btn-sm" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* URL input */}
        <form onSubmit={onUrlSubmit} className="px-6 py-3 border-b border-line flex gap-2 bg-paper shrink-0">
          <input
            type="url"
            placeholder="https://… paste a URL"
            aria-label="Photo URL"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="input"
          />
          <button type="submit" className="btn-secondary btn-md shrink-0">Use URL</button>
        </form>

        {/* Upload */}
        <div className="px-6 py-3 border-b border-line flex flex-wrap items-center gap-3 shrink-0">
          <label className="btn-secondary btn-md cursor-pointer">
            <Upload className="w-4 h-4" />
            {uploading ? 'Uploading…' : 'Upload from your computer'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onUpload(f)
                e.target.value = ''
              }}
            />
          </label>
          <PageError message={error} className="flex-1" />
        </div>

        {/* Library grid */}
        <div className="flex-1 overflow-auto p-6 bg-paper">
          {loading && <div className="text-muted text-sm">Loading library…</div>}
          {!loading && photos.length === 0 && (
            <div className="text-muted text-sm text-center py-12">
              No photos uploaded yet. Upload one above, or paste a URL.
            </div>
          )}
          {!loading && photos.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {photos.map((p) => {
                const selected = p.url === selectedUrl
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedUrl(p.url)}
                    aria-pressed={selected}
                    aria-label={p.alt || 'Photo'}
                    className={clsx(
                      'relative aspect-square rounded-lg overflow-hidden border-2 transition group bg-white dark:bg-slate-800',
                      selected ? 'border-brand ring-2 ring-brand/20' : 'border-transparent hover:border-line'
                    )}
                  >
                    <img src={p.url} alt={p.alt || ''} className="w-full h-full object-cover" />
                    {selected && (
                      <div className="absolute top-2 right-2 bg-brand text-white rounded-full w-6 h-6 grid place-items-center">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                    {p.tag && (
                      <div className="absolute bottom-1 left-1 bg-black/70 text-white text-xs rounded px-1.5 py-0.5">
                        {p.tag}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-line flex items-center justify-end gap-2 shrink-0">
          <button type="button" onClick={() => close(null)} className="btn-secondary btn-md">Cancel</button>
          <button
            type="button"
            onClick={() => close(selectedUrl || null)}
            disabled={!selectedUrl}
            className="btn-primary btn-md disabled:opacity-40"
          >
            Use selected photo
          </button>
        </div>
      </div>
    </div>
  )
}
