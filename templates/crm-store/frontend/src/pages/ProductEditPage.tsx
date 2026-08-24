import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Trash2, Plus, Star, StarOff, Upload, Loader2 } from 'lucide-react'
import api, { Product, ProductVariant } from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { dollarsToCents, centsToDollars, money } from '../lib/format'

const BLANK = {
  name: '', tagline: '', description: '', status: 'draft' as const,
  featured: false, leadTimeDays: null as number | null, seoTitle: '', seoDescription: '',
}

export default function ProductEditPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const { toast } = useToast()

  const [form, setForm] = useState<any>(BLANK)
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isNew) return
    api.getProduct(id!).then((p) => { setProduct(p); setForm(p) }).catch(() => toast('Could not load product', 'error')).finally(() => setLoading(false))
  }, [id])

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true)
    try {
      const body = {
        name: form.name, tagline: form.tagline, description: form.description,
        status: form.status, featured: form.featured,
        leadTimeDays: form.leadTimeDays === '' ? null : form.leadTimeDays,
        seoTitle: form.seoTitle, seoDescription: form.seoDescription,
      }
      if (isNew) {
        const created = await api.createProduct(body)
        toast('Product created — now add variants and photos')
        navigate(`/products/${created.id}`, { replace: true })
      } else {
        const updated = await api.updateProduct(id!, body)
        setProduct((p) => p ? { ...p, ...updated } : p)
        toast('Saved')
      }
    } catch (e: any) { toast(e?.message || 'Save failed', 'error') } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!confirm('Delete this product? This cannot be undone.')) return
    await api.deleteProduct(id!)
    toast('Product deleted')
    navigate('/products')
  }

  const reloadProduct = async () => { if (id) setProduct(await api.getProduct(id)) }

  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/products" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft className="h-4 w-4" /> Products</Link>
        {!isNew && <button onClick={remove} className="text-sm text-red-600 flex items-center gap-1"><Trash2 className="h-4 w-4" /> Delete</button>}
      </div>

      <h1 className="text-2xl font-bold text-gray-900">{isNew ? 'New product' : form.name}</h1>

      {/* Details */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Product name" />
        </div>
        <div>
          <label className="label">Tagline</label>
          <input className="input" value={form.tagline || ''} onChange={(e) => set('tagline', e.target.value)} placeholder="Short one-liner" />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input min-h-[120px]" value={form.description || ''} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
              <option value="draft">Draft (hidden)</option>
              <option value="active">Active (live)</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className="label">Lead time (days)</label>
            <input className="input" type="number" value={form.leadTimeDays ?? ''} onChange={(e) => set('leadTimeDays', e.target.value === '' ? null : Number(e.target.value))} placeholder="Optional" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!!form.featured} onChange={(e) => set('featured', e.target.checked)} /> Feature on storefront home
        </label>
        <button onClick={save} className="btn-primary" disabled={saving || !form.name}>{saving ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}</button>
      </div>

      {isNew ? (
        <p className="text-sm text-gray-500">Save the product first, then add variants (prices) and photos.</p>
      ) : product ? (
        <>
          <VariantsSection product={product} onChange={reloadProduct} />
          <ImagesSection product={product} onChange={reloadProduct} />
        </>
      ) : (
        // After the "add product" redirect the detail hasn't loaded yet — show a
        // spinner instead of rendering the sections against a null product
        // (which read product.variants / product.images and white-screened).
        <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
      )}
    </div>
  )
}

