// Moved from templates/crm-store/frontend/src/pages/ProductEditPage.tsx. One product at /crm/products/new and
// /crm/products/:id, over /api/admin/products (server/crm/store/catalog/products.ts): its details, its variants (price,
// compare-at price, stock, options) and its photos (uploaded or by address; the main one; the alt text).
//
// Kept as the template had it: a save sends only the fields this person changed from what the form was loaded from
// (two people editing one product keep each other's work); a stock change names the count it was typed over
// (inventoryFrom) and a 409 inventory_changed reloads the count as it stands; a variant row saves as a whole with an
// explicit Save; the supplier item id beside each variant, for the owner (integrations:update) with a supplier
// connected; staff add and edit, deleting a product or a variant is products:delete.
//
// 2026-10-30 (gap 5): with store_ai_writer on, a seat that edits products can ask for a DRAFT of the description and search
// text, and of each photo's alt text, in a tone it picks. The draft lands in a box to read and change, then in the form's own
// boxes — nothing is saved until the person presses the ordinary Save (the photo's own Save alt).
//
// Changes from the template:
//   · replies (RULEBOOK §3): one product, variant or photo is the record itself (the template read { product },
//     { variant }, { image }); the supplier variant map is { data } (was { map }), its link answer { success, name } /
//     { success, cleared } (was { ok, … }); a refusal's `fields` marks the details form;
//   · the app's API client, toasts and the shared confirm dialog (the template used window.confirm for both deletes and
//     deleted a photo with no question at all — it asks now);
//   · the compare-at price and the options (size, colour …) of a variant can be set and changed — the server took both
//     and the template offered neither; the SEO title and description are on the form (the template sent them back
//     unchanged with no box to change them); each photo's alt text can be changed (the server took it; no box);
//   · money is typed in the store's currency and sent as whole cents read from the digits (the template's
//     parseFloat × 100 could land a cent off), and a price that is not a number is refused on the form instead of
//     being sent as 0 — the template turned 'abc' into a free product;
//   · a stock count that is not a whole number is refused on the form (the template sent Number('3.5'));
//   · the photo controls are always on screen (the template showed Make primary and Delete only on hover — never on a
//     phone), and the controls a seat cannot use are not shown: adding or changing variants and photos asks
//     products:update, so a seat without it sees the product as a record;
//   · links are under /crm; every ink has its dark partner; the variant rows and the forms stack at phone width.
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, Star, Trash2, Upload } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useAuth, useConfirm, useKnownPermission, useMayWrite, useToast } from '../../../../shared'
import {
  formatMoney, fromHundredths, listOf, refusalOf, toHundredths, toWhole, useStoreCurrency,
  type Product, type ProductImage, type ProductVariant,
} from './lib'

interface DetailsForm {
  name: string; tagline: string; description: string; status: Product['status']; featured: boolean
  leadTimeDays: string; seoTitle: string; seoDescription: string
  kind: 'physical' | 'gift_card'; brand: string; condition: 'new' | 'refurbished' | 'used'; category: string
  boughtTogetherIds: string[]; alsoLikeIds: string[]
}
const BLANK: DetailsForm = {
  name: '', tagline: '', description: '', status: 'draft', featured: false, leadTimeDays: '', seoTitle: '', seoDescription: '',
  kind: 'physical', brand: '', condition: 'new', category: '', boughtTogetherIds: [], alsoLikeIds: [],
}

const formOf = (p: Product): DetailsForm => ({
  name: p.name || '', tagline: p.tagline || '', description: p.description || '', status: p.status, featured: !!p.featured,
  leadTimeDays: p.leadTimeDays == null ? '' : String(p.leadTimeDays), seoTitle: p.seoTitle || '', seoDescription: p.seoDescription || '',
  kind: p.kind || 'physical', brand: p.brand || '', condition: p.condition || 'new', category: p.category || '',
  boughtTogetherIds: p.boughtTogetherIds || [], alsoLikeIds: p.alsoLikeIds || [],
})

/** The product's own fields as the server takes them, or the box that is wrong. */
function detailsBody(f: DetailsForm): { body: Record<string, unknown> } | { error: string; field: string } {
  const lead = toWhole(f.leadTimeDays)
  if (Number.isNaN(lead)) return { error: 'Lead time is a whole number of days.', field: 'leadTimeDays' }
  return {
    body: {
      name: f.name.trim(), tagline: f.tagline || null, description: f.description || null, status: f.status, featured: f.featured,
      leadTimeDays: lead, seoTitle: f.seoTitle || null, seoDescription: f.seoDescription || null,
      kind: f.kind, brand: f.brand.trim() || null, condition: f.condition, category: f.category.trim() || null,
      boughtTogetherIds: f.boughtTogetherIds, alsoLikeIds: f.alsoLikeIds,
    },
  }
}

/** 'size=M, color=Red' ⇄ { size: 'M', color: 'Red' }. */
const optionsText = (o: Record<string, string> | null | undefined) => Object.entries(o || {}).map(([k, v]) => `${k}=${v}`).join(', ')
function parseOptions(text: string): Record<string, string> | null | 'invalid' {
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return null
  const out: Record<string, string> = {}
  for (const part of parts) {
    const m = /^([^=:]+)[=:](.+)$/.exec(part)
    if (!m || !m[1].trim() || !m[2].trim()) return 'invalid'
    out[m[1].trim()] = m[2].trim()
  }
  return out
}

