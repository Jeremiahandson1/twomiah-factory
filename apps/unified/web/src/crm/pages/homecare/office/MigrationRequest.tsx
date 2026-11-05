// Assisted migration (parity row 10, care_migration): send the old system's export to Twomiah, who load it with the same importer
// (Import from a spreadsheet) and hand it back checked. The agency types what the old system showed so the counts can be compared,
// and ticks its side of the sign-off checklist.
//   GET/POST /api/care-migration/requests   GET /requests/:id   PUT /requests/:id/old-counts   GET /requests/:id/comparison
//   PUT /requests/:id/signoff   POST /requests/:id/cancel   GET /checklist     (server/crm/homecare/office/migration.ts)
import { useCallback, useEffect, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, errorMessage, rows } from '../lib/http'
import { formatAgencyDateTime } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'

interface FileMeta { id: string; name: string; size: number; uploadedAt: string }
interface Signoff { by: string; side: 'agency' | 'staff'; at: string }
interface ChecklistItem { id: string; label: string; who: 'agency' | 'staff' | 'either'; signoff: Signoff | null }
interface Batch { id: string; kind: string; fileName: string | null; created: number; updated: number; attached: number; failed: number; skippedDuplicates: number; status: string; createdAt: string; createdBy: string | null }
interface Request {
  id: string; status: string; statusLabel: string; fromSystem: string | null; note: string | null; staffNote: string | null; oldCounts: Record<string, number> | null
  createdAt: string; files: FileMeta[]; batches: Batch[]; checklist: ChecklistItem[]
}
interface Comparison { kind: string; label: string; old: number | null; now: number; difference: number | null }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const muted = 'text-gray-600 dark:text-slate-400'
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const WHO: Record<ChecklistItem['who'], string> = { agency: 'the agency', staff: 'Twomiah', either: 'either side' }