// ── Variants ─────────────────────────────────────────────────────────────────
function VariantsSection({ product, onChange }: { product: Product; onChange: () => void }) {
  // Dropship: variant → supplier-item links (only shown when a supplier is connected)
  const [supplierConnected, setSupplierConnected] = useState(false)
  const [supplierMap, setSupplierMap] = useState<Record<string, { ref: string; name: string | null }>>({})
  useEffect(() => {
    api.getSupplierStatus().then((st: any) => {
      if (!st?.config?.connected) return
      setSupplierConnected(true)
      api.getVariantSupplierMap().then(rows => {
        const m: Record<string, { ref: string; name: string | null }> = {}
        rows.forEach(r => { m[r.variantId] = { ref: r.supplierVariantRef, name: r.supplierItemName } })
        setSupplierMap(m)
      }).catch(() => {})
    }).catch(() => {})
  }, [])
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  const blank = { sku: '', name: 'Default', price: '', inventory: '' }
  const [draft, setDraft] = useState(blank)

  const add = async () => {
    try {
      await api.addVariant(product.id, {
        sku: draft.sku, name: draft.name || 'Default',
        priceCents: dollarsToCents(draft.price),
        inventoryQty: draft.inventory === '' ? null : Number(draft.inventory),
      })
      setDraft(blank); setAdding(false); onChange(); toast('Variant added')
    } catch (e: any) { toast(e?.message || 'Could not add variant', 'error') }
  }
  const del = async (v: ProductVariant) => { if (!confirm(`Delete variant ${v.sku}?`)) return; await api.deleteVariant(v.id); onChange() }

  // Save a whole row at once, awaiting each call and surfacing errors. The old
  // per-field onBlur saves lost edits silently: a blur that didn't fire (or
  // raced the "Save changes" button click / a re-render) dropped the value with
  // no error, and merchants couldn't set up dropshipping through the UI.
  const saveRow = async (v: ProductVariant, next: { price: string; inv: string; ref: string }) => {
    try {
      await api.updateVariant(v.id, {
        priceCents: dollarsToCents(next.price),
        inventoryQty: next.inv === '' ? null : Number(next.inv),
      })
      if (supplierConnected && next.ref.trim() !== (supplierMap[v.id]?.ref || '')) {
        const res: any = await api.setVariantSupplierRef(v.id, next.ref.trim())
        if (res?.cleared) { const m = { ...supplierMap }; delete m[v.id]; setSupplierMap(m) }
        else setSupplierMap({ ...supplierMap, [v.id]: { ref: next.ref.trim(), name: res?.name || null } })
      }
      toast('Variant saved')
      onChange()
    } catch (e: any) {
      toast(e?.message || 'Could not save variant', 'error')
      throw e
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900">Variants & pricing</h2>
        {!adding && <button onClick={() => setAdding(true)} className="btn-secondary text-xs"><Plus className="h-3 w-3" /> Add variant</button>}
      </div>
      {(product.variants || []).length === 0 && !adding && <p className="text-sm text-gray-500">Add at least one variant so the product can be sold.</p>}
      <div className="space-y-2">
        {(product.variants || []).map((v) => (
          <VariantRow
            key={v.id}
            v={v}
            supplierConnected={supplierConnected}
            supplierRef={supplierMap[v.id]?.ref ?? ''}
            supplierName={supplierMap[v.id]?.name ?? null}
            onSave={(next) => saveRow(v, next)}
            onDelete={() => del(v)}
          />
        ))}
      </div>
      {adding && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3">
          <input className="input" placeholder="SKU (e.g. TSHIRT-M)" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} />
          <input className="input" placeholder="Name (e.g. Medium)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="input" placeholder="Price (e.g. 24.99)" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          <input className="input" placeholder="Inventory (blank = ∞)" value={draft.inventory} onChange={(e) => setDraft({ ...draft, inventory: e.target.value })} />
          <div className="col-span-2 flex gap-2">
            <button onClick={add} className="btn-primary text-xs" disabled={!draft.sku || !draft.price}>Add</button>
            <button onClick={() => { setAdding(false); setDraft(blank) }} className="btn-secondary text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// One editable variant row: controlled inputs + an explicit Save that only
// lights up when something changed. Replaces the old blur-to-save inputs.
function VariantRow({ v, supplierConnected, supplierRef, supplierName, onSave, onDelete }: {
  v: ProductVariant
  supplierConnected: boolean
  supplierRef: string
  supplierName: string | null
  onSave: (next: { price: string; inv: string; ref: string }) => Promise<void>
  onDelete: () => void
}) {
  const [price, setPrice] = useState(centsToDollars(v.priceCents))
  const [inv, setInv] = useState<string>(v.inventoryQty == null ? '' : String(v.inventoryQty))
  const [ref, setRef] = useState(supplierRef)
  const [saving, setSaving] = useState(false)

  // Re-sync when the underlying variant changes (e.g. after a reload).
  useEffect(() => { setPrice(centsToDollars(v.priceCents)); setInv(v.inventoryQty == null ? '' : String(v.inventoryQty)) }, [v.priceCents, v.inventoryQty])
  useEffect(() => { setRef(supplierRef) }, [supplierRef])

  const dirty = price !== centsToDollars(v.priceCents)
    || inv !== (v.inventoryQty == null ? '' : String(v.inventoryQty))
    || (supplierConnected && ref.trim() !== supplierRef)

  const save = async () => {
    setSaving(true)
    try { await onSave({ price, inv, ref }) } catch { /* toast already shown */ } finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900 truncate">{v.name}</div>
        <div className="text-xs text-gray-400">{v.sku}</div>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-gray-400">$</span>
        <input className="input w-24 py-1" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <input className="input w-20 py-1" placeholder="∞" value={inv} onChange={(e) => setInv(e.target.value)} title="Inventory (blank = untracked)" />
      {supplierConnected && (
        <input className="input w-32 py-1" placeholder="Supplier item id" value={ref} onChange={(e) => setRef(e.target.value)} title={supplierName || 'Supplier item id (Printful sync variant / CJ vid). Blank = not dropshipped.'} />
      )}
      <button onClick={save} disabled={!dirty || saving} className="btn-primary text-xs px-2 py-1 disabled:opacity-40">{saving ? '…' : 'Save'}</button>
      <button onClick={onDelete} className="text-gray-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
    </div>
  )
}

// ── Images ───────────────────────────────────────────────────────────────────
function ImagesSection({ product, onChange }: { product: Product; onChange: () => void }) {
  const { toast } = useToast()
  const [url, setUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const add = async () => {
    try {
      await api.addImage(product.id, { url, isPrimary: (product.images || []).length === 0 })
      setUrl(''); onChange(); toast('Image added')
    } catch (e: any) { toast(e?.message || 'Could not add image', 'error') }
  }

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (!list.length) return
    setUploading(true)
    try {
      for (const f of list) await api.uploadImage(product.id, f)
      onChange(); toast(list.length > 1 ? `${list.length} images uploaded` : 'Image uploaded')
    } catch (e: any) {
      toast(e?.message || 'Could not upload image', 'error')
    } finally { setUploading(false) }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files)
  }

  const makePrimary = async (imageId: string) => { await api.updateImage(imageId, { isPrimary: true }); onChange() }
  const del = async (imageId: string) => { await api.deleteImage(imageId); onChange() }

  return (
    <div className="card p-5">
      <h2 className="font-semibold text-gray-900 mb-3">Photos</h2>
      <div className="flex flex-wrap gap-3 mb-3">
        {(product.images || []).map((img) => (
          <div key={img.id} className="relative group h-24 w-24 rounded-lg overflow-hidden border">
            <img src={img.url} alt={img.alt || ''} className="h-full w-full object-cover" />
            {img.isPrimary && <span className="absolute top-1 left-1 rounded bg-primary-500 px-1 text-[10px] text-white">Primary</span>}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition">
              {!img.isPrimary && <button onClick={() => makePrimary(img.id)} title="Make primary"><Star className="h-4 w-4 text-white" /></button>}
              <button onClick={() => del(img.id)} title="Delete"><Trash2 className="h-4 w-4 text-white" /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Drag-and-drop / click-to-upload */}
      <div
        onClick={() => !uploading && fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed py-6 text-center transition ${dragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-300 hover:border-gray-400'} ${uploading ? 'pointer-events-none opacity-60' : ''}`}
      >
        {uploading
          ? <><Loader2 className="h-5 w-5 animate-spin text-primary-500" /><span className="text-sm text-gray-500">Uploading…</span></>
          : <><Upload className="h-5 w-5 text-gray-400" /><span className="text-sm text-gray-600">Drop images here or <span className="font-medium text-primary-600">browse</span></span><span className="text-xs text-gray-400">JPEG, PNG, WebP, GIF or AVIF · up to 8 MB</span></>}
      </div>
      <input
        ref={fileInput} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files); e.target.value = '' }}
      />

      {/* Paste-a-URL fallback */}
      <div className="mt-3 flex gap-2">
        <input className="input flex-1" placeholder="…or paste an image URL (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button onClick={add} className="btn-secondary" disabled={!url}><Plus className="h-4 w-4" /> Add</button>
      </div>
    </div>
  )
}