const FIELD_LABELS: Record<string, string> = { name: 'Name', leadTimeDays: 'Lead time', slug: 'Slug', seoTitle: 'SEO title', seoDescription: 'SEO description' }

export default function ProductEditPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const currency = useStoreCurrency()

  const [form, setForm] = useState<DetailsForm>(BLANK)
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // Staff add and edit; taking a product off sale for good is the manager's (products:delete).
  const mayCreate = useMayWrite('products:create')
  const mayUpdate = useMayWrite('products:update')
  const mayDelete = useMayWrite('products:delete')
  const mayEditDetails = isNew ? mayCreate : mayUpdate
  const writerOn = useAuth().hasFeature('store_ai_writer')
  // The other products, for the upsell picks.
  const [others, setOthers] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    api.get('/api/admin/products').then((r) => setOthers(listOf<Product>(r).filter((p) => p.id !== id).map((p) => ({ id: p.id, name: p.name })))).catch(() => setOthers([]))
  }, [id])
  const togglePick = (k: 'boughtTogetherIds' | 'alsoLikeIds', pid: string) =>
    set(k, form[k].includes(pid) ? form[k].filter((x) => x !== pid) : [...form[k], pid])

  // What the form was filled from. A save sends only the fields this person changed from it (not `product`: the
  // variant and photo sections reload that, and it then holds another person's edits — comparing with it would send
  // ours over theirs).
  const loaded = useRef<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (!id) { setProduct(null); setForm(BLANK); loaded.current = null; setLoading(false); return }
    let live = true
    setLoading(true)
    setLoadError(null)
    api.get(`/api/admin/products/${id}`)
      .then((p: Product) => {
        if (!live) return
        setProduct(p); setForm(formOf(p))
        const d = detailsBody(formOf(p))
        loaded.current = 'body' in d ? d.body : null
      })
      .catch((e: unknown) => { if (live) setLoadError(errorText(e, 'Could not load the product')) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [id])

  // Editing a field takes its refusal away: "Give the product a name." stayed under a name already typed.
  const set = <K extends keyof DetailsForm>(k: K, v: DetailsForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setFieldErrors((e) => { if (!(k in e)) return e; const { [k as string]: _gone, ...rest } = e; return rest })
  }

  const save = async () => {
    setFormError(null); setFieldErrors({})
    if (!form.name.trim()) { setFieldErrors({ name: 'Give the product a name.' }); return }
    const d = detailsBody(form)
    if ('error' in d) { setFieldErrors({ [d.field]: d.error }); return }
    setSaving(true)
    try {
      if (isNew) {
        const created: Product = await api.post('/api/admin/products', d.body)
        toast.success('Product created — now add variants and photos')
        navigate(`/crm/products/${created.id}`, { replace: true })
      } else {
        const from = loaded.current || {}
        const changed = Object.fromEntries(Object.entries(d.body).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(from[k] ?? null)))
        if (!Object.keys(changed).length) { toast.success('Saved — nothing had changed'); return }
        const updated: Product = await api.patch(`/api/admin/products/${id}`, changed)
        loaded.current = { ...from, ...changed }
        setProduct((p) => (p ? { ...p, ...updated, images: p.images, variants: p.variants } : p))
        toast.success('Saved')
      }
    } catch (e) {
      const { fields } = refusalOf(e)
      setFieldErrors(fields)
      setFormError(errorText(e, 'Save failed'))
    } finally { setSaving(false) }
  }

  const remove = async () => {
    if (!product) return
    if (!(await confirm(`Delete "${product.name}"? It comes off the storefront and cannot be brought back.`, { title: 'Delete product', confirmText: 'Delete' }))) return
    try {
      await api.delete(`/api/admin/products/${product.id}`)
      toast.success('Product deleted')
      navigate('/crm/products')
    } catch (e) { toast.error(errorText(e, 'Could not delete the product')) }
  }

  const reloadProduct = useCallback(async () => {
    if (!id) return
    try { setProduct(await api.get(`/api/admin/products/${id}`)) } catch (e) { toast.error(errorText(e, 'Could not reload the product')) }
  }, [id, toast])

  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" /></div>
  if (loadError) {
    return (
      <div className="max-w-3xl space-y-4">
        <Link to="/crm/products" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"><ArrowLeft className="h-4 w-4" /> Products</Link>
        <PageError message={loadError} />
      </div>
    )
  }

  const err = (k: string) => fieldErrors[k] ? <p className="mt-1 text-xs text-red-700 dark:text-red-300">{fieldErrors[k]}</p> : null
  const unnamed = Object.keys(fieldErrors).filter((k) => !FIELD_LABELS[k])

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/crm/products" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"><ArrowLeft className="h-4 w-4" /> Products</Link>
        {!isNew && mayDelete && product && (
          <button type="button" onClick={remove} className="inline-flex items-center gap-1 text-sm text-red-700 hover:text-red-800 dark:text-red-300 dark:hover:text-red-200"><Trash2 className="h-4 w-4" /> Delete</button>
        )}
      </div>

      <h1 className="text-2xl font-bold text-gray-900 break-words dark:text-slate-100">{isNew ? 'New product' : product?.name || form.name}</h1>

      {/* Details */}
      <fieldset disabled={!mayEditDetails} className="card p-5 space-y-4 min-w-0">
        {!mayEditDetails && <p className="text-xs text-gray-600 dark:text-slate-400">Products are edited by staff, managers and the owner.</p>}
        <PageError message={formError && (unnamed.length ? `${formError} (${unnamed.map((k) => `${k}: ${fieldErrors[k]}`).join('; ')})` : formError)} />
        <div>
          <label className="label" htmlFor="p-name">Name</label>
          <input id="p-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Product name" />
          {err('name')}
        </div>
        <div>
          <label className="label" htmlFor="p-tagline">Tagline</label>
          <input id="p-tagline" className="input" value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Short one-liner" />
        </div>
        <div>
          <label className="label" htmlFor="p-description">Description</label>
          <textarea id="p-description" className="input min-h-[120px]" value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        {writerOn && !isNew && mayUpdate && id && (
          <WriterPanel productId={id} onUse={(draft) => { set('description', draft.description); set('seoTitle', draft.seoTitle); set('seoDescription', draft.seoDescription) }} />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="p-status">Status</label>
            <select id="p-status" className="input" value={form.status} onChange={(e) => set('status', e.target.value as Product['status'])}>
              <option value="draft">Draft (hidden)</option>
              <option value="active">Active (live)</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-lead">Lead time (days)</label>
            <input id="p-lead" className="input" inputMode="numeric" value={form.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} placeholder="Optional" />
            {err('leadTimeDays')}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
          <input type="checkbox" checked={form.featured} onChange={(e) => set('featured', e.target.checked)} /> Feature on the storefront's home page
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="p-kind">Kind</label>
            <select id="p-kind" className="input" value={form.kind} onChange={(e) => set('kind', e.target.value as DetailsForm['kind'])}>
              <option value="physical">A product</option>
              <option value="gift_card">Gift card (emailed as a number when paid)</option>
            </select>
            {form.kind === 'gift_card' && <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">Each variant is an amount from 5.00 to 500.00. No shipping, tax or discount codes apply to a gift card.</p>}
          </div>
          <div>
            <label className="label" htmlFor="p-cat">Category</label>
            <input id="p-cat" className="input" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="Mugs" />
            <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">“You may also like” shows the same category when you pick none below.</p>
          </div>
          <div>
            <label className="label" htmlFor="p-brand">Brand (product feeds)</label>
            <input id="p-brand" className="input" value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Defaults to the store's name" />
          </div>
          <div>
            <label className="label" htmlFor="p-cond">Condition (product feeds)</label>
            <select id="p-cond" className="input" value={form.condition} onChange={(e) => set('condition', e.target.value as DetailsForm['condition'])}>
              <option value="new">New</option>
              <option value="refurbished">Refurbished</option>
              <option value="used">Used</option>
            </select>
          </div>
        </div>
        {others.length > 0 && (
          <details className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
            <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-slate-200">Upsells on the product page ({form.boughtTogetherIds.length + form.alsoLikeIds.length} picked)</summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([['boughtTogetherIds', 'Frequently bought together'], ['alsoLikeIds', 'You may also like']] as const).map(([k, title]) => (
                <fieldset key={k} className="space-y-1 min-w-0">
                  <legend className="text-sm font-medium text-gray-800 dark:text-slate-200">{title}</legend>
                  <p className="text-xs text-gray-600 dark:text-slate-400">None picked: products in the same category.</p>
                  {others.map((o) => (
                    <label key={o.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200 break-all">
                      <input type="checkbox" checked={form[k].includes(o.id)} onChange={() => togglePick(k, o.id)} /> {o.name}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </details>
        )}
        <details className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-medium text-gray-700 dark:text-slate-200">Search engines (optional)</summary>
          <div className="mt-3 space-y-3">
            <div>
              <label className="label" htmlFor="p-seo-title">SEO title</label>
              <input id="p-seo-title" className="input" value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} placeholder="Defaults to the product name" />
              {err('seoTitle')}
            </div>
            <div>
              <label className="label" htmlFor="p-seo-desc">SEO description</label>
              <textarea id="p-seo-desc" className="input min-h-[72px]" value={form.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} />
              {err('seoDescription')}
            </div>
          </div>
        </details>
        {mayEditDetails && (
          <button type="button" onClick={save} className="btn btn-primary" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}</button>
        )}
      </fieldset>

      {isNew ? (
        <p className="text-sm text-gray-600 dark:text-slate-400">Save the product first, then add variants (prices) and photos.</p>
      ) : product ? (
        <>
          <VariantsSection product={product} currency={currency} mayUpdate={mayUpdate} onChange={reloadProduct} />
          <ImagesSection product={product} mayUpdate={mayUpdate} onChange={reloadProduct} />
        </>
      ) : null}
    </div>
  )
}

// ── Variants ─────────────────────────────────────────────────────────────────
interface SupplierLink { ref: string; name: string | null }
interface RowEdit { price: string; compareAt: string; inv: string; low: string; cost: string; options: string; ref: string; gtin: string; mpn: string }

function VariantsSection({ product, currency, mayUpdate, onChange }: { product: Product; currency: string; mayUpdate: boolean; onChange: () => Promise<void> }) {
  const toast = useToast()
  const confirm = useConfirm()
  // Low-stock alerts (store_low_stock): the "Tell me at" box is there only where the shop has them on.
  const lowStockOn = useAuth().hasFeature('store_low_stock')
  // Dropship: variant → supplier item links, shown only when a supplier is connected. The supplier connection is the
  // owner's (integrations:update): asked only once the answer is known to be yes, never a request other seats are refused.
  const mayLinkSupplier = useKnownPermission('integrations:update')
  const mayDeleteVariant = useMayWrite('products:delete')
  const [supplierConnected, setSupplierConnected] = useState(false)
  const [supplierMap, setSupplierMap] = useState<Record<string, SupplierLink>>({})
  useEffect(() => {
    if (mayLinkSupplier !== true) return
    let live = true
    api.get('/api/admin/suppliers').then((st: { config?: { connected?: boolean } | null }) => {
      if (!live || !st?.config?.connected) return
      setSupplierConnected(true)
      return api.get('/api/admin/suppliers/variant-map').then((r: unknown) => {
        if (!live) return
        const m: Record<string, SupplierLink> = {}
        listOf<{ variantId: string; supplierVariantRef: string; supplierItemName: string | null }>(r)
          .forEach((row) => { m[row.variantId] = { ref: row.supplierVariantRef, name: row.supplierItemName } })
        setSupplierMap(m)
      })
    }).catch(() => { /* no supplier panel; the variants still work */ })
    return () => { live = false }
  }, [mayLinkSupplier])

  const blank = { sku: '', name: 'Default', price: '', compareAt: '', inventory: '', options: '' }
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(blank)
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)

  const add = async () => {
    setAddError(null)
    const priceCents = toHundredths(draft.price)
    if (priceCents === null) { setAddError('Enter the price as a number, like 24.99.'); return }
    const compare = draft.compareAt.trim() ? toHundredths(draft.compareAt) : null
    if (draft.compareAt.trim() && compare === null) { setAddError('Enter the compare-at price as a number, or leave it blank.'); return }
    const inventory = toWhole(draft.inventory)
    if (Number.isNaN(inventory)) { setAddError('Stock is a whole number, or blank for untracked.'); return }
    const options = parseOptions(draft.options)
    if (options === 'invalid') { setAddError('Write options as name=value, separated by commas (size=M, color=Red).'); return }
    setAddBusy(true)
    try {
      await api.post(`/api/admin/products/${product.id}/variants`, {
        sku: draft.sku.trim(), name: draft.name.trim() || 'Default', priceCents,
        compareAtPriceCents: compare, inventoryQty: inventory, options,
      })
      setDraft(blank); setAdding(false); toast.success('Variant added')
      await onChange()
    } catch (e) {
      const { fields } = refusalOf(e)
      const named = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('; ')
      setAddError(named ? `${errorText(e, 'Could not add the variant')} (${named})` : errorText(e, 'Could not add the variant'))
    } finally { setAddBusy(false) }
  }

  const del = async (v: ProductVariant) => {
    if (!(await confirm(`Delete variant ${v.sku}? It comes off sale at once.`, { title: 'Delete variant', confirmText: 'Delete' }))) return
    try { await api.delete(`/api/admin/products/variants/${v.id}`); toast.success('Variant deleted'); await onChange() }
    catch (e) { toast.error(errorText(e, 'Could not delete the variant')) }
  }

  // Save a whole row at once, awaiting each call and showing errors (per-field blur saves lost edits silently).
  const saveRow = async (v: ProductVariant, next: RowEdit): Promise<boolean> => {
    const priceCents = toHundredths(next.price)
    if (priceCents === null) { toast.error('Enter the price as a number, like 24.99.'); return false }
    const compare = next.compareAt.trim() ? toHundredths(next.compareAt) : null
    if (next.compareAt.trim() && compare === null) { toast.error('Enter the compare-at price as a number, or leave it blank.'); return false }
    const inventoryQty = toWhole(next.inv)
    if (Number.isNaN(inventoryQty)) { toast.error('Stock is a whole number, or blank for untracked.'); return false }
    // What it costs you: only a seat that is sent the cost (margin:read) has the box; blank = no cost entered.
    const costCents = next.cost.trim() ? toHundredths(next.cost) : null
    if (next.cost.trim() && costCents === null) { toast.error('Enter the cost as a number, like 9.50, or leave it blank.'); return false }
    const lowStockAt = toWhole(next.low)
    if (Number.isNaN(lowStockAt) || (lowStockAt !== null && lowStockAt < 0)) { toast.error('The low-stock level is a whole number, or blank for no alert.'); return false }
    const options = parseOptions(next.options)
    if (options === 'invalid') { toast.error('Write options as name=value, separated by commas (size=M, color=Red).'); return false }
    try {
      // Only what changed in this row. A changed stock count names the count it was typed over (inventoryFrom), and the
      // server refuses it if a sale or another person moved the count in between.
      const body: Record<string, unknown> = {}
      if (priceCents !== v.priceCents) body.priceCents = priceCents
      if (compare !== v.compareAtPriceCents) body.compareAtPriceCents = compare
      if (inventoryQty !== v.inventoryQty) { body.inventoryQty = inventoryQty; body.inventoryFrom = v.inventoryQty }
      if (lowStockOn && lowStockAt !== (v.lowStockAt ?? null)) body.lowStockAt = lowStockAt
      if (v.costCents !== undefined && costCents !== v.costCents) body.costCents = costCents
      if (optionsText(options) !== optionsText(v.options)) body.options = options
      if (next.gtin.trim() !== (v.gtin || '')) body.gtin = next.gtin.trim() || null
      if (next.mpn.trim() !== (v.mpn || '')) body.mpn = next.mpn.trim() || null
      if (Object.keys(body).length) await api.patch(`/api/admin/products/variants/${v.id}`, body)
      if (supplierConnected && next.ref.trim() !== (supplierMap[v.id]?.ref || '')) {
        const res: { cleared?: boolean; name?: string | null } = await api.put(`/api/admin/suppliers/variant-map/${v.id}`, { ref: next.ref.trim() })
        setSupplierMap((m) => {
          const copy = { ...m }
          if (res?.cleared) delete copy[v.id]
          else copy[v.id] = { ref: next.ref.trim(), name: res?.name || null }
          return copy
        })
      }
      toast.success('Variant saved')
      await onChange()
      return true
    } catch (e) {
      toast.error(errorText(e, 'Could not save the variant'))
      // The count moved under us: show it as it stands, so the next save is typed over the real figure.
      if (refusalOf(e).code === 'inventory_changed') await onChange()
      else { const f = refusalOf(e).fields; if (Object.keys(f).length) toast.error(Object.values(f).join('; ')) }
      return false
    }
  }

  return (
    <section className="card p-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Variants &amp; pricing</h2>
        {mayUpdate && !adding && <button type="button" onClick={() => setAdding(true)} className="btn btn-secondary text-xs px-3 py-1.5"><Plus className="h-3 w-3" /> Add variant</button>}
      </div>
      {product.variants.length === 0 && !adding && <p className="text-sm text-gray-600 dark:text-slate-400">Add at least one variant so the product can be sold.</p>}
      <div className="divide-y divide-gray-200 dark:divide-slate-800">
        {product.variants.map((v) => (
          <VariantRow
            key={v.id} v={v} currency={currency} mayUpdate={mayUpdate}
            lowStockOn={lowStockOn}
            supplierConnected={supplierConnected} supplierRef={supplierMap[v.id]?.ref ?? ''} supplierName={supplierMap[v.id]?.name ?? null}
            onSave={(next) => saveRow(v, next)}
            onDelete={mayDeleteVariant ? () => del(v) : undefined}
          />
        ))}
      </div>
      {adding && (
        <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-slate-800">
          <PageError message={addError} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label className="label text-xs" htmlFor="nv-sku">SKU</label><input id="nv-sku" className="input" placeholder="TSHIRT-M" value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} /></div>
            <div><label className="label text-xs" htmlFor="nv-name">Name</label><input id="nv-name" className="input" placeholder="Medium" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
            <div><label className="label text-xs" htmlFor="nv-price">Price ({currency.toUpperCase()})</label><input id="nv-price" className="input" inputMode="decimal" placeholder="24.99" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></div>
            <div><label className="label text-xs" htmlFor="nv-compare">Compare-at price (optional)</label><input id="nv-compare" className="input" inputMode="decimal" placeholder="29.99" value={draft.compareAt} onChange={(e) => setDraft({ ...draft, compareAt: e.target.value })} /></div>
            <div><label className="label text-xs" htmlFor="nv-stock">Stock (blank = not tracked)</label><input id="nv-stock" className="input" inputMode="numeric" placeholder="∞" value={draft.inventory} onChange={(e) => setDraft({ ...draft, inventory: e.target.value })} /></div>
            <div><label className="label text-xs" htmlFor="nv-options">Options (optional)</label><input id="nv-options" className="input" placeholder="size=M, color=Red" value={draft.options} onChange={(e) => setDraft({ ...draft, options: e.target.value })} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={add} className="btn btn-primary text-xs px-3 py-1.5" disabled={addBusy || !draft.sku.trim() || !draft.price.trim()}>{addBusy ? 'Adding…' : 'Add'}</button>
            <button type="button" onClick={() => { setAdding(false); setDraft(blank); setAddError(null) }} className="btn btn-secondary text-xs px-3 py-1.5">Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}

// One editable variant row: controlled inputs and an explicit Save that lights up only when something changed.
function VariantRow({ v, currency, mayUpdate, lowStockOn, supplierConnected, supplierRef, supplierName, onSave, onDelete }: {
  v: ProductVariant
  currency: string
  mayUpdate: boolean
  /** Low-stock alerts are on: show the "Tell me at" box. */
  lowStockOn: boolean
  supplierConnected: boolean
  supplierRef: string
  supplierName: string | null
  onSave: (next: RowEdit) => Promise<boolean>
  /** Absent when this person may not remove a variant from sale. */
  onDelete?: () => void
}) {
  const fromVariant = (): RowEdit => ({
    price: fromHundredths(v.priceCents), compareAt: fromHundredths(v.compareAtPriceCents),
    inv: v.inventoryQty == null ? '' : String(v.inventoryQty), low: v.lowStockAt == null ? '' : String(v.lowStockAt), cost: v.costCents == null ? '' : fromHundredths(v.costCents), options: optionsText(v.options), ref: supplierRef,
    gtin: v.gtin || '', mpn: v.mpn || '',
  })
  const [edit, setEdit] = useState<RowEdit>(fromVariant)
  const [saving, setSaving] = useState(false)

  // Re-sync when the variant changes underneath (a reload after a save, or the stock moved).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setEdit(fromVariant()) }, [v.priceCents, v.compareAtPriceCents, v.inventoryQty, v.lowStockAt, v.costCents, optionsText(v.options), supplierRef, v.gtin, v.mpn])

  const base = fromVariant()
  const dirty = edit.price !== base.price || edit.compareAt !== base.compareAt || edit.inv !== base.inv || (lowStockOn && edit.low !== base.low) || (v.costCents !== undefined && edit.cost !== base.cost) || edit.options !== base.options
    || edit.gtin.trim() !== base.gtin || edit.mpn.trim() !== base.mpn
    || (supplierConnected && edit.ref.trim() !== supplierRef)

  const save = async () => {
    setSaving(true)
    try { await onSave(edit) } finally { setSaving(false) }
  }

  if (!mayUpdate) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-900 truncate dark:text-slate-100">{v.name}</div>
          <div className="text-xs text-gray-600 dark:text-slate-400">{v.sku}{v.options && Object.keys(v.options).length ? ` · ${optionsText(v.options)}` : ''}</div>
        </div>
        <div className="text-gray-900 dark:text-slate-100">
          {formatMoney(v.priceCents, currency)}
          {v.compareAtPriceCents != null && <span className="ml-1 text-xs text-gray-600 line-through dark:text-slate-400">{formatMoney(v.compareAtPriceCents, currency)}</span>}
        </div>
        <div className="text-gray-700 dark:text-slate-300">{v.inventoryQty == null ? 'Not tracked' : `${v.inventoryQty} in stock`}</div>
      </div>
    )
  }

  return (
    <div className="py-3 space-y-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-gray-900 truncate dark:text-slate-100">{v.name}</div>
          <div className="text-xs text-gray-600 dark:text-slate-400">{v.sku}</div>
        </div>
        {onDelete && (
          <button type="button" aria-label={`Delete variant ${v.sku}`} onClick={onDelete} className="p-1 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block text-xs text-gray-600 dark:text-slate-400">Price ({currency.toUpperCase()})
          <input className="input mt-1 py-1.5" inputMode="decimal" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} />
        </label>
        <label className="block text-xs text-gray-600 dark:text-slate-400">Compare-at
          <input className="input mt-1 py-1.5" inputMode="decimal" placeholder="—" value={edit.compareAt} onChange={(e) => setEdit({ ...edit, compareAt: e.target.value })} />
        </label>
        <label className="block text-xs text-gray-600 dark:text-slate-400">Stock
          <input className="input mt-1 py-1.5" inputMode="numeric" placeholder="∞" title="Blank = not tracked" value={edit.inv} onChange={(e) => setEdit({ ...edit, inv: e.target.value })} />
        </label>
        {v.costCents !== undefined && (
          <label className="block text-xs text-gray-600 dark:text-slate-400">What it costs you ({currency.toUpperCase()})
            <input className="input mt-1 py-1.5" inputMode="decimal" placeholder="—" title="Used for profit on the Sales page. Shoppers never see it." value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })} />
          </label>
        )}
        {lowStockOn && (
          <label className="block text-xs text-gray-600 dark:text-slate-400">Tell me at
            <input className="input mt-1 py-1.5" inputMode="numeric" placeholder="No alert" title="One email when a sale takes the stock down to this number" value={edit.low} onChange={(e) => setEdit({ ...edit, low: e.target.value })} />
          </label>
        )}
        <label className="block text-xs text-gray-600 dark:text-slate-400">Options
          <input className="input mt-1 py-1.5" placeholder="size=M" value={edit.options} onChange={(e) => setEdit({ ...edit, options: e.target.value })} />
        </label>
        <label className="block text-xs text-gray-600 dark:text-slate-400">Barcode (GTIN)
          <input className="input mt-1 py-1.5" inputMode="numeric" placeholder="UPC / EAN" value={edit.gtin} onChange={(e) => setEdit({ ...edit, gtin: e.target.value })} />
        </label>
        <label className="block text-xs text-gray-600 dark:text-slate-400">Part number (MPN)
          <input className="input mt-1 py-1.5" placeholder="Optional" value={edit.mpn} onChange={(e) => setEdit({ ...edit, mpn: e.target.value })} />
        </label>
        {supplierConnected && (
          <label className="block col-span-2 text-xs text-gray-600 dark:text-slate-400">Supplier item id{supplierName ? ` — ${supplierName}` : ''}
            <input className="input mt-1 py-1.5" placeholder="Blank = not dropshipped" title="Printful sync variant / CJ vid" value={edit.ref} onChange={(e) => setEdit({ ...edit, ref: e.target.value })} />
          </label>
        )}
      </div>
      <button type="button" onClick={save} disabled={!dirty || saving} className="btn btn-primary text-xs px-3 py-1.5">{saving ? 'Saving…' : 'Save'}</button>
    </div>
  )
}

