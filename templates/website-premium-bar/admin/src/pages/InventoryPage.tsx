// Inventory — the owner's back office for stock.
//   Stock:    every item, estimated on hand, par, what's low, what it costs.
//   Recipes:  what goes into each menu item size → plate cost and cost %; each tap's pour cost.
//   Counts:   counts done on the bar phone, and each one against the last (variance, food and pour cost).
//   Orders:   "order what's low" drafts per vendor, send, receive (receiving sets the new price); vendors.
//   Menu mix: popularity × margin, the last 30 days.
import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../api/client'
import { Label, Hint } from '../components/Field'

const money = (c: number | null | undefined) => (c === null || c === undefined ? '—' : (c < 0 ? '−' : '') + '$' + (Math.abs(c) / 100).toFixed(2))
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : String(Math.round(n * 100) / 100))
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
const dollarsToCents = (s: string) => (s.trim() === '' ? null : Math.round(Number(s.replace(/[^\d.]/g, '')) * 100))
type Msg = { ok: boolean; text: string } | null
const Note = ({ m }: { m: Msg }) => (m ? <div className={'text-sm rounded-lg px-3 py-2 mb-3 border ' + (m.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')} role="status">{m.text}</div> : null)

interface Stock { id: string; name: string; category: string; unit: string; unitLabel: string; packName: string; packSize: number; packCostCents: number | null; unitCostCents: number | null; vendorId: string | null; vendorName: string | null; parPacks: number | null; isActive: boolean; lastCountAt: string | null; onHand: number | null; onHandPacks: number | null; low: boolean; suggestPacks: number }
interface Vendor { id: string; name: string; contact: string | null; phone: string | null; email: string | null; orderDays: string | null; note: string | null; isActive: boolean }
interface StockResp { stock: Stock[]; vendors: Vendor[]; categories: Array<{ id: string; label: string }>; units: Record<string, string>; presets: Array<{ name: string; unit: string; size: number }> }

// ─── Stock ──────────────────────────────────────────────────────────────────
function StockEditor({ item, meta, onClose, onSaved }: { item: Stock | null; meta: StockResp; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: item?.name || '', category: item?.category || 'food', unit: item?.unit || 'each', packName: item?.packName || 'each', packSize: item ? String(item.packSize) : '1',
    packCost: item?.packCostCents != null ? (item.packCostCents / 100).toFixed(2) : '', vendorId: item?.vendorId || '', par: item?.parPacks != null ? String(item.parPacks) : '', isActive: item ? item.isActive : true,
  })
  const [msg, setMsg] = useState<Msg>(null)
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const preset = (name: string) => { const p = meta.presets.find((x) => x.name === name); if (p) setF({ ...f, packName: p.name, unit: p.unit, packSize: String(p.size) }) }
  const save = async () => {
    setMsg(null)
    const b = { name: f.name, category: f.category, unit: f.unit, packName: f.packName, packSize: f.packSize, packCostCents: dollarsToCents(f.packCost), vendorId: f.vendorId || null, parPacks: f.par, isActive: f.isActive }
    try { if (item) await api.patch(`/api/admin/inventory/stock/${item.id}`, b); else await api.post('/api/admin/inventory/stock', b); onSaved(); onClose() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const unitCost = dollarsToCents(f.packCost) !== null && Number(f.packSize) > 0 ? (dollarsToCents(f.packCost) as number) / Number(f.packSize) : null
  return (
    <aside className="card card-padding" aria-labelledby="se-h">
      <div className="flex justify-between items-start gap-3 mb-3">
        <h2 id="se-h" className="text-xl text-ink">{item ? item.name : 'New stock item'}</h2>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm inline-flex items-center" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      <Note m={msg} />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label htmlFor="se-name">Name</Label><input id="se-name" className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Ground chuck, Spaten Lager, Buns" /></div>
        <div><Label htmlFor="se-cat">Kind</Label><select id="se-cat" className="input" value={f.category} onChange={(e) => set('category', e.target.value)}>{meta.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
        <div><Label htmlFor="se-preset">Bought as</Label><select id="se-preset" className="input" value="" onChange={(e) => preset(e.target.value)}><option value="">Pick a common pack…</option>{meta.presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</select></div>
        <div><Label htmlFor="se-pack">Pack</Label><input id="se-pack" className="input" value={f.packName} onChange={(e) => set('packName', e.target.value)} placeholder="case of 24" /></div>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <div><Label htmlFor="se-size">Holds</Label><input id="se-size" className="input" inputMode="decimal" value={f.packSize} onChange={(e) => set('packSize', e.target.value)} /></div>
          <div><Label htmlFor="se-unit">Unit</Label><select id="se-unit" className="input" value={f.unit} onChange={(e) => set('unit', e.target.value)}>{Object.entries(meta.units).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div><Label htmlFor="se-cost">Price per pack ($)</Label><input id="se-cost" className="input" inputMode="decimal" value={f.packCost} onChange={(e) => set('packCost', e.target.value)} /></div>
        <div><Label htmlFor="se-par">Keep at least (packs)</Label><input id="se-par" className="input" inputMode="decimal" value={f.par} onChange={(e) => set('par', e.target.value)} placeholder="2" /></div>
        <div className="col-span-2"><Label htmlFor="se-vendor">Vendor</Label><select id="se-vendor" className="input" value={f.vendorId} onChange={(e) => set('vendorId', e.target.value)}><option value="">None</option>{meta.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <label className="flex items-center gap-2 text-sm text-ink col-span-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} /> Still carried (untick to hide it from counts and orders)</label>
      </div>
      <Hint>{unitCost !== null ? `That's ${(unitCost / 100).toFixed(unitCost < 10 ? 3 : 2)} per ${meta.units[f.unit]}. Receiving an order updates the price.` : 'The price comes in with the first order received, or type it here.'}</Hint>
      <button type="button" className="btn-primary btn-md mt-3" onClick={save}>Save</button>
    </aside>
  )
}

function StockTab() {
  const [d, setD] = useState<StockResp | null>(null)
  const [open, setOpen] = useState<Stock | 'new' | null>(null)
  const [filter, setFilter] = useState<'all' | 'low'>('all')
  const [err, setErr] = useState<string | null>(null)
  const load = () => api.get<StockResp>('/api/admin/inventory/stock').then(setD).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])
  if (!d) return <p className="text-muted text-sm">{err || 'Loading…'}</p>
  const rows = d.stock.filter((s) => filter === 'all' || s.low)
  const value = d.stock.reduce((n, s) => n + (s.onHand !== null && s.unitCostCents !== null ? s.onHand * s.unitCostCents : 0), 0)
  const catLabel = Object.fromEntries(d.categories.map((c) => [c.id, c.label]))
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-muted">{d.stock.length} items · about {money(Math.round(value))} on the shelves · {d.stock.filter((s) => s.low).length} below par</p>
        <div className="flex gap-2">
          {(['all', 'low'] as const).map((k) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={'px-3 py-1.5 rounded-full text-sm border ' + (filter === k ? 'bg-ink text-white border-ink' : 'border-line text-ink-soft hover:bg-paper')}>{k === 'all' ? 'All' : 'Below par'}</button>)}
          <button type="button" className="btn-primary btn-md" onClick={() => setOpen('new')}>Add stock item</button>
        </div>
      </div>
      <div className={open ? 'grid lg:grid-cols-[1fr_440px] gap-4 items-start' : ''}>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Item</th><th className="p-3">Kind</th><th className="p-3 text-right">On hand</th><th className="p-3 text-right">Par</th><th className="p-3 text-right">Pack price</th><th className="p-3">Vendor</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((s) => (
                <tr key={s.id} className="hover:bg-paper cursor-pointer" onClick={() => setOpen(s)}>
                  <td className="p-3"><button type="button" className="text-ink text-left hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(s) }}>{s.name}</button><div className="text-xs text-muted">{s.packName}{s.packSize !== 1 ? ` · ${fmt(s.packSize)} ${s.unitLabel}` : ''}</div></td>
                  <td className="p-3 text-ink-soft">{catLabel[s.category] || s.category}</td>
                  <td className="p-3 text-right tabular-nums">{s.onHandPacks === null ? <span className="text-muted">not counted</span> : <>{fmt(s.onHandPacks)} {s.low && <span className="ml-1 text-xs text-red-700 font-semibold">low · order {s.suggestPacks}</span>}</>}</td>
                  <td className="p-3 text-right tabular-nums text-muted">{fmt(s.parPacks)}</td>
                  <td className="p-3 text-right tabular-nums">{money(s.packCostCents)}</td>
                  <td className="p-3 text-muted">{s.vendorName || '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">{d.stock.length ? 'Nothing below par.' : 'No stock items yet. Add what you buy: the beef, the buns, the fryer oil, each keg and bottle.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {open && <StockEditor key={open === 'new' ? 'new' : open.id} item={open === 'new' ? null : open} meta={d} onClose={() => setOpen(null)} onSaved={load} />}
      </div>
      <p className="text-xs text-muted mt-3">On hand is the last count, plus orders received since, minus what the register says was used (recipes × what sold). Count to reset it.</p>
    </div>
  )
}

// ─── Recipes ────────────────────────────────────────────────────────────────
interface Size { id: string; name: string; priceCents: number | null; costCents: number | null; missing: string[]; pct: number | null; hasRecipe: boolean }
interface RItem { id: string; name: string; lines: Array<{ id: string; sizeId: string | null; stockItemId: string; qty: number; name: string; unit: string }>; sizes: Size[] }
interface Pour { tapId: string; line: number; beer: string; priceCents: number | null; stockItemId: string | null; stockName: string | null; pourOz: number; costCents: number | null; pct: number | null }
interface Book { sections: Array<{ id: string; name: string; kind: string; items: RItem[] }>; pours: Pour[]; stock: Array<{ id: string; name: string; unit: string; unitLabel: string; category: string; unitCostCents: number | null }> }

function RecipeEditor({ item, size, book, onClose, onSaved }: { item: RItem; size: Size; book: Book; onClose: () => void; onSaved: () => void }) {
  const sized = item.lines.filter((l) => l.sizeId === size.id)
  const [scope, setScope] = useState<'size' | 'all'>(sized.length || item.sizes.length === 1 ? (item.sizes.length === 1 ? 'all' : 'size') : 'all')
  const start = (scope === 'size' ? sized : item.lines.filter((l) => l.sizeId === null)).map((l) => ({ stockItemId: l.stockItemId, qty: String(l.qty) }))
  const [lines, setLines] = useState(start.length ? start : [{ stockItemId: '', qty: '' }])
  const [msg, setMsg] = useState<Msg>(null)
  const stockById = useMemo(() => new Map(book.stock.map((s) => [s.id, s])), [book])
  const cost = lines.reduce<number | null>((n, l) => { const s = stockById.get(l.stockItemId); if (!s || n === null) return n; if (s.unitCostCents === null) return null; return n + Number(l.qty || 0) * s.unitCostCents }, 0)
  const save = async () => {
    setMsg(null)
    try {
      await api.put(`/api/admin/inventory/recipes/${item.id}`, { sizeId: scope === 'size' ? size.id : null, lines: lines.filter((l) => l.stockItemId && Number(l.qty) > 0) })
      onSaved(); setMsg({ ok: true, text: 'Saved.' })
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <aside className="card card-padding" aria-labelledby="re-h">
      <div className="flex justify-between items-start gap-3 mb-3">
        <div><h2 id="re-h" className="text-xl text-ink">{item.name}</h2><p className="text-sm text-muted">{size.name !== 'Regular' ? size.name + ' · ' : ''}sells for {money(size.priceCents)}</p></div>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm inline-flex items-center" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      <Note m={msg} />
      {item.sizes.length > 1 && (
        <fieldset className="mb-3"><legend className="text-sm text-ink mb-1">This recipe is for</legend>
          <label className="mr-4 text-sm"><input type="radio" checked={scope === 'size'} onChange={() => setScope('size')} /> {size.name} only</label>
          <label className="text-sm"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> every size</label>
        </fieldset>
      )}
      <div className="grid gap-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_60px_36px] gap-2 items-end">
            <div><Label htmlFor={'rl-s' + i}>Stock item</Label><select id={'rl-s' + i} className="input" value={l.stockItemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, stockItemId: e.target.value } : x)))}><option value="">Pick…</option>{book.stock.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><Label htmlFor={'rl-q' + i}>How much</Label><input id={'rl-q' + i} className="input" inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></div>
            <span className="text-sm text-muted pb-3">{stockById.get(l.stockItemId)?.unitLabel || ''}</span>
            <button type="button" className="btn-secondary btn-sm mb-1" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
      <button type="button" className="btn-secondary btn-md mt-2" onClick={() => setLines([...lines, { stockItemId: '', qty: '' }])}>Add a line</button>
      <p className="text-sm text-ink mt-3">Costs {cost === null ? 'unknown (a stock item has no price yet)' : money(Math.round(cost))}{cost !== null && size.priceCents ? ` · ${(Math.round((cost / size.priceCents) * 1000) / 10).toFixed(1)}% of the price` : ''}</p>
      <Hint>A half-pound burger: 0.5 lb of beef, 1 bun, 2 oz of fries on the platter. Anything you don't track (salt, ketchup) can stay off.</Hint>
      <button type="button" className="btn-primary btn-md mt-3" onClick={save}>Save recipe</button>
    </aside>
  )
}

function RecipesTab() {
  const [b, setB] = useState<Book | null>(null)
  const [open, setOpen] = useState<{ item: RItem; size: Size } | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const load = () => api.get<Book>('/api/admin/inventory/recipes').then((r) => { setB(r); if (open) { const it = r.sections.flatMap((s) => s.items).find((i) => i.id === open.item.id); const sz = it?.sizes.find((z) => z.id === open.size.id); if (it && sz) setOpen({ item: it, size: sz }) } }).catch((e) => setMsg({ ok: false, text: e.message }))
  useEffect(() => { load() }, [])
  if (!b) return <p className="text-muted text-sm">Loading…</p>
  const kegs = b.stock.filter((s) => s.category === 'beer')
  const setPour = async (p: Pour, patch: Record<string, unknown>) => { setMsg(null); try { await api.patch(`/api/admin/inventory/taps/${p.tapId}`, patch); load() } catch (e: any) { setMsg({ ok: false, text: e.message }) } }
  return (
    <div className={open ? 'grid lg:grid-cols-[1fr_460px] gap-4 items-start' : ''}>
      <div className="grid gap-4">
        <Note m={msg} />
        {!b.stock.length && <p className="text-sm text-muted">Add stock items first (Stock tab); recipes are made of them.</p>}
        {b.sections.map((s) => (
          <section key={s.id} className="card overflow-x-auto">
            <h2 className="px-3 pt-3 text-sm font-semibold uppercase tracking-wide text-muted">{s.name}</h2>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Item</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Costs</th><th className="p-3 text-right">Cost %</th></tr></thead>
              <tbody className="divide-y divide-line">
                {s.items.flatMap((i) => i.sizes.map((z) => (
                  <tr key={i.id + z.id} className="hover:bg-paper cursor-pointer" onClick={() => setOpen({ item: i, size: z })}>
                    <td className="p-3"><button type="button" className="text-ink text-left hover:underline" onClick={(e) => { e.stopPropagation(); setOpen({ item: i, size: z }) }}>{i.name}{z.name !== 'Regular' ? <span className="text-muted"> · {z.name}</span> : null}</button></td>
                    <td className="p-3 text-right tabular-nums">{money(z.priceCents)}</td>
                    <td className="p-3 text-right tabular-nums">{!z.hasRecipe ? <span className="text-muted">no recipe</span> : z.costCents === null ? <span className="text-amber-700" title={z.missing.join(', ')}>no price: {z.missing[0]}</span> : money(z.costCents)}</td>
                    <td className={'p-3 text-right tabular-nums ' + (z.pct !== null && z.pct > 40 ? 'text-red-700 font-semibold' : '')}>{z.pct === null ? '—' : z.pct.toFixed(1) + '%'}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </section>
        ))}
        <section className="card overflow-x-auto">
          <h2 className="px-3 pt-3 text-sm font-semibold uppercase tracking-wide text-muted">On tap</h2>
          <p className="px-3 text-xs text-muted">Tapping a new keg on the console links it to the beer stock item with the same name. Each pour's cost is kept with the sale.</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Line</th><th className="p-3">Keg (stock item)</th><th className="p-3">Pour (oz)</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Costs</th><th className="p-3 text-right">Pour cost</th></tr></thead>
            <tbody className="divide-y divide-line">
              {b.pours.map((p) => (
                <tr key={p.tapId}>
                  <td className="p-3">{p.line} · {p.beer}</td>
                  <td className="p-3"><label className="sr-only" htmlFor={'tk' + p.tapId}>Keg on line {p.line}</label><select id={'tk' + p.tapId} className="input" value={p.stockItemId || ''} onChange={(e) => setPour(p, { stockItemId: e.target.value || null })}><option value="">Not linked</option>{kegs.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></td>
                  <td className="p-3"><label className="sr-only" htmlFor={'to' + p.tapId}>Pour size on line {p.line}</label><input id={'to' + p.tapId} className="input w-20" inputMode="decimal" defaultValue={p.pourOz} onBlur={(e) => Number(e.target.value) !== p.pourOz && setPour(p, { pourOz: e.target.value })} /></td>
                  <td className="p-3 text-right tabular-nums">{money(p.priceCents)}</td>
                  <td className="p-3 text-right tabular-nums">{money(p.costCents)}</td>
                  <td className="p-3 text-right tabular-nums">{p.pct === null ? '—' : p.pct.toFixed(1) + '%'}</td>
                </tr>
              ))}
              {!b.pours.length && <tr><td colSpan={6} className="p-6 text-center text-muted">Nothing on tap.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
      {open && <RecipeEditor key={open.item.id + open.size.id} item={open.item} size={open.size} book={b} onClose={() => setOpen(null)} onSaved={load} />}
    </div>
  )
}

// ─── Counts ─────────────────────────────────────────────────────────────────
interface CountRow { id: string; status: string; startedAt: string; finishedAt: string | null; finishedBy: string | null; items: number }
interface Report { previous: { finishedAt: string } | null; rows: Array<{ stockItemId: string; name: string; unit: string; start: number; received: number; end: number; actual: number; expected: number; varianceUnits: number; varianceCents: number | null }>; totals: { varianceCents: number; foodUsedCents: number; drinkUsedCents: number; foodSalesCents: number; drinkSalesCents: number; foodCostPct: number | null; pourCostPct: number | null } | null }

function CountsTab() {
  const [d, setD] = useState<{ counts: CountRow[]; current: { startedAt: string; startedBy: string | null; lines: unknown[] } | null } | null>(null)
  const [rep, setRep] = useState<{ id: string; r: Report } | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  useEffect(() => { api.get<any>('/api/admin/inventory/counts').then(setD).catch((e) => setMsg({ ok: false, text: e.message })) }, [])
  const openReport = async (id: string) => { setMsg(null); try { setRep({ id, r: await api.get<Report>(`/api/admin/inventory/counts/${id}/report`) }) } catch (e: any) { setMsg({ ok: false, text: e.message }) } }
  if (!d) return <p className="text-muted text-sm">Loading…</p>
  return (
    <div className="grid gap-4">
      <Note m={msg} />
      <p className="text-sm text-ink">Counts are done on the bar phone: <strong>Register → Count</strong> (<span className="font-mono">/register/count</span>). {d.current ? `One is in progress: ${d.current.lines.length} item${d.current.lines.length === 1 ? '' : 's'} counted since ${when(d.current.startedAt)}${d.current.startedBy ? ' by ' + d.current.startedBy : ''}.` : ''}</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Finished</th><th className="p-3">By</th><th className="p-3 text-right">Items</th><th className="p-3"></th></tr></thead>
          <tbody className="divide-y divide-line">
            {d.counts.filter((c) => c.status === 'done').map((c) => (
              <tr key={c.id}><td className="p-3">{when(c.finishedAt)}</td><td className="p-3 text-muted">{c.finishedBy || '—'}</td><td className="p-3 text-right tabular-nums">{c.items}</td>
                <td className="p-3 text-right"><button type="button" className="btn-secondary btn-sm" onClick={() => openReport(c.id)}>Against the last count</button></td></tr>
            ))}
            {!d.counts.some((c) => c.status === 'done') && <tr><td colSpan={4} className="p-6 text-center text-muted">No finished counts yet. Two counts make the first comparison.</td></tr>}
          </tbody>
        </table>
      </div>
      {rep && (
        <section className="card card-padding" aria-labelledby="rep-h">
          <div className="flex justify-between items-start gap-3 mb-2"><h2 id="rep-h" className="text-xl text-ink">Since {rep.r.previous ? when(rep.r.previous.finishedAt) : 'the start'}</h2><button type="button" onClick={() => setRep(null)} className="btn-secondary btn-sm inline-flex items-center" aria-label="Close"><X className="w-4 h-4" /></button></div>
          {!rep.r.totals ? <p className="text-sm text-muted">This is the first count, so there's nothing to compare it to yet. The next one will be.</p> : (
            <>
              <div className="grid sm:grid-cols-3 gap-3 mb-4">
                <div className="rounded-lg border border-line p-3"><div className="text-xs text-muted uppercase tracking-wide">Food cost</div><div className="text-2xl text-ink tabular-nums">{rep.r.totals.foodCostPct === null ? '—' : rep.r.totals.foodCostPct.toFixed(1) + '%'}</div><div className="text-xs text-muted">{money(rep.r.totals.foodUsedCents)} used on {money(rep.r.totals.foodSalesCents)} of food</div></div>
                <div className="rounded-lg border border-line p-3"><div className="text-xs text-muted uppercase tracking-wide">Pour cost</div><div className="text-2xl text-ink tabular-nums">{rep.r.totals.pourCostPct === null ? '—' : rep.r.totals.pourCostPct.toFixed(1) + '%'}</div><div className="text-xs text-muted">{money(rep.r.totals.drinkUsedCents)} used on {money(rep.r.totals.drinkSalesCents)} of drinks</div></div>
                <div className="rounded-lg border border-line p-3"><div className="text-xs text-muted uppercase tracking-wide">Not accounted for</div><div className={'text-2xl tabular-nums ' + (rep.r.totals.varianceCents > 0 ? 'text-red-700' : 'text-ink')}>{money(rep.r.totals.varianceCents)}</div><div className="text-xs text-muted">used beyond what the register rang</div></div>
              </div>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="text-left text-muted border-b border-line"><th className="p-2">Item</th><th className="p-2 text-right">Used</th><th className="p-2 text-right">Rang</th><th className="p-2 text-right">Difference</th><th className="p-2 text-right">$</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {rep.r.rows.map((r) => <tr key={r.stockItemId}><td className="p-2">{r.name}</td><td className="p-2 text-right tabular-nums">{fmt(r.actual)} {r.unit === 'floz' ? 'fl oz' : r.unit}</td><td className="p-2 text-right tabular-nums">{fmt(r.expected)}</td><td className={'p-2 text-right tabular-nums ' + (r.varianceUnits > 0 ? 'text-red-700' : '')}>{fmt(r.varianceUnits)}</td><td className="p-2 text-right tabular-nums">{money(r.varianceCents)}</td></tr>)}
                </tbody>
              </table></div>
              <p className="text-xs text-muted mt-2">"Rang" is what recipes and pours say the register sold. Over-pouring, spills, comps not rung, waste and theft all show up as a difference; so does a recipe that's wrong.</p>
            </>
          )}
        </section>
      )}
    </div>
  )
}

// ─── Orders & vendors ───────────────────────────────────────────────────────
interface OLine { id: string; stockItemId: string; packs: number; packCostCents: number | null; receivedPacks: number | null; receivedCostCents: number | null; name: string; packName: string }
interface Order { id: string; number: number; status: string; note: string | null; createdAt: string; sentAt: string | null; receivedAt: string | null; vendorId: string | null; vendor: Vendor | null; lines: OLine[]; totalCents: number }

function OrderPanel({ order, stock, vendors, onClose, onChanged }: { order: Order | null; stock: Stock[]; vendors: Vendor[]; onClose: () => void; onChanged: () => void }) {
  const [vendorId, setVendorId] = useState(order?.vendorId || '')
  const [note, setNote] = useState(order?.note || '')
  const [lines, setLines] = useState((order?.lines || []).map((l) => ({ id: l.id, stockItemId: l.stockItemId, packs: String(l.packs), cost: l.packCostCents != null ? (l.packCostCents / 100).toFixed(2) : '', rPacks: String(l.packs), rCost: l.packCostCents != null ? (l.packCostCents / 100).toFixed(2) : '' })))
  const [msg, setMsg] = useState<Msg>(null)
  const editable = !order || order.status === 'draft' || order.status === 'sent'
  const act = async (fn: () => Promise<unknown>, ok: string, close = false) => { setMsg(null); try { await fn(); setMsg({ ok: true, text: ok }); onChanged(); if (close) onClose() } catch (e: any) { setMsg({ ok: false, text: e.message }) } }
  const payload = () => ({ vendorId: vendorId || null, note, lines: lines.filter((l) => l.stockItemId).map((l) => ({ stockItemId: l.stockItemId, packs: l.packs, packCostCents: dollarsToCents(l.cost) })) })
  const vendor = vendors.find((v) => v.id === vendorId)
  return (
    <aside className="card card-padding" aria-labelledby="op-h">
      <div className="flex justify-between items-start gap-3 mb-3">
        <div><h2 id="op-h" className="text-xl text-ink">{order ? `Order #${order.number}` : 'New order'}</h2>{order && <p className="text-sm text-muted">{order.status}{order.sentAt ? ' · sent ' + when(order.sentAt) : ''}{order.receivedAt ? ' · received ' + when(order.receivedAt) : ''}</p>}</div>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm inline-flex items-center" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      <Note m={msg} />
      <div className="grid gap-3">
        <div><Label htmlFor="op-v">Vendor</Label><select id="op-v" className="input" disabled={!editable} value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">No vendor</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_90px_36px] gap-2 items-end">
            <div><Label htmlFor={'ol-s' + i}>Item</Label><select id={'ol-s' + i} className="input" disabled={!editable} value={l.stockItemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, stockItemId: e.target.value } : x)))}><option value="">Pick…</option>{stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.packName})</option>)}</select></div>
            <div><Label htmlFor={'ol-p' + i}>{order?.status === 'sent' ? 'Came in' : 'Packs'}</Label><input id={'ol-p' + i} className="input" inputMode="decimal" disabled={!editable} value={order?.status === 'sent' ? l.rPacks : l.packs} onChange={(e) => setLines(lines.map((x, j) => (j === i ? (order?.status === 'sent' ? { ...x, rPacks: e.target.value } : { ...x, packs: e.target.value }) : x)))} /></div>
            <div><Label htmlFor={'ol-c' + i}>$ / pack</Label><input id={'ol-c' + i} className="input" inputMode="decimal" disabled={!editable} value={order?.status === 'sent' ? l.rCost : l.cost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? (order?.status === 'sent' ? { ...x, rCost: e.target.value } : { ...x, cost: e.target.value }) : x)))} /></div>
            {editable && order?.status !== 'sent' ? <button type="button" className="btn-secondary btn-sm mb-1" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button> : <span />}
          </div>
        ))}
        {editable && order?.status !== 'sent' && <button type="button" className="btn-secondary btn-md justify-self-start" onClick={() => setLines([...lines, { id: '', stockItemId: '', packs: '1', cost: '', rPacks: '', rCost: '' }])}>Add a line</button>}
        <div><Label htmlFor="op-n">Note to the vendor</Label><input id="op-n" className="input" disabled={!editable} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        {(!order || order.status === 'draft') && <button type="button" className="btn-secondary btn-md" onClick={() => act(async () => { if (order) await api.put(`/api/admin/inventory/orders/${order.id}`, payload()); else await api.post('/api/admin/inventory/orders', payload()) }, 'Saved.', !order)}>Save draft</button>}
        {order?.status === 'draft' && vendor?.email && <button type="button" className="btn-primary btn-md" onClick={() => act(async () => { await api.put(`/api/admin/inventory/orders/${order.id}`, payload()); await api.post(`/api/admin/inventory/orders/${order.id}/send`, { email: true }) }, `Emailed to ${vendor.email}.`)}>Email to {vendor.name}</button>}
        {order?.status === 'draft' && <button type="button" className="btn-secondary btn-md" onClick={() => act(async () => { await api.put(`/api/admin/inventory/orders/${order.id}`, payload()); await api.post(`/api/admin/inventory/orders/${order.id}/send`, { email: false }) }, 'Marked as sent.')}>Mark as sent (called it in)</button>}
        {order?.status === 'sent' && <button type="button" className="btn-primary btn-md" onClick={() => act(() => api.post(`/api/admin/inventory/orders/${order.id}/receive`, { lines: lines.map((l) => ({ lineId: l.id, packs: l.rPacks, packCostCents: dollarsToCents(l.rCost) })) }), 'Received. Stock and prices are updated.')}>Received</button>}
        {order && (order.status === 'draft' || order.status === 'sent') && <button type="button" className="btn-secondary btn-md text-red-700" onClick={() => act(() => api.post(`/api/admin/inventory/orders/${order.id}/cancel`, {}), 'Cancelled.', true)}>Cancel order</button>}
      </div>
      {order?.status === 'sent' && <Hint>When it comes in, fix any count or price that's different from the invoice, then tap Received.</Hint>}
    </aside>
  )
}

