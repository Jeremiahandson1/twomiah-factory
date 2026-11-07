// Plan Takeoffs (landscaping parity row 4; Aspire's property takeoffs; feature plan_takeoffs, not ready). Server:
// crm/landscaping/planTakeoffs.ts (/api/plan-takeoffs), measuring in data/planTakeoffs.ts.
//   · upload a site plan (PDF, PNG or JPEG) for a property; a PDF's page is drawn here with PDF.js;
//   · Set scale: click both ends of a length you know, then type it in feet;
//   · Area / Length / Count: click the corners (or points, or each plant), then Finish; each item gets a name, a service (an area
//     whose service has an Area Pricing rate is priced by the rate card) and a unit price;
//   · Save keeps the points; the server measures them; Add to quote puts the items on an open quote or a new one.
// Points are kept as a share of the page's width on both axes, so the scale holds whatever size the page is drawn at.
import { useCallback, useEffect, useRef, useState } from 'react'
import { FileUp, Loader2, Ruler, Square, Spline, MapPin, Trash2 } from 'lucide-react'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { api } from '../../../api'
import { useToast, useConfirm, useMayWrite, useAuth } from '../../../shared'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'
import { SitePicker, useSites } from './SitePicker'

type Kind = 'area' | 'length' | 'count'
type Pt = [number, number]
interface Item { id: string; kind: Kind; label: string; serviceType: string | null; unitPrice: number | null; points: Pt[]; quantity?: number | null; unit?: string }
interface Takeoff { id: string; name: string; siteId: string | null; contactId: string | null; fileType: string; page: number; pageAspect: string | null; feetPerWidth: number | null; items: Item[] }
interface Row { id: string; name: string; items: number; scaled: boolean }
interface QuoteRow { id: string; number: string; name: string; status: string }

const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
const COLORS: Record<Kind, string> = { area: '#16a34a', length: '#2563eb', count: '#d97706' }
const KIND_LABEL: Record<Kind, string> = { area: 'Area', length: 'Length', count: 'Count' }
const UNIT: Record<Kind, string> = { area: 'sq ft', length: 'ft', count: 'each' }
const shoelace = (p: Pt[]) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1] } return Math.abs(s) / 2 }
const polyline = (p: Pt[]) => p.slice(1).reduce((t, q, i) => t + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0)
/** The same arithmetic the server does (data/planTakeoffs.ts measure), for the figure shown while drawing. */
const measure = (it: Pick<Item, 'kind' | 'points'>, scale: number | null) => it.kind === 'count' ? it.points.length : !scale ? null
  : it.kind === 'area' ? Math.round(shoelace(it.points) * scale * scale) : Math.round(polyline(it.points) * scale * 10) / 10
const newId = () => Math.random().toString(36).slice(2, 10)

/** The plan drawn to fit the box: a PDF page through PDF.js, or the picture. Reports the page's height ÷ width. */
function PlanImage({ takeoffId, fileType, page, onAspect, onPages }: { takeoffId: string; fileType: string; page: number; onAspect: (a: number) => void; onPages: (n: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<string | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let dead = false, url: string | null = null
    setErr(''); setImg(null)
    ;(async () => {
      try {
        const res: Response = await api.raw(`/api/plan-takeoffs/${takeoffId}/file`)
        if (!res.ok) throw new Error('The plan could not be loaded.')
        if (fileType !== 'application/pdf') { url = URL.createObjectURL(await res.blob()); if (!dead) setImg(url); return }
        const pdfjs: any = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise
        if (dead) return
        onPages(doc.numPages)
        const pg = await doc.getPage(Math.min(Math.max(1, page), doc.numPages))
        const base = pg.getViewport({ scale: 1 })
        const vp = pg.getViewport({ scale: Math.min(3, 1600 / base.width) })
        const cv = canvas.current
        if (!cv || dead) return
        cv.width = vp.width; cv.height = vp.height
        await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise
        onAspect(vp.height / vp.width)
      } catch (e) { if (!dead) setErr((e as Error).message || 'The plan could not be drawn.') }
    })()
    return () => { dead = true; if (url) URL.revokeObjectURL(url) }
  }, [takeoffId, fileType, page]) // eslint-disable-line react-hooks/exhaustive-deps
  if (err) return <p className="text-sm text-red-700 dark:text-red-400" role="alert">{err}</p>
  if (fileType !== 'application/pdf') return img ? <img src={img} alt="The plan" className="block w-full" onLoad={(e) => onAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)} /> : <Loader2 className="w-5 h-5 animate-spin m-4" />
  return <canvas ref={canvas} className="block w-full h-auto" aria-label="The plan" />
}

