// Retail (server crm/salon/retail.ts, /api/salon-retail; hidden feature `salon_retail`): the products the salon sells off the shelf, the count on
// hand, stock received and corrected (who and why), and a walk-in sale. Selling onto a client's sale happens beside the sale (ChairCheckout.tsx).
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Plus, ShoppingBag } from 'lucide-react'
import { api, useToast, usePermissions, money } from '../../../shared'
import { Button, Field, Modal, inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const cents = (c: number) => money(c / 100)
const toCents = (v: string) => Math.round(Number(v) * 100)

interface Product { id: string; name: string; brand: string | null; sku: string | null; priceCents: number; costCents: number | null; reorderAt: number | null; active: boolean; onHand: number; low: boolean }
interface History { moves: Array<{ kind: string; quantity: number; note: string | null; by: string | null; at: string }>; sales: Array<{ quantity: number; at: string; sale: string; void: boolean }> }

export default function RetailPage() {
  const { can, known } = usePermissions()
  const navigate = useNavigate()
  const mayAdd = known && can('inventory:create')
  const mayEdit = known && can('inventory:update')
  const maySell = known && can('invoices:create') && can('invoices:update')
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [stocking, setStocking] = useState<Product | null>(null)
  const [selling, setSelling] = useState(false)
  const load = useCallback(() => { api.get('/api/salon-retail/manage').then((r: { products: Product[] }) => { setProducts(r.products); setError('') }).catch((e: Error) => setError(e.message || 'The products could not be loaded.')) }, [])
  useEffect(load, [load])
  const low = (products || []).filter((p) => p.active && p.low)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><ShoppingBag className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Retail</h1>
          <p className="mt-1 text-gray-600 dark:text-slate-300">What you sell off the shelf, and how many are left. A product goes on a client's sale from the sale itself; the count goes down when it does.</p>
        </div>
        <div className="flex gap-2">
          {maySell && <Button variant="secondary" onClick={() => setSelling(true)}>Sell to a walk-in</Button>}
          {mayAdd && <Button onClick={() => setEditing('new')}><Plus className="mr-2 inline h-4 w-4" aria-hidden="true" />Add a product</Button>}
        </div>
      </div>
      {low.length > 0 && <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">Running low: {low.map((p) => `${[p.brand, p.name].filter(Boolean).join(' ')} (${p.onHand})`).join(', ')}.</div>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {!products && !error && <div className="flex h-32 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>}
      {products && products.length === 0 && <p className="text-gray-600 dark:text-slate-300">No products yet.</p>}
      {products && products.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-700 dark:bg-slate-800 dark:text-slate-200"><tr><th className="px-4 py-2">Product</th><th className="px-4 py-2 text-right">Price</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2 text-right">On hand</th><th className="px-4 py-2" /></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {products.map((p) => (
                <tr key={p.id} className={'text-gray-900 dark:text-slate-100' + (p.active ? '' : ' opacity-60')}>
                  <td className="px-4 py-2">{p.brand ? `${p.brand} ` : ''}{p.name}{!p.active && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs dark:bg-slate-700">Off the shelf</span>}{p.sku && <span className="block text-xs text-gray-600 dark:text-slate-400">{p.sku}</span>}</td>
                  <td className="px-4 py-2 text-right">{cents(p.priceCents)}</td>
                  <td className="px-4 py-2 text-right">{p.costCents != null ? cents(p.costCents) : '—'}</td>
                  <td className={'px-4 py-2 text-right font-medium ' + (p.low ? 'text-amber-800 dark:text-amber-300' : '')}>{p.onHand}{p.low ? ' · low' : ''}</td>
                  <td className="px-4 py-2 text-right">{mayEdit && (<><button className="mr-3 font-medium text-teal-800 underline dark:text-teal-200" onClick={() => setStocking(p)}>Stock</button><button className="font-medium text-teal-800 underline dark:text-teal-200" onClick={() => setEditing(p)}>Edit</button></>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <ProductModal product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={load} />}
      {stocking && <StockModal product={stocking} onClose={() => setStocking(null)} onSaved={load} />}
      {selling && <WalkInModal products={(products || []).filter((p) => p.active && p.onHand > 0)} onClose={() => setSelling(false)} onSold={(id) => navigate(`/crm/invoices/${id}`)} />}
    </div>
  )
}

function ProductModal({ product, onClose, onSaved }: { product: Product | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ name: product?.name || '', brand: product?.brand || '', sku: product?.sku || '', price: product ? (product.priceCents / 100).toFixed(2) : '', cost: product?.costCents != null ? (product.costCents / 100).toFixed(2) : '', reorderAt: product?.reorderAt != null ? String(product.reorderAt) : '', openingStock: '', active: product?.active ?? true })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }))
  const save = async () => {
    setBusy(true); setErrors({}); setProblem('')
    const body: Record<string, unknown> = { name: f.name, brand: f.brand, sku: f.sku, priceCents: f.price ? toCents(f.price) : undefined, costCents: f.cost ? toCents(f.cost) : null, reorderAt: f.reorderAt === '' ? null : Number(f.reorderAt), active: f.active }
    if (!product && f.openingStock) body.openingStock = Number(f.openingStock)
    try { if (product) await api.patch(`/api/salon-retail/products/${product.id}`, body); else await api.post('/api/salon-retail/products', body); toast.success('Saved'); onSaved(); onClose() }
    catch (e: any) { setErrors(e?.data?.fields || {}); setProblem(e?.message || 'That did not save.') } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={product ? 'Edit product' : 'Add a product'} size="md" dirty>
      <div className="space-y-3">
        {problem && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{problem}</div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name"><input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} aria-invalid={!!errors.name} /></Field>
          <Field label="Brand (optional)"><input value={f.brand} onChange={(e) => set('brand', e.target.value)} className={inputCls} /></Field>
          <Field label="Price ($)"><input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} className={inputCls} aria-invalid={!!errors.priceCents} /></Field>
          <Field label="What it cost you ($, optional)" hint="Only managers see this."><input inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} className={inputCls} /></Field>
          <Field label="Code or SKU (optional)"><input value={f.sku} onChange={(e) => set('sku', e.target.value)} className={inputCls} /></Field>
          <Field label="Flag as low at (units, optional)"><input inputMode="numeric" value={f.reorderAt} onChange={(e) => set('reorderAt', e.target.value)} className={inputCls} /></Field>
          {!product && <Field label="Units on the shelf now"><input inputMode="numeric" value={f.openingStock} onChange={(e) => set('openingStock', e.target.value)} className={inputCls} aria-invalid={!!errors.openingStock} /></Field>}
        </div>
        {product && <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />On the shelf (uncheck to stop selling it; its history stays)</label>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button></div>
      </div>
    </Modal>
  )
}

function StockModal({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [kind, setKind] = useState<'received' | 'adjust'>('received')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const [h, setH] = useState<History | null>(null)
  useEffect(() => { api.get(`/api/salon-retail/products/${product.id}/history`).then(setH).catch(() => setH(null)) }, [product.id])
  const save = async () => {
    setBusy(true); setProblem('')
    try { await api.post(`/api/salon-retail/products/${product.id}/stock`, { kind, quantity: Number(qty), note }); toast.success('Count updated'); onSaved(); onClose() }
    catch (e: any) { setProblem(e?.message || 'That did not save.') } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={`${[product.brand, product.name].filter(Boolean).join(' ')} — ${product.onHand} on hand`} size="md">
      <div className="space-y-3 text-gray-900 dark:text-slate-100">
        {problem && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{problem}</div>}
        <div className="flex gap-4 text-sm" role="radiogroup" aria-label="What happened">
          <label className="flex items-center gap-2"><input type="radio" checked={kind === 'received'} onChange={() => setKind('received')} />Stock came in</label>
          <label className="flex items-center gap-2"><input type="radio" checked={kind === 'adjust'} onChange={() => setKind('adjust')} />Correct the count</label>
        </div>
        <Field label={kind === 'received' ? 'How many came in' : 'Units to add (or take off, with a minus sign)'}><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} /></Field>
        <Field label={kind === 'received' ? 'Note (optional)' : 'Why is the count changing?'}><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} maxLength={160} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy || !qty}>{busy ? 'Saving…' : 'Save'}</Button></div>
        {h && (h.moves.length > 0) && (
          <div>
            <h3 className="text-sm font-semibold">Recent changes</h3>
            <ul className="mt-1 divide-y divide-gray-100 text-sm dark:divide-slate-800">{h.moves.slice(0, 8).map((m, i) => <li key={i} className="flex justify-between gap-3 py-1"><span>{m.kind === 'received' ? 'Came in' : 'Corrected'}{m.by ? ` — ${m.by}` : ''}{m.note ? ` (${m.note})` : ''}<span className="block text-xs text-gray-600 dark:text-slate-400">{momentDate(m.at)}</span></span><span>{m.quantity > 0 ? '+' : '−'}{Math.abs(m.quantity)}</span></li>)}</ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

function WalkInModal({ products, onClose, onSold }: { products: Product[]; onClose: () => void; onSold: (invoiceId: string) => void }) {
  const [productId, setProductId] = useState('')
  const [qty, setQty] = useState('1')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true); setProblem('')
    try { const r = await api.post('/api/salon-retail/sell/new', { items: [{ productId, quantity: Number(qty) || 1 }] }); onSold(r.invoiceId) }
    catch (e: any) { setProblem(e?.message || 'That could not be sold.') } finally { setBusy(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title="Sell to a walk-in" size="sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-700 dark:text-slate-300">This makes a new sale. You take the payment on the next screen, on the card reader or any other way.</p>
        {problem && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{problem}</div>}
        <Field label="Product"><select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}><option value="">Choose…</option>{products.map((p) => <option key={p.id} value={p.id}>{[p.brand, p.name].filter(Boolean).join(' ')} — {cents(p.priceCents)} ({p.onHand} left)</option>)}</select></Field>
        <Field label="Quantity"><input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} className={inputCls} /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={go} disabled={busy || !productId}>{busy ? 'Making the sale…' : 'Make the sale'}</Button></div>
      </div>
    </Modal>
  )
}
