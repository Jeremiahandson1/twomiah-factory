import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Save, ExternalLink } from 'lucide-react'
import { api } from '../api/client'
import { Label, TextField, TextAreaField, ImageUrlField } from '../components/Field'

interface Post {
  id: string
  slug: string
  title: string
  excerpt: string | null
  body: string
  coverImageUrl: string | null
  status: 'draft' | 'published'
  metaTitle: string | null
  metaDescription: string | null
  publishedAt: string | null
}

export function PostEditPage() {
  const { slug } = useParams<{ slug: string }>()
  const [post, setPost] = useState<Post | null>(null)
  const [originalJson, setOriginalJson] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.get<{ post: Post }>(`/api/admin/posts/${slug}`)
      .then(({ post }) => { setPost(post); setOriginalJson(JSON.stringify(post)) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  const isDirty = useMemo(() => post ? JSON.stringify(post) !== originalJson : false, [post, originalJson])
  const update = (patch: Partial<Post>) => setPost(p => p ? { ...p, ...patch } : p)

  const save = async () => {
    if (!post) return
    setSaving(true); setError(null)
    try {
      const { post: updated } = await api.patch<{ post: Post }>(`/api/admin/posts/${slug}`, {
        title: post.title,
        excerpt: post.excerpt,
        body: post.body,
        coverImageUrl: post.coverImageUrl,
        status: post.status,
        metaTitle: post.metaTitle,
        metaDescription: post.metaDescription,
      })
      setPost(updated)
      setOriginalJson(JSON.stringify(updated))
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="p-8 text-muted text-sm">Loading…</div>
  if (error && !post) return <div className="p-8 text-red-700 text-sm">{error}</div>
  if (!post) return null

  const publicHref = '/blog/' + post.slug

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-line bg-white px-6 py-3 flex items-center gap-4 shrink-0">
        <Link to="/posts" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm">
          <ArrowLeft className="w-4 h-4" />
          Posts
        </Link>
        <div className="w-px h-5 bg-line" />
        <input
          type="text"
          value={post.title}
          onChange={(e) => update({ title: e.target.value })}
          className="font-display text-xl text-ink bg-transparent border-0 focus:outline-none focus:ring-0 flex-1"
          placeholder="Post title"
        />
        <select value={post.status} onChange={(e) => update({ status: e.target.value as Post['status'] })} className="input" style={{ width: 'auto' }}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        {post.status === 'published' && (
          <a href={publicHref} target="_blank" rel="noreferrer" className="btn-secondary btn-sm inline-flex items-center gap-1.5">
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
          <ImageUrlField label="Cover image (optional)" value={post.coverImageUrl || ''} onChange={(v) => update({ coverImageUrl: v })} uploadTag="blog" />

          <TextAreaField label="Excerpt" rows={2} value={post.excerpt || ''} onChange={(e) => update({ excerpt: e.target.value })} />

          <div>
            <Label>Body (markdown)</Label>
            <p className="text-xs text-muted mb-2">Supports # headings, **bold**, *italic*, [links](url), - lists, &gt; quotes, `code`, and ![images](url).</p>
            <textarea
              value={post.body}
              onChange={(e) => update({ body: e.target.value })}
              rows={20}
              className="input font-mono text-sm"
              placeholder="Write your post here. Markdown is rendered at request time on the public site."
            />
          </div>

          <div className="card card-padding">
            <h2 className="text-sm font-semibold text-ink mb-3">SEO (optional, overrides defaults)</h2>
            <div className="space-y-3">
              <TextField label="Meta title" value={post.metaTitle || ''} onChange={(e) => update({ metaTitle: e.target.value || null })} />
              <TextAreaField label="Meta description" rows={2} value={post.metaDescription || ''} onChange={(e) => update({ metaDescription: e.target.value || null })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