function VendorsCard({ vendors, onChanged }: { vendors: Vendor[]; onChanged: () => void }) {
  const blank = { name: '', contact: '', phone: '', email: '', orderDays: '', note: '' }
  const [edit, setEdit] = useState<{ id: string | null; f: typeof blank } | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const save = async () => { if (!edit) return; setMsg(null); try { if (edit.id) await api.patch(`/api/admin/inventory/vendors/${edit.id}`, edit.f); else await api.post('/api/admin/inventory/vendors', edit.f); setEdit(null); onChanged() } catch (e: any) { setMsg({ ok: false, text: e.message }) } }
  return (
    <section className="card card-padding" aria-labelledby="vn-h">
      <div className="flex justify-between items-center mb-2"><h2 id="vn-h" className="text-lg text-ink">Vendors</h2><button type="button" className="btn-secondary btn-md" onClick={() => setEdit({ id: null, f: blank })}>Add vendor</button></div>
      <Note m={msg} />
      <ul className="divide-y divide-line text-sm">
        {vendors.map((v) => <li key={v.id} className="py-2 flex justify-between gap-3"><span><span className="text-ink">{v.name}</span><span className="block text-xs text-muted">{[v.contact, v.phone, v.email, v.orderDays && 'orders ' + v.orderDays].filter(Boolean).join(' · ')}</span></span><button type="button" className="btn-secondary btn-sm" onClick={() => setEdit({ id: v.id, f: { name: v.name, contact: v.contact || '', phone: v.phone || '', email: v.email || '', orderDays: v.orderDays || '', note: v.note || '' } })}>Edit</button></li>)}
        {!vendors.length && <li className="py-2 text-muted">No vendors yet: the food distributor, the beer distributors, the liquor rep.</li>}
      </ul>
      {edit && (
        <div className="grid grid-cols-2 gap-3 mt-3">
          {([['name', 'Name'], ['contact', 'Rep'], ['phone', 'Phone'], ['email', 'Email for orders'], ['orderDays', 'Order days'], ['note', 'Note']] as const).map(([k, label]) => (
            <div key={k}><Label htmlFor={'vn-' + k}>{label}</Label><input id={'vn-' + k} className="input" value={edit.f[k]} onChange={(e) => setEdit({ ...edit, f: { ...edit.f, [k]: e.target.value } })} /></div>
          ))}
          <div className="col-span-2 flex gap-2"><button type="button" className="btn-primary btn-md" onClick={save}>Save vendor</button><button type="button" className="btn-secondary btn-md" onClick={() => setEdit(null)}>Cancel</button></div>
        </div>
      )}
    </section>
  )
}

