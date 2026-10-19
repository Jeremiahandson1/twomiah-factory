// Moved from templates/crm-store/frontend/src/pages/DiscountsPage.tsx. Discount codes at /api/admin/discounts
// (server/crm/store/catalog/discounts.ts): everyone who may see them reads them (discounts:read — staff answer a shopper
// with them); writing one is giving money away, discounts:create / update / delete, the manager's.
//
// Changes from the template:
//   · the list is the reply's `data` (the template read `codes`); the app's API client, toasts and the shared confirm
//     dialog (the template used window.confirm, and its delete had no error handling — a refusal vanished);
//   · an expiry date means the END of that day where the person is: the template sent midnight UTC at the START of it,
//     so a code set to expire on the 20th stopped working on the evening of the 19th for every American shop, and the
//     list (toLocaleDateString of that instant) showed the 19th;
//   · money and percents are read from the digits (a $5.00 code is 500 cents, never 499), and a value, minimum or use
//     count that is not a number is refused on the form, naming the box, instead of being sent as 0 or NaN;
//   · a refusal from the server (a code already taken, a percent over 100) is shown above the form, where the code is;
//   · amounts in the store's currency; the table's ink and the header's have their dark partners (the rows had none);
//     the form stacks and the table scrolls at phone width.
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../../../api'
import { PageError, errorText, useConfirm, useMayWrite, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { formatMoney, listOf, refusalOf, toHundredths, toWhole, useStoreCurrency, type DiscountCode } from './lib'

const BLANK = { code: '', type: 'percent' as 'percent' | 'fixed', value: '', minSubtotal: '', maxUses: '', expiresAt: '' }

const ACTIVE = 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
const INACTIVE = 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'

export default function DiscountsPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const currency = useStoreCurrency()
  const [codes, setCodes] = useState<DiscountCode[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // A code is money off, so writing one is the manager's; staff read them to answer a shopper.
  const mayCreate = useMayWrite('discounts:create')
  const mayUpdate = useMayWrite('discounts:update')
  const mayDelete = useMayWrite('discounts:delete')

  const load = useCallback(async () => {
    setLoading(true)
    try { setCodes(listOf<DiscountCode>(await api.get('/api/admin/discounts'))); setLoadError(null) }
    catch (e) { setLoadError(errorText(e, 'Could not load the discount codes')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const create = async () => {
    setFormError(null)
    if (!form.code.trim()) { setFormError('Enter the code shoppers will type.'); return }
    const value = form.type === 'percent' ? toWhole(form.value) : toHundredths(form.value)
    if (value === null || Number.isNaN(value) || value <= 0) {
      setFormError(form.type === 'percent' ? 'Percent off is a whole number from 1 to 100.' : 'Enter the amount off as a number, like 5.00.'); return
    }
    if (form.type === 'percent' && value > 100) { setFormError('Percent off cannot be more than 100.'); return }
    const min = form.minSubtotal.trim() ? toHundredths(form.minSubtotal) : 0
    if (min === null) { setFormError('Enter the minimum subtotal as a number, or leave it blank.'); return }
    const maxUses = toWhole(form.maxUses)
    if (Number.isNaN(maxUses) || maxUses === 0) { setFormError('Max uses is a whole number above 0, or blank for unlimited.'); return }
    setSaving(true)
    try {
      await api.post('/api/admin/discounts', {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value,
        minSubtotalCents: min,
        maxUses,
        // The end of the chosen day, where this person is — the code works through the whole of that date.
        expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59.999`).toISOString() : null,
      })
      toast.success('Code created'); setForm({ ...BLANK }); void load()
    } catch (e) {
      const named = Object.entries(refusalOf(e).fields).map(([k, v]) => `${k}: ${v}`).join('; ')
      setFormError(named ? `${errorText(e, 'Could not create the code')} (${named})` : errorText(e, 'Could not create the code'))
    } finally { setSaving(false) }
  }
  const toggle = async (c: DiscountCode) => {
    try { await api.patch(`/api/admin/discounts/${c.id}`, { active: !c.active }); toast.success(c.active ? `${c.code} switched off` : `${c.code} switched on`); void load() }
    catch (e) { toast.error(errorText(e, 'Update failed')) }
  }
  const del = async (c: DiscountCode) => {
    if (!(await confirm(`Delete ${c.code}? Shoppers will no longer be able to use it.`, { title: 'Delete code', confirmText: 'Delete' }))) return
    try { await api.delete(`/api/admin/discounts/${c.id}`); toast.success(`${c.code} deleted`); void load() }
    catch (e) { toast.error(errorText(e, 'Could not delete the code')) }
  }

  const fmtValue = (c: DiscountCode) => (c.type === 'percent' ? `${c.value}%` : formatMoney(c.value, currency))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Discount codes</h1>

      {mayCreate && (
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100">Create a code</h2>
          <PageError message={formError} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="label" htmlFor="dc-code">Code</label><input id="dc-code" className="input uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SAVE10" /></div>
            <div><label className="label" htmlFor="dc-type">Type</label>
              <select id="dc-type" className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'fixed' })}>
                <option value="percent">Percent off</option><option value="fixed">Amount off</option>
              </select>
            </div>
            <div><label className="label" htmlFor="dc-value">{form.type === 'percent' ? 'Percent off' : `Amount off (${currency.toUpperCase()})`}</label><input id="dc-value" className="input" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'percent' ? '10' : '5.00'} /></div>
            <div><label className="label" htmlFor="dc-min">Minimum subtotal <span className="font-normal text-gray-600 dark:text-slate-400">(optional)</span></label><input id="dc-min" className="input" inputMode="decimal" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} placeholder="0.00" /></div>
            <div><label className="label" htmlFor="dc-max">Max uses <span className="font-normal text-gray-600 dark:text-slate-400">(optional)</span></label><input id="dc-max" className="input" inputMode="numeric" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="Unlimited" /></div>
            <div><label className="label" htmlFor="dc-exp">Last day it works <span className="font-normal text-gray-600 dark:text-slate-400">(optional)</span></label><input id="dc-exp" className="input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
          </div>
          <button type="button" onClick={create} className="btn btn-primary" disabled={saving || !form.code.trim() || !form.value.trim()}>{saving ? 'Creating…' : 'Create code'}</button>
        </div>
      )}

      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">All codes</h2>
        <PageError message={loadError} />
        {loading ? <p className="text-gray-600 text-sm dark:text-slate-400">Loading…</p> : loadError ? null : codes.length === 0 ? <p className="text-gray-600 text-sm dark:text-slate-400">No codes yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-gray-600 dark:text-slate-400">
                  <th className="py-2 pr-4 font-medium">Code</th><th className="pr-4 font-medium">Discount</th><th className="pr-4 font-medium">Used</th>
                  <th className="pr-4 font-medium">Minimum</th><th className="pr-4 font-medium">Last day</th><th className="font-medium"><span className="sr-only">Status and actions</span></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-t border-gray-200 dark:border-slate-800">
                    <td className="py-2 pr-4 font-medium font-mono text-gray-900 dark:text-slate-100">{c.code}</td>
                    <td className="pr-4 text-gray-900 dark:text-slate-100">{fmtValue(c)}</td>
                    <td className="pr-4 tabular-nums text-gray-700 dark:text-slate-300">{c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ''}</td>
                    <td className="pr-4 text-gray-700 dark:text-slate-300">{c.minSubtotalCents ? formatMoney(c.minSubtotalCents, currency) : '—'}</td>
                    <td className="pr-4 text-gray-700 dark:text-slate-300">{c.expiresAt ? formatDate(c.expiresAt) : '—'}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {mayUpdate
                        ? <button type="button" onClick={() => toggle(c)} title={c.active ? 'Switch off' : 'Switch on'} className={`text-xs px-2 py-1 rounded ${c.active ? ACTIVE : INACTIVE}`}>{c.active ? 'Active' : 'Inactive'}</button>
                        : <span className={`text-xs px-2 py-1 rounded ${c.active ? ACTIVE : INACTIVE}`}>{c.active ? 'Active' : 'Inactive'}</span>}
                      {mayDelete && <button type="button" onClick={() => del(c)} className="text-xs text-red-700 ml-3 hover:underline dark:text-red-300">Delete</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
