// Editing one blog post or one piece of portfolio work. They share the toolbar, cover, story and SEO; a post has an
// excerpt, portfolio work a place, a summary and more photos.
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Save, ExternalLink, Plus, X } from 'lucide-react'
import { PageError, useMayWrite } from '../../shared'
import { api } from '../../api'
import { Label, TextField, TextAreaField, ImageUrlField } from '../components/Field'

interface Article {
  id: string
  slug: string
  title: string
  body: string
  coverImageUrl: string | null
  status: 'draft' | 'published'
  metaTitle: string | null
  metaDescription: string | null
  // A post:
  excerpt?: string | null
  // Portfolio work:
  location?: string | null
  summary?: string | null
  photos?: string[]
}

type KindId = 'posts' | 'portfolio'
const KINDS: Record<KindId, { back: string; backLabel: string; publicPrefix: string; titlePlaceholder: string; photoTag: string }> = {
  posts: { back: '/crm/website/blog', backLabel: 'Blog', publicPrefix: '/blog/', titlePlaceholder: 'Post title', photoTag: 'blog' },
  portfolio: { back: '/crm/website/portfolio', backLabel: 'Portfolio', publicPrefix: '/projects/', titlePlaceholder: 'Project title', photoTag: 'projects' },
}

const normalise = (a: Article): Article => (Array.isArray(a.photos) || a.photos === undefined ? a : { ...a, photos: [] })

export function ArticleEditPage({ kind }: { kind: KindId }) {
  const { slug } = useParams<{ slug: string }>()
  const k = KINDS[kind]
  const mayEdit = useMayWrite('site:update')
  const [article, setArticle] = useState<Article | null>(null)
  const [originalJson, setOriginalJson] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.get(`/api/site/${kind}/${slug}`)
      .then((a: Article) => { const n = normalise(a); setArticle(n); setOriginalJson(JSON.stringify(n)) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [kind, slug])

  const isDirty = useMemo(() => article ? JSON.stringify(article) !== originalJson : false, [article, originalJson])
  // "View" opens the public page, which exists only once it is SAVED as published.
  const savedPublished = useMemo(() => { try { return JSON.parse(originalJson).status === 'published' } catch { return false } }, [originalJson])
  useEffect(() => {
    if (!isDirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isDirty])

  const update = (patch: Partial<Article>) => setArticle((a) => a ? { ...a, ...patch } : a)
  const photos = article?.photos ?? []
  const setPhoto = (i: number, url: string) => update({ photos: photos.map((u, j) => (j === i ? url : u)) })

  const save = async () => {
    if (!article) return
    setSaving(true); setError(null)
    try {
      const shared = {
        title: article.title,
        body: article.body,
        coverImageUrl: article.coverImageUrl,
        status: article.status,
        metaTitle: article.metaTitle,
        metaDescription: article.metaDescription,
      }
      const body = kind === 'posts'
        ? { ...shared, excerpt: article.excerpt ?? null }
        : { ...shared, location: article.location ?? null, summary: article.summary ?? null, photos: photos.filter(Boolean) }
      const updated = normalise(await api.patch(`/api/site/${kind}/${slug}`, body))
      setArticle(updated)
      setOriginalJson(JSON.stringify(updated))
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  if (loading) return <div className="text-muted text-sm">Loading…</div>
  if (!article) return <PageError message={error || 'Not found'} />

  return (
    <div className="max-w-3xl mx-auto">
      <div className="card px-4 sm:px-6 py-3 mb-5 flex flex-wrap items-center gap-3 sm:gap-4">
        <Link to={k.back} className="text-muted hover:text-ink flex items-center gap-1.5 text-sm">
          <ArrowLeft className="w-4 h-4" />
          {k.backLabel}
        </Link>
        <div className="hidden sm:block w-px h-5 bg-line" />
        <input
          type="text"
          value={article.title}
          onChange={(e) => update({ title: e.target.value })}
          readOnly={!mayEdit}
          className="text-xl text-ink bg-transparent dark:bg-transparent border-0 focus:outline-none focus:ring-0 flex-1 min-w-[10rem] px-0"
          placeholder={k.titlePlaceholder}
          aria-label="Title"
        />
        <select value={article.status} disabled={!mayEdit} onChange={(e) => update({ status: e.target.value as Article['status'] })} className="input w-auto" aria-label="Status">
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        {savedPublished && (
          <a href={k.publicPrefix + article.slug} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
            <ExternalLink className="w-3.5 h-3.5" />
            View
          </a>
        )}
        {isDirty && <span className="text-amber-700 dark:text-amber-300 text-xs font-semibold">Unsaved changes</span>}
        {mayEdit && (
          <button type="button" onClick={save} disabled={saving || !isDirty} className="btn-primary btn-md disabled:opacity-40">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        <PageError message={error} className="w-full" />
      </div>

      <fieldset disabled={!mayEdit} className="space-y-5 min-w-0">
        {kind === 'portfolio' && (
          <>
            <TextField label="Where (town or neighborhood, optional)" value={article.location || ''} onChange={(e) => update({ location: e.target.value || null })} />
            <TextAreaField label="Summary — one or two sentences shown on the project card" rows={2} value={article.summary || ''} onChange={(e) => update({ summary: e.target.value || null })} />
          </>
        )}

        <ImageUrlField label={kind === 'posts' ? 'Cover image (optional)' : 'Cover photo'} value={article.coverImageUrl || ''} onChange={(v) => update({ coverImageUrl: v || null })} uploadTag={k.photoTag} />

        {kind === 'posts' && (
          <TextAreaField label="Excerpt" rows={2} value={article.excerpt || ''} onChange={(e) => update({ excerpt: e.target.value || null })} />
        )}

        {kind === 'portfolio' && (
          <div>
            <Label>More photos</Label>
            <div className="space-y-3">
              {photos.map((url, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0"><ImageUrlField label={`Photo ${i + 1}`} value={url} onChange={(v) => setPhoto(i, v)} uploadTag={k.photoTag} /></div>
                  <button type="button" onClick={() => update({ photos: photos.filter((_, j) => j !== i) })} className="btn-secondary btn-sm mt-6 text-red-700 dark:text-red-300" aria-label={`Remove photo ${i + 1}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {photos.length < 40 && (
                <button type="button" onClick={() => update({ photos: [...photos, ''] })} className="btn-secondary btn-sm">
                  <Plus className="w-3.5 h-3.5" />
                  Add a photo
                </button>
              )}
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="article-body">{kind === 'posts' ? 'Body (markdown)' : 'The story (markdown, optional)'}</Label>
          <p className="text-xs text-muted mb-2">
            {kind === 'posts'
              ? <>Supports # headings, **bold**, *italic*, [links](url), - lists, &gt; quotes, `code`, and ![images](url).</>
              : <>What the customer needed, what you did, how it turned out. Supports # headings, **bold**, *italic*, [links](url) and - lists.</>}
          </p>
          <textarea
            id="article-body"
            value={article.body}
            onChange={(e) => update({ body: e.target.value })}
            rows={kind === 'posts' ? 20 : 14}
            className="input font-mono text-sm"
          />
        </div>

        <div className="card card-padding">
          <h2 className="text-sm font-semibold text-ink mb-3">SEO (optional, overrides defaults)</h2>
          <div className="space-y-3">
            <TextField label="Meta title" value={article.metaTitle || ''} onChange={(e) => update({ metaTitle: e.target.value || null })} />
            <TextAreaField label="Meta description" rows={2} value={article.metaDescription || ''} onChange={(e) => update({ metaDescription: e.target.value || null })} />
          </div>
        </div>
      </fieldset>
    </div>
  )
}
