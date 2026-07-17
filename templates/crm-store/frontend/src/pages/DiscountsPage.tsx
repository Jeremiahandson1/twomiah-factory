import { useEffect, useState } from 'react'
import api, { DiscountCode } from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { centsToDollars, dollarsToCents } from '../lib/format'

const BLANK = { code: '', type: 'percent' as 'percent' | 'fixed', value: '', minSubtotal: '', maxUses: '', expiresAt: '' }

export default function DiscountsPage() {
  const { toast } = useToast()
  const [codes, setCodes] = useState<DiscountCode[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)

  const load = async () => { setLoading(true); try { setCodes(await api.listDiscounts()) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!form.code.trim() || !form.value) { toast('Code and value are required', 'error'); return }
    setSaving(true)
    try {
      await api.createDiscount({
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value: form.type === 'percent' ? Math.round(Number(form.value)) : dollarsToCents(form.value),
        minSubtotalCents: form.minSubtotal ? dollarsToCents(form.minSubtotal) : 0,
        maxUses: form.maxUses ? Math.round(Number(form.maxUses)) : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      })
      toast('Code created'); setForm({ ...BLANK }); load()
    } catch (e: any) { toast(e?.message || 'Could not create code', 'error') } finally { setSaving(false) }
  }
  const toggle = async (c: DiscountCode) => { try { await api.updateDiscount(c.id, { active: !c.active }); load() } catch (e: any) { toast(e?.message || 'Update failed', 'error') } }
  const del = async (c: DiscountCode) => { if (!confirm(`Delete ${c.code}?`)) return; await api.deleteDiscount(c.id); load() }

  const fmtValue = (c: DiscountCode) => c.type === 'percent' ? `${c.value}%` : `$${centsToDollars(c.value)}`

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Discount codes</h1>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Create a code</h2>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Code</label><input className="input uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="SAVE10" /></div>
          <div><label className="label">Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
              <option value="percent">Percent (%)</option><option value="fixed">Fixed ($)</option>
            </select>
          </div>
          <div><label className="label">{form.type === 'percent' ? 'Percent off' : 'Amount off ($)'}</label><input className="input" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'percent' ? '10' : '5.00'} /></div>
          <div><label className="label">Min subtotal ($) <span className="text-gray-400">(optional)</span></label><input className="input" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} placeholder="0.00" /></div>
          <div><label className="label">Max uses <span className="text-gray-400">(optional)</span></label><input className="input" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="unlimited" /></div>
          <div><label className="label">Expires <span className="text-gray-400">(optional)</span></label><input className="input" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
        </div>
        <button onClick={create} className="btn-primary" disabled={saving || !form.code || !form.value}>{saving ? 'Creating…' : 'Create code'}</button>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-3">All codes</h2>
        {loading ? <p className="text-gray-400 text-sm">Loading…</p> : codes.length === 0 ? <p className="text-gray-400 text-sm">No codes yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500"><th className="py-2 pr-4">Code</th><th className="pr-4">Discount</th><th className="pr-4">Used</th><th className="pr-4">Min</th><th className="pr-4">Expires</th><th></th></tr></thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="py-2 pr-4 font-medium">{c.code}</td>
                    <td className="pr-4">{fmtValue(c)}</td>
                    <td className="pr-4">{c.usedCount}{c.maxUses != null ? ` / ${c.maxUses}` : ''}</td>
                    <td className="pr-4">{c.minSubtotalCents ? `$${centsToDollars(c.minSubtotalCents)}` : '—'}</td>
                    <td className="pr-4">{c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : '—'}</td>
                    <td className="text-right whitespace-nowrap">
                      <button onClick={() => toggle(c)} className={`text-xs px-2 py-1 rounded ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{c.active ? 'Active' : 'Inactive'}</button>
                      <button onClick={() => del(c)} className="text-xs text-red-600 ml-2">Delete</button>
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
