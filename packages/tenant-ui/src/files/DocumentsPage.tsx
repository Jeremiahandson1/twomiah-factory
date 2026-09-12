// Documents — one page for every CRM. Upload (single or many), search/filter, preview, authenticated
// download, version history, plan markup (construction), delete. Every file request carries the bearer
// token: an <img src> / <a href> cannot, which is why previews were blank and downloads 401'd before.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Eye, File, FileText, FolderOpen, History, Image as ImageIcon, MapPin, PenLine, PenTool, RotateCcw, Square, Trash2, Upload, UploadCloud, X } from 'lucide-react'
import { Button, ConfirmModal, DataTable, Field, Modal, PageHeader, dateOnly, errMsg, inputCls } from '../invoicing/ui'
import type { Pagination } from '../invoicing/ui'
import type { DocumentRow, DocumentsPageProps, FilesApi, FilesToast } from './types'
import { resolveDocumentsConfig } from './types'

// ---------------------------------------------------------------- authenticated file access
const token = () => { try { return localStorage.getItem('accessToken') || localStorage.getItem('token') || '' } catch { return '' } }
const absolute = (api: FilesApi, url: string) => (url.startsWith('http') ? url : (api.baseUrl || '') + url)
async function authedFetch(api: FilesApi, url: string, init: RequestInit = {}) {
  const res = await fetch(absolute(api, url), { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token()}` } })
  return res
}
async function blobUrl(api: FilesApi, url: string): Promise<string> {
  const res = await authedFetch(api, url)
  if (!res.ok) throw new Error(`Could not load file (${res.status})`)
  return URL.createObjectURL(await res.blob())
}
async function postForm(api: FilesApi, url: string, fd: FormData) {
  const res = await authedFetch(api, url, { method: 'POST', body: fd })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `Upload failed (${res.status})`)
  return body
}
async function downloadAuthed(api: FilesApi, url: string, filename: string) {
  const u = await blobUrl(api, url)
  const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(u), 60_000)
}
function AuthImg({ api, src, alt, className }: { api: FilesApi; src: string; alt?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let obj: string | null = null, live = true
    blobUrl(api, src).then(u => { obj = u; if (live) setUrl(u); else URL.revokeObjectURL(u) }).catch(() => { if (live) setUrl(null) })
    return () => { live = false; if (obj) URL.revokeObjectURL(obj) }
  }, [api, src])
  return url ? <img src={url} alt={alt || ''} className={className} /> : <div className={className} />
}

const label = (t: string) => t.replace(/_/g, ' ').replace(/^\w/, ch => ch.toUpperCase())
const formatSize = (b: unknown) => { const n = Number(b); if (!n) return '-'; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB` }
const iconFor = (mime?: string | null) => (mime?.startsWith('image/') ? ImageIcon : mime?.includes('pdf') ? FileText : File)

export function DocumentsPage({ api, toast, config }: DocumentsPageProps) {
  const cfg = resolveDocumentsConfig(config)
  const showProjects = cfg.projects && (!config?.hasFeature || config.hasFeature('projects'))
  const fileInput = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<DocumentRow[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [filter, setFilter] = useState({ type: '', projectId: '', search: '' })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<File[]>([])
  const [form, setForm] = useState({ name: '', type: cfg.types[0] || 'general', projectId: '', description: '' })
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<DocumentRow | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [history, setHistory] = useState<DocumentRow | null>(null)
  const [markup, setMarkup] = useState<DocumentRow | null>(null)
  const [toDelete, setToDelete] = useState<DocumentRow | null>(null)

  // debounce the search box so every keystroke does not hit the API
  useEffect(() => { const h = setTimeout(() => setFilter(f => (f.search === search ? f : { ...f, search })), 300); return () => clearTimeout(h) }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = { page, limit: 25 }
      for (const [k, v] of Object.entries(filter)) if (v) params[k] = v
      const res = await api.get('/api/documents', params)
      setRows(Array.isArray(res) ? res : res?.data || []); setPagination(res?.pagination || null)
    } catch (e) { toast.error(errMsg(e, 'Could not load documents')) } finally { setLoading(false) }
  }, [api, page, filter])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!showProjects) return
    api.get('/api/projects', { limit: 100 }).then((r: any) => setProjects(Array.isArray(r) ? r : r?.data || [])).catch(() => setProjects([]))
  }, [api, showProjects])
  useEffect(() => {
    if (!preview) { setPreviewUrl(null); return }
    let obj: string | null = null, live = true
    blobUrl(api, preview.url).then(u => { obj = u; if (live) setPreviewUrl(u); else URL.revokeObjectURL(u) }).catch(() => { if (live) setPreviewUrl(null) })
    return () => { live = false; if (obj) URL.revokeObjectURL(obj) }
  }, [api, preview])

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setSelected(files); setForm(f => ({ ...f, name: files.length === 1 ? files[0].name : '' }))
  }
  const upload = async () => {
    if (!selected.length) return
    setUploading(true)
    let ok = 0
    try {
      for (const file of selected) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('name', (selected.length === 1 && form.name.trim()) || file.name)
        fd.append('type', form.type)
        if (form.projectId) fd.append('projectId', form.projectId)
        if (form.description.trim()) fd.append('description', form.description.trim())
        await postForm(api, '/api/documents', fd)
        ok++
      }
      toast.success(`${ok} file${ok === 1 ? '' : 's'} uploaded`)
      setSelected([]); setForm({ name: '', type: cfg.types[0] || 'general', projectId: '', description: '' }); load()
    } catch (e) { toast.error(errMsg(e, 'Upload failed')); if (ok) load() } finally { setUploading(false) }
  }
  const remove = async () => {
    if (!toDelete) return
    try { await api.delete(`/api/documents/${toDelete.id}`); toast.success('Document deleted'); setToDelete(null); load() }
    catch (e) { toast.error(errMsg(e, 'Could not delete')) }
  }
  const download = async (d: DocumentRow) => {
    try { await downloadAuthed(api, `/api/documents/${d.id}/download`, d.originalName || d.name || 'download') }
    catch (e) { const m = errMsg(e, ''); toast.error(/\(404\)/.test(m) ? 'This file is no longer in storage.' : `Download failed${m ? `: ${m}` : ''}`) }
  }

  const columns = [
    { key: 'name', label: 'Name', render: (v: any, r: DocumentRow) => { const Icon = iconFor(r.mimeType); return (
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 shrink-0 rounded-lg bg-gray-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
          {r.thumbnailUrl ? <AuthImg api={api} src={r.thumbnailUrl} className="w-10 h-10 object-cover" /> : <Icon className="w-5 h-5 text-gray-500 dark:text-slate-400" />}
        </div>
        <div className="min-w-0"><p className="font-medium truncate">{v}</p><p className="text-xs text-gray-500 dark:text-slate-400 truncate">{r.originalName}</p></div>
      </div>) } },
    { key: 'type', label: 'Type', render: (v: any) => label(String(v || 'general')) },
    ...(showProjects ? [{ key: 'project', label: 'Project', render: (v: any) => v?.name || '-' }] : []),
    { key: 'size', label: 'Size', render: (v: any) => formatSize(v) },
    { key: 'createdAt', label: 'Uploaded', render: (v: any, r: DocumentRow) => <span>{dateOnly(v)}{r.uploadedBy?.firstName ? <span className="block text-xs text-gray-500 dark:text-slate-400">{[r.uploadedBy.firstName, r.uploadedBy.lastName].filter(Boolean).join(' ')}</span> : null}</span> },
  ]
  const previewable = (d: DocumentRow) => !!(d.mimeType?.startsWith('image/') || d.mimeType?.includes('pdf'))

  return (
    <div>
      <PageHeader title="Documents" action={<Button onClick={() => fileInput.current?.click()}><Upload className="w-4 h-4" /> Upload</Button>} />
      <input ref={fileInput} type="file" multiple onChange={onPick} className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" data-testid="document-file-input" />

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 mb-6">
        <div className={`grid gap-3 md:grid-cols-${showProjects ? 4 : 3}`}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents…" className={inputCls} aria-label="Search documents" />
          <select value={filter.type} onChange={e => { setFilter({ ...filter, type: e.target.value }); setPage(1) }} className={inputCls} aria-label="Type">
            <option value="">All types</option>{cfg.types.map(t => <option key={t} value={t}>{label(t)}</option>)}
          </select>
          {showProjects && <select value={filter.projectId} onChange={e => { setFilter({ ...filter, projectId: e.target.value }); setPage(1) }} className={inputCls} aria-label="Project">
            <option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>}
          <Button variant="secondary" onClick={() => { setSearch(''); setFilter({ type: '', projectId: '', search: '' }); setPage(1) }}>Clear filters</Button>
        </div>
      </div>

      {!loading && rows.length === 0 && !filter.search && !filter.type && !filter.projectId ? (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-12 text-center">
          <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-700 dark:text-slate-200 font-medium">No documents yet</p>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1 mb-4">Upload contracts, photos, receipts — anything you want kept with the customer's record.</p>
          <Button onClick={() => fileInput.current?.click()}><Upload className="w-4 h-4" /> Upload a document</Button>
        </div>
      ) : (
        <DataTable<DocumentRow> data={rows} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No documents match these filters." actions={[
          { label: 'Preview', icon: Eye, onClick: d => setPreview(d), show: previewable },
          { label: 'Download', icon: Download, onClick: download },
          ...(cfg.versions ? [{ label: 'Versions', icon: History, onClick: (d: DocumentRow) => setHistory(d) }] : []),
          ...(cfg.markup ? [{ label: 'Markup', icon: PenTool, onClick: (d: DocumentRow) => setMarkup(d), show: (d: DocumentRow) => !!d.mimeType?.startsWith('image/') }] : []),
          { label: 'Delete', icon: Trash2, className: 'text-red-600 dark:text-red-300', onClick: d => setToDelete(d) },
        ]} />
      )}

      <Modal isOpen={selected.length > 0} onClose={() => setSelected([])} title={selected.length === 1 ? 'Upload document' : `Upload ${selected.length} documents`}>
        <div className="space-y-4">
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60 text-sm">
            {selected.map((f, i) => <p key={i} className="truncate"><span className="font-medium">{f.name}</span> <span className="text-gray-500 dark:text-slate-400">· {formatSize(f.size)}</span></p>)}
          </div>
          {selected.length === 1 && <Field label="Name"><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} /></Field>}
          <div className={`grid gap-3 ${showProjects ? 'grid-cols-2' : ''}`}>
            <Field label="Type"><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={inputCls}>{cfg.types.map(t => <option key={t} value={t}>{label(t)}</option>)}</select></Field>
            {showProjects && <Field label="Project (optional)"><select value={form.projectId} onChange={e => setForm({ ...form, projectId: e.target.value })} className={inputCls}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          </div>
          <Field label="Description (optional)"><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className={inputCls} /></Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="secondary" onClick={() => setSelected([])}>Cancel</Button>
          <Button onClick={upload} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload'}</Button>
        </div>
      </Modal>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setPreview(null)} role="dialog" aria-label={`Preview ${preview.name}`}>
          <div className="relative max-w-5xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between text-white mb-2"><span className="font-medium truncate">{preview.name}</span><button onClick={() => setPreview(null)} className="p-2 rounded-full bg-white/10 hover:bg-white/20" aria-label="Close"><X className="w-5 h-5" /></button></div>
            {!previewUrl ? <div className="text-center text-white/70 py-24">Loading…</div>
              : preview.mimeType?.startsWith('image/') ? <img src={previewUrl} alt={preview.name} className="max-w-full max-h-[85vh] object-contain rounded-lg mx-auto" />
              : <iframe src={previewUrl} title={preview.name} className="w-full h-[85vh] bg-white rounded-lg" />}
          </div>
        </div>
      )}

      {history && <HistoryModal api={api} toast={toast} doc={history} onClose={() => setHistory(null)} onChanged={load} />}
      {markup && <MarkupModal api={api} toast={toast} doc={markup} onClose={() => setMarkup(null)} />}
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} title="Delete document" message={`Delete "${toDelete?.name}"? The file${cfg.versions ? ' and its version history' : ''} cannot be recovered.`} confirmText="Delete" />
    </div>
  )
}

