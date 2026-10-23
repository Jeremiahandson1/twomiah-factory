// Editing one blog post or one piece of portfolio work. They share the toolbar, cover, story and SEO; a post has an
// excerpt, portfolio work a place, a summary and more photos. As the page editor does (components/Drafts.tsx): the
// preview shows the post as you type, Save draft keeps it off the site, Publish puts it on, and "Show on site" is its
// own switch.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Plus, X } from 'lucide-react'
import { PageError, useConfirm, useMayWrite } from '../../shared'
import { api } from '../../api'
import { Label, TextField, TextAreaField, ImageUrlField } from '../components/Field'
import { DraftActions, DraftStatus, LivePreview, PreviewToggle, PublishAllButton, useDraftEditor, useIsWide, useSiteDrafts, type DraftRow } from '../components/Drafts'

/** What the editor edits: the draft where there is one, else the live post or work. */
interface Article {
  title: string
  body: string
  coverImageUrl: string | null
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

const workingOf = (kind: KindId) => (r: DraftRow): Article => {
  const s = r.draft ?? r
  const shared = { title: s.title ?? '', body: s.body ?? '', coverImageUrl: s.coverImageUrl ?? null, metaTitle: s.metaTitle ?? null, metaDescription: s.metaDescription ?? null }
  return kind === 'posts'
    ? { ...shared, excerpt: s.excerpt ?? null }
    : { ...shared, location: s.location ?? null, summary: s.summary ?? null, photos: Array.isArray(s.photos) ? s.photos : [] }
}
const TO_WORKING = { posts: workingOf('posts'), portfolio: workingOf('portfolio') }

export function ArticleEditPage({ kind }: { kind: KindId }) {
  const { slug } = useParams<{ slug: string }>()
  const k = KINDS[kind]
  const confirm = useConfirm()
  const mayEdit = useMayWrite('site:update')
  const wide = useIsWide()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [previewOnPhone, setPreviewOnPhone] = useState(false)
  const [switching, setSwitching] = useState(false)
  /** Off the site and never published: Publish puts it on, unless this is cleared. */
  const [showOnPublish, setShowOnPublish] = useState(false)

  const ed = useDraftEditor<Article>({
    row: null,
    toWorking: TO_WORKING[kind],
    save: (a) => {
      const shared = { title: a.title, body: a.body, coverImageUrl: a.coverImageUrl, metaTitle: a.metaTitle, metaDescription: a.metaDescription }
      return api.patch(`/api/site/${kind}/${slug}`, kind === 'posts'
        ? { ...shared, excerpt: a.excerpt ?? null }
        : { ...shared, location: a.location ?? null, summary: a.summary ?? null, photos: (a.photos ?? []).filter(Boolean) })
    },
    publish: (show) => api.post(`/api/site/${kind}/${slug}/publish`, show ? { show: true } : {}),
    discard: () => api.delete(`/api/site/${kind}/${slug}/draft`),
    autosave: mayEdit,
  })
  const drafts = useSiteDrafts()
  const settingsDraft = !!drafts.items?.some((i) => i.kind === 'settings')

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    api.get(`/api/site/${kind}/${slug}`)
      .then((a: DraftRow) => { ed.adopt(a); setShowOnPublish(a.status !== 'published' && !a.publishedAt) })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, slug])

  const article = ed.value
  const row = ed.row
  const update = (patch: Partial<Article>) => ed.update((a) => ({ ...a, ...patch }))
  const photos = article?.photos ?? []
  const setPhoto = (i: number, url: string) => update({ photos: photos.map((u, j) => (j === i ? url : u)) })

  /** "Show on site": at once, on its own — it neither saves nor publishes the edits. */
  const setShown = async (shown: boolean) => {
    if (!shown && !(await confirm(`Visitors can't open it until you show it again. Your edits are kept.`, { title: `Take this ${kind === 'posts' ? 'post' : 'project'} off your site?`, confirmText: 'Take it off' }))) return
    setSwitching(true)
    ed.setError(null)
    try {
      ed.setRow(await api.patch(`/api/site/${kind}/${slug}`, { status: shown ? 'published' : 'draft' }))
      if (shown) setShowOnPublish(false)
    } catch (e: any) { ed.setError(e.message) } finally { setSwitching(false) }
  }

  if (loading) return <div className="text-muted text-sm">Loading…</div>
  if (!article || !row) return <PageError message={loadError || 'Not found'} />

  const onSite = row.status === 'published'
  const preview = wide || previewOnPhone

  return (
    <div className="max-w-[100rem] mx-auto">
      <div className="card px-4 sm:px-6 py-3 mb-5 space-y-3">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
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
          <DraftStatus isDirty={ed.isDirty} hasDraft={ed.hasDraft} saving={ed.saving} justPublished={ed.justPublished} />
          <PreviewToggle on={previewOnPhone} onChange={setPreviewOnPhone} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-ink" title="Whether visitors can open it at all. Separate from publishing your edits.">
            <input type="checkbox" role="switch" aria-checked={onSite} checked={onSite} disabled={!mayEdit || switching} onChange={(e) => setShown(e.target.checked)} className="rounded border-line" />
            Show on site
          </label>
          <span className="text-xs text-muted">{onSite ? `Visitors can open it at ${k.publicPrefix}${row.slug}.` : "Off the site: visitors can't open it."}</span>
          {mayEdit && (
            <div className="sm:ml-auto flex flex-wrap items-center gap-2">
              <PublishAllButton changed={ed.isDirty || ed.saving || ed.hasDraft} current={{ kind: kind === 'posts' ? 'post' : 'portfolio', slug: row.slug }} drafts={drafts} beforeOpen={ed.saveNow} onPublished={() => api.get(`/api/site/${kind}/${slug}`).then(ed.adopt)} />
              <DraftActions ed={ed} noun={kind === 'posts' ? 'post' : 'project'} offSite={!onSite} show={showOnPublish} setShow={setShowOnPublish} showLabel="Also show it on the site" />
            </div>
          )}
        </div>
        <PageError message={ed.error} className="w-full" />
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6 lg:items-start">
      <div className={previewOnPhone ? 'hidden lg:block' : ''}>
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

      {preview && (
        <LivePreview
          kind={kind === 'posts' ? 'post' : 'portfolio'}
          slug={row.slug}
          data={mayEdit ? article : null}
          label={ed.isDirty || ed.hasDraft ? 'Preview of your changes' : 'Preview'}
          publicHref={onSite ? k.publicPrefix + row.slug : null}
          settingsDraft={settingsDraft}
          className={`card overflow-hidden ${wide ? 'lg:sticky lg:top-4 h-[calc(100vh-10rem)]' : 'h-[calc(100svh-12rem)] min-h-[24rem]'}`}
        />
      )}
      </div>
    </div>
  )
}
