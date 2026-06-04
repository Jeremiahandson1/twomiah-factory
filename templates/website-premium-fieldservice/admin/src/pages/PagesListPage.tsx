import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Edit3, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { Label } from '../components/Field'

interface PageRow {
  id: string
  slug: string
  title: string
  isPublished: boolean
  navOrder: number
  updatedAt: string
}

export function PagesListPage() {
  const [pages, setPages] = useState<PageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    api.get<{ pages: PageRow[] }>('/api/admin/pages')
      .then(({ pages }) => setPages(pages))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const remove = async (p: PageRow) => {
    if (p.slug === 'home') return
    if (!confirm(`Delete "${p.title}"? This can't be undone.`)) return
    setError(null)
    try {
      await api.delete<{ ok: true }>(`/api/admin/pages/${p.slug}`)
      setPages((rows) => rows.filter((r) => r.id !== p.id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl text-ink">Pages</h1>
          <p className="text-muted text-sm mt-1">Edit content, reorder sections, manage SEO per page.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary btn-md inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          New page
        </button>
      </div>

      {loading && <div className="text-muted text-sm">Loading…</div>}
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {!loading && pages.length === 0 && (
        <div className="card card-padding text-center text-muted">
          No pages yet. Click <span className="font-semibold">New page</span> to add one, or wait for the AI composition to seed the standard pages.
        </div>
      )}

      {!loading && pages.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Page</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
                <th className="px-5 py-3 font-semibold w-px"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pages.map((p) => {
                const isHome = p.slug === 'home'
                return (
                  <tr key={p.id} className="hover:bg-paper/50">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-ink">{p.title}</div>
                      <div className="text-xs text-muted mt-0.5">/{p.slug}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={clsx(
                        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
                        p.isPublished ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'
                      )}>
                        {p.isPublished ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        {p.isPublished ? 'Published' : 'Hidden'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-muted text-xs">
                      {new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link to={`/pages/${p.slug}`} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit
                        </Link>
                        <button
                          onClick={() => remove(p)}
                          disabled={isHome}
                          className="btn-secondary btn-sm text-red-600 disabled:opacity-30"
                          title={isHome ? "Home can't be deleted — hide it via Published toggle if needed." : ''}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewPageModal
          existingSlugs={pages.map((p) => p.slug)}
          onClose={() => setShowNew(false)}
          onCreated={(p) => { setPages((rows) => [...rows, p]); setShowNew(false) }}
        />
      )}
    </div>
  )
}

function NewPageModal({ existingSlugs, onClose, onCreated }: {
  existingSlugs: string[]
  onClose: () => void
  onCreated: (p: PageRow) => void
}) {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setTitleAndSlug = (next: string) => {
    setTitle(next)
    if (!slugTouched) {
      setSlug(next.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (existingSlugs.includes(slug)) {
      setError('A page with that slug already exists.')
      return
    }
    setSubmitting(true)
    try {
      const { page } = await api.post<{ page: PageRow }>('/api/admin/pages', {
        slug, title, sections: [], isPublished: true,
      })
      onCreated(page)
      navigate(`/pages/${page.slug}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card card-padding w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl text-ink">New page</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Title</Label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitleAndSlug(e.target.value)}
              placeholder="e.g. Service Areas"
              required
              autoFocus
              className="input"
            />
          </div>
          <div>
            <Label>URL slug</Label>
            <div className="flex items-center gap-1">
              <span className="text-muted text-sm">/</span>
              <input
                type="text"
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }}
                pattern="[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?"
                placeholder="service-areas"
                required
                className="input"
              />
            </div>
            <p className="text-xs text-muted mt-1">
              Lowercase letters, numbers, and hyphens. Becomes <span className="font-mono">/{slug || 'your-slug'}</span> on the public site.
            </p>
          </div>

          {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
            <button type="submit" disabled={submitting || !title || !slug} className="btn-primary btn-md disabled:opacity-40">
              {submitting ? 'Creating…' : 'Create page'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