function OrdersTab() {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [meta, setMeta] = useState<StockResp | null>(null)
  const [open, setOpen] = useState<Order | 'new' | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const load = () => Promise.all([api.get<{ orders: Order[] }>('/api/admin/inventory/orders'), api.get<StockResp>('/api/admin/inventory/stock')]).then(([o, s]) => {
    setOrders(o.orders); setMeta(s)
    if (open && open !== 'new') setOpen(o.orders.find((x) => x.id === open.id) || null)
  }).catch((e) => setMsg({ ok: false, text: e.message }))
  useEffect(() => { load() }, [])
  if (!orders || !meta) return <p className="text-muted text-sm">Loading…</p>
  const low = meta.stock.filter((s) => s.low).length
  const draft = async () => { setMsg(null); try { const r = await api.post<{ ids: string[] }>('/api/admin/inventory/orders/draft-low', {}); setMsg({ ok: true, text: `${r.ids.length} draft order${r.ids.length === 1 ? '' : 's'} made. Check them, then send.` }); load() } catch (e: any) { setMsg({ ok: false, text: e.message }) } }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2 items-center"><button type="button" className="btn-primary btn-md" onClick={draft} disabled={!low}>Order what's low ({low})</button><button type="button" className="btn-secondary btn-md" onClick={() => setOpen('new')}>New order</button></div>
      <Note m={msg} />
      <div className={open ? 'grid lg:grid-cols-[1fr_480px] gap-4 items-start' : ''}>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Order</th><th className="p-3">Vendor</th><th className="p-3">Status</th><th className="p-3 text-right">About</th></tr></thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-paper cursor-pointer" onClick={() => setOpen(o)}>
                  <td className="p-3"><button type="button" className="text-ink hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(o) }}>#{o.number}</button><div className="text-xs text-muted">{when(o.createdAt)} · {o.lines.length} line{o.lines.length === 1 ? '' : 's'}</div></td>
                  <td className="p-3">{o.vendor?.name || '—'}</td>
                  <td className="p-3">{o.status}</td>
                  <td className="p-3 text-right tabular-nums">{money(o.totalCents)}</td>
                </tr>
              ))}
              {!orders.length && <tr><td colSpan={4} className="p-6 text-center text-muted">No orders yet. Set a par on your stock items and "Order what's low" writes them for you.</td></tr>}
            </tbody>
          </table>
        </div>
        {open && <OrderPanel key={open === 'new' ? 'new' : open.id + open.status} order={open === 'new' ? null : open} stock={meta.stock} vendors={meta.vendors} onClose={() => setOpen(null)} onChanged={load} />}
      </div>
      <VendorsCard vendors={meta.vendors} onChanged={load} />
    </div>
  )
}