// ── Images ───────────────────────────────────────────────────────────────────
function ImagesSection({ product, mayUpdate, onChange }: { product: Product; mayUpdate: boolean; onChange: () => Promise<void> }) {
  const toast = useToast()
  const writerOn = useAuth().hasFeature('store_ai_writer')
  const [tone, setTone] = useState<ToneId>('straightforward')
  const [writing, setWriting] = useState(false)
  /** Drafted descriptions by photo, waiting in each photo's box for the person to read and save. */
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [skipNote, setSkipNote] = useState<string | null>(null)
  const writeAlts = async () => {
    setWriting(true); setSkipNote(null)
    try {
      const r: { alts: Array<{ imageId: string; alt: string }>; skipped: Array<{ imageId: string; reason: string }> } = await api.post(`/api/admin/product-writer/${product.id}/alt-text`, { tone })
      setDrafts(Object.fromEntries(r.alts.map((a) => [a.imageId, a.alt])))
      if (r.skipped.length) setSkipNote(`${r.skipped.length} photo${r.skipped.length === 1 ? '' : 's'} left for you: ${[...new Set(r.skipped.map((x) => x.reason))].join('; ')}.`)
      toast.success(r.alts.length ? 'Drafts are in the photo boxes — read them, then Save alt on each' : 'Nothing to draft')
    } catch (e) { toast.error(errorText(e, 'Could not write the photo descriptions')) } finally { setWriting(false) }
  }
  const confirm = useConfirm()
  const [url, setUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const add = async () => {
    try {
      await api.post(`/api/admin/products/${product.id}/images`, { url: url.trim(), isPrimary: product.images.length === 0 })
      setUrl(''); toast.success('Photo added'); await onChange()
    } catch (e) { toast.error(errorText(e, 'Could not add the photo')) }
  }

  const uploadFiles = async (files: FileList | File[]) => {
    const picked = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (!picked.length) return
    setUploading(true)
    let done = 0
    try {
      for (const f of picked) {
        const fd = new FormData()
        fd.append('file', f)
        await api.upload(`/api/admin/products/${product.id}/images/upload`, fd)
        done++
      }
      toast.success(picked.length > 1 ? `${picked.length} photos uploaded` : 'Photo uploaded')
    } catch (e) {
      toast.error(`${errorText(e, 'Could not upload the photo')}${done ? ` (${done} of ${picked.length} uploaded)` : ''}`)
    } finally {
      setUploading(false)
      await onChange()
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files)
  }

  const makePrimary = async (img: ProductImage) => {
    try { await api.patch(`/api/admin/products/images/${img.id}`, { isPrimary: true }); toast.success('Main photo updated'); await onChange() }
    catch (e) { toast.error(errorText(e, 'Could not change the main photo')) }
  }
  const del = async (img: ProductImage) => {
    if (!(await confirm('Remove this photo from the product?', { title: 'Remove photo', confirmText: 'Remove' }))) return
    try { await api.delete(`/api/admin/products/images/${img.id}`); toast.success('Photo removed'); await onChange() }
    catch (e) { toast.error(errorText(e, 'Could not remove the photo')) }
  }
  const saveAlt = async (img: ProductImage, alt: string) => {
    try { await api.patch(`/api/admin/products/images/${img.id}`, { alt: alt.trim() || null }); toast.success('Alt text saved'); await onChange() }
    catch (e) { toast.error(errorText(e, 'Could not save the alt text')) }
  }

  return (
    <section className="card p-5 min-w-0">
      <h2 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">Photos</h2>
      {product.images.length === 0 && <p className="mb-3 text-sm text-gray-600 dark:text-slate-400">No photos yet.</p>}
      {writerOn && mayUpdate && product.images.length > 0 && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <ToneSelect id="alt-tone" value={tone} onChange={setTone} />
          <button type="button" onClick={writeAlts} disabled={writing} className="btn btn-secondary text-xs">{writing ? 'Writing…' : 'Write photo descriptions'}</button>
          {skipNote && <p className="basis-full text-xs text-gray-600 dark:text-slate-400">{skipNote}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
        {product.images.map((img) => (
          <ImageCard key={img.id} img={img} draft={drafts[img.id]} mayUpdate={mayUpdate} onPrimary={() => makePrimary(img)} onDelete={() => del(img)} onAlt={(alt) => saveAlt(img, alt)} />
        ))}
      </div>

      {mayUpdate && (
        <>
          {/* Drag-and-drop / click-to-upload */}
          <div
            role="button" tabIndex={0}
            onClick={() => !uploading && fileInput.current?.click()}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !uploading) { e.preventDefault(); fileInput.current?.click() } }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-6 text-center transition ${dragOver ? 'border-brand-500 bg-brand-50 dark:bg-slate-800' : 'border-gray-300 hover:border-gray-400 dark:border-slate-600 dark:hover:border-slate-500'} ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            {uploading
              ? <><Loader2 className="h-5 w-5 animate-spin text-gray-600 dark:text-slate-300" /><span className="text-sm text-gray-600 dark:text-slate-300">Uploading…</span></>
              : <><Upload className="h-5 w-5 text-gray-600 dark:text-slate-300" /><span className="text-sm text-gray-700 dark:text-slate-200">Drop photos here or <span className="font-medium underline">browse</span></span><span className="text-xs text-gray-600 dark:text-slate-400">JPEG, PNG, WebP, GIF or AVIF · up to 8 MB</span></>}
          </div>
          <input
            ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple className="hidden"
            onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files); e.target.value = '' }}
          />

          {/* Paste-an-address fallback */}
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            <label className="sr-only" htmlFor="img-url">Photo address</label>
            <input id="img-url" className="input flex-1" placeholder="…or paste a photo address (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button type="button" onClick={add} className="btn btn-secondary" disabled={!url.trim()}><Plus className="h-4 w-4" /> Add</button>
          </div>
        </>
      )}
    </section>
  )
}

