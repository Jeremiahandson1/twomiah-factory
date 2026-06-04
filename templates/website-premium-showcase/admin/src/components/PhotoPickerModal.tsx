import { useEffect, useState, type FormEvent } from 'react'
import { X, Upload, Check } from 'lucide-react'
import clsx from 'clsx'
import { api, ApiError } from '../api/client'
import { usePhotoPicker, type Photo } from '../contexts/PhotoPickerContext'

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
    api.get<{ photos: Photo[] }>('/api/admin/photos')
      .then(({ photos }) => setPhotos(photos))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null

  const onUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      if (open.initialTag) form.append('tag', open.initialTag)
      const res = await fetch('/api/admin/photos', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || '') },
        body: form,
      })
      const data = await res.json()
      if (!res.ok) throw new ApiError(data?.error || res.statusText, res.status, data)
      setPhotos((p) => [data.photo, ...p])
      setSelectedUrl(data.photo.url)
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => close(null)}>
      <div className="bg-white rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-line flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl text-ink">Choose a photo</h2>
            <p className="text-xs text-muted mt-0.5">Pick from your library, upload a new one, or paste a URL.</p>
          </div>
          <button onClick={() => close(null)} className="btn-secondary btn-sm" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* URL input */}
        <form onSubmit={onUrlSubmit} className="px-6 py-3 border-b border-line flex gap-2 bg-paper shrink-0">
          <input
            type="url"
            placeholder="https://… paste a URL (e.g. Unsplash)"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            className="input"
          />
          <button type="submit" className="btn-secondary btn-md shrink-0">Use URL</button>
        </form>

        {/* Upload */}
        <div className="px-6 py-3 border-b border-line flex items-center gap-3 shrink-0">
          <label className="btn-secondary btn-md inline-flex items-center gap-2 cursor-pointer">
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
          {error && <span className="text-red-700 text-sm">{error}</span>}
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
                    className={clsx(
                      'relative aspect-square rounded-lg overflow-hidden border-2 transition group bg-white',
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
          <button onClick={() => close(null)} className="btn-secondary btn-md">Cancel</button>
          <button
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
