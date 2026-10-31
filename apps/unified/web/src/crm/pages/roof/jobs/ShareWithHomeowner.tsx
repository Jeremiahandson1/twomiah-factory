// What the homeowner sees in their portal (docs/parity/roof-portal-documents.md; roofing depth gap 10), on the job page behind
// the `portal_job_files` switch — the same switch and permission as /api/job-files: each photo, document and inspection
// report has its own on/off, off until someone with portal:share turns it on. A seat without that permission sees what is
// shared but gets no switch (the server refuses it anyway).
import { useCallback, useEffect, useState } from 'react'
import { Eye, FileText } from 'lucide-react'
import { api } from '../../../../api'
import { useMayWrite, useToast, errorText } from '../../../../shared'

interface Photo { id: string; caption: string | null; photoType: string; url: string; thumbnailUrl: string | null; shared: boolean }
interface Doc { id: string; name: string; type: string; shared: boolean }
interface Report { id: string; title: string; shared: boolean }
interface Files { photos: Photo[]; documents: Doc[]; reports: Report[] }

export default function ShareWithHomeowner({ jobId, homeowner, refreshKey }: { jobId: string; homeowner: string | null; refreshKey?: number }) {
  const toast = useToast()
  const mayShare = useMayWrite('portal:share')
  const [files, setFiles] = useState<Files | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setFiles((await api.get(`/api/job-files?jobId=${jobId}`)) as Files) } catch { setFiles(null) }
  }, [jobId])
  useEffect(() => { load() }, [load, refreshKey])

  const set = async (kind: 'photos' | 'documents' | 'reports', id: string, shared: boolean) => {
    setBusy(`${kind}-${id}`)
    try {
      await api.put(`/api/job-files/${kind}/${id}`, { shared })
      setFiles((f) => f && ({ ...f, [kind]: (f[kind] as Array<{ id: string; shared: boolean }>).map((x) => (x.id === id ? { ...x, shared } : x)) } as Files))
    } catch (e) { toast.error(errorText(e, 'Could not change what the homeowner sees')) } finally { setBusy(null) }
  }
  if (!files) return null
  const total = files.photos.length + files.documents.length + files.reports.length
  const shown = [...files.photos, ...files.documents, ...files.reports].filter((x) => x.shared).length

  const Row = ({ kind, id, label, sub, shared }: { kind: 'photos' | 'documents' | 'reports'; id: string; label: string; sub: string; shared: boolean }) => (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="min-w-0"><span className="block truncate text-gray-900 dark:text-slate-100">{label}</span><span className="block text-xs text-gray-500 dark:text-slate-400">{sub}</span></span>
      {mayShare ? (
        <label className="inline-flex items-center gap-2 shrink-0 text-gray-700 dark:text-slate-200">
          <input type="checkbox" checked={shared} disabled={busy === `${kind}-${id}`} onChange={(e) => set(kind, id, e.target.checked)} aria-label={`Show ${label} to the homeowner`} />
          Show
        </label>
      ) : <span className="text-xs text-gray-500 shrink-0 dark:text-slate-400">{shared ? 'Shown' : 'Not shown'}</span>}
    </li>
  )

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900" data-testid="share-with-homeowner">
      <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-1 dark:text-slate-100"><Eye className="w-4 h-4 text-gray-400" /> Shown in the homeowner’s portal</h2>
      <p className="text-xs text-gray-500 mb-4 dark:text-slate-400">
        {homeowner ? `${homeowner} sees` : 'The homeowner sees'} only what is ticked here, in their portal’s Photos &amp; Documents. Nothing is shown until you tick it. {total ? `${shown} of ${total} shown.` : ''}
      </p>
      {total === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">This job has no photos, documents or inspection reports yet. File documents under this job from Documents.</p>}
      {files.reports.length > 0 && <>
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500 mt-2 mb-2 dark:text-slate-400">Inspection report</h3>
        <ul className="space-y-2">{files.reports.map((r) => <Row key={r.id} kind="reports" id={r.id} label={r.title} sub="PDF" shared={r.shared} />)}</ul>
      </>}
      {files.documents.length > 0 && <>
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500 mt-4 mb-2 flex items-center gap-1 dark:text-slate-400"><FileText className="w-3 h-3" /> Documents</h3>
        <ul className="space-y-2">{files.documents.map((x) => <Row key={x.id} kind="documents" id={x.id} label={x.name} sub={x.type} shared={x.shared} />)}</ul>
      </>}
      {files.photos.length > 0 && <>
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500 mt-4 mb-2 dark:text-slate-400">Photos</h3>
        <ul className="space-y-2">
          {files.photos.map((p) => (
            <li key={p.id} className="flex items-center gap-3">
              <img src={p.thumbnailUrl || p.url} alt="" className="w-10 h-10 rounded-md object-cover shrink-0 bg-gray-100 dark:bg-slate-800" />
              <ul className="flex-1 min-w-0"><Row kind="photos" id={p.id} label={p.caption || 'Photo'} sub={p.photoType} shared={p.shared} /></ul>
            </li>
          ))}
        </ul>
      </>}
    </div>
  )
}
