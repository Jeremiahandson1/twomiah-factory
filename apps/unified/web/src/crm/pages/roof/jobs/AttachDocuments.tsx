// A job's quotes and invoices that are not on it yet: the homeowner's own, on no job, each with an Attach button
// (POST /api/jobs/:id/attach, server/crm/roof/jobs.ts). A quote written from the Quotes page or an invoice raised from a
// contact belongs to no job, and the job then read "No quotes" / "No invoices" beside the homeowner's QTE-00001 and
// INV-00001 (live test 2026-10-22). Shown to a seat that may change both the job and that kind of document — the server
// asks jobs:update and quotes:update / invoices:update.
import { useCallback, useEffect, useState } from 'react'
import { Link2 } from 'lucide-react'
import { api } from '../../../../api'
import { money } from '@twomiah/tenant-ui/src/money'
import { errorText, useMayWrite, useToast } from '../../../../shared'
import { formatStatus, rowsOf } from './model'

interface Doc { id: string; number?: string | null; status?: string | null; total?: string | number | null; jobId?: string | null; name?: string | null }

export default function AttachDocuments({ kind, jobId, contactId, onAttached }: {
  kind: 'quote' | 'invoice'
  jobId: string
  contactId: string | null | undefined
  /** Re-read the job: its lists and figures change. */
  onAttached: () => void
}) {
  const toast = useToast()
  const mayJob = useMayWrite('jobs:update')
  const mayDoc = useMayWrite(`${kind}s:update`)
  const [docs, setDocs] = useState<Doc[]>([])
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    if (!contactId || !mayJob || !mayDoc) { setDocs([]); return }
    try {
      const reply = await api.get(`/api/${kind}s`, { contactId, limit: 100 })
      setDocs(rowsOf<Doc>(reply).filter((d) => !d.jobId && d.status !== 'void'))
    } catch { setDocs([]) }
  }, [kind, contactId, mayJob, mayDoc])

  useEffect(() => { load() }, [load])

  if (!docs.length) return null

  const attach = async (d: Doc) => {
    setBusy(d.id)
    try {
      await api.post(`/api/jobs/${jobId}/attach`, kind === 'quote' ? { quoteId: d.id } : { invoiceId: d.id })
      toast.success(`${d.number} is on this job`)
      await load()
      onAttached()
    } catch (err) {
      toast.error(errorText(err, `Could not attach the ${kind}`))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="mt-4 border-t pt-3 dark:border-slate-700" data-testid={`attach-${kind}s`}>
      <p className="text-xs text-gray-600 mb-2 dark:text-slate-400">
        This homeowner’s {kind}s on no job — attach the one that belongs here:
      </p>
      <div className="space-y-1.5">
        {docs.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="text-gray-800 dark:text-slate-200">
              {d.number}{d.name ? ` — ${d.name}` : ''} · {formatStatus(d.status)} · {money(d.total || 0)}
            </span>
            <button type="button" onClick={() => attach(d)} disabled={busy === d.id}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-orange-300 text-orange-800 hover:bg-orange-50 disabled:opacity-50 dark:border-orange-700 dark:text-orange-200 dark:hover:bg-orange-950/40">
              <Link2 className="w-3.5 h-3.5" /> {busy === d.id ? 'Attaching…' : 'Attach'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