export default function PlanTakeoffsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const on = useAuth().hasFeature('plan_takeoffs')
  const mayCreate = useMayWrite('quotes:create')
  const mayEdit = useMayWrite('quotes:update')
  const mayDelete = useMayWrite('quotes:delete')
  const { sites, reloadSites } = useSites()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [t, setT] = useState<Takeoff | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [scale, setScale] = useState<number | null>(null)
  const [aspect, setAspect] = useState<number>(1.3)
  const [pages, setPages] = useState(1)
  const [tool, setTool] = useState<null | 'scale' | Kind>(null)
  const [draft, setDraft] = useState<Pt[]>([])
  const [scaleFeet, setScaleFeet] = useState('')
  const [upload, setUpload] = useState<{ siteId: string; name: string; file: File | null }>({ siteId: '', name: '', file: null })
  const [busy, setBusy] = useState(false)
  const [rates, setRates] = useState<string[]>([])
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [pick, setPick] = useState('new')
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/plan-takeoffs'); setRows(Array.isArray(r?.data) ? r.data : []) }
    catch (e) { toast.error(errorText(e, 'Could not load the plans')); setRows([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const open = useCallback(async (id: string) => {
    try {
      const r = await api.get(`/api/plan-takeoffs/${id}`) as Takeoff
      setT(r); setItems(r.items || []); setScale(r.feetPerWidth); setTool(null); setDraft([])
      if (r.pageAspect) setAspect(Number(r.pageAspect))
      if (r.contactId) {
        const q: any = await api.get('/api/quotes', { contactId: r.contactId, limit: 20 }).catch(() => null)
        const openQ = ((q?.data ?? []) as QuoteRow[]).filter((x) => x.status === 'draft' || x.status === 'sent')
        setQuotes(openQ); setPick(openQ[0]?.id ?? 'new')
      } else { setQuotes([]); setPick('new') }
    } catch (e) { toast.error(errorText(e, 'Could not open the plan')) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!on) return
    load()
    api.get('/api/area-pricing/rates').then((r: any) => setRates(((r?.data ?? r ?? []) as any[]).filter((x) => x.active !== false).map((x) => x.serviceType))).catch(() => {})
  }, [on, load])
  if (!on) return <div className="p-6 text-gray-600 dark:text-slate-300">Plan takeoffs are not turned on for this business.</div>

  const send = async () => {
    if (!upload.file) { toast.error('Choose the plan to upload.'); return }
    setBusy(true)
    try {
      const fd = new FormData()
      fd.set('file', upload.file)
      if (upload.name.trim()) fd.set('name', upload.name.trim())
      if (upload.siteId) fd.set('siteId', upload.siteId)
      const r = await api.upload('/api/plan-takeoffs', fd) as Takeoff
      toast.success('Plan uploaded — set its scale next'); setUpload({ siteId: '', name: '', file: null }); await load(); await open(r.id)
    } catch (e) { toast.error(errorText(e, 'Could not upload the plan')) }
    finally { setBusy(false) }
  }
  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!tool || !box.current) return
    const r = box.current.getBoundingClientRect()
    const p: Pt = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.width]
    if (tool === 'scale') { setDraft((d) => (d.length >= 2 ? [p] : [...d, p])); return }
    setDraft((d) => [...d, p])
  }
  const finish = () => {
    if (!tool || tool === 'scale') return
    const need = tool === 'area' ? 3 : tool === 'length' ? 2 : 1
    if (draft.length < need) { toast.error(tool === 'area' ? 'Click at least three corners.' : tool === 'length' ? 'Click at least two points.' : 'Click at least one.'); return }
    setItems((all) => [...all, { id: newId(), kind: tool, label: '', serviceType: null, unitPrice: null, points: draft }])
    setDraft([]); setTool(null)
  }
  const applyScale = () => {
    const ft = Number(scaleFeet)
    if (draft.length !== 2 || !(ft > 0)) { toast.error('Click both ends of a length you know, then type it in feet.'); return }
    const d = Math.hypot(draft[1][0] - draft[0][0], draft[1][1] - draft[0][1])
    if (!(d > 0)) { toast.error('Click two different points.'); return }
    setScale(Math.round((ft / d) * 10_000) / 10_000); setDraft([]); setTool(null); setScaleFeet('')
  }
  const save = async () => {
    if (!t) return
    setBusy(true)
    try {
      const r = await api.put(`/api/plan-takeoffs/${t.id}`, { items: items.map(({ quantity: _q, unit: _u, ...x }) => x), feetPerWidth: scale, pageAspect: aspect, page: t.page }) as Takeoff
      setT(r); setItems(r.items); toast.success('Takeoff saved'); await load()
    } catch (e) { toast.error(errorText(e, 'Could not save the takeoff')) }
    finally { setBusy(false) }
  }
  const toQuote = async () => {
    if (!t) return
    setBusy(true)
    try {
      await save()
      if (pick === 'new') {
        const { lines, skipped } = await api.get(`/api/plan-takeoffs/${t.id}/lines`) as any
        if (!lines?.length) throw new Error(skipped?.length ? 'Set the plan’s scale first: nothing is measured yet.' : 'Measure something on the plan first.')
        const q: any = await api.post('/api/quotes', { name: t.name, contactId: t.contactId || undefined, siteId: t.siteId || undefined, lineItems: lines.map((l: any) => ({ ...l, optional: false })) })
        toast.success(`New quote ${q?.number ?? ''} made from the plan`)
      } else {
        const out: any = await api.post(`/api/plan-takeoffs/${t.id}/quote`, { quoteId: pick })
        toast.success(`${out?.lines?.length ?? 0} line${out?.lines?.length === 1 ? '' : 's'} added to the quote${out?.skipped?.length ? ` — not measured yet: ${out.skipped.join(', ')}` : ''}`)
      }
    } catch (e) { toast.error(errorText(e, 'Could not put it on a quote')) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!t || !(await confirm('The plan and its measurements are deleted. Quotes made from it stay.', { title: `Delete “${t.name}”?`, confirmText: 'Delete plan' }))) return
    try { await api.delete(`/api/plan-takeoffs/${t.id}`); setT(null); toast.success('Plan deleted'); await load() }
    catch (e) { toast.error(errorText(e, 'Could not delete the plan')) }
  }
  const setItem = (id: string, patch: Partial<Item>) => setItems((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const pts = (p: Pt[]) => p.map(([x, y]) => `${x},${y}`).join(' ')
  const stroke = 0.002

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1"><Ruler className="w-6 h-6" /> Plan takeoffs</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">Upload a site plan, set its scale, measure areas, lengths and counts on it, and put them on a quote.</p>

      {mayCreate && (
        <div className="flex flex-wrap items-end gap-2 mb-4 rounded border p-3 dark:border-slate-700">
          <label className="text-sm">Plan (PDF, PNG or JPEG)<input className="block mt-1 text-sm" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} /></label>
          <input className="input" aria-label="Plan name" placeholder="Name (optional)" value={upload.name} onChange={(e) => setUpload({ ...upload, name: e.target.value })} />
          <div className="min-w-[14rem]"><SitePicker id="plan-site" value={upload.siteId} sites={sites} onAdded={reloadSites} onChange={(siteId) => setUpload({ ...upload, siteId })} /></div>
          <button className="btn-primary flex items-center gap-1" disabled={busy || !upload.file} onClick={send}><FileUp className="w-4 h-4" /> Upload</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {(rows || []).map((r) => <button key={r.id} className={`btn ${t?.id === r.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => open(r.id)}>{r.name} · {r.items} item{r.items === 1 ? '' : 's'}{r.scaled ? '' : ' · no scale'}</button>)}
        {rows === null && <Loader2 className="w-4 h-4 animate-spin" />}
        {rows?.length === 0 && <p className="text-gray-500 dark:text-slate-400 text-sm">No plans yet.</p>}
      </div>

      {t && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t.name}</span>
            <span className="text-sm text-gray-500 dark:text-slate-400">{scale ? `Scale set: the page is ${Math.round(scale).toLocaleString()} ft across` : 'No scale yet — set it before measuring areas and lengths'}</span>
            {pages > 1 && (
              <label className="text-sm">Page <select className="input w-auto" value={t.page} onChange={(e) => setT({ ...t, page: Number(e.target.value) })}>{Array.from({ length: pages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
            )}
          </div>
          {mayEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <button className={`btn ${tool === 'scale' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setTool(tool === 'scale' ? null : 'scale'); setDraft([]) }}><Ruler className="inline w-4 h-4 mr-1" />Set scale</button>
              {(['area', 'length', 'count'] as Kind[]).map((k) => (
                <button key={k} className={`btn ${tool === k ? 'btn-primary' : 'btn-secondary'}`} disabled={k !== 'count' && !scale} onClick={() => { setTool(tool === k ? null : k); setDraft([]) }}>
                  {k === 'area' ? <Square className="inline w-4 h-4 mr-1" /> : k === 'length' ? <Spline className="inline w-4 h-4 mr-1" /> : <MapPin className="inline w-4 h-4 mr-1" />}{KIND_LABEL[k]}
                </button>
              ))}
              {tool && tool !== 'scale' && <button className="btn-primary" onClick={finish}>Finish ({draft.length})</button>}
              {tool === 'scale' && draft.length === 2 && (
                <span className="flex items-center gap-2"><input className="input w-28" type="number" min={0} step="any" aria-label="Length of that line in feet" placeholder="Feet" value={scaleFeet} onChange={(e) => setScaleFeet(e.target.value)} /><button className="btn-primary" onClick={applyScale}>Use as scale</button></span>
              )}
            </div>
          )}
          {tool && <p className="text-xs text-gray-500 dark:text-slate-400">{tool === 'scale' ? 'Click both ends of a length you know (a scale bar, a dimensioned wall), then type it in feet.' : tool === 'area' ? 'Click each corner in order, then Finish.' : tool === 'length' ? 'Click along the edge, then Finish.' : 'Click each one (each plant, each head), then Finish.'}</p>}

          <div ref={box} className="relative w-full overflow-hidden rounded border bg-white dark:border-slate-700">
            <PlanImage takeoffId={t.id} fileType={t.fileType} page={t.page} onAspect={setAspect} onPages={setPages} />
            <svg className={`absolute inset-0 w-full h-full ${tool ? 'cursor-crosshair' : ''}`} viewBox={`0 0 1 ${aspect}`} preserveAspectRatio="none" onClick={click} aria-label="Measurements drawn on the plan">
              {items.map((it) => it.kind === 'area'
                ? <polygon key={it.id} points={pts(it.points)} fill={COLORS.area} fillOpacity={0.25} stroke={COLORS.area} strokeWidth={stroke} />
                : it.kind === 'length'
                  ? <polyline key={it.id} points={pts(it.points)} fill="none" stroke={COLORS.length} strokeWidth={stroke * 1.5} />
                  : <g key={it.id}>{it.points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={0.006} fill={COLORS.count} />)}</g>)}
              {draft.length > 0 && (tool === 'count'
                ? draft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={0.006} fill={COLORS.count} />)
                : <polyline points={pts(draft)} fill="none" stroke={tool === 'scale' ? '#dc2626' : COLORS[tool as Kind] || '#111'} strokeWidth={stroke * 1.5} strokeDasharray="0.006 0.004" />)}
            </svg>
          </div>

          {items.length > 0 && (
            <div className="space-y-2">
              {items.map((it) => {
                const q = measure(it, scale)
                return (
                  <div key={it.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLORS[it.kind] }} aria-hidden="true" />
                    <span className="w-16">{KIND_LABEL[it.kind]}</span>
                    <input className="input flex-1 min-w-[10rem]" aria-label="What it is" placeholder="What it is (e.g. Front lawn)" disabled={!mayEdit} value={it.label} onChange={(e) => setItem(it.id, { label: e.target.value })} />
                    <select className="input w-auto" aria-label="Service" disabled={!mayEdit} value={it.serviceType ?? ''} onChange={(e) => setItem(it.id, { serviceType: e.target.value || null })}>
                      <option value="">No rate — price per {UNIT[it.kind]}</option>
                      {it.kind === 'area' && rates.map((s) => <option key={s} value={s}>{codeLabel(s)} (rate card)</option>)}
                    </select>
                    {!(it.kind === 'area' && it.serviceType) && <input className="input w-28" type="number" min={0} step="any" aria-label={`Price per ${UNIT[it.kind]}`} placeholder={`$ per ${UNIT[it.kind]}`} disabled={!mayEdit} value={it.unitPrice ?? ''} onChange={(e) => setItem(it.id, { unitPrice: e.target.value === '' ? null : Number(e.target.value) })} />}
                    <span className="font-medium w-28 text-right">{q == null ? 'set the scale' : `${q.toLocaleString()} ${UNIT[it.kind]}`}</span>
                    {mayEdit && <button aria-label={`Delete ${it.label || KIND_LABEL[it.kind]}`} className="text-red-600 dark:text-red-400" onClick={() => setItems((all) => all.filter((x) => x.id !== it.id))}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                )
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t pt-3 dark:border-slate-700">
            {mayEdit && <button className="btn-primary" disabled={busy} onClick={save}>Save takeoff</button>}
            {mayEdit && (
              <>
                <select aria-label="Quote to add to" className="input w-auto" value={pick} onChange={(e) => setPick(e.target.value)}>
                  {mayCreate && <option value="new">A new quote{t.contactId ? ' for this customer' : ''}</option>}
                  {quotes.map((q) => <option key={q.id} value={q.id}>{q.number} · {q.name} ({codeLabel(q.status)})</option>)}
                </select>
                <button className="btn-secondary" disabled={busy || !items.length} onClick={toQuote}>Add to quote</button>
              </>
            )}
            {mayDelete && <button className="text-red-600 dark:text-red-400 text-sm ml-auto" onClick={remove}><Trash2 className="inline w-4 h-4" /> Delete plan</button>}
          </div>
        </div>
      )}
    </div>
  )
}
