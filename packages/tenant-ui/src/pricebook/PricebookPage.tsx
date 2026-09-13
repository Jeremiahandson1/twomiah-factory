// Pricebook — ONE page for every CRM that offers `pricebook` (crm, crm-fieldservice, crm-landscaping), vendored as ../shared.
// Before: two copies (typed crm, untyped fs/lnd) that differed only in the tier wording; both lost customer description,
// labor hours and "show to customers" on create, saved options into a 500, built the search URL without encoding, and
// reported every failure with alert().
import React, { useState, useEffect, useCallback } from 'react'
import { BookOpen, Plus, Search, Edit2, Copy, Trash2, Loader2, DollarSign, Clock, Package, Star, Percent, FolderTree } from 'lucide-react'
import { Button, Modal, ConfirmModal, Field, inputCls, errMsg } from '../invoicing/ui'
import type { PricebookApi, PricebookToast, PricebookConfig, TierPreset } from './types'

type Item = Record<string, any>
type Category = { id: string; name: string; _count?: { items?: number } }
const DEFAULT_TIERS: TierPreset[] = [
  { tier: 'good', name: 'Basic', description: '', recommended: false },
  { tier: 'better', name: 'Standard', description: '', recommended: true },
  { tier: 'best', name: 'Premium', description: '', recommended: false },
]
const usd = (v: unknown) => '$' + Number(v || 0).toFixed(2)