// ─── Menu mix ───────────────────────────────────────────────────────────────
interface Eng { days: number; avgMarginCents: number | null; popularAt: number; rows: Array<{ key: string; name: string; sold: number; priceCents: number; costCents: number | null; marginCents: number | null; mixPct: number; class: string | null }> }
const CLASS: Record<string, [string, string, string]> = {
  star: ['Star', 'Sells a lot and makes good money. Keep it where it is.', 'bg-emerald-50 text-emerald-800 border-emerald-200'],
  plowhorse: ['Plowhorse', 'Sells a lot, thin margin. A small price bump or a cheaper side.', 'bg-amber-50 text-amber-800 border-amber-200'],
  puzzle: ['Puzzle', "Good margin, doesn't sell. Mention it, feature it, or rename it.", 'bg-sky-50 text-sky-800 border-sky-200'],
  dog: ['Dog', 'Low sales, low margin. A candidate to drop.', 'bg-red-50 text-red-700 border-red-200'],
}
function MixTab() {
  const [days, setDays] = useState(30)
  const [e, setE] = useState<Eng | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.get<Eng>(`/api/admin/inventory/engineering?days=${days}`).then(setE).catch((x) => setErr(x.message)) }, [days])
  if (!e) return <p className="text-muted text-sm">{err || 'Loading…'}</p>
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2 items-center">
        {[30, 90, 365].map((n) => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={'px-3 py-1.5 rounded-full text-sm border ' + (days === n ? 'bg-ink text-white border-ink' : 'border-line text-ink-soft hover:bg-paper')}>Last {n} days</button>)}
        <span className="text-sm text-muted">Food only. Average margin {money(e.avgMarginCents)}; "popular" is {e.popularAt}% of the mix or more.</span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Item</th><th className="p-3 text-right">Sold</th><th className="p-3 text-right">Mix</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">Cost</th><th className="p-3 text-right">Margin</th><th className="p-3">Class</th></tr></thead>
          <tbody className="divide-y divide-line">
            {e.rows.map((r) => (
              <tr key={r.key}>
                <td className="p-3 text-ink">{r.name}</td><td className="p-3 text-right tabular-nums">{r.sold}</td><td className="p-3 text-right tabular-nums">{r.mixPct}%</td>
                <td className="p-3 text-right tabular-nums">{money(r.priceCents)}</td><td className="p-3 text-right tabular-nums">{money(r.costCents)}</td><td className="p-3 text-right tabular-nums">{money(r.marginCents)}</td>
                <td className="p-3">{r.class ? <span title={CLASS[r.class][1]} className={'text-xs px-2 py-0.5 rounded-full border ' + CLASS[r.class][2]}>{CLASS[r.class][0]}</span> : <span className="text-xs text-muted">needs a recipe</span>}</td>
              </tr>
            ))}
            {!e.rows.length && <tr><td colSpan={7} className="p-6 text-center text-muted">No food sold in this window yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <ul className="text-sm text-ink-soft grid sm:grid-cols-2 gap-2">{Object.values(CLASS).map(([n, why]) => <li key={n}><strong className="text-ink">{n}:</strong> {why}</li>)}</ul>
    </div>
  )
}

