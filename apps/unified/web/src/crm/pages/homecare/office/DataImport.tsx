// Import from a spreadsheet (item 1, care_import): clients, caregivers or recurring shifts from a CSV. Pick the kind, choose the
// file, check which column is which, look at every row, run it as a dry run if you like, then import. A whole import can be undone.
//   GET /api/care-import/template/:kind     POST /api/care-import/preview | /commit     GET /api/care-import/batches
//   POST /api/care-import/batches/:id/undo  (server/crm/homecare/office/csvImport.ts)
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, errorMessage, rows, saveBlob } from '../lib/http'
import { formatAgencyDateTime } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'

type Kind = 'clients' | 'caregivers' | 'schedules'
interface MapRow { header: string; field: string | null; confidence: 'exact' | 'likely' | 'none' }
interface FieldDef { key: string; label: string; required: boolean }
interface PreviewRow { line: number; status: 'ok' | 'duplicate' | 'error'; label: string; problems: string[]; duplicateOf?: string }
interface Preview { ready: boolean; missingRequired: string[]; mapping: MapRow[]; fields: FieldDef[]; rows: PreviewRow[]; counts: { rows: number; ok: number; duplicates: number; errors: number } }
interface Result {
  batchId: string | null; created: number; skippedDuplicates: number; skippedBadRows: number
  failures: Array<{ line: number; label: string; message: string }>; skipped: Array<{ line: number; label: string; why: string }>
}
interface Batch { id: string; kind: Kind; fileName: string | null; status: string; created: number; skippedDuplicates: number; failed: number; createdAt: string }

const KIND_LABEL: Record<Kind, string> = { clients: 'Clients', caregivers: 'Caregivers', schedules: 'Recurring shifts' }
const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const BADGE = {
  ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  duplicate: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  error: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
}
const BADGE_TEXT = { ok: 'Ready', duplicate: 'Already here', error: 'Problem' }
const SHOWN_ROWS = 300

