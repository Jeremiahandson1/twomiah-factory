import { useEffect, useState } from 'react'
import api, { StoreSettings } from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { centsToDollars, dollarsToCents } from '../lib/format'

export default function SettingsPage() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [form, setForm] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Password change
  const [pw, setPw] = useState({ current: '', next: '' })
  const [pwSaving, setPwSaving] = useState(false)

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s)
      setForm({
        companyName: s?.companyName || '',
        supportEmail: s?.supportEmail || '',
        currency: s?.currency || 'usd',
        flatShipping: centsToDollars(s?.flatShippingCents),
        freeShippingThreshold: s?.freeShippingThresholdCents != null ? centsToDollars(s.freeShippingThresholdCents) : '',
        taxRatePct: s ? (s.taxRateBps / 100).toString() : '0',
        storefrontOrigin: s?.storefrontOrigin || '',
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.updateSettings({
        companyName: form.companyName,
        supportEmail: form.supportEmail || null,
        currency: form.currency,
        flatShippingCents: dollarsToCents(form.flatShipping),
        freeShippingThresholdCents: form.freeShippingThreshold === '' ? null : dollarsToCents(form.freeShippingThreshold),
        taxRateBps: Math.round(parseFloat(form.taxRatePct || '0') * 100),
        storefrontOrigin: form.storefrontOrigin || null,
      })
      setSettings(updated)
      toast('Settings saved')
    } catch (e: any) { toast(e?.message || 'Save failed', 'error') } finally { setSaving(false) }
  }

  const changePassword = async () => {
    setPwSaving(true)
    try {
      await api.changePassword(pw.current, pw.next)
      setPw({ current: '', next: '' })
      toast('Password changed')
    } catch (e: any) { toast(e?.message || 'Could not change password', 'error') } finally { setPwSaving(false) }
  }

  if (loading) return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Store</h2>
        <div><label className="label">Store name</label><input className="input" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} /></div>
        <div><label className="label">Support email</label><input className="input" type="email" value={form.supportEmail} onChange={(e) => set('supportEmail', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Currency</label><input className="input" value={form.currency} onChange={(e) => set('currency', e.target.value.toLowerCase())} maxLength={3} /></div>
          <div><label className="label">Tax rate (%)</label><input className="input" type="number" step="0.01" value={form.taxRatePct} onChange={(e) => set('taxRatePct', e.target.value)} /></div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Shipping</h2>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Flat shipping ($)</label><input className="input" value={form.flatShipping} onChange={(e) => set('flatShipping', e.target.value)} /></div>
          <div><label className="label">Free shipping over ($)</label><input className="input" value={form.freeShippingThreshold} onChange={(e) => set('freeShippingThreshold', e.target.value)} placeholder="Blank = never" /></div>
        </div>
        <button onClick={save} className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Change password</h2>
        <div><label className="label">Current password</label><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
        <div><label className="label">New password</label><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" /></div>
        <button onClick={changePassword} className="btn-secondary" disabled={pwSaving || !pw.current || pw.next.length < 8}>{pwSaving ? 'Saving…' : 'Update password'}</button>
      </div>
    </div>
  )
}
