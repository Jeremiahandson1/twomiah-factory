// Portal visits (landscaping): the visits that are done, each with the crew's note and the after-photos. Read-only. The backend
// offers this section only to a business that has turned visit messages on (portal.ts, deps.visits).
import React, { useState, useEffect } from 'react'
import { Camera } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, card, formatDate } from './common'

export interface PortalVisit {
  jobId: string; title: string; completedAt: string | null; note: string | null
  photos: Array<{ id: string; caption: string | null; url: string }>
}

export function PortalVisits() {
  const { config, fetch: portalFetch } = usePortal()
  const [visits, setVisits] = useState<PortalVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/visits').then((d) => setVisits(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  if (loading) return <Spinner />
  return (
    <div>
      <PageTitle title={config.labels.visits} subtitle="Finished visits, with a note from the crew and photos of the work." />
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {visits.length === 0 ? <Empty icon={Camera} text="No finished visits to show yet." /> : (
        <div className="space-y-4">
          {visits.map((v) => (
            <div key={v.jobId} className={`${card} p-5`}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-gray-900 dark:text-slate-100">{v.title}</h3>
                {v.completedAt && <span className="text-sm text-gray-500 dark:text-slate-400">{formatDate(v.completedAt)}</span>}
              </div>
              {v.note && <p className="mt-2 text-sm text-gray-700 dark:text-slate-300 whitespace-pre-line">{v.note}</p>}
              {v.photos.length > 0 && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {v.photos.map((p) => (
                    <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                      <img src={p.url} alt={p.caption || `After photo — ${v.title}`} loading="lazy" className="w-full aspect-square object-cover rounded-lg border border-gray-200 dark:border-slate-700" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
