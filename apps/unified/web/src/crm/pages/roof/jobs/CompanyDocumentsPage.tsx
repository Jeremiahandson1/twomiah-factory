// Settings › Documents for every homeowner (roofing parity row 22; AccuLynx company documents; portal_posts_packets, not ready). The
// company's own documents — warranty terms, brochures, uploaded in Documents with no job or customer — and whether every homeowner's
// portal shows each, under "From <company>". Server: crm/roof/portalFiles/office.ts (/api/job-files/company-documents).
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../../api'
import { useMayWrite, useToast } from '../../../../shared'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback

export default function CompanyDocumentsPage() {
  const toast = useToast()
  const mayShare = useMayWrite('portal:share')
  const [rows, setRows] = useState<Array<{ id: string; name: string; type: string; shared: boolean }> | null>(null)
  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/job-files/company-documents'); setRows(Array.isArray(r?.data) ? r.data : []) } catch (e) { toast.error(errorText(e, 'Could not load the documents')); setRows([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  const set = async (id: string, shared: boolean) => {
    try { await api.put(`/api/job-files/company-documents/${id}`, { shared }); setRows((r) => r && r.map((x) => (x.id === id ? { ...x, shared } : x))) }
    catch (e) { toast.error(errorText(e, 'Could not change it')) }
  }
  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Documents for every homeowner</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">Your own documents — warranty terms, brochures — that every homeowner’s portal shows. Upload them in Documents without a job or customer, then tick them here.</p>
      </div>
      {!rows ? <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p> : rows.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No company documents yet.</p> : (
        <ul className="divide-y rounded border dark:divide-slate-700 dark:border-slate-700">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span>{d.name} <span className="text-xs text-gray-500 dark:text-slate-400">· {codeLabel(d.type)}</span></span>
              {mayShare ? <label className="flex items-center gap-2"><input type="checkbox" checked={d.shared} onChange={(e) => set(d.id, e.target.checked)} />Show every homeowner</label> : <span className="text-xs text-gray-500 dark:text-slate-400">{d.shared ? 'Shown' : 'Not shown'}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
