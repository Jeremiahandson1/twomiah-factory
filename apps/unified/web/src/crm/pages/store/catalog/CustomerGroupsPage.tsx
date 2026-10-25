// Wholesale: customer groups at /crm/customer-groups (2026-10-24, the store upgrade). A group (e.g. "Wholesale") takes a
// percent off the catalogue and may set its own price for any product option, which wins; customers are put in a group
// (one group each). The prices apply to the orders made for a member (Orders › New order for a customer): this
// storefront has no shopper sign-in, so a typed email cannot prove who is buying, and a group price is never given to
// it (server/crm/store/catalog/groupPricing.ts says why).
//
// The server's permissions (server/crm/store/catalog/groups.ts): discounts:read to see, discounts:create / update /
// delete to change — each control asks its own.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../../api'
import { PageError, errorText, useConfirm, useMayWrite, useToast } from '../../../../shared'
import { formatMoney, listOf, refusalOf, toHundredths, toWhole, useStoreCurrency, type Product } from './lib'
import { CustomerPicker, type PickedCustomer } from '../orders/CustomerPicker'

interface Group {
  id: string; name: string; percentOff: number
  members: { contactId: string; name: string; email: string | null }[]
  prices: { variantId: string; sku: string; productName: string; variantName: string; priceCents: number; catalogueCents: number }[]
}

export default function CustomerGroupsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const currency = useStoreCurrency()
  const mayCreate = useMayWrite('discounts:create')
  const mayUpdate = useMayWrite('discounts:update')
  const mayDelete = useMayWrite('discounts:delete')
  const [groups, setGroups] = useState<Group[]>([])
  const [variants, setVariants] = useState<{ id: string; label: string; priceCents: number }[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', percent: '' })
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setGroups(listOf<Group>(await api.get('/api/admin/customer-groups'))); setLoadError(null) } catch (e) { setLoadError(errorText(e, 'Could not load the customer groups')) }
  }, [])
  useEffect(() => {
    void load()
    // The product options for a group's own prices (customers are searched as they are added: CustomerPicker).
    api.get('/api/admin/products').then((r) => setVariants(listOf<Product>(r).flatMap((p) => p.variants.map((v) => ({
      id: v.id, label: `${p.name}${v.name && v.name !== p.name && v.name !== 'Default' ? ' — ' + v.name : ''} (${v.sku})`, priceCents: v.priceCents,
    }))))).catch(() => setVariants([]))
  }, [load])

  const run = async (what: () => Promise<unknown>, ok: string, fallback: string) => {
    setBusy(true)
    try { await what(); toast.success(ok); await load() } catch (e) { toast.error(errorText(e, fallback)) } finally { setBusy(false) }
  }

  const create = async () => {
    setFormError(null)
    const pct = form.percent.trim() ? toWhole(form.percent) : 0
    if (!form.name.trim()) { setFormError('Name the group, like Wholesale.'); return }
    if (pct === null || Number.isNaN(pct) || pct > 100) { setFormError('The percent off is a whole number from 0 to 100.'); return }
    setBusy(true)
    try {
      await api.post('/api/admin/customer-groups', { name: form.name.trim(), percentOff: pct })
      toast.success('Group added'); setForm({ name: '', percent: '' }); await load()
    } catch (e) {
      const named = Object.values(refusalOf(e).fields).join('; ')
      setFormError(named ? `${errorText(e, 'Could not add the group')} (${named})` : errorText(e, 'Could not add the group'))
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Customer groups</h1>
        <p className="text-sm text-gray-600 dark:text-slate-400">Wholesale and trade prices. A group's prices apply to the orders you make for its customers (Orders › New order for a customer) — the storefront has no customer sign-in, so shoppers checking out on the website always pay the shop's prices.</p>
      </div>
      <PageError message={loadError} />

      {mayCreate && (
        <div className="card p-5 space-y-3">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">New group</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2"><label className="label" htmlFor="cg-name">Name</label><input id="cg-name" className="input" placeholder="Wholesale" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label" htmlFor="cg-pct">Percent off everything</label><input id="cg-pct" className="input" inputMode="numeric" placeholder="20" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} /></div>
          </div>
          <PageError message={formError} />
          <button type="button" onClick={create} disabled={busy} className="btn btn-primary">Add group</button>
        </div>
      )}

      {groups.length === 0 && !loadError && <p className="text-sm text-gray-600 dark:text-slate-400">No customer groups yet.</p>}
      {groups.map((g) => (
        <GroupCard key={g.id} g={g} variants={variants} currency={currency} busy={busy}
          mayUpdate={mayUpdate} mayDelete={mayDelete} run={run} confirm={confirm} />
      ))}
    </div>
  )
}

