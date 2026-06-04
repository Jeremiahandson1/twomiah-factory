import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Edit3, Eye, EyeOff } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../api/client'

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

  useEffect(() => {
    api.get<{ pages: PageRow[] }>('/api/admin/pages')
      .then(({ pages }) => setPages(pages))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl text-ink">Pages</h1>
          <p className="text-muted text-sm mt-1">Edit content, reorder sections, manage SEO per page.</p>
        </div>
      </div>

      {loading && <div className="text-muted text-sm">Loading…</div>}
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {!loading && pages.length === 0 && (
        <div className="card card-padding text-center text-muted">
          No pages yet. Pages are normally seeded from the AI composition during the show-first preview step.
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
              {pages.map((p) => (
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
                    <Link to={`/pages/${p.slug}`} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