function ImageCard({ img, draft, mayUpdate, onPrimary, onDelete, onAlt }: {
  img: ProductImage; draft?: string; mayUpdate: boolean; onPrimary: () => void; onDelete: () => void; onAlt: (alt: string) => Promise<void>
}) {
  const [alt, setAlt] = useState(img.alt || '')
  const [saving, setSaving] = useState(false)
  useEffect(() => { setAlt(img.alt || '') }, [img.alt])
  // A drafted description lands in the box, unsaved: the person reads it and presses Save alt.
  useEffect(() => { if (draft) setAlt(draft) }, [draft])
  const dirty = alt.trim() !== (img.alt || '').trim()
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden dark:border-slate-700">
      <div className="relative aspect-square bg-gray-100 dark:bg-slate-800">
        <img src={img.url} alt={img.alt || ''} className="h-full w-full object-cover" />
        {img.isPrimary && <span className="absolute top-1 left-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white">Main photo</span>}
      </div>
      {mayUpdate ? (
        <div className="p-2 space-y-2">
          <label className="block text-xs text-gray-600 dark:text-slate-400">Alt text
            <input className="input mt-1 px-2 py-1 text-xs" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="What the photo shows" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <button type="button" disabled={saving} onClick={async () => { setSaving(true); try { await onAlt(alt) } finally { setSaving(false) } }} className="text-xs font-medium text-gray-900 underline dark:text-slate-100">{saving ? 'Saving…' : 'Save alt'}</button>
            )}
            {!img.isPrimary && (
              <button type="button" onClick={onPrimary} title="Make this the main photo" className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"><Star className="h-3.5 w-3.5" /> Main</button>
            )}
            <button type="button" onClick={onDelete} aria-label="Remove photo" className="ml-auto inline-flex items-center text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-300"><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      ) : img.alt ? <p className="p-2 text-xs text-gray-600 dark:text-slate-400">{img.alt}</p> : null}
    </div>
  )
}