export default function DataImport() {
  const clientsMay = useMay('care-clients')
  const hrMay = useMay('care-hr')
  const schedMay = useMay('care-schedule')
  const toast = useToast()
  const confirm = useConfirm()
  const kinds = useMemo(() => ([
    clientsMay.create && 'clients', hrMay.create && 'caregivers', schedMay.create && 'schedules',
  ].filter(Boolean) as Kind[]), [clientsMay.create, hrMay.create, schedMay.create])
  const mayUndo = (k: Kind) => (k === 'clients' ? clientsMay.delete : k === 'caregivers' ? hrMay.delete : schedMay.delete)

  const [kind, setKind] = useState<Kind | null>(kinds[0] ?? null)
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState('')
  const [mapping, setMapping] = useState<Record<string, string | null> | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [dry, setDry] = useState<{ wouldCreate: number; wouldSkipDuplicates: number; wouldSkipBadRows: number; note?: string } | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])

  useEffect(() => { if (!kind && kinds.length) setKind(kinds[0]) }, [kind, kinds])

  const loadBatches = useCallback(async () => {
    try { setBatches(rows<Batch>(await api.get('/api/care-import/batches'))) } catch { /* the list is a convenience */ }
  }, [])
  useEffect(() => { loadBatches() }, [loadBatches])

  const check = useCallback(async (text: string, map: Record<string, string | null> | null) => {
    if (!kind || !text) return
    setBusy(true)
    try {
      const out = await api.post('/api/care-import/preview', { kind, csv: text, ...(map ? { mapping: map } : {}) }) as Preview
      setPreview(out)
      if (!map) setMapping(Object.fromEntries(out.mapping.map((m) => [m.header, m.field])))
    } catch (e) { setPreview(null); toast.error(errorMessage(e, 'Could not read that file')) }
    finally { setBusy(false) }
  }, [kind, toast])

  const choose = async (file: File | undefined) => {
    if (!file) return
    setResult(null); setDry(null); setMapping(null)
    const text = await file.text()
    setCsv(text); setFileName(file.name)
    check(text, null)
  }
  const remap = (header: string, field: string) => {
    const next = { ...(mapping ?? {}), [header]: field || null }
    setMapping(next); setDry(null)
    check(csv, next)
  }
  const template = async () => {
    if (!kind) return
    try {
      const r = await api.get(`/api/care-import/template/${kind}`) as { csv: string }
      saveBlob(new Blob([r.csv], { type: 'text/csv' }), `${kind}-template.csv`)
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const dryRun = async () => {
    if (!kind) return
    setBusy(true)
    try { setDry(await api.post('/api/care-import/commit', { kind, csv, mapping, dryRun: true }) as any) }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const run = async () => {
    if (!kind || !preview) return
    if (!(await confirm(`Add ${preview.counts.ok} ${KIND_LABEL[kind].toLowerCase()} from ${fileName || 'this file'}? You can undo the whole import afterwards.`, { confirmText: 'Import' }))) return
    setBusy(true)
    try {
      const out = await api.post('/api/care-import/commit', { kind, csv, mapping, fileName }) as Result
      setResult(out); setPreview(null); setCsv(''); setDry(null); loadBatches()
      toast.success(`${out.created} added`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const undo = async (id: string, label: string) => {
    if (!(await confirm(`Undo ${label}? Everything it added is removed, except anything that has already been used (visits, invoices, pay), which is kept.`, { confirmText: 'Undo import' }))) return
    try {
      const out = await api.post(`/api/care-import/batches/${id}/undo`, {}) as { removed: number; kept: Array<{ line: number | null; reason: string }> }
      toast.success(out.kept.length ? `${out.removed} removed, ${out.kept.length} kept because they are in use` : `${out.removed} removed`)
      loadBatches()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  if (!kinds.length) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">You do not have access to importing.</div>
  const shown = (preview?.rows ?? []).filter((r) => !onlyProblems || r.status !== 'ok')

  return (
    <div className="p-4 max-w-5xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Import from a spreadsheet</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">
        Bring in clients, caregivers or recurring shifts from a CSV file. Nothing is added until you press Import, and anything already here is skipped, never changed.
        Import clients and caregivers before the shifts that use them.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-sm">What are you importing?<br />
          <select className={inp} value={kind ?? ''} onChange={(e) => { setKind(e.target.value as Kind); setPreview(null); setCsv(''); setResult(null); setDry(null); setMapping(null) }}>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="text-sm">CSV file<br /><input type="file" accept=".csv,text/csv" className={inp} onChange={(e) => choose(e.target.files?.[0])} /></label>
        <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={template}>Download a blank template</button>
      </div>

      {busy && <div className="text-sm mb-2 text-gray-600 dark:text-slate-400">Working…</div>}

      {preview && (
        <>
          <h2 className="text-base font-semibold mb-1">1. Which column is which</h2>
          <div className="overflow-x-auto rounded-lg border mb-4 border-gray-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Column in your file</th><th>Goes into</th><th /></tr></thead>
              <tbody>{preview.mapping.map((m) => (
                <tr key={m.header} className="border-t border-gray-100 dark:border-slate-700">
                  <td className="px-3 py-1.5 font-semibold">{m.header || '(no heading)'}</td>
                  <td>
                    <select className={inp} aria-label={`Field for ${m.header}`} value={mapping?.[m.header] ?? ''} onChange={(e) => remap(m.header, e.target.value)}>
                      <option value="">Do not import</option>
                      {preview.fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>)}
                    </select>
                  </td>
                  <td className="text-xs text-gray-600 dark:text-slate-400">{m.field ? (m.confidence === 'exact' ? 'Matched' : m.confidence === 'likely' ? 'Probably' : 'Chosen by you') : ''}</td>
                </tr>))}</tbody>
            </table>
          </div>
          {!preview.ready && <p className="text-sm mb-3 text-red-800 dark:text-red-300">Pick a column for: {preview.missingRequired.join(', ')}.</p>}

          {preview.ready && (
            <>
              <h2 className="text-base font-semibold mb-1">2. Check the rows</h2>
              <p className="text-sm mb-2">
                <b>{preview.counts.ok}</b> ready · <b>{preview.counts.duplicates}</b> already here (skipped) · <b>{preview.counts.errors}</b> with a problem (skipped) · {preview.counts.rows} in the file
                <label className="ml-3"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows that will be skipped</label>
              </p>
              <div className="overflow-x-auto rounded-lg border mb-3 border-gray-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Row</th><th>Who</th><th>Result</th><th>Why</th></tr></thead>
                  <tbody>{shown.slice(0, SHOWN_ROWS).map((r) => (
                    <tr key={r.line} className="border-t border-gray-100 dark:border-slate-700 align-top">
                      <td className="px-3 py-1.5">{r.line}</td><td>{r.label}</td>
                      <td><span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGE[r.status]}`}>{BADGE_TEXT[r.status]}</span></td>
                      <td className="text-xs">{r.status === 'duplicate' ? r.duplicateOf : r.problems.join(' ')}</td>
                    </tr>))}</tbody>
                </table>
              </div>
              {shown.length > SHOWN_ROWS && <p className="text-xs mb-3 text-gray-600 dark:text-slate-400">Showing the first {SHOWN_ROWS} of {shown.length} rows. All of them are checked.</p>}

              <div className="flex flex-wrap items-center gap-2 mb-4">
                <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled={busy} onClick={dryRun}>Check without importing</button>
                <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={busy || preview.counts.ok === 0} onClick={run}>Import {preview.counts.ok} {kind ? KIND_LABEL[kind].toLowerCase() : ''}</button>
              </div>
              {dry && (
                <p className="text-sm mb-4 rounded-lg p-3 bg-gray-50 dark:bg-slate-800">
                  Dry run, nothing was added: it would add <b>{dry.wouldCreate}</b>, skip <b>{dry.wouldSkipDuplicates}</b> already here and <b>{dry.wouldSkipBadRows}</b> with a problem.{dry.note ? ` ${dry.note}` : ''}
                </p>
              )}
            </>
          )}
        </>
      )}

      {result && (
        <div className="rounded-lg border p-3 mb-4 text-sm border-gray-200 dark:border-slate-700">
          <b>{result.created}</b> added · <b>{result.skippedDuplicates}</b> already here · <b>{result.skippedBadRows}</b> skipped with a problem{result.failures.length ? ` · ${result.failures.length} could not be saved` : ''}.
          {result.failures.map((f) => <div key={f.line} className="text-red-800 dark:text-red-300">Row {f.line} ({f.label}): {f.message}</div>)}
          {kind === 'caregivers' && result.created > 0 && <div className="mt-1 text-gray-600 dark:text-slate-400">New caregivers have no password yet. Use Reset password on each one before they sign in.</div>}
        </div>
      )}

      <h2 className="text-base font-semibold mb-1">Past imports</h2>
      {batches.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">None yet.</p> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">When</th><th>What</th><th>File</th><th>Added</th><th>Skipped</th><th /></tr></thead>
            <tbody>{batches.map((b) => (
              <tr key={b.id} className="border-t border-gray-100 dark:border-slate-700">
                <td className="px-3 py-1.5">{formatAgencyDateTime(b.createdAt)}</td><td>{KIND_LABEL[b.kind]}</td><td>{b.fileName || '—'}</td>
                <td>{b.created}</td><td>{b.skippedDuplicates + b.failed}</td>
                <td className="text-right pr-2">{b.status === 'undone' ? <span className="text-xs text-gray-600 dark:text-slate-400">Undone</span>
                  : mayUndo(b.kind) && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => undo(b.id, `the ${KIND_LABEL[b.kind].toLowerCase()} import${b.fileName ? ` of ${b.fileName}` : ''}`)}>Undo</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
