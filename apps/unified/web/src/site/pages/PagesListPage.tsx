import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Edit3, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { PageError, useConfirm, useMayWrite } from '../../shared'
import { api } from '../../api'
import { NewItemDialog, StatusPill, useShortDate } from '../components/ui'

interface PageRow {
  id: string
  slug: string
  title: string
  isPublished: boolean
  navOrder: number
  updatedAt: string
}

export function PagesListPage() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const shortDate = useShortDate()
  const mayEdit = useMayWrite('site:update')
  const mayDelete = useMayWrite('site:delete')
  const [pages, setPages] = useState<PageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const load = () => api.get('/api/site/pages')
    .then((res: { data: PageRow[] }) => setPages(res.data))
    .catch((e) => setError(e.message))
    .finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const swapOrder = async (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= pages.length) return
    // Numbered afresh in the order wanted, saving only the pages whose number changed. Swapping the pair's numbers
    // did nothing when they shared one, and new pages all start at 100.
    const previous = pages
    const order = [...pages]
    ;[order[i], order[j]] = [order[j], order[i]]
    const next = order.map((p, k) => ({ ...p, navOrder: (k + 1) * 10 }))
    const changed = next.filter((p) => previous.find((q) => q.id === p.id)?.navOrder !== p.navOrder)
    setPages(next)
    setError(null)
    try {
      await Promise.all(changed.map((p) => api.patch(`/api/site/pages/${p.slug}`, { navOrder: p.navOrder })))
    } catch (e: any) {
      // Some may have saved: show what the server now holds.
      setError(e.message)
      load()
    }
  }

  const remove = async (p: PageRow) => {
    if (p.slug === 'home') return
    if (!(await confirm(`Delete "${p.title}"? This can't be undone.`, { title: 'Delete this page?', confirmText: 'Delete' }))) return
    setError(null)
    try {
      await api.delete(`/api/site/pages/${p.slug}`)
      setPages((rows) => rows.filter((r) => r.id !== p.id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Pages</h1>
          <p className="text-muted text-sm mt-1">Edit content, reorder sections, manage SEO per page.</p>
        </div>
        {mayEdit && (
          <button type="button" onClick={() => setShowNew(true)} className="btn-primary btn-md">
            <Plus className="w-4 h-4" />
            New page
          </button>
        )}
      </div>

      {loading && <div className="text-muted text-sm">Loading…</div>}
      <PageError message={error} className="mb-4" />

      {!loading && pages.length === 0 && !error && (
        <div className="card card-padding text-center text-muted">
          No pages yet.{mayEdit && <> Click <span className="font-semibold">New page</span> to add one.</>}
        </div>
      )}

      {!loading && pages.length > 0 && (
        <div className="card overflow-x-auto relative">
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                {mayEdit && <th className="px-2 py-3 w-px"><span className="sr-only">Order</span></th>}
                <th className="px-5 py-3 font-semibold">Page</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Updated</th>
                <th className="px-5 py-3 w-px"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pages.map((p, i) => {
                const isHome = p.slug === 'home'
                return (
                  <tr key={p.id} className="hover:bg-paper/50">
                    {mayEdit && (
                      <td className="px-2 py-4 w-px">
                        <div className="flex flex-col gap-0.5">
                          <button type="button" onClick={() => swapOrder(i, -1)} disabled={i === 0} className="text-muted hover:text-ink disabled:opacity-30 disabled:cursor-default" aria-label={`Move ${p.title} up`}>
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => swapOrder(i, 1)} disabled={i === pages.length - 1} className="text-muted hover:text-ink disabled:opacity-30 disabled:cursor-default" aria-label={`Move ${p.title} down`}>
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                    <td className="px-5 py-4">
                      <div className="font-semibold text-ink">{p.title}</div>
                      <div className="text-xs text-muted mt-0.5">/{isHome ? '' : p.slug}</div>
                    </td>
                    <td className="px-5 py-4"><StatusPill on={p.isPublished} offLabel="Hidden" /></td>
                    <td className="px-5 py-4 text-muted text-xs whitespace-nowrap">{shortDate(p.updatedAt)}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link to={`/crm/website/pages/${p.slug}`} className="btn-secondary btn-sm">
                          <Edit3 className="w-3.5 h-3.5" />
                          {mayEdit ? 'Edit' : 'Open'}
                        </Link>
                        {mayDelete && !isHome && (
                          <button type="button" onClick={() => remove(p)} className="btn-secondary btn-sm text-red-700 dark:text-red-300" aria-label={`Delete ${p.title}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
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
        <NewItemDialog
          heading="New page"
          prefix="/"
          pattern="[a-z0-9]([a-z0-9\-]{0,62}[a-z0-9])?"
          hint="Lowercase letters, numbers, and hyphens."
          titlePlaceholder="e.g. Our Team"
          slugPlaceholder="our-team"
          submitLabel="Create page"
          existingSlugs={pages.map((p) => p.slug)}
          duplicateMessage="A page with that address already exists."
          onClose={() => setShowNew(false)}
          create={async (title, slug) => {
            const created: PageRow = await api.post('/api/site/pages', { slug, title, sections: [], isPublished: true })
            navigate(`/crm/website/pages/${created.slug}`)
          }}
        />
      )}
    </div>
  )
}
