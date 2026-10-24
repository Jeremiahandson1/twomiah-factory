// The blog list and the portfolio list: the same screen over two collections (/api/site/posts, /api/site/portfolio).
// The site admin had a copy for each.
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Edit3, Plus, Trash2 } from 'lucide-react'
import { PageError, useConfirm, useMayWrite } from '../../shared'
import { api } from '../../api'
import { DraftPill, NewItemDialog, StatusPill, useShortDate } from '../components/ui'

interface Row {
  id: string
  slug: string
  title: string
  location?: string | null
  status: 'draft' | 'published'
  updatedAt: string
  /** Saved edits not yet published (site/drafts.ts). */
  hasDraft?: boolean
}

interface Kind {
  heading: string
  intro: string
  /** /api/site/<collection> */
  collection: 'posts' | 'portfolio'
  /** Where the admin edits one: /crm/website/<route>/:slug */
  route: 'blog' | 'portfolio'
  /** Where the public site shows one: /blog/:slug, /projects/:slug */
  publicPrefix: string
  noun: string
  newLabel: string
  titlePlaceholder?: string
  emptyText: string
}

export const BLOG: Kind = {
  heading: 'Blog',
  intro: 'Write posts to bring in search traffic, share project updates, or show how you work.',
  collection: 'posts', route: 'blog', publicPrefix: '/blog/',
  noun: 'post', newLabel: 'New post',
  emptyText: 'No posts yet.',
}

export const PORTFOLIO: Kind = {
  heading: 'Portfolio',
  intro: "Show work you've done: photos, where, and the story. Each published piece gets its own page under /projects.",
  collection: 'portfolio', route: 'portfolio', publicPrefix: '/projects/',
  noun: 'project', newLabel: 'New project',
  titlePlaceholder: 'Kitchen remodel on Oak Street',
  emptyText: 'Nothing here yet.',
}

export function ArticlesListPage({ kind }: { kind: Kind }) {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const shortDate = useShortDate()
  const mayEdit = useMayWrite('site:update')
  const mayDelete = useMayWrite('site:delete')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.get(`/api/site/${kind.collection}`)
      .then((res: { data: Row[] }) => setRows(res.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [kind.collection])

  const remove = async (r: Row) => {
    if (!(await confirm(`Delete "${r.title}"? This can't be undone.`, { title: `Delete this ${kind.noun}?`, confirmText: 'Delete' }))) return
    setError(null)
    try {
      await api.delete(`/api/site/${kind.collection}/${r.slug}`)
      setRows((list) => list.filter((x) => x.id !== r.id))
    } catch (e: any) { setError(e.message) }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">{kind.heading}</h1>
          <p className="text-muted text-sm mt-1">{kind.intro}</p>
        </div>
        {mayEdit && (
          <button type="button" onClick={() => setShowNew(true)} className="btn-primary btn-md">
            <Plus className="w-4 h-4" />
            {kind.newLabel}
          </button>
        )}
      </div>

      {loading && <div className="text-muted text-sm">Loading…</div>}
      <PageError message={error} className="mb-4" />

      {!loading && rows.length === 0 && !error && (
        <div className="card card-padding text-center text-muted">
          {kind.emptyText}{mayEdit && <> Click <span className="font-semibold">{kind.newLabel}</span> to start.</>}
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="card overflow-x-auto relative">
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Title</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
                <th className="px-5 py-3 w-px"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-paper/50">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-ink">{r.title}</div>
                    <div className="text-xs text-muted mt-0.5">{kind.publicPrefix}{r.slug}{r.location ? ' · ' + r.location : ''}</div>
                  </td>
                  <td className="px-5 py-4"><div className="flex flex-wrap gap-1.5"><StatusPill on={r.status === 'published'} offLabel="Off the site" /><DraftPill on={r.hasDraft} /></div></td>
                  <td className="px-5 py-4 text-muted text-xs whitespace-nowrap">{shortDate(r.updatedAt)}</td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Link to={`/crm/website/${kind.route}/${r.slug}`} className="btn-secondary btn-sm">
                        <Edit3 className="w-3.5 h-3.5" />
                        {mayEdit ? 'Edit' : 'Open'}
                      </Link>
                      {mayDelete && (
                        <button type="button" onClick={() => remove(r)} className="btn-secondary btn-sm text-red-700 dark:text-red-300" aria-label={`Delete ${r.title}`}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <NewItemDialog
          heading={kind.newLabel}
          prefix={kind.publicPrefix}
          pattern="[a-z0-9]([a-z0-9\-]{0,80}[a-z0-9])?"
          hint="Lowercase letters, numbers and hyphens. Keep it once it's published — links to it use it."
          titlePlaceholder={kind.titlePlaceholder}
          submitLabel="Create"
          existingSlugs={rows.map((r) => r.slug)}
          duplicateMessage={`A ${kind.noun} with that address already exists.`}
          onClose={() => setShowNew(false)}
          create={async (title, slug) => {
            const created: Row = await api.post(`/api/site/${kind.collection}`, { title, slug, status: 'draft' })
            navigate(`/crm/website/${kind.route}/${created.slug}`)
          }}
        />
      )}
    </div>
  )
}
