import { useEffect, useState } from 'react'
import { Upload, Trash2, Tag as TagIcon, Copy, Check } from 'lucide-react'
import { api, ApiError } from '../api/client'

interface Photo {
  id: string
  url: string
  storageKey?: string | null
  alt?: string | null
  tag?: string | null
  width?: number | null
  height?: number | null
  bytes?: number | null
  contentType?: string | null
  createdAt: string
}

const TAG_PRESETS = ['hero', 'about', 'services', 'team', 'projects', 'contact', 'misc']

export function PhotosPage() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const refresh = (tag?: string | null) => {
    const path = tag ? `/api/admin/photos?tag=${encodeURIComponent(tag)}` : '/api/admin/photos'
    setLoading(true)
    api.get<{ photos: Photo[] }>(path)
      .then(({ photos }) => setPhotos(photos))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh(activeTag) }, [activeTag])

  const onUpload = async (files: FileList | null, defaultTag?: string) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        if (defaultTag) form.append('tag', defaultTag)
        const res = await fetch('/api/admin/photos', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + (localStorage.getItem('admin_token') || '') },
          body: form,
        })
        const data = await res.json()
        if (!res.ok) throw new ApiError(data?.error || res.statusText, res.status, data)
      }
      refresh(activeTag)
    } catch (e: any) {
      setError(e.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const updateTag = async (photo: Photo, tag: string | null) => {
    try {
      await api.patch(`/api/admin/photos/${photo.id}`, { tag })
      refresh(activeTag)
    } catch (e: any) { setError(e.message) }
  }

  const remove = async (photo: Photo) => {
    if (!confirm('Delete this photo? Any section currently using it will break.')) return
    try {
      await api.delete(`/api/admin/photos/${photo.id}`)
      setPhotos((p) => p.filter((x) => x.id !== photo.id))
    } catch (e: any) { setError(e.message) }
  }

  const copyUrl = async (photo: Photo) => {
    try {
      await navigator.clipboard.writeText(photo.url)
      setCopiedId(photo.id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch { /* ignore */ }
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl text-ink">Photos</h1>
          <p className="text-muted text-sm mt-1">Upload, tag, and reuse images across your sections.</p>
        </div>
        <label className="btn-primary btn-lg inline-flex items-center gap-2 cursor-pointer">
          <Upload className="w-4 h-4" />
          {uploading ? 'Uploading…' : 'Upload photos'}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => { onUpload(e.target.files); e.target.value = '' }}
          />
        </label>
      </div>

      {/* Tag filter */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          type="button"
          onClick={() => setActiveTag(null)}
          className={'btn-sm rounded-full px-3 py-1 ' + (activeTag === null ? 'bg-ink text-white' : 'bg-white border border-line text-ink-soft hover:bg-paper')}
        >
          All
        </button>
        {TAG_PRESETS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTag(t)}
            className={'btn-sm rounded-full px-3 py-1 ' + (activeTag === t ? 'bg-ink text-white' : 'bg-white border border-line text-ink-soft hover:bg-paper')}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}
      {loading && <div className="text-muted text-sm">Loading…</div>}

      {!loading && photos.length === 0 && (
        <div className="card card-padding text-center text-muted">
          {activeTag ? `No photos tagged "${activeTag}" yet.` : 'No photos yet. Upload a few to get started.'}
        </div>
      )}

      {!loading && photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {photos.map((p) => (
            <div key={p.id} className="card overflow-hidden group">
              <div className="aspect-square bg-paper relative">
                <img src={p.url} alt={p.alt || ''} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                  <button onClick={() => copyUrl(p)} className="btn-secondary btn-sm" title="Copy URL">
                    {copiedId === p.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => remove(p)} className="btn-secondary btn-sm text-red-600" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <TagIcon className="w-3 h-3 text-muted" />
                  <select
                    value={p.tag || ''}
                    onChange={(e) => updateTag(p, e.target.value || null)}
                    className="text-xs bg-transparent border-0 focus:outline-none focus:ring-0 -ml-1 text-ink-soft"
                  >
                    <option value="">untagged</option>
                    {TAG_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="text-[11px] text-muted">
                  {p.width && p.height ? `${p.width}×${p.height}` : '—'} · {p.bytes ? Math.round(p.bytes / 1024) + ' KB' : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