const TABS = [['stock', 'Stock'], ['recipes', 'Recipes'], ['counts', 'Counts'], ['orders', 'Orders'], ['mix', 'Menu mix']] as const

export function InventoryPage() {
  const [tab, setTab] = useState<string>(() => (typeof location !== 'undefined' && location.hash.slice(1)) || 'stock')
  useEffect(() => { history.replaceState(null, '', '#' + tab) }, [tab])
  useEffect(() => {
    const on = () => { const h = location.hash.slice(1); if (TABS.some(([k]) => k === h)) setTab(h) }
    window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on)
  }, [])
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl text-ink">Inventory</h1>
      <p className="text-muted text-sm mt-1 mb-5">What's on the shelves, what each plate and pour costs, and what to order.</p>
      <div className="flex flex-wrap gap-2 mb-5 border-b border-line" role="tablist" aria-label="Inventory">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={'px-3 py-2 text-sm -mb-px border-b-2 ' + (tab === k ? 'border-ink text-ink font-semibold' : 'border-transparent text-muted hover:text-ink')}>{label}</button>)}
      </div>
      <div role="tabpanel">
        {tab === 'stock' && <StockTab />}
        {tab === 'recipes' && <RecipesTab />}
        {tab === 'counts' && <CountsTab />}
        {tab === 'orders' && <OrdersTab />}
        {tab === 'mix' && <MixTab />}
      </div>
    </div>
  )
}
