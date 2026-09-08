import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Edit3, Plus, Trash2, X, Eye, EyeOff } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'
import { Label } from '../components/Field'

interface PostRow {
  id: string
  slug: string
  title: string
  excerpt: string | null
  status: 'draft' | 'published'
  coverImageUrl: string | null
  publishedAt: string | null
  updatedAt: string
}

export function PostsListPage() {
  const [posts, setPosts] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    api.get<{ posts: PostRow[] }>('/api/admin/posts')
      .then(({ posts }) => setPosts(posts))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const remove = async (p: PostRow) => {
    if (!confirm(`Delete "${p.title}"? This can't be undone.`)) return
    setError(null)
    try {
      await api.delete<{ ok: true }>(`/api/admin/posts/${p.slug}`)
      setPosts((rows) => rows.filter((r) => r.id !== p.id))
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl text-ink">Blog</h1>
          <p className="text-muted text-sm mt-1">Write posts to drive search traffic, share project updates, or document your process.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary btn-md inline-flex items-center gap-1.5">
          <Plus className="w-4 h-4" />
          New post
        </button>
      </div>

      {loading && <div className="text-muted text-sm">Loading…</div>}
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {!loading && posts.length === 0 && (
        <div className="card card-padding text-center text-muted">
          No posts yet. Click <span className="font-semibold">New post</span> to start your first.
        </div>
      )}

      {!loading && posts.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Title</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
                <th className="px-5 py-3 font-semibold w-px"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {posts.map((p) => (
                <tr key={p.id} className="hover:bg-paper/50">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-ink">{p.title}</div>
                    <div className="text-xs text-muted mt-0.5">/blog/{p.slug}</div>
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
                      <Link to={`/posts/${p.slug}`} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </Link>
                      <button onClick={() => remove(p)} className="btn-secondary btn-sm text-red-600">
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
        <NewPostModal
          existingSlugs={posts.map(p => p.slug)}
          onClose={() => setShowNew(false)}
          onCreated={(p) => { setPosts((rows) => [p, ...rows]); setShowNew(false) }}
        />
      )}
    </div>
  )
}

function NewPostModal({ existingSlugs, onClose, onCreated }: { existingSlugs: string[]; onClose: () => void; onCreated: (p: PostRow) => void }) {
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
    if (existingSlugs.includes(slug)) { setError('A post with that slug already exists.'); return }
    setSubmitting(true)
    try {
      const { post } = await api.post<{ post: PostRow }>('/api/admin/posts', { title, slug, body: '', status: 'draft' })
      onCreated(post)
      navigate(`/posts/${post.slug}`)
    } catch (e: any) { setError(e.message) }
    finally { setSubmitting(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card card-padding w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl text-ink">New post</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Title</Label>
            <input type="text" value={title} onChange={(e) => setTitleAndSlug(e.target.value)} required autoFocus className="input" />
          </div>
          <div>
            <Label>URL slug</Label>
            <div className="flex items-center gap-1">
              <span className="text-muted text-sm">/blog/</span>
              <input type="text" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true) }} pattern="[a-z0-9]([a-z0-9-]{0,80}[a-z0-9])?" required className="input" />
            </div>
            <p className="text-xs text-muted mt-1">Lowercase letters, numbers, hyphens. Permanent once published, so make it good.</p>
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
