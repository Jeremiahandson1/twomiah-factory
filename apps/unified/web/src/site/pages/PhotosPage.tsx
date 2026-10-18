import { useEffect, useState } from 'react'
import { Upload, Trash2, Tag as TagIcon, Copy, Check } from 'lucide-react'
import { PageError, useConfirm, useMayWrite } from '../../shared'
import { listPhotos, uploadPhoto, tagPhoto, deletePhoto, type Photo } from '../photos'

const TAG_PRESETS = ['hero', 'about', 'services', 'team', 'projects', 'blog', 'contact', 'misc']

export function PhotosPage() {
  const confirm = useConfirm()
  const mayEdit = useMayWrite('site:update')
  const mayDelete = useMayWrite('site:delete')
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const refresh = (tag?: string | null) => {
    setLoading(true)
    listPhotos(tag)
      .then(setPhotos)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh(activeTag) }, [activeTag])

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    // One at a time, each reported: a bad file names itself and the rest still go up.
    const failed: string[] = []
    for (const file of Array.from(files)) {
      try { await uploadPhoto(file, activeTag) } catch (e: any) { failed.push(`${file.name}: ${e.message || 'upload failed'}`) }
    }
    if (failed.length) setError(failed.join('\n'))
    setUploading(false)
    refresh(activeTag)
  }

  const updateTag = async (photo: Photo, tag: string | null) => {
    try {
      await tagPhoto(photo.id, tag)
      refresh(activeTag)
    } catch (e: any) { setError(e.message) }
  }

  const remove = async (photo: Photo) => {
    if (!(await confirm('Any section using it will show an empty space.', { title: 'Delete this photo?', confirmText: 'Delete' }))) return
    try {
      await deletePhoto(photo.id)
      setPhotos((p) => p.filter((x) => x.id !== photo.id))
    } catch (e: any) { setError(e.message) }
  }

  const copyUrl = async (photo: Photo) => {
    try {
      await navigator.clipboard.writeText(new URL(photo.url, window.location.origin).href)
      setCopiedId(photo.id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch { /* the clipboard can be refused; the button just doesn't confirm */ }
  }

  const chip = (on: boolean) => 'rounded-full px-3 py-1 text-xs font-medium ' + (on
    ? 'bg-ink text-white dark:text-slate-900'
    : 'bg-white dark:bg-slate-900 border border-line text-ink-soft hover:bg-paper')

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Photos</h1>
          <p className="text-muted text-sm mt-1">Upload, tag, and reuse images across your sections.</p>
        </div>
        {mayEdit && (
          <label className="btn-primary btn-lg cursor-pointer">
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
        )}
      </div>

      {/* Tag filter */}
      <div className="flex items-center gap-2 mb-6 flex-wrap" role="group" aria-label="Show photos tagged">
        <button type="button" onClick={() => setActiveTag(null)} aria-pressed={activeTag === null} className={chip(activeTag === null)}>All</button>
        {TAG_PRESETS.map((t) => (
          <button key={t} type="button" onClick={() => setActiveTag(t)} aria-pressed={activeTag === t} className={chip(activeTag === t)}>{t}</button>
        ))}
      </div>

      <PageError message={error} onDismiss={() => setError(null)} className="mb-4" />
      {loading && <div className="text-muted text-sm">Loading…</div>}

      {!loading && photos.length === 0 && (
        <div className="card card-padding text-center text-muted">
          {activeTag ? `No photos tagged "${activeTag}" yet.` : 'No photos yet.'}{mayEdit && ' Upload a few to get started.'}
        </div>
      )}

      {!loading && photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {photos.map((p) => (
            <div key={p.id} className="card overflow-hidden group">
              <div className="aspect-square bg-paper relative">
                <img src={p.url} alt={p.alt || ''} className="w-full h-full object-cover" />
                {/* Shown on hover, and always on a touch screen or to the keyboard (focus-within). */}
                <div className="absolute inset-x-0 bottom-0 p-2 flex justify-end gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition">
                  <button type="button" onClick={() => copyUrl(p)} className="btn-secondary btn-sm" aria-label="Copy the photo's link" title="Copy link">
                    {copiedId === p.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  {mayDelete && (
                    <button type="button" onClick={() => remove(p)} className="btn-secondary btn-sm text-red-700 dark:text-red-300" aria-label="Delete photo" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <TagIcon className="w-3 h-3 text-muted" aria-hidden="true" />
                  <select
                    value={p.tag || ''}
                    disabled={!mayEdit}
                    onChange={(e) => updateTag(p, e.target.value || null)}
                    aria-label="Tag"
                    className="text-xs bg-transparent dark:bg-transparent border-0 focus:outline-none focus:ring-0 -ml-1 text-ink-soft"
                  >
                    <option value="">untagged</option>
                    {TAG_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
                    {p.tag && !TAG_PRESETS.includes(p.tag) && <option value={p.tag}>{p.tag}</option>}
                  </select>
                </div>
                <div className="text-[11px] text-muted">
                  {p.width && p.height ? `${p.width}×${p.height}` : '—'} · {p.size ? Math.round(p.size / 1024) + ' KB' : '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