// ── The writer (store_ai_writer) ───────────────────────────────────────────────
const TONE_CHOICES = [
  ['friendly', 'Friendly'], ['professional', 'Professional'], ['playful', 'Playful'], ['luxurious', 'Luxurious'], ['straightforward', 'Straightforward'],
] as const
type ToneId = (typeof TONE_CHOICES)[number][0]

function ToneSelect({ id, value, onChange }: { id: string; value: ToneId; onChange: (t: ToneId) => void }) {
  return (
    <div>
      <label className="label" htmlFor={id}>Tone</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as ToneId)}>
        {TONE_CHOICES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    </div>
  )
}

interface Draft { description: string; seoTitle: string; seoDescription: string }

/** Asks for a draft, shows it in boxes the person can change, and hands it to the form only when they say so. */
function WriterPanel({ productId, onUse }: { productId: string; onUse: (d: Draft) => void }) {
  const toast = useToast()
  const [tone, setTone] = useState<ToneId>('friendly')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const write = async () => {
    setBusy(true); setProblem(null)
    try { setDraft(await api.post(`/api/admin/product-writer/${productId}/describe`, { tone, notes: notes.trim() || null })) }
    catch (e) { setProblem(errorText(e, 'Could not write a draft')) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-lg border border-gray-200 p-3 space-y-3 dark:border-slate-700">
      <p className="text-sm font-medium text-gray-700 dark:text-slate-200">Write it for me</p>
      <p className="text-xs text-gray-600 dark:text-slate-400">A draft from the product's name, options and your notes. Read it and change it; it is only saved when you press Save changes.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ToneSelect id="p-tone" value={tone} onChange={setTone} />
        <div>
          <label className="label" htmlFor="p-notes">What to say about it (optional)</label>
          <textarea id="p-notes" className="input min-h-[40px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Materials, who it's for, what makes it good" />
        </div>
      </div>
      <PageError message={problem} />
      <button type="button" onClick={write} disabled={busy} className="btn btn-secondary text-sm">{busy ? 'Writing…' : draft ? 'Write another' : 'Write a draft'}</button>
      {draft && (
        <div className="space-y-3 border-t border-gray-200 pt-3 dark:border-slate-700">
          <div>
            <label className="label" htmlFor="d-description">Draft description</label>
            <textarea id="d-description" className="input min-h-[140px]" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="d-seo-title">Draft search title</label>
            <input id="d-seo-title" className="input" value={draft.seoTitle} onChange={(e) => setDraft({ ...draft, seoTitle: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="d-seo-desc">Draft search description</label>
            <textarea id="d-seo-desc" className="input min-h-[60px]" value={draft.seoDescription} onChange={(e) => setDraft({ ...draft, seoDescription: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary text-sm" onClick={() => { onUse(draft); setDraft(null); toast.success('Draft is in the form — press Save changes to keep it') }}>Use this draft</button>
            <button type="button" className="btn btn-secondary text-sm" onClick={() => setDraft(null)}>Throw it away</button>
          </div>
        </div>
      )}
    </div>
  )
}
