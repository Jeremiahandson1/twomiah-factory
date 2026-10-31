// "Photos & Documents": what the business chose to show this homeowner of their own jobs — photos, the contract, the
// inspection report, the warranty. The server decides what is shared (GET /job-files answers only that, for this customer's
// own jobs); this page draws it, grouped by job. A photo opens full size; a document or report downloads.
import React, { useEffect, useState } from 'react'
import { FileText, Download, Images } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, Section, card, formatDate } from './common'

interface Item {
  kind: 'photo' | 'document' | 'report'
  id: string
  jobId: string
  jobNumber: string
  jobTitle: string
  jobAddress?: string | null
  name: string
  /** A document's kind (contract, warranty, inspection…) — a photo's is before / damage / during / after. */
  type?: string | null
  mimeType?: string | null
  takenAt?: string | null
  createdAt?: string | null
}

const TYPE_LABELS: Record<string, string> = { contract: 'Contract', warranty: 'Warranty', inspection: 'Inspection', permit: 'Permit', insurance: 'Insurance', scope: 'Scope of work', invoice: 'Invoice', receipt: 'Receipt', general: 'Document', other: 'Document', report: 'Inspection report' }
const PHOTO_LABELS: Record<string, string> = { before: 'Before', during: 'During', after: 'After', damage: 'Damage', general: 'Photo' }

export function PortalJobFiles() {
  const { fetch: portalFetch, url, config } = usePortal()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    portalFetch('/job-files').then((d) => setItems(Array.isArray(d?.data) ? d.data : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false))
  }, [portalFetch])
  if (loading) return <Spinner />

  const jobs: Array<{ id: string; number: string; title: string; address?: string | null; items: Item[] }> = []
  for (const it of items) {
    let g = jobs.find((j) => j.id === it.jobId)
    if (!g) { g = { id: it.jobId, number: it.jobNumber, title: it.jobTitle, address: it.jobAddress, items: [] }; jobs.push(g) }
    g.items.push(it)
  }
  const fileUrl = (it: Item) => url(`/job-files/${it.kind}/${it.id}/file`)
  const docLabel = (it: Item) => (it.kind === 'report' ? TYPE_LABELS.report : config.docTypeLabels[it.type || ''] || TYPE_LABELS[it.type || ''] || 'Document')

  return (
    <div>
      <PageTitle title={config.labels.jobFiles} subtitle={`The photos and documents your ${config.providerNoun} has shared with you.`} />
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {jobs.length === 0 && !error ? <Empty icon={Images} text="Nothing has been shared with you yet." /> : (
        <div className="space-y-8">
          {jobs.map((job) => {
            const photos = job.items.filter((i) => i.kind === 'photo')
            const docs = job.items.filter((i) => i.kind !== 'photo')
            return (
              <Section key={job.id} title={<>{job.number} — {job.title}{job.address ? <span className="ml-2 text-sm font-normal text-gray-500 dark:text-slate-400">{job.address}</span> : null}</>}>
                {docs.length > 0 && (
                  <ul className="space-y-2 mb-4">
                    {docs.map((d) => (
                      <li key={`${d.kind}-${d.id}`} className={`${card} p-3 flex items-center justify-between gap-3`}>
                        <span className="flex items-center gap-3 min-w-0">
                          <FileText className="w-5 h-5 text-gray-500 shrink-0 dark:text-slate-400" />
                          <span className="min-w-0">
                            <span className="block font-medium text-gray-900 truncate dark:text-slate-100">{d.name}</span>
                            <span className="block text-xs text-gray-500 dark:text-slate-400">{docLabel(d)}{d.createdAt ? ` · ${formatDate(d.createdAt)}` : ''}</span>
                          </span>
                        </span>
                        <a href={fileUrl(d)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-orange-700 hover:underline shrink-0 dark:text-orange-200" aria-label={`Download ${d.name}`}>
                          <Download className="w-4 h-4" /> Download
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {photos.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {photos.map((p) => (
                      <a key={p.id} href={fileUrl(p)} target="_blank" rel="noopener noreferrer" className={`${card} overflow-hidden block`} aria-label={`Open photo: ${p.name}`}>
                        <img src={fileUrl(p)} alt={p.name} loading="lazy" className="w-full aspect-square object-cover bg-gray-100 dark:bg-slate-800" />
                        <span className="block px-2 py-1.5 text-xs text-gray-600 dark:text-slate-300">
                          <span className="block truncate">{p.name}</span>
                          <span className="block text-gray-500 dark:text-slate-400">{PHOTO_LABELS[p.type || 'general'] || 'Photo'}{p.takenAt ? ` · ${formatDate(p.takenAt)}` : ''}</span>
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </Section>
            )
          })}
        </div>
      )}
    </div>
  )
}
