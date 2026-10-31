// Assisted migration, staff side (home care parity row 10). A unified home-care agency sends its old system's export from its
// app; here Twomiah staff open the request, look at the files, run the agency's own importer on each one (dry run first), attach
// a zip of documents or qualifications, compare record counts old vs new, tick the staff side of the sign-off checklist and set the
// status. Every call is passed to the agency's own service by apps/api/src/unified/migration.ts; nothing is kept in the Factory.
import { useCallback, useEffect, useState } from 'react'
import { supabase, API_URL } from '../supabase'
import { Upload, CheckCircle2, AlertTriangle, Download, Undo2 } from 'lucide-react'

type Tenant = { id: string; slug: string; business_name?: string | null; status?: string | null; ready: boolean; why: string | null }
type FileMeta = { id: string; name: string; size: number }
type Signoff = { by: string; side: string; at: string }
type ChecklistItem = { id: string; label: string; who: 'agency' | 'staff' | 'either'; signoff: Signoff | null }
type Batch = { id: string; kind: string; fileName: string | null; created: number; updated: number; attached: number; skippedDuplicates: number; failed: number; status: string; createdAt: string; createdBy: string | null }
type Request = { id: string; status: string; statusLabel: string; fromSystem: string | null; note: string | null; staffNote: string | null; createdAt: string; files: FileMeta[]; batches: Batch[]; checklist: ChecklistItem[] }
type Comparison = { kind: string; label: string; old: number | null; now: number; difference: number | null }
type Kinds = { kinds: Array<{ kind: string; label: string }>; attach: string[]; dateFormats: string[] }
type Preview = { ready: boolean; missingRequired: string[]; sheets?: string[]; sheet?: string; counts: { rows: number; ok: number; duplicates: number; updates: number; errors: number }; rows: Array<{ line: number; status: string; label: string; problems: string[]; duplicateOf?: string }> }
type RunResult = { created: number; updated: number; skippedDuplicates: number; skippedBadRows: number; failures: Array<{ line: number; label: string; message: string }> }
type AttachResult = { dryRun: boolean; attached: number; skipped: number; failed: number; skippedFiles: Array<{ file: string; why: string }>; failedFiles: Array<{ file: string; why: string }> }