function GroupCard({ g, variants, currency, busy, mayUpdate, mayDelete, run, confirm }: {
  g: Group; variants: { id: string; label: string; priceCents: number }[]; currency: string; busy: boolean
  mayUpdate: boolean; mayDelete: boolean; run: (what: () => Promise<unknown>, ok: string, fallback: string) => Promise<void>
  confirm: (m: string, o?: { title?: string; confirmText?: string }) => Promise<boolean>
}) {
  const [pct, setPct] = useState(String(g.percentOff))
  const [member, setMember] = useState<PickedCustomer | null>(null)
  const [variant, setVariant] = useState('')
  const [price, setPrice] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const base = `/api/admin/customer-groups/${encodeURIComponent(g.id)}`
  const inGroup = new Set(g.members.map((m) => m.contactId))

  const savePct = async () => {
    const n = toWhole(pct)
    if (n === null || Number.isNaN(n) || n > 100) { setErr('The percent off is a whole number from 0 to 100.'); return }
    setErr(null)
    await run(() => api.patch(base, { percentOff: n }), 'Saved', 'Could not save the group')
  }
  const addPrice = async () => {
    const cents = toHundredths(price)
    if (!variant || cents === null) { setErr('Choose a product option and enter its price, like 12.50.'); return }
    setErr(null)
    await run(() => api.put(`${base}/prices/${encodeURIComponent(variant)}`, { priceCents: cents }), 'Price set', 'Could not set the price')
    setVariant(''); setPrice('')
  }
  const remove = async () => {
    if (!(await confirm(`Delete the group ${g.name}? Its customers go back to the shop's prices.`, { title: 'Delete group', confirmText: 'Delete' }))) return
    await run(() => api.delete(base), 'Group deleted', 'Could not delete the group')
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{g.name}</h2>
        {mayDelete && <button type="button" className="btn btn-secondary px-3 py-1.5 text-xs text-red-700 dark:text-red-300" disabled={busy} onClick={remove}>Delete group</button>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor={`pct-${g.id}`}>Percent off everything</label><input id={`pct-${g.id}`} className="input max-w-[8rem]" inputMode="numeric" value={pct} readOnly={!mayUpdate} onChange={(e) => setPct(e.target.value)} /></div>
        {mayUpdate && <button type="button" className="btn btn-secondary" disabled={busy} onClick={savePct}>Save</button>}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Customers ({g.members.length})</h3>
        {g.members.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-400">No customers in this group yet.</p>}
        <ul className="space-y-1">
          {g.members.map((m) => (
            <li key={m.contactId} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-800 dark:text-slate-200">
              <span className="min-w-0 break-all">{m.name}{m.email ? ` · ${m.email}` : ''}</span>
              {mayUpdate && <button type="button" className="text-xs text-red-700 hover:underline dark:text-red-300" disabled={busy} onClick={() => run(() => api.delete(`${base}/members/${encodeURIComponent(m.contactId)}`), 'Removed from the group', 'Could not remove them')}>Remove</button>}
            </li>
          ))}
        </ul>
        {mayUpdate && (
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[14rem] max-w-sm"><CustomerPicker id={`add-${g.id}`} label={`Add a customer to ${g.name}`} value={member} onPick={setMember} exclude={[...inGroup]} /></div>
            <button type="button" className="btn btn-secondary self-start" disabled={busy || !member} onClick={async () => { if (!member) return; await run(() => api.put(`${base}/members/${encodeURIComponent(member.id)}`), 'Added to the group', 'Could not add them'); setMember(null) }}>Add</button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Own prices</h3>
        <p className="text-xs text-gray-600 dark:text-slate-400">A price set here wins over the percent off, for that option.</p>
        <ul className="space-y-1">
          {g.prices.map((p) => (
            <li key={p.variantId} className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-800 dark:text-slate-200">
              <span className="min-w-0 break-all">{p.productName}{p.variantName && p.variantName !== p.productName && p.variantName !== 'Default' ? ` — ${p.variantName}` : ''} ({p.sku})</span>
              <span className="flex items-center gap-3">
                <span>{formatMoney(p.priceCents, currency)} <span className="text-gray-600 dark:text-slate-400 line-through">{formatMoney(p.catalogueCents, currency)}</span></span>
                {mayUpdate && <button type="button" className="text-xs text-red-700 hover:underline dark:text-red-300" disabled={busy} onClick={() => run(() => api.delete(`${base}/prices/${encodeURIComponent(p.variantId)}`), 'Price removed', 'Could not remove the price')}>Remove</button>}
              </span>
            </li>
          ))}
        </ul>
        {mayUpdate && (
          <div className="flex flex-wrap gap-2">
            <select className="input max-w-sm" aria-label={`Product option for ${g.name}'s own price`} value={variant} onChange={(e) => setVariant(e.target.value)}>
              <option value="">Choose a product option…</option>
              {variants.map((v) => <option key={v.id} value={v.id}>{v.label} — {formatMoney(v.priceCents, currency)}</option>)}
            </select>
            <input className="input max-w-[8rem]" inputMode="decimal" placeholder="12.50" aria-label="Group price" value={price} onChange={(e) => setPrice(e.target.value)} />
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={addPrice}>Set price</button>
          </div>
        )}
      </div>
      <PageError message={err} />
    </div>
  )
}