// ---------------------------------------------------------------- version history
function HistoryModal({ api, toast, doc, onClose, onChanged }: { api: FilesApi; toast: FilesToast; doc: DocumentRow; onClose: () => void; onChanged: () => void }) {
  const [versions, setVersions] = useState<any[]>([])
  const [current, setCurrent] = useState<DocumentRow>(doc)
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await api.get(`/api/documents/${doc.id}/versions`); setVersions(r?.data || []) }
    catch (e) { toast.error(errMsg(e, 'Could not load version history')) } finally { setLoading(false) }
  }, [api, doc.id])
  useEffect(() => { load() }, [load])
  const uploadVersion = async (file: File) => {
    setBusy(true)
    try {
      const fd = new FormData(); fd.append('file', file); if (note.trim()) fd.append('note', note.trim())
      const updated = await postForm(api, `/api/documents/${doc.id}/versions`, fd)
      setCurrent(c => ({ ...c, ...updated })); setNote(''); toast.success('New version uploaded — the previous file is kept below'); load(); onChanged()
    } catch (e) { toast.error(errMsg(e, 'Could not upload the new version')) } finally { setBusy(false) }
  }
  const restore = async (v: any) => {
    try { const updated = await api.post(`/api/documents/${doc.id}/versions/${v.id}/restore`, {}); setCurrent(c => ({ ...c, ...updated })); toast.success(`Restored v${v.versionNumber} — the replaced file was kept as a version`); load(); onChanged() }
    catch (e) { toast.error(errMsg(e, 'Could not restore')) }
  }
  return (
    <Modal isOpen onClose={onClose} title={`Versions — ${doc.name}`}>
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
          <p className="text-sm font-medium mb-2">Current file: <span className="font-normal">{current.originalName}</span></p>
          <div className="flex gap-2 items-center flex-wrap">
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="What changed? (optional)" className={`${inputCls} flex-1 min-w-[12rem]`} />
            <input ref={fileRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadVersion(f) }} />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}><UploadCloud className="w-4 h-4" />{busy ? 'Uploading…' : 'Upload new version'}</Button>
          </div>
        </div>
        {loading ? <p className="text-center text-gray-400 py-6">Loading…</p> : versions.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No previous versions — replaced files are kept here.</p> : (
          <div className="space-y-2">
            {versions.map(v => (
              <div key={v.id} className="rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 flex items-center justify-between gap-3">
                <div className="min-w-0"><p className="text-sm font-medium truncate">v{v.versionNumber} — {v.originalName}</p><p className="text-xs text-gray-500 dark:text-slate-400">{new Date(v.createdAt).toLocaleString()}{v.note ? ` — ${v.note}` : ''}</p></div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => downloadAuthed(api, `/api/documents/${doc.id}/versions/${v.id}/download`, v.originalName || 'download').catch(e => toast.error(errMsg(e, 'Download failed')))} className="p-2 rounded text-gray-500 hover:text-gray-900 dark:hover:text-slate-100" title="Download"><Download className="w-4 h-4" /></button>
                  <button onClick={() => restore(v)} className="p-2 rounded text-gray-500 hover:text-gray-900 dark:hover:text-slate-100" title="Restore this version"><RotateCcw className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- plan markup (normalized 0..1 coordinates)
type Shape = { kind: 'rect'; x: number; y: number; w: number; h: number } | { kind: 'pen'; points: Array<[number, number]> } | { kind: 'pin'; x: number; y: number; note: string }
function MarkupModal({ api, toast, doc, onClose }: { api: FilesApi; toast: FilesToast; doc: DocumentRow; onClose: () => void }) {
  const [layers, setLayers] = useState<any[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [tool, setTool] = useState<'rect' | 'pen' | 'pin'>('rect')
  const [drawing, setDrawing] = useState<Shape | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pinNote, setPinNote] = useState<{ x: number; y: number } | null>(null)
  const [noteText, setNoteText] = useState('')
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const R = 800
  useEffect(() => { let obj: string | null = null, live = true; blobUrl(api, doc.url).then(u => { obj = u; if (live) setImgUrl(u); else URL.revokeObjectURL(u) }).catch(() => {}); return () => { live = false; if (obj) URL.revokeObjectURL(obj) } }, [api, doc.url])
  const select = (m: any) => { setActiveId(m.id); try { setShapes(JSON.parse(m.data)) } catch { setShapes([]) } setDirty(false) }
  useEffect(() => { api.get(`/api/documents/${doc.id}/markups`).then((r: any) => { const list = r?.data || []; setLayers(list); if (list.length) select(list[0]) }).catch(e => toast.error(errMsg(e, 'Could not load markups'))) }, [api, doc.id])
  const norm = (e: React.PointerEvent): [number, number] => { const r = box.current!.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))] }
  const onDown = (e: React.PointerEvent) => { const [x, y] = norm(e); if (tool === 'pin') { setPinNote({ x, y }); setNoteText(''); return } (e.target as Element).setPointerCapture?.(e.pointerId); setDrawing(tool === 'rect' ? { kind: 'rect', x, y, w: 0, h: 0 } : { kind: 'pen', points: [[x, y]] }) }
  const onMove = (e: React.PointerEvent) => { if (!drawing) return; const [x, y] = norm(e); setDrawing(d => (d!.kind === 'rect' ? { ...(d as any), w: x - (d as any).x, h: y - (d as any).y } : { kind: 'pen', points: [...(d as any).points, [x, y]] })) }
  const onUp = () => { if (!drawing) return; const d = drawing; setDrawing(null); if (!(d.kind === 'rect' && Math.abs(d.w) < 0.005 && Math.abs(d.h) < 0.005)) { setShapes(s => [...s, d]); setDirty(true) } }
  const addPin = () => { if (pinNote && noteText.trim()) { setShapes(s => [...s, { kind: 'pin', x: pinNote.x, y: pinNote.y, note: noteText.trim() }]); setDirty(true) } setPinNote(null) }
  const save = async () => {
    setSaving(true)
    try {
      const data = JSON.stringify(shapes)
      if (activeId) await api.put(`/api/documents/${doc.id}/markups/${activeId}`, { data })
      else { const created = await api.post(`/api/documents/${doc.id}/markups`, { name: `Markup ${layers.length + 1}`, data }); setActiveId(created.id); setLayers(l => [created, ...l]) }
      setDirty(false); toast.success('Markup saved')
    } catch (e) { toast.error(errMsg(e, 'Could not save markup')) } finally { setSaving(false) }
  }
  const newLayer = () => { setActiveId(null); setShapes([]); setDirty(false) }
  const deleteLayer = async () => { if (!activeId) return; try { await api.delete(`/api/documents/${doc.id}/markups/${activeId}`); setLayers(l => l.filter(x => x.id !== activeId)); newLayer(); toast.success('Markup deleted') } catch (e) { toast.error(errMsg(e, 'Could not delete markup')) } }
  const toolBtn = (t: 'rect' | 'pen' | 'pin', Icon: React.ComponentType<{ className?: string }>, title: string) => <button key={t} onClick={() => setTool(t)} className={`p-2 rounded-lg border ${tool === t ? 'bg-orange-50 border-orange-400 text-orange-700 dark:bg-orange-900/30 dark:text-orange-200' : 'border-gray-300 dark:border-slate-600 text-gray-500 dark:text-slate-300'}`} title={title} aria-pressed={tool === t}><Icon className="w-4 h-4" /></button>
  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-label={`Markup ${doc.name}`}>
      <div className="bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-xl max-w-5xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex-wrap gap-2">
          <div className="font-semibold truncate">Markup — {doc.name}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={activeId || ''} onChange={e => { const m = layers.find(x => x.id === e.target.value); if (m) select(m); else newLayer() }} className={`${inputCls} w-auto py-1.5`}>
              <option value="">New layer…</option>{layers.map(m => <option key={m.id} value={m.id}>{m.name} ({dateOnly(m.updatedAt)})</option>)}
            </select>
            {toolBtn('rect', Square, 'Rectangle')}{toolBtn('pen', PenLine, 'Freehand')}{toolBtn('pin', MapPin, 'Pin with note')}
            <Button variant="secondary" onClick={() => { setShapes(s => s.slice(0, -1)); setDirty(true) }} disabled={!shapes.length}>Undo</Button>
            <Button onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Save'}</Button>
            {activeId && <Button variant="danger" onClick={deleteLayer} title="Delete layer"><Trash2 className="w-4 h-4" /></Button>}
            <button onClick={onClose} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800" aria-label="Close"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-gray-100 dark:bg-slate-800">
          {!imgUrl ? <div className="text-center text-gray-500 py-16">Loading image…</div> : (
            <div ref={box} className="relative inline-block select-none touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
              <img src={imgUrl} alt={doc.name} className="max-w-full block rounded-lg" draggable={false} />
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${R} ${R}`} preserveAspectRatio="none">
                {[...shapes, ...(drawing ? [drawing] : [])].map((s, i) => s.kind === 'rect'
                  ? <rect key={i} x={(s.w < 0 ? s.x + s.w : s.x) * R} y={(s.h < 0 ? s.y + s.h : s.y) * R} width={Math.abs(s.w) * R} height={Math.abs(s.h) * R} fill="rgba(220,38,38,0.12)" stroke="#dc2626" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                  : s.kind === 'pen'
                    ? <polyline key={i} points={s.points.map(([px, py]) => `${px * R},${py * R}`).join(' ')} fill="none" stroke="#dc2626" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                    : <g key={i}><circle cx={s.x * R} cy={s.y * R} r="8" fill="#dc2626" /><text x={s.x * R + 12} y={s.y * R + 4} fill="#dc2626" fontSize="16" style={{ paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>{s.note}</text></g>)}
              </svg>
            </div>
          )}
        </div>
        {pinNote && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-slate-700 flex items-center gap-2">
            <input autoFocus value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addPin(); if (e.key === 'Escape') setPinNote(null) }} placeholder="Pin note" className={`${inputCls} flex-1`} />
            <Button onClick={addPin} disabled={!noteText.trim()}>Add pin</Button>
            <Button variant="secondary" onClick={() => setPinNote(null)}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  )
}