export function PricebookPage({ api, toast, config }: { api: PricebookApi; toast: PricebookToast; config?: PricebookConfig }) {
  const itemWord = config?.itemLabel || 'Service'
  const [items, setItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [editing, setEditing] = useState<{ open: boolean; item: Item | null }>({ open: false, item: null })
  const [catsOpen, setCatsOpen] = useState(false)
  const [tiersFor, setTiersFor] = useState<Item | null>(null)
  const [toDelete, setToDelete] = useState<Item | null>(null)

  const load = useCallback(async () => {
    try {
      const [res, cats] = await Promise.all([
        api.get('/api/pricebook/items', { search: search || undefined, categoryId: categoryId || undefined, limit: 200 }),
        api.get('/api/pricebook/categories', { flat: true }),
      ])
      setItems(Array.isArray(res?.data) ? res.data : [])
      setCategories(Array.isArray(cats) ? cats : [])
    } catch (e) { toast.error(errMsg(e, 'Failed to load the pricebook')) } finally { setLoading(false) }
  }, [api, search, categoryId])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])

  const duplicate = async (item: Item) => { try { await api.post(`/api/pricebook/items/${item.id}/duplicate`); toast.success('Duplicated'); load() } catch (e) { toast.error(errMsg(e, 'Failed to duplicate')) } }
  const remove = async () => { if (!toDelete) return; try { await api.delete('/api/pricebook/items', toDelete.id); toast.success('Deleted') } catch (e) { toast.error(errMsg(e, 'Failed to delete')) } finally { setToDelete(null); load() } }
  const avg = (f: (i: Item) => number) => (items.length ? items.reduce((s, i) => s + f(i), 0) / items.length : 0)

  return (
    <div className="space-y-6" data-testid="pricebook-page-shared">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{config?.title || 'Pricebook'}</h1>
          <p className="text-gray-500 dark:text-slate-400">{config?.subtitle || 'Flat-rate service catalog'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCatsOpen(true)}><FolderTree className="w-4 h-4" />Categories</Button>
          <Button onClick={() => setEditing({ open: true, item: null })}><Plus className="w-4 h-4" />Add {itemWord}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={BookOpen} label={`${itemWord}s`} value={items.length} />
        <Stat icon={FolderTree} label="Categories" value={categories.length} />
        <Stat icon={DollarSign} label="Avg price" value={usd(avg((i) => Number(i.price)))} />
        <Stat icon={Percent} label="Avg margin" value={`${Math.round(avg((i) => Number(i.margin || 0)))}%`} tone="green" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${itemWord.toLowerCase()}s…`} className={`${inputCls} pl-10`} aria-label="Search" />
        </div>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputCls} w-auto`} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div> : items.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-xl dark:bg-slate-900">
          <BookOpen className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <p className="text-gray-500 dark:text-slate-400">No {itemWord.toLowerCase()}s found</p>
          <button onClick={() => setEditing({ open: true, item: null })} className="mt-4 text-orange-600 hover:text-orange-700">Add your first {itemWord.toLowerCase()}</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((item) => (
            <div key={item.id} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4">
              <div className="flex items-start gap-3">
                {item.imageUrl ? <img src={item.imageUrl} alt="" className="w-14 h-14 rounded-lg object-cover" /> : <div className="w-14 h-14 bg-gray-100 rounded-lg flex items-center justify-center dark:bg-slate-800"><Package className="w-6 h-6 text-gray-400" /></div>}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate dark:text-slate-100">{item.name}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{item.code}{item.active === false ? ' · inactive' : ''}</p>
                  {item.category?.name && <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded dark:bg-slate-800 dark:text-slate-400">{item.category.name}</span>}
                </div>
              </div>
              {item.description && <p className="mt-3 text-sm text-gray-600 line-clamp-2 dark:text-slate-400">{item.description}</p>}
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <div><p className="text-gray-500 dark:text-slate-400">Price</p><p className="font-bold text-gray-900 dark:text-slate-100">{usd(item.price)}</p></div>
                <div><p className="text-gray-500 dark:text-slate-400">Cost</p><p className="font-medium text-gray-700 dark:text-slate-200">{usd(item.totalCost ?? item.cost)}</p></div>
                <div><p className="text-gray-500 dark:text-slate-400">Margin</p><p className={`font-medium ${Number(item.margin) > 30 ? 'text-green-600' : 'text-orange-600'}`}>{item.margin}%</p></div>
              </div>
              {Number(item.laborHours) > 0 && <div className="mt-2 flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400"><Clock className="w-4 h-4" />{Number(item.laborHours)} hours</div>}
              {Number(item._count?.goodBetterBest) > 0 && <div className="mt-2 flex items-center gap-1 text-sm text-blue-600"><Star className="w-4 h-4" />{item._count.goodBetterBest} {config?.tiersTitle || 'pricing tier'}{item._count.goodBetterBest === 1 ? '' : 's'}</div>}
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-800 flex items-center gap-1">
                <button onClick={() => setEditing({ open: true, item })} className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 rounded-lg dark:text-slate-400 dark:hover:bg-slate-800"><Edit2 className="w-4 h-4" />Edit</button>
                <button onClick={() => setTiersFor(item)} className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"><Star className="w-4 h-4" />{config?.tiersButton || 'Options'}</button>
                <button onClick={() => duplicate(item)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg" title="Duplicate" aria-label="Duplicate"><Copy className="w-4 h-4" /></button>
                <button onClick={() => setToDelete(item)} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg" title="Delete" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing.open && <ItemModal api={api} toast={toast} item={editing.item} categories={categories} itemWord={itemWord} onClose={() => setEditing({ open: false, item: null })} onSaved={() => { setEditing({ open: false, item: null }); load() }} />}
      {catsOpen && <CategoriesModal api={api} toast={toast} categories={categories} onClose={() => setCatsOpen(false)} onChanged={load} />}
      {tiersFor && <TiersModal api={api} toast={toast} item={tiersFor} presets={config?.tierPresets || DEFAULT_TIERS} title={config?.tiersTitle || 'Good-Better-Best options'} onClose={() => setTiersFor(null)} onSaved={() => { setTiersFor(null); load() }} />}
      <ConfirmModal isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} title={`Delete ${itemWord.toLowerCase()}`} message={`Delete "${toDelete?.name}" and its pricing tiers?`} confirmText="Delete" />
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone = 'gray' }: { icon: any; label: string; value: string | number; tone?: 'gray' | 'green' }) {
  return <div className={`p-4 rounded-xl ${tone === 'green' ? 'bg-green-50 text-green-600 dark:bg-green-950/40 dark:text-green-300' : 'bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300'}`}><Icon className="w-5 h-5 mb-2" /><p className="text-2xl font-bold">{value}</p><p className="text-sm opacity-75">{label}</p></div>
}

function ItemModal({ api, toast, item, categories, itemWord, onClose, onSaved }: { api: PricebookApi; toast: PricebookToast; item: Item | null; categories: Category[]; itemWord: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: item?.name || '', code: item?.code || '', categoryId: item?.categoryId || '', description: item?.description || '', customerDescription: item?.customerDescription || '',
    price: item?.price != null ? String(Number(item.price)) : '', cost: item?.cost != null ? String(Number(item.cost)) : '', laborHours: item?.laborHours != null ? String(Number(item.laborHours)) : '',
    taxable: item?.taxable ?? true, showToCustomer: item?.showToCustomer ?? true, active: item?.active ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((cur) => ({ ...cur, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))
  const margin = Number(f.price) > 0 ? (((Number(f.price) - Number(f.cost || 0)) / Number(f.price)) * 100).toFixed(1) : '0'
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(''); setSaving(true)
    const payload = { ...f, code: f.code.trim() || undefined, categoryId: f.categoryId || null, price: Number(f.price || 0), cost: Number(f.cost || 0), laborHours: f.laborHours === '' ? null : Number(f.laborHours) }
    try {
      if (item) await api.put(`/api/pricebook/items/${item.id}`, payload); else await api.post('/api/pricebook/items', payload)
      toast.success(item ? 'Saved' : `${itemWord} added`); onSaved()
    } catch (e) { setErr(errMsg(e, `Failed to save the ${itemWord.toLowerCase()}`)) } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={item ? `Edit ${itemWord.toLowerCase()}` : `Add ${itemWord.toLowerCase()}`} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><Field label="Name"><input className={inputCls} required maxLength={200} value={f.name} onChange={set('name')} placeholder="e.g. AC tune-up" /></Field></div>
          <Field label="Code" hint="Leave blank to auto-number"><input className={inputCls} maxLength={50} value={f.code} onChange={set('code')} /></Field>
          <Field label="Category"><select className={inputCls} value={f.categoryId} onChange={set('categoryId')}><option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <div className="md:col-span-2"><Field label="Internal description"><textarea className={inputCls} rows={2} maxLength={2000} value={f.description} onChange={set('description')} placeholder="For your team" /></Field></div>
          <div className="md:col-span-2"><Field label="Customer description"><textarea className={inputCls} rows={2} maxLength={2000} value={f.customerDescription} onChange={set('customerDescription')} placeholder="What customers see on quotes and invoices" /></Field></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-lg bg-gray-50 p-4 dark:bg-slate-800/60">
          <Field label="Price ($)"><input className={inputCls} type="number" min={0} step="0.01" required value={f.price} onChange={set('price')} /></Field>
          <Field label="Cost ($)"><input className={inputCls} type="number" min={0} step="0.01" value={f.cost} onChange={set('cost')} /></Field>
          <Field label="Labor hours"><input className={inputCls} type="number" min={0} step="0.25" value={f.laborHours} onChange={set('laborHours')} /></Field>
          <Field label="Margin"><div className={`px-3 py-2 rounded-lg font-medium ${Number(margin) > 30 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{margin}%</div></Field>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.taxable} onChange={set('taxable')} />Taxable</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.showToCustomer} onChange={set('showToCustomer')} />Show to customers</label>
          {item && <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={set('active')} />Active</label>}
        </div>
        {err && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{err}</div>}
        <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></div>
      </form>
    </Modal>
  )
}

function CategoriesModal({ api, toast, categories, onClose, onChanged }: { api: PricebookApi; toast: PricebookToast; categories: Category[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const add = async () => {
    if (!name.trim()) return
    setSaving(true)
    try { await api.post('/api/pricebook/categories', { name: name.trim() }); setName(''); toast.success('Category added'); onChanged() } catch (e) { toast.error(errMsg(e, 'Failed to add the category')) } finally { setSaving(false) }
  }
  const rename = async (c: Category) => {
    const next = window.prompt('Rename category', c.name)?.trim()
    if (!next || next === c.name) return
    try { await api.put(`/api/pricebook/categories/${c.id}`, { name: next }); onChanged() } catch (e) { toast.error(errMsg(e, 'Failed to rename')) }
  }
  const retire = async (c: Category) => { try { await api.put(`/api/pricebook/categories/${c.id}`, { active: false }); toast.success('Category hidden'); onChanged() } catch (e) { toast.error(errMsg(e, 'Failed to hide the category')) } }
  return (
    <Modal isOpen onClose={onClose} title="Categories">
      <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
        {categories.length === 0 && <p className="text-sm text-gray-500">No categories yet.</p>}
        {categories.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 p-3 bg-gray-50 rounded-lg dark:bg-slate-800">
            <span className="truncate">{c.name}</span>
            <span className="flex items-center gap-3 text-sm text-gray-500 dark:text-slate-400 shrink-0">{c._count?.items || 0} items
              <button onClick={() => rename(c)} className="text-gray-600 hover:underline dark:text-slate-300">Rename</button>
              <button onClick={() => retire(c)} className="text-red-600 hover:underline">Hide</button>
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input className={inputCls} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }} />
        <Button onClick={add} disabled={saving || !name.trim()}>Add</Button>
      </div>
    </Modal>
  )
}

function TiersModal({ api, toast, item, presets, title, onClose, onSaved }: { api: PricebookApi; toast: PricebookToast; item: Item; presets: TierPreset[]; title: string; onClose: () => void; onSaved: () => void }) {
  type Opt = TierPreset & { price: string; features: string[] }
  const blank = (): Opt[] => presets.map((p) => ({ ...p, price: '', features: [] }))
  const [opts, setOpts] = useState<Opt[]>(blank)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.get(`/api/pricebook/items/${item.id}/options`).then((rows: any[]) => {
      if (Array.isArray(rows) && rows.length) setOpts(presets.map((p) => { const r = rows.find((x) => x.tier === p.tier); return r ? { tier: p.tier, name: r.name || '', description: r.description || '', recommended: !!r.recommended, price: String(Number(r.price)), features: Array.isArray(r.features) ? r.features : [] } : { ...p, price: '', features: [], recommended: false } }))
    }).catch((e) => setErr(errMsg(e, 'Failed to load the options'))).finally(() => setLoading(false))
  }, [api, item.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (tier: string, patch: Partial<Opt>) => setOpts((cur) => cur.map((o) => (o.tier === tier ? { ...o, ...patch } : o)))
  const save = async () => {
    setErr(''); setSaving(true)
    try {
      const options = opts.filter((o) => o.name.trim() && o.price !== '').map((o) => ({ tier: o.tier, name: o.name.trim(), description: o.description || null, price: Number(o.price), features: o.features.filter(Boolean), recommended: o.recommended }))
      await api.put(`/api/pricebook/items/${item.id}/options`, { options })
      toast.success('Options saved'); onSaved()
    } catch (e) { setErr(errMsg(e, 'Failed to save the options')) } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={`${title} — ${item.name}`} size="xl">
      {loading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div> : (
        <>
          <div className="grid md:grid-cols-3 gap-4">
            {opts.map((o) => (
              <div key={o.tier} className={`p-4 rounded-xl border-2 ${o.recommended ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20' : 'border-gray-200 dark:border-slate-700'}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${o.tier === 'good' ? 'bg-gray-200 text-gray-700' : o.tier === 'better' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{o.tier}</span>
                  <label className="flex items-center gap-1 text-xs"><input type="radio" name="recommended" checked={o.recommended} onChange={() => setOpts((cur) => cur.map((x) => ({ ...x, recommended: x.tier === o.tier })))} />Recommended</label>
                </div>
                <input className={`${inputCls} mb-2 font-medium`} maxLength={100} value={o.name} onChange={(e) => upd(o.tier, { name: e.target.value })} placeholder="Option name" />
                <input className={`${inputCls} mb-2 text-lg font-bold`} type="number" min={0} step="0.01" value={o.price} onChange={(e) => upd(o.tier, { price: e.target.value })} placeholder="Price" />
                <textarea className={`${inputCls} text-sm`} rows={3} maxLength={500} value={o.description || ''} onChange={(e) => upd(o.tier, { description: e.target.value })} placeholder="Description" />
                <input className={`${inputCls} mt-2 text-sm`} value={o.features.join(', ')} onChange={(e) => upd(o.tier, { features: e.target.value.split(',').map((s) => s.trim()).slice(0, 20) })} placeholder="Included (comma separated)" />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">Options without a name and price are not saved.</p>
          {err && <div role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{err}</div>}
          <div className="flex justify-end gap-3 mt-4"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save options'}</Button></div>
        </>
      )}
    </Modal>
  )
}