const DATE_LABEL: Record<string, string> = { mdy: 'month/day/year (US)', dmy: 'day/month/year', ymd: 'year-month-day' }
const STATUSES = [['sent', 'Sent to Twomiah'], ['in_progress', 'Being loaded'], ['done', 'Done'], ['cancelled', 'Cancelled']]

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(API_URL + '/api/v1/factory' + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session?.access_token, ...(opts?.headers || {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || 'Request failed')
  return body
}
const when = (iso: string) => new Date(iso).toLocaleString()
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const inp = 'bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm'
const btn = 'px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50'

export default function MigrationPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [tenantId, setTenantId] = useState('')
  const [requests, setRequests] = useState<Request[]>([])
  const [open, setOpen] = useState<Request | null>(null)
  const [comparison, setComparison] = useState<Comparison[]>([])
  const [kinds, setKinds] = useState<Kinds | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // the importer's choices
  const [fileId, setFileId] = useState('')
  const [kind, setKind] = useState('clients')
  const [sheet, setSheet] = useState('')
  const [dateFormat, setDateFormat] = useState('mdy')
  const [updateMatches, setUpdateMatches] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [attachResult, setAttachResult] = useState<AttachResult | null>(null)
  const [staffNote, setStaffNote] = useState('')
  const [status, setStatus] = useState('')

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Request failed')
  const base = `/migration/${tenantId}`

  useEffect(() => { apiFetch('/migration/tenants').then((r) => setTenants(r.data)).catch(fail) }, [])
  const loadRequests = useCallback(async (id: string) => {
    if (!id) return
    setError(null); setOpen(null)
    try {
      const [r, k] = await Promise.all([apiFetch(`/migration/${id}/requests`), apiFetch(`/migration/${id}/kinds`)])
      setRequests(r.data); setKinds(k)
    } catch (e) { fail(e); setRequests([]) }
  }, [])
  useEffect(() => { loadRequests(tenantId) }, [tenantId, loadRequests])

  const show = async (id: string) => {
    setError(null); setPreview(null); setResult(null); setAttachResult(null)
    try {
      const [r, c] = await Promise.all([apiFetch(`${base}/requests/${id}`), apiFetch(`${base}/requests/${id}/comparison`)])
      setOpen(r); setComparison(c.data); setStaffNote(r.staffNote || ''); setStatus(r.status); setFileId(r.files[0]?.id || '')
    } catch (e) { fail(e) }
  }
  const refresh = async () => { if (open) { await show(open.id); setNotice(null) } }
  const download = async (f: FileMeta) => {
    try {
      const r = await apiFetch(`${base}/files/${f.id}`)
      const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes]))
      const a = document.createElement('a'); a.href = url; a.download = f.name; a.click(); URL.revokeObjectURL(url)
    } catch (e) { fail(e) }
  }
  const runImport = async (dryRun: boolean) => {
    if (!open || !fileId) return
    setBusy(true); setError(null); setResult(null)
    try {
      const body = { fileId, kind, sheet: sheet || undefined, dateFormat, updateMatches, dryRun }
      const out = await apiFetch(`${base}/requests/${open.id}/import`, { method: 'POST', body: JSON.stringify(body) })
      if (dryRun) { setPreview(out); if (out.sheet) setSheet(out.sheet) } else { setResult(out); setPreview(null); setNotice(`${out.created} added, ${out.updated} updated`); await show(open.id) }
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const runAttach = async (dryRun: boolean) => {
    if (!open || !fileId) return
    setBusy(true); setError(null)
    try {
      const out = await apiFetch(`${base}/requests/${open.id}/attach`, { method: 'POST', body: JSON.stringify({ fileId, kind, dryRun, dateFormat }) })
      setAttachResult(out)
      if (!dryRun) await show(open.id)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const tick = async (item: ChecklistItem, done: boolean) => {
    if (!open) return
    try { setOpen(await apiFetch(`${base}/requests/${open.id}/signoff`, { method: 'PUT', body: JSON.stringify({ item: item.id, done }) })) } catch (e) { fail(e) }
  }
  const saveStatus = async () => {
    if (!open) return
    try { setOpen(await apiFetch(`${base}/requests/${open.id}/status`, { method: 'PUT', body: JSON.stringify({ status, staffNote }) })); loadRequests(tenantId) } catch (e) { fail(e) }
  }
  const undo = async (b: Batch) => {
    if (!open) return
    setBusy(true); setError(null)
    try {
      const out = await apiFetch(`${base}/batches/${b.id}/undo`, { method: 'POST', body: JSON.stringify({}) })
      setNotice(`${out.removed} removed, ${out.restored} put back, ${out.kept.length} kept because they are in use`)
      await show(open.id)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const isAttach = !!kinds?.attach.includes(kind)
  const tenant = tenants.find((t) => t.id === tenantId)

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-1 flex items-center gap-2"><Upload size={22} /> Assisted migration</h1>
      <p className="text-gray-400 text-sm mb-4">A home-care agency sends its old system's export from its app. Load it here with the agency's own importer, dry run first, compare the counts, and tick the checklist with them.</p>

      <label className="text-sm block mb-4">Customer<br />
        <select className={inp} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">Choose a home-care customer</option>
          {tenants.map((t) => <option key={t.id} value={t.id} disabled={!t.ready}>{t.business_name || t.slug}{t.ready ? '' : ` — ${t.why}`}</option>)}
        </select>
      </label>
      {tenant && !tenant.ready && <p className="text-amber-400 text-sm mb-4">{tenant.why}</p>}
      {error && <p className="text-red-400 text-sm mb-3 flex items-center gap-1"><AlertTriangle size={14} /> {error}</p>}
      {notice && <p className="text-green-400 text-sm mb-3 flex items-center gap-1"><CheckCircle2 size={14} /> {notice}</p>}

      {tenantId && !open && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-400"><th className="p-3">Sent</th><th>From</th><th>Files</th><th>Where it stands</th><th /></tr></thead>
            <tbody>{requests.map((r) => (
              <tr key={r.id} className="border-t border-gray-800">
                <td className="p-3">{when(r.createdAt)}</td><td>{r.fromSystem || '—'}</td><td>{r.files.length}</td><td>{r.statusLabel}</td>
                <td className="text-right p-3"><button className={`${btn} bg-blue-600`} onClick={() => show(r.id)}>Open</button></td>
              </tr>))}
              {requests.length === 0 && <tr><td className="p-3 text-gray-500" colSpan={5}>This customer has not sent a migration request.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Request sent {when(open.createdAt)} from {open.fromSystem || 'an unnamed system'} — {open.statusLabel}</h2>
            <button className={`${btn} bg-gray-800`} onClick={() => setOpen(null)}>Back to the list</button>
          </div>
          {open.note && <p className="text-sm text-gray-300"><b>The agency says:</b> {open.note}</p>}

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Files</h3>
            <ul className="text-sm space-y-1">{open.files.map((f) => <li key={f.id} className="flex items-center gap-2">{f.name} <span className="text-gray-500">({kb(f.size)})</span><button className="text-blue-400" onClick={() => download(f)} title="Download"><Download size={14} /></button></li>)}</ul>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Run the agency's importer</h3>
            <div className="flex flex-wrap gap-3 items-end text-sm">
              <label>File<br /><select className={inp} value={fileId} onChange={(e) => { setFileId(e.target.value); setPreview(null); setSheet('') }}>{open.files.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
              <label>Kind<br /><select className={inp} value={kind} onChange={(e) => { setKind(e.target.value); setPreview(null); setAttachResult(null) }}>
                {kinds?.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                {kinds?.attach.map((k) => <option key={k} value={k}>{k === 'documents' ? 'Client documents (zip)' : 'Caregiver qualifications (zip)'}</option>)}
              </select></label>
              <label>Dates are<br /><select className={inp} value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>{kinds?.dateFormats.map((d) => <option key={d} value={d}>{DATE_LABEL[d] ?? d}</option>)}</select></label>
              {preview?.sheets && preview.sheets.length > 1 && <label>Sheet<br /><select className={inp} value={sheet} onChange={(e) => setSheet(e.target.value)}>{preview.sheets.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>}
              {!isAttach && <label className="pb-1"><input type="checkbox" checked={updateMatches} onChange={(e) => setUpdateMatches(e.target.checked)} /> Update matched records (the owner's overwritable fields)</label>}
            </div>
            <div className="flex gap-2 mt-3">
              <button className={`${btn} bg-gray-800`} disabled={busy || !fileId} onClick={() => (isAttach ? runAttach(true) : runImport(true))}>Dry run</button>
              <button className={`${btn} bg-blue-600`} disabled={busy || !fileId || (!isAttach && !preview?.ready)} onClick={() => (isAttach ? runAttach(false) : runImport(false))}>{isAttach ? 'Attach for real' : 'Import for real'}</button>
            </div>
            {preview && (
              <div className="mt-3 text-sm">
                {!preview.ready ? <p className="text-amber-400">The file has no column for: {preview.missingRequired.join(', ')}. The headings must name the fields (download the agency's template from its Import screen), or ask the agency to re-export.</p> : (
                  <>
                    <p><b>{preview.counts.ok}</b> would be added · <b>{preview.counts.updates}</b> updated · <b>{preview.counts.duplicates}</b> already there · <b>{preview.counts.errors}</b> with a problem · {preview.counts.rows} rows</p>
                    <ul className="mt-1 text-gray-400 max-h-60 overflow-auto">{preview.rows.filter((r) => r.status === 'error').slice(0, 100).map((r) => <li key={r.line}>Row {r.line} ({r.label}): {r.problems.join(' ')}</li>)}</ul>
                  </>
                )}
              </div>
            )}
            {result && <p className="mt-3 text-sm"><b>{result.created}</b> added · <b>{result.updated}</b> updated · <b>{result.skippedDuplicates}</b> already there · <b>{result.skippedBadRows}</b> skipped{result.failures.map((f) => <span key={f.line} className="block text-red-400">Row {f.line} ({f.label}): {f.message}</span>)}</p>}
            {attachResult && <p className="mt-3 text-sm"><b>{attachResult.attached}</b> {attachResult.dryRun ? 'would be attached' : 'attached'} · <b>{attachResult.skipped}</b> skipped · <b>{attachResult.failed}</b> failed{[...attachResult.skippedFiles, ...attachResult.failedFiles].map((f) => <span key={f.file} className="block text-gray-400">{f.file}: {f.why}</span>)}</p>}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Loaded so far</h3>
            {open.batches.length === 0 ? <p className="text-sm text-gray-500">Nothing yet.</p> : (
              <table className="w-full text-sm"><tbody>{open.batches.map((b) => (
                <tr key={b.id} className="border-t border-gray-800"><td className="py-1">{when(b.createdAt)}</td><td>{b.fileName || b.kind}</td><td>{b.attached ? `${b.attached} attached` : `${b.created} added`}{b.updated ? `, ${b.updated} updated` : ''}, {b.skippedDuplicates + b.failed} skipped</td><td>{b.createdBy?.replace(/^factory:/, '')}</td>
                  <td className="text-right">{b.status === 'undone' ? <span className="text-gray-500">Undone</span> : <button className={`${btn} bg-gray-800 inline-flex items-center gap-1`} disabled={busy} onClick={() => undo(b)}><Undo2 size={14} /> Undo</button>}</td></tr>
              ))}</tbody></table>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Record counts: old system vs here</h3>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-400"><th>Kind</th><th>Old system (typed by the agency)</th><th>Here now</th><th>Difference</th></tr></thead>
              <tbody>{comparison.map((c) => <tr key={c.kind} className="border-t border-gray-800"><td className="py-1">{c.label}</td><td>{c.old ?? '—'}</td><td>{c.now}</td><td className={c.difference === null ? 'text-gray-500' : c.difference === 0 ? 'text-green-400' : 'text-amber-400'}>{c.difference === null ? '—' : c.difference === 0 ? 'Same' : c.difference > 0 ? `+${c.difference}` : c.difference}</td></tr>)}</tbody>
            </table>
            <button className={`${btn} bg-gray-800 mt-2`} onClick={refresh}>Refresh</button>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Sign-off checklist</h3>
            <ul className="text-sm">{open.checklist.map((item) => (
              <li key={item.id} className="py-1 border-t border-gray-800"><label><input type="checkbox" checked={!!item.signoff} disabled={item.who === 'agency'} onChange={(e) => tick(item, e.target.checked)} /> {item.label}
                <span className="ml-2 text-xs text-gray-500">({item.who === 'agency' ? 'the agency' : item.who === 'staff' ? 'Twomiah' : 'either side'}{item.signoff ? ` — ${item.signoff.by}, ${when(item.signoff.at)}` : ''})</span></label></li>
            ))}</ul>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="font-semibold mb-2">Status and a note to the agency</h3>
            <div className="flex flex-wrap gap-3 items-end text-sm">
              <label>Status<br /><select className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="grow">Note the agency sees<br /><input className={`${inp} w-full`} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} /></label>
              <button className={`${btn} bg-blue-600`} onClick={saveStatus}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