export default function MigrationRequest() {
  const may = useMay('care-clients')
  const toast = useToast()
  const confirm = useConfirm()
  const [list, setList] = useState<Request[]>([])
  const [open, setOpen] = useState<Request | null>(null)
  const [comparison, setComparison] = useState<Comparison[]>([])
  const [counted, setCounted] = useState<Array<{ kind: string; label: string }>>([])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [fromSystem, setFromSystem] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setList(rows<Request>(await api.get('/api/care-migration/requests'))) } catch (e) { toast.error(errorMessage(e)) }
  }, [toast])
  useEffect(() => {
    load()
    api.get('/api/care-migration/checklist').then((r: any) => setCounted(r.counted ?? [])).catch(() => {})
  }, [load])

  const show = async (id: string) => {
    try {
      const r = await api.get(`/api/care-migration/requests/${id}`) as Request
      setOpen(r)
      setCounts(Object.fromEntries(Object.entries(r.oldCounts ?? {}).map(([k, v]) => [k, String(v)])))
      setComparison(rows<Comparison>(await api.get(`/api/care-migration/requests/${id}/comparison`)))
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const send = async () => {
    if (!files.length) { toast.error('Attach at least one export file.'); return }
    setBusy(true)
    try {
      const form = new FormData()
      for (const f of files) form.append('files', f)
      form.set('fromSystem', fromSystem); form.set('note', note)
      const r = await api.upload('/api/care-migration/requests', form) as Request
      toast.success('Sent to Twomiah')
      setFiles([]); setFromSystem(''); setNote('')
      await load(); await show(r.id)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const saveCounts = async () => {
    if (!open) return
    try {
      const r = await api.put(`/api/care-migration/requests/${open.id}/old-counts`, { counts }) as Request
      setOpen(r); setComparison(rows<Comparison>(await api.get(`/api/care-migration/requests/${open.id}/comparison`)))
      toast.success('Counts saved')
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const tick = async (item: ChecklistItem, done: boolean) => {
    if (!open) return
    try { setOpen(await api.put(`/api/care-migration/requests/${open.id}/signoff`, { item: item.id, done }) as Request) } catch (e) { toast.error(errorMessage(e)) }
  }
  const cancel = async () => {
    if (!open || !(await confirm('Cancel this request? Twomiah will stop working on it; anything already loaded stays until you undo it under Import from a spreadsheet.', { confirmText: 'Cancel request' }))) return
    try { setOpen(await api.post(`/api/care-migration/requests/${open.id}/cancel`, {}) as Request); load() } catch (e) { toast.error(errorMessage(e)) }
  }

  if (!may.create) return <div className={`p-4 text-sm ${muted}`}>You do not have access to the assisted migration.</div>

  return (
    <div className="p-4 max-w-5xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Let Twomiah load your old system&apos;s data</h1>
      <p className={`text-sm mb-4 ${muted}`}>
        Export everything you can from your old system (clients, caregivers, schedules, authorizations, payers, past invoices, certifications, documents) and send it here.
        Twomiah staff load it with the same importer you have under Import from a spreadsheet — dry run first — and both of you tick the checklist before you go live.
        Anything loaded can be undone there.
      </p>

      <div className="rounded-lg border p-3 mb-6 border-gray-200 dark:border-slate-700">
        <h2 className="text-base font-semibold mb-2">Send an export</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">Your old system<br /><input className={inp} placeholder="AxisCare, WellSky, a spreadsheet…" value={fromSystem} onChange={(e) => setFromSystem(e.target.value)} /></label>
          <label className="text-sm">Files (CSV, Excel, zip — up to 10, each under 20 MB)<br /><input type="file" multiple className={inp} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>
        </div>
        <label className="text-sm block mt-2">Anything Twomiah should know<br /><textarea className={`${inp} w-full h-20`} placeholder="Dates are day/month. The caregiver file has two sheets. Payers are in the clients file." value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button type="button" className="hc-btn hc-btn-primary hc-btn-sm mt-2" disabled={busy || !files.length} onClick={send}>Send to Twomiah</button>
      </div>

      <h2 className="text-base font-semibold mb-1">Your requests</h2>
      {list.length === 0 ? <p className={`text-sm mb-4 ${muted}`}>None yet.</p> : (
        <div className="overflow-x-auto rounded-lg border mb-4 border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Sent</th><th>From</th><th>Files</th><th>Where it stands</th><th /></tr></thead>
            <tbody>{list.map((r) => (
              <tr key={r.id} className="border-t border-gray-100 dark:border-slate-700">
                <td className="px-3 py-1.5">{formatAgencyDateTime(r.createdAt)}</td><td>{r.fromSystem || '—'}</td><td>{r.files.length}</td><td>{r.statusLabel}</td>
                <td className="text-right pr-2"><button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => show(r.id)}>Open</button></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="rounded-lg border p-3 border-gray-200 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-base font-semibold">Request sent {formatAgencyDateTime(open.createdAt)} — {open.statusLabel}</h2>
            {open.status !== 'cancelled' && open.status !== 'done' && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={cancel}>Cancel request</button>}
          </div>
          {open.note && <p className="text-sm mb-1"><b>Your note:</b> {open.note}</p>}
          {open.staffNote && <p className="text-sm mb-2"><b>From Twomiah:</b> {open.staffNote}</p>}
          <p className="text-sm mb-3"><b>Files:</b> {open.files.map((f) => `${f.name} (${kb(f.size)})`).join(', ')}</p>

          <h3 className="text-sm font-semibold mb-1">What Twomiah has loaded</h3>
          {open.batches.length === 0 ? <p className={`text-sm mb-3 ${muted}`}>Nothing yet.</p> : (
            <ul className="text-sm mb-3 list-disc pl-5">
              {open.batches.map((b) => <li key={b.id}>{formatAgencyDateTime(b.createdAt)}: {b.fileName || b.kind} — {b.attached ? `${b.attached} attached` : `${b.created} added`}{b.updated ? `, ${b.updated} updated` : ''}, {b.skippedDuplicates + b.failed} skipped{b.status === 'undone' ? ' (undone)' : ''}</li>)}
            </ul>
          )}

          <h3 className="text-sm font-semibold mb-1">Record counts: your old system vs here</h3>
          <p className={`text-xs mb-2 ${muted}`}>Type what the old system shows for each kind, so both sides can see what is still missing. Leave a box empty for a kind you do not use.</p>
          <div className="overflow-x-auto rounded-lg border mb-2 border-gray-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Kind</th><th>Old system</th><th>Here now</th><th>Difference</th></tr></thead>
              <tbody>{(comparison.length ? comparison : counted.map((c) => ({ ...c, old: null, now: 0, difference: null }))).map((c) => (
                <tr key={c.kind} className="border-t border-gray-100 dark:border-slate-700">
                  <td className="px-3 py-1">{c.label}</td>
                  <td><input className={`${inp} w-24 py-0.5`} inputMode="numeric" aria-label={`${c.label} in the old system`} value={counts[c.kind] ?? ''} onChange={(e) => setCounts({ ...counts, [c.kind]: e.target.value })} /></td>
                  <td>{c.now}</td>
                  <td className={c.difference === null ? muted : c.difference === 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-800 dark:text-amber-300'}>{c.difference === null ? '—' : c.difference === 0 ? 'Same' : c.difference > 0 ? `+${c.difference}` : String(c.difference)}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm mb-4" onClick={saveCounts}>Save the old system&apos;s counts</button>

          <h3 className="text-sm font-semibold mb-1">Sign-off checklist</h3>
          <ul className="text-sm">
            {open.checklist.map((item) => (
              <li key={item.id} className="py-1 border-t border-gray-100 dark:border-slate-700">
                <label>
                  <input type="checkbox" checked={!!item.signoff} disabled={item.who === 'staff'} onChange={(e) => tick(item, e.target.checked)} /> {item.label}
                  <span className={`ml-2 text-xs ${muted}`}>({WHO[item.who]}{item.signoff ? ` — ${item.signoff.by}, ${formatAgencyDateTime(item.signoff.at)}` : ''})</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
