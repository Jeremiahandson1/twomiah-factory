import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Save, ExternalLink, Plus, X } from 'lucide-react'
import { api } from '../api/client'
import { Label, TextField, TextAreaField, ImageUrlField } from '../components/Field'

interface Project {
  id: string
  slug: string
  title: string
  location: string | null
  summary: string | null
  body: string
  coverImageUrl: string | null
  photos: string[]
  status: 'draft' | 'published'
  metaTitle: string | null
  metaDescription: string | null
}

export function ProjectEditPage() {
  const { slug } = useParams<{ slug: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [originalJson, setOriginalJson] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.get<{ project: Project }>(`/api/admin/projects/${slug}`)
      .then(({ project }) => {
        const p = { ...project, photos: Array.isArray(project.photos) ? project.photos : [] }
        setProject(p); setOriginalJson(JSON.stringify(p))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  const isDirty = useMemo(() => project ? JSON.stringify(project) !== originalJson : false, [project, originalJson])
  const update = (patch: Partial<Project>) => setProject(p => p ? { ...p, ...patch } : p)
  const setPhoto = (i: number, url: string) => update({ photos: (project?.photos || []).map((u, j) => (j === i ? url : u)) })

  const save = async () => {
    if (!project) return
    setSaving(true); setError(null)
    try {
      const { project: updated } = await api.patch<{ project: Project }>(`/api/admin/projects/${slug}`, {
        title: project.title,
        location: project.location,
        summary: project.summary,
        body: project.body,
        coverImageUrl: project.coverImageUrl,
        photos: project.photos.filter(Boolean),
        status: project.status,
        metaTitle: project.metaTitle,
        metaDescription: project.metaDescription,
      })
      const p = { ...updated, photos: Array.isArray(updated.photos) ? updated.photos : [] }
      setProject(p)
      setOriginalJson(JSON.stringify(p))
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="p-8 text-muted text-sm">Loading…</div>
  if (error && !project) return <div className="p-8 text-red-700 text-sm">{error}</div>
  if (!project) return null

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-line bg-white px-6 py-3 flex items-center gap-4 shrink-0">
        <Link to="/projects" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Projects
        </Link>
        <div className="w-px h-5 bg-line" />
        <input
          type="text"
          value={project.title}
          onChange={(e) => update({ title: e.target.value })}
          className="font-display text-xl text-ink bg-transparent border-0 focus:outline-none focus:ring-0 flex-1"
          placeholder="Project title"
          aria-label="Project title"
        />
        <select value={project.status} onChange={(e) => update({ status: e.target.value as Project['status'] })} className="input" style={{ width: 'auto' }} aria-label="Status">
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        {project.status === 'published' && (
          <a href={'/projects/' + project.slug} target="_blank" rel="noreferrer" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" />
            View
          </a>
        )}
        {error && <div className="text-red-700 text-sm">{error}</div>}
        {isDirty && <span className="text-amber-700 text-xs font-semibold">Unsaved changes</span>}
        <button onClick={save} disabled={saving || !isDirty} className="btn-primary btn-md inline-flex items-center gap-1.5 disabled:opacity-40">
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl mx-auto space-y-5">
          <TextField label="Where (town or neighborhood, optional)" value={project.location || ''} onChange={(e) => update({ location: e.target.value || null })} />
          <TextAreaField label="Summary — one or two sentences shown on the project card" rows={2} value={project.summary || ''} onChange={(e) => update({ summary: e.target.value || null })} />
          <ImageUrlField label="Cover photo" value={project.coverImageUrl || ''} onChange={(v) => update({ coverImageUrl: v || null })} uploadTag="project" />

          <div>
            <Label>More photos</Label>
            <div className="space-y-3">
              {project.photos.map((url, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1"><ImageUrlField label={`Photo ${i + 1}`} value={url} onChange={(v) => setPhoto(i, v)} uploadTag="project" /></div>
                  <button type="button" onClick={() => update({ photos: project.photos.filter((_, j) => j !== i) })} className="btn-secondary btn-sm mt-6 text-red-600" aria-label={`Remove photo ${i + 1}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {project.photos.length < 40 && (
                <button type="button" onClick={() => update({ photos: [...project.photos, ''] })} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  Add a photo
                </button>
              )}
            </div>
          </div>

          <div>
            <Label>The story (markdown, optional)</Label>
            <p className="text-xs text-muted mb-2">What the customer needed, what you did, how it turned out. Supports # headings, **bold**, *italic*, [links](url) and - lists.</p>
            <textarea
              value={project.body}
              onChange={(e) => update({ body: e.target.value })}
              rows={14}
              className="input font-mono text-sm"
              aria-label="The story"
            />
          </div>

          <div className="card card-padding">
            <h2 className="text-sm font-semibold text-ink mb-3">SEO (optional, overrides defaults)</h2>
            <div className="space-y-3">
              <TextField label="Meta title" value={project.metaTitle || ''} onChange={(e) => update({ metaTitle: e.target.value || null })} />
              <TextAreaField label="Meta description" rows={2} value={project.metaDescription || ''} onChange={(e) => update({ metaDescription: e.target.value || null })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
