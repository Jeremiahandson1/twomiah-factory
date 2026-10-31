// Import from a spreadsheet (item 1, care_import; parity rows 8–9, care_import_all and care_import_wizard): any record kind from a
// CSV, an Excel workbook or rows pasted from a sheet. Pick the kind, choose the file (or paste), check which column is which (a mapping
// saved before is applied when the headings match), pick the date format, look at every row, fix a bad cell in place, run it as a dry
// run if you like, then import. A re-import can update the records it matches on the fields the owner allows. A zip of documents or
// qualifications attaches in bulk. A whole import can be undone.
//   GET /api/care-import/kinds | template/:kind | batches | mappings/:kind | overwrite/:kind     POST preview | commit | attach | mappings
//   POST batches/:id/undo   DELETE mappings/:id   PUT overwrite/:kind    (server/crm/homecare/office/csvImport.ts)
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, errorMessage, rows, saveBlob } from '../lib/http'
import { formatAgencyDateTime } from '../lib/agencyClock'

type Status = 'ok' | 'duplicate' | 'update' | 'error'
interface KindInfo { kind: string; label: string; mayUndo: boolean; attach?: boolean }
interface Kinds { kinds: KindInfo[]; features: { all: boolean; wizard: boolean }; dateFormats: Array<{ value: string; label: string }>; mayChooseOverwrite: boolean }
interface MapRow { header: string; field: string | null; confidence: 'exact' | 'likely' | 'none' }
interface FieldDef { key: string; label: string; required: boolean }
interface PreviewRow { line: number; status: Status; label: string; problems: string[]; duplicateOf?: string; changes?: string[]; cells?: Record<string, string> }
interface Preview {
  ready: boolean; missingRequired: string[]; mapping: MapRow[]; fields: FieldDef[]; rows: PreviewRow[]; sheets?: string[]; sheet?: string
  savedMapping?: { id: string; name: string } | null; dateFormat: string; overwritable: string[]
  counts: { rows: number; ok: number; duplicates: number; updates: number; errors: number }
}
interface Result {
  batchId: string | null; created: number; updated: number; skippedDuplicates: number; skippedBadRows: number
  failures: Array<{ line: number; label: string; message: string }>; skipped: Array<{ line: number; label: string; why: string }>
}
interface AttachResult { batchId: string | null; dryRun: boolean; attached: number; skipped: number; failed: number; attachedFiles: Array<{ file: string; person: string; name: string }>; skippedFiles: Array<{ file: string; why: string }>; failedFiles: Array<{ file: string; why: string }> }
interface Batch { id: string; kind: string; kindLabel: string; fileName: string | null; status: string; created: number; updated: number; attached: number; skippedDuplicates: number; failed: number; source: string; createdAt: string }
interface SavedMapping { id: string; name: string; headers: string[] }
interface Edit { line: number; header: string; value: string }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const BADGE: Record<Status, string> = {
  ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  duplicate: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  update: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
  error: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
}
const BADGE_TEXT: Record<Status, string> = { ok: 'Ready', duplicate: 'Already here', update: 'Will be updated', error: 'Problem' }
const SOURCE_LABEL: Record<string, string> = { office: 'This office', factory: 'Twomiah staff' }
const SHOWN_ROWS = 300
const muted = 'text-gray-600 dark:text-slate-400'

const toBase64 = (buf: ArrayBuffer) => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }

export default function DataImport() {
  const toast = useToast()
  const confirm = useConfirm()
  const [info, setInfo] = useState<Kinds | null>(null)
  const [kind, setKind] = useState<string>('')
  const [csv, setCsv] = useState('')
  const [xlsx, setXlsx] = useState('')
  const [sheet, setSheet] = useState('')
  const [fileName, setFileName] = useState('')
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [mapping, setMapping] = useState<Record<string, string | null> | null>(null)
  const [dateFormat, setDateFormat] = useState('mdy')
  const [edits, setEdits] = useState<Edit[]>([])
  const [updateMatches, setUpdateMatches] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [dry, setDry] = useState<{ wouldCreate: number; wouldUpdate: number; wouldSkipDuplicates: number; wouldSkipBadRows: number; note?: string } | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [saved, setSaved] = useState<SavedMapping[]>([])
  const [mappingName, setMappingName] = useState('')
  const [overwrite, setOverwrite] = useState<{ fields: string[]; choices: Array<{ key: string; label: string }> } | null>(null)
  const [zipName, setZipName] = useState('')
  const [zip, setZip] = useState<File | null>(null)
  const [attached, setAttached] = useState<AttachResult | null>(null)

  const kinds = info?.kinds ?? []
  const current = useMemo(() => kinds.find((k) => k.kind === kind) ?? null, [kinds, kind])
  const wizard = !!info?.features.wizard
  const isAttach = !!current?.attach

  const loadBatches = useCallback(async () => {
    try { setBatches(rows<Batch>(await api.get('/api/care-import/batches'))) } catch { /* the list is a convenience */ }
  }, [])
  useEffect(() => {
    (async () => {
      try {
        const k = await api.get('/api/care-import/kinds') as Kinds
        setInfo(k)
        setKind((cur) => cur || k.kinds[0]?.kind || '')
      } catch (e) { toast.error(errorMessage(e)) }
      loadBatches()
    })()
  }, [loadBatches, toast])

  const loadKindBits = useCallback(async (k: string, wiz: boolean, attach: boolean) => {
    if (!k || attach) { setSaved([]); setOverwrite(null); return }
    try { setOverwrite(await api.get(`/api/care-import/overwrite/${k}`)) } catch { setOverwrite(null) }
    if (wiz) { try { setSaved(rows<SavedMapping>(await api.get(`/api/care-import/mappings/${k}`))) } catch { setSaved([]) } } else setSaved([])
  }, [])
  useEffect(() => { loadKindBits(kind, wizard, isAttach) }, [kind, wizard, isAttach, loadKindBits])

  const body = (over: Record<string, unknown> = {}) => ({
    kind, ...(xlsx ? { xlsx, ...(sheet ? { sheet } : {}) } : { csv }), ...(mapping ? { mapping } : {}),
    ...(dateFormat !== 'mdy' ? { dateFormat } : {}), ...(edits.length ? { edits } : {}), ...(updateMatches ? { updateMatches: true } : {}), ...over,
  })

  const check = useCallback(async (over: Record<string, unknown> = {}, keepMapping = true) => {
    if (!kind || (!csv && !xlsx && !over.csv && !over.xlsx)) return
    setBusy(true)
    try {
      const out = await api.post('/api/care-import/preview', { ...body(over), ...(keepMapping ? {} : { mapping: undefined }) }) as Preview
      setPreview(out)
      if (!keepMapping || !mapping) setMapping(Object.fromEntries(out.mapping.map((m) => [m.header, m.field])))
      if (out.sheet) setSheet(out.sheet)
    } catch (e) { setPreview(null); toast.error(errorMessage(e, 'Could not read that file')) }
    finally { setBusy(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, csv, xlsx, sheet, mapping, dateFormat, edits, updateMatches, toast])

  const reset = () => { setPreview(null); setCsv(''); setXlsx(''); setSheet(''); setFileName(''); setResult(null); setDry(null); setMapping(null); setEdits([]); setAttached(null); setZip(null); setZipName('') }
  const choose = async (file: File | undefined) => {
    if (!file) return
    reset()
    setFileName(file.name)
    if (/\.xlsx$/i.test(file.name)) {
      if (!wizard) { toast.error('Excel files need the import wizard, which this agency has not turned on. Save the sheet as CSV.'); return }
      const b64 = toBase64(await file.arrayBuffer())
      setXlsx(b64)
      check({ xlsx: b64 }, false)
    } else {
      const text = await file.text()
      setCsv(text)
      check({ csv: text }, false)
    }
  }
  const usePasted = () => {
    if (!pasted.trim()) return
    reset(); setFileName('Pasted rows'); setCsv(pasted); setPasting(false)
    check({ csv: pasted }, false)
  }
  const remap = (header: string, field: string) => {
    const next = { ...(mapping ?? {}), [header]: field || null }
    setMapping(next); setDry(null)
    check({ mapping: next })
  }
  const fixCell = (line: number, header: string, value: string) => {
    setEdits((cur) => [...cur.filter((e) => !(e.line === line && e.header === header)), { line, header, value }])
  }
  const template = async () => {
    if (!kind) return
    try {
      const r = await api.get(`/api/care-import/template/${kind}`) as { csv: string }
      saveBlob(new Blob([r.csv], { type: 'text/csv' }), `${kind}-template.csv`)
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const dryRun = async () => {
    setBusy(true)
    try { setDry(await api.post('/api/care-import/commit', body({ dryRun: true })) as any) }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const run = async () => {
    if (!current || !preview) return
    const what = [`add ${preview.counts.ok}`, preview.counts.updates ? `update ${preview.counts.updates}` : ''].filter(Boolean).join(' and ')
    if (!(await confirm(`Import ${fileName || 'this file'}: ${what} ${current.label.toLowerCase()}? You can undo the whole import afterwards.`, { confirmText: 'Import' }))) return
    setBusy(true)
    try {
      const out = await api.post('/api/care-import/commit', body({ fileName })) as Result
      setResult(out); setPreview(null); setCsv(''); setXlsx(''); setDry(null); setEdits([]); loadBatches()
      toast.success(out.updated ? `${out.created} added, ${out.updated} updated` : `${out.created} added`)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const runAttach = async (dryRunOnly: boolean) => {
    if (!zip || !kind) return
    if (!dryRunOnly && !(await confirm(`Attach the files in ${zipName} as ${current?.label.toLowerCase()}? You can undo the whole batch afterwards.`, { confirmText: 'Attach' }))) return
    setBusy(true)
    try {
      const form = new FormData()
      form.set('kind', kind); form.set('file', zip); form.set('dryRun', String(dryRunOnly)); if (dateFormat !== 'mdy') form.set('dateFormat', dateFormat)
      const out = await api.upload('/api/care-import/attach', form) as AttachResult
      setAttached(out)
      if (!dryRunOnly) { loadBatches(); toast.success(`${out.attached} attached`) }
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const undo = async (b: Batch) => {
    const label = `the ${b.kindLabel.toLowerCase()} import${b.fileName ? ` of ${b.fileName}` : ''}`
    if (!(await confirm(`Undo ${label}? Everything it added is removed and everything it updated is put back, except anything that has already been used (visits, invoices, pay), which is kept.`, { confirmText: 'Undo import' }))) return
    try {
      const out = await api.post(`/api/care-import/batches/${b.id}/undo`, {}) as { removed: number; restored: number; kept: Array<{ line: number | null; reason: string }> }
      const parts = [`${out.removed} removed`, out.restored ? `${out.restored} put back` : '', out.kept.length ? `${out.kept.length} kept because they are in use` : ''].filter(Boolean)
      toast.success(parts.join(', '))
      loadBatches()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const saveMapping = async () => {
    if (!preview || !mapping || !mappingName.trim()) return
    try {
      await api.post('/api/care-import/mappings', { kind, name: mappingName.trim(), headers: preview.mapping.map((m) => m.header), mapping })
      toast.success('Mapping saved for next time'); setMappingName('')
      setSaved(rows<SavedMapping>(await api.get(`/api/care-import/mappings/${kind}`)))
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const applySaved = (m: SavedMapping & { mapping?: Record<string, string | null> }) => {
    if (!m.mapping) return
    setMapping(m.mapping); check({ mapping: m.mapping })
  }
  const removeSaved = async (m: SavedMapping) => {
    if (!(await confirm(`Forget the saved mapping "${m.name}"?`, { confirmText: 'Forget' }))) return
    try { await api.delete(`/api/care-import/mappings/${m.id}`); setSaved((cur) => cur.filter((x) => x.id !== m.id)) } catch (e) { toast.error(errorMessage(e)) }
  }
  const toggleOverwrite = async (key: string) => {
    if (!overwrite) return
    const fields = overwrite.fields.includes(key) ? overwrite.fields.filter((f) => f !== key) : [...overwrite.fields, key]
    try {
      const out = await api.put(`/api/care-import/overwrite/${kind}`, { fields }) as { fields: string[] }
      setOverwrite({ ...overwrite, fields: out.fields })
      if (preview) check()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  if (info && !kinds.length) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">You do not have access to importing.</div>
  if (!info) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">Loading…</div>
  const shown = (preview?.rows ?? []).filter((r) => !onlyProblems || r.status !== 'ok')
  const editable = preview ? preview.mapping.filter((m) => m.field).map((m) => m.header) : []
  const editValue = (r: PreviewRow, h: string) => edits.find((e) => e.line === r.line && e.header === h)?.value ?? r.cells?.[h] ?? ''

  return (
    <div className="p-4 max-w-6xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Import from a spreadsheet</h1>
      <p className={`text-sm mb-3 ${muted}`}>
        Bring records in from a CSV file{wizard ? ', an Excel workbook or rows pasted from a sheet' : ''}. Nothing is added until you press Import.
        Anything already here is skipped{wizard ? ' — or updated on the fields the owner allows, when you ask for that' : ', never changed'}.
        Import clients and caregivers before the records that belong to them.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-sm">What are you importing?<br />
          <select className={inp} value={kind} onChange={(e) => { setKind(e.target.value); reset() }}>
            {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </label>
        {isAttach ? (
          <label className="text-sm">Zip file<br /><input type="file" accept=".zip,application/zip" className={inp} onChange={(e) => { const f = e.target.files?.[0] ?? null; setZip(f); setZipName(f?.name ?? ''); setAttached(null) }} /></label>
        ) : (
          <>
            <label className="text-sm">{wizard ? 'CSV or Excel file' : 'CSV file'}<br /><input type="file" accept={wizard ? '.csv,.xlsx,text/csv' : '.csv,text/csv'} className={inp} onChange={(e) => choose(e.target.files?.[0])} /></label>
            {wizard && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setPasting((p) => !p)}>{pasting ? 'Cancel paste' : 'Paste rows instead'}</button>}
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={template}>Download a blank template</button>
          </>
        )}
        {wizard && (
          <label className="text-sm">Dates in the file are<br />
            <select className={inp} value={dateFormat} onChange={(e) => { setDateFormat(e.target.value); setDry(null); if (preview) check({ dateFormat: e.target.value }) }}>
              {info.dateFormats.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
        )}
      </div>

      {pasting && !isAttach && (
        <div className="mb-4">
          <textarea className={`${inp} w-full h-40 font-mono`} placeholder={'Copy the rows from your sheet, headings included, and paste them here.'} value={pasted} onChange={(e) => setPasted(e.target.value)} />
          <button type="button" className="hc-btn hc-btn-primary hc-btn-sm mt-2" onClick={usePasted} disabled={!pasted.trim()}>Read the pasted rows</button>
        </div>
      )}

      {isAttach && (
        <div className="rounded-lg border p-3 mb-4 text-sm border-gray-200 dark:border-slate-700">
          <p className="mb-2">
            Each file in the zip goes to the person it names: a folder per person (<code>Maria Lopez/care plan.pdf</code>, <code>C-1001/consent.pdf</code>, <code>sam@agency.com/CPR.pdf</code>),
            the name before &quot; - &quot; (<code>Maria Lopez - care plan.pdf</code>), or an <code>index.csv</code> at the root with the columns file, person, name{kind === 'qualifications' ? ', expires, issued, number' : ', type'}.
            A person is found by reference code, ID, email or name. A file already attached to them under the same name is skipped.
          </p>
          <div className="flex gap-2">
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled={busy || !zip} onClick={() => runAttach(true)}>Check without attaching</button>
            <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={busy || !zip} onClick={() => runAttach(false)}>Attach</button>
          </div>
          {attached && (
            <div className="mt-3">
              <b>{attached.attached}</b> {attached.dryRun ? 'would be attached' : 'attached'} · <b>{attached.skipped}</b> skipped · <b>{attached.failed}</b> could not be saved{attached.dryRun ? ' (nothing was saved: this was a check)' : ''}.
              {attached.attachedFiles.slice(0, 50).map((f) => <div key={f.file} className={muted}>{f.file} → {f.person}: {f.name}</div>)}
              {attached.skippedFiles.map((f) => <div key={f.file} className="text-amber-800 dark:text-amber-300">{f.file}: {f.why}</div>)}
              {attached.failedFiles.map((f) => <div key={f.file} className="text-red-800 dark:text-red-300">{f.file}: {f.why}</div>)}
            </div>
          )}
        </div>
      )}

      {busy && <div className={`text-sm mb-2 ${muted}`}>Working…</div>}

      {preview && !isAttach && (
        <>
          {preview.sheets && preview.sheets.length > 1 && (
            <label className="text-sm block mb-3">Sheet<br />
              <select className={inp} value={sheet || preview.sheet || ''} onChange={(e) => { setSheet(e.target.value); setMapping(null); setEdits([]); check({ sheet: e.target.value }, false) }}>
                {preview.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          <h2 className="text-base font-semibold mb-1">1. Which column is which</h2>
          {preview.savedMapping && <p className={`text-sm mb-2 ${muted}`}>Using the saved mapping &quot;{preview.savedMapping.name}&quot; (the headings matched). Change any column below if it is wrong.</p>}
          <div className="overflow-x-auto rounded-lg border mb-2 border-gray-200 dark:border-slate-700">
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
                  <td className={`text-xs ${muted}`}>{m.field ? (m.confidence === 'exact' ? 'Matched' : m.confidence === 'likely' ? 'Probably' : 'Chosen by you') : ''}</td>
                </tr>))}</tbody>
            </table>
          </div>
          {wizard && (
            <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
              <input className={inp} placeholder="Name this mapping to reuse it" value={mappingName} onChange={(e) => setMappingName(e.target.value)} />
              <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled={!mappingName.trim()} onClick={saveMapping}>Save mapping</button>
              {saved.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 border-gray-300 dark:border-slate-600">
                  <button type="button" className="underline" onClick={() => applySaved(m as any)}>{m.name}</button>
                  <button type="button" aria-label={`Forget ${m.name}`} className={muted} onClick={() => removeSaved(m)}>×</button>
                </span>
              ))}
            </div>
          )}
          {!preview.ready && <p className="text-sm mb-3 text-red-800 dark:text-red-300">Pick a column for: {preview.missingRequired.join(', ')}.</p>}

          {preview.ready && (
            <>
              <h2 className="text-base font-semibold mb-1">2. Check the rows</h2>
              <p className="text-sm mb-2">
                <b>{preview.counts.ok}</b> ready · {preview.counts.updates > 0 && <><b>{preview.counts.updates}</b> will be updated · </>}<b>{preview.counts.duplicates}</b> already here (skipped) · <b>{preview.counts.errors}</b> with a problem (skipped) · {preview.counts.rows} in the file
                <label className="ml-3"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows that will be skipped</label>
              </p>
              {wizard && overwrite && (
                <div className="rounded-lg border p-2 mb-2 text-sm border-gray-200 dark:border-slate-700">
                  <label><input type="checkbox" checked={updateMatches} onChange={(e) => { setUpdateMatches(e.target.checked); setDry(null); check({ updateMatches: e.target.checked }) }} /> Update the records this file matches{overwrite.fields.length ? ` (${overwrite.fields.map((k) => overwrite.choices.find((c) => c.key === k)?.label ?? k).join(', ')})` : ''}</label>
                  {!overwrite.fields.length && <span className={`ml-2 ${muted}`}>{info.mayChooseOverwrite ? 'Tick below which fields a re-import may overwrite.' : 'The owner has not yet said which fields a re-import may overwrite.'}</span>}
                  {info.mayChooseOverwrite && (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {overwrite.choices.map((c) => <label key={c.key} className="text-xs"><input type="checkbox" checked={overwrite.fields.includes(c.key)} onChange={() => toggleOverwrite(c.key)} /> {c.label}</label>)}
                    </div>
                  )}
                </div>
              )}
              <div className="overflow-x-auto rounded-lg border mb-3 border-gray-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Row</th><th>Who</th><th>Result</th><th>Why</th></tr></thead>
                  <tbody>{shown.slice(0, SHOWN_ROWS).map((r) => (
                    <tr key={r.line} className="border-t border-gray-100 dark:border-slate-700 align-top">
                      <td className="px-3 py-1.5">{r.line}</td><td>{r.label}</td>
                      <td><span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGE[r.status]}`}>{BADGE_TEXT[r.status]}</span></td>
                      <td className="text-xs">
                        {r.status === 'duplicate' ? r.duplicateOf : r.status === 'update' ? `Changes: ${(r.changes ?? []).join(', ')}` : r.problems.join(' ')}
                        {wizard && r.status === 'error' && r.cells && (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {editable.map((h) => (
                              <label key={h} className={muted}>{h}<br /><input className={`${inp} py-0.5`} aria-label={`Row ${r.line} ${h}`} value={editValue(r, h)} onChange={(e) => fixCell(r.line, h, e.target.value)} /></label>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>))}</tbody>
                </table>
              </div>
              {shown.length > SHOWN_ROWS && <p className={`text-xs mb-3 ${muted}`}>Showing the first {SHOWN_ROWS} of {shown.length} rows. All of them are checked.</p>}

              <div className="flex flex-wrap items-center gap-2 mb-4">
                {wizard && edits.length > 0 && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled={busy} onClick={() => { setDry(null); check() }}>Re-check with my fixes</button>}
                <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled={busy} onClick={dryRun}>Check without importing</button>
                <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={busy || (preview.counts.ok === 0 && preview.counts.updates === 0)} onClick={run}>
                  Import {preview.counts.ok}{preview.counts.updates ? ` + update ${preview.counts.updates}` : ''} {current?.label.toLowerCase()}
                </button>
              </div>
              {dry && (
                <p className="text-sm mb-4 rounded-lg p-3 bg-gray-50 dark:bg-slate-800">
                  Dry run, nothing was added: it would add <b>{dry.wouldCreate}</b>, {dry.wouldUpdate > 0 && <>update <b>{dry.wouldUpdate}</b>, </>}skip <b>{dry.wouldSkipDuplicates}</b> already here and <b>{dry.wouldSkipBadRows}</b> with a problem.{dry.note ? ` ${dry.note}` : ''}
                </p>
              )}
            </>
          )}
        </>
      )}

      {result && (
        <div className="rounded-lg border p-3 mb-4 text-sm border-gray-200 dark:border-slate-700">
          <b>{result.created}</b> added · {result.updated > 0 && <><b>{result.updated}</b> updated · </>}<b>{result.skippedDuplicates}</b> already here · <b>{result.skippedBadRows}</b> skipped with a problem{result.failures.length ? ` · ${result.failures.length} could not be saved` : ''}.
          {result.failures.map((f) => <div key={f.line} className="text-red-800 dark:text-red-300">Row {f.line} ({f.label}): {f.message}</div>)}
          {kind === 'caregivers' && result.created > 0 && <div className={`mt-1 ${muted}`}>New caregivers have no password yet. Use Reset password on each one before they sign in.</div>}
        </div>
      )}

      <h2 className="text-base font-semibold mb-1">Past imports</h2>
      {batches.length === 0 ? <p className={`text-sm ${muted}`}>None yet.</p> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">When</th><th>What</th><th>File</th><th>By</th><th>Added</th><th>Updated</th><th>Skipped</th><th /></tr></thead>
            <tbody>{batches.map((b) => (
              <tr key={b.id} className="border-t border-gray-100 dark:border-slate-700">
                <td className="px-3 py-1.5">{formatAgencyDateTime(b.createdAt)}</td><td>{b.kindLabel}</td><td>{b.fileName || '—'}</td><td>{SOURCE_LABEL[b.source] ?? b.source}</td>
                <td>{b.attached ? `${b.attached} attached` : b.created}</td><td>{b.updated || '—'}</td><td>{b.skippedDuplicates + b.failed}</td>
                <td className="text-right pr-2">{b.status === 'undone' ? <span className={`text-xs ${muted}`}>Undone</span>
                  : kinds.find((k) => k.kind === b.kind)?.mayUndo && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => undo(b)}>Undo</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
