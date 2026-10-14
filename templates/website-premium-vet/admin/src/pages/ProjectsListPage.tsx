import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Edit3, Plus, Trash2, X, Eye, EyeOff } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { Label } from '../components/Field'

interface ProjectRow {
  id: string
  slug: string
  title: string
  location: string | null
  status: 'draft' | 'published'
  coverImageUrl: string | null
  updatedAt: string
}

export function ProjectsListPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    api.get<{ projects: ProjectRow[] }>('/api/admin/projects')
      .then(({ projects }) => setProjects(projects))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const remove = async (p: ProjectRow) => {
    if (!confirm(`Delete "${p.title}"? This can't be undone.`)) return
    setError(null)
    try {
      await api.delete<{ ok: true }>(`/api/admin/projects/${p.slug}`)
      setProjects((rows) => rows.filter((r) => r.id !== p.id))
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl text-ink">Projects</h1>
          <p className="text-muted text-sm mt-1">Show jobs you've done — photos, where, and the story. Each published project gets its own page under /projects.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary btn-md inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          New project
        </button>
      </div>

      {loading && <div className="text-muted text-sm">Loading…</div>}
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {!loading && projects.length === 0 && (
        <div className="card card-padding text-center text-muted">
          No projects yet. Click <span className="font-semibold">New project</span> to add your first job.
        </div>
      )}

      {!loading && projects.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Project</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
                <th className="px-5 py-3 font-semibold w-px"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {projects.map((p) => (
                <tr key={p.id} className="hover:bg-paper/50">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-ink">{p.title}</div>
                    <div className="text-xs text-muted mt-0.5">/projects/{p.slug}{p.location ? ' · ' + p.location : ''}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span className={clsx(
                      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
                      p.status === 'published' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'
                    )}>
                      {p.status === 'published' ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      {p.status === 'published' ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-muted text-xs">
                    {new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link to={`/projects/${p.slug}`} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </Link>
                      <button onClick={() => remove(p)} className="btn-secondary btn-sm text-red-600" aria-label={`Delete ${p.title}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewProjectModal
          existingSlugs={projects.map(p => p.slug)}
          onClose={() => setShowNew(false)}
          onCreated={(p) => { setProjects((rows) => [p, ...rows]); setShowNew(false) }}
        />
      )}
    </div>
  )
}

function NewProjectModal({ existingSlugs, onClose, onCreated }: { existingSlugs: string[]; onClose: () => void; onCreated: (p: ProjectRow) => void }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setTitleAndSlug = (next: string) => {
    setTitle(next)
    if (!slugTouched) setSlug(next.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (existingSlugs.includes(slug)) { setError('A project with that URL already exists.'); return }
    setSubmitting(true)
    try {
      const { project } = await api.post<{ project: ProjectRow }>('/api/admin/projects', { title, slug, status: 'draft' })
      onCreated(project)
      navigate(`/projects/${project.slug}`)
    } catch (e: any) { setError(e.message) }
    finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card card-padding w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl text-ink">New project</h2>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Title</Label>
            <input type="text" value={title} onChange={(e) => setTitleAndSlug(e.target.value)} required autoFocus className="input" placeholder="Kitchen remodel on Oak Street" />
          </div>
          <div>
            <Label>URL</Label>
            <div className="flex items-center gap-1">
              <span className="text-muted text-sm">/projects/</span>
              <input type="text" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} pattern="[a-z0-9]([a-z0-9-]{0,80}[a-z0-9])?" required className="input" />
            </div>
            <p className="text-xs text-muted mt-1">Lowercase letters, numbers, hyphens.</p>
          </div>
          {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
            <button type="submit" disabled={submitting || !title || !slug} className="btn-primary btn-md disabled:opacity-40">
              {submitting ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
