import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AtSign, Globe, Inbox } from 'lucide-react'
import api, { StoreSettings, StoreUser } from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { centsToDollars, dollarsToCents } from '../lib/format'

export default function SettingsPage() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [form, setForm] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Password change
  const [pw, setPw] = useState({ current: '', next: '' })
  const [pwSaving, setPwSaving] = useState(false)

  // Staff logins. Nothing in this app could create a second login before, so a
  // store on a seat-based plan was permanently a one-person account.
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const [staff, setStaff] = useState<StoreUser[]>([])
  const [newStaff, setNewStaff] = useState({ name: '', email: '', password: '' })
  const [addingStaff, setAddingStaff] = useState(false)

  const loadStaff = () => {
    if (!isOwner) return
    api.listUsers().then(setStaff).catch(() => { /* non-fatal: the rest of Settings still works */ })
  }
  useEffect(loadStaff, [isOwner])

  // Revoke = deactivate, never delete: orders and fulfilment history reference
  // the user. Until now a departing employee kept full access to products,
  // orders, customers and payments with no way to remove them.
  const toggleStaffAccess = async (id: string, currentlyActive: boolean) => {
    if (currentlyActive && !confirm('Revoke access for this staff member? They will not be able to sign in.')) return
    try {
      await api.updateUser(id, { isActive: !currentlyActive })
      toast(currentlyActive ? 'Access revoked' : 'Access restored')
      loadStaff()
    } catch (e: any) {
      toast(e?.message || 'Could not change access', 'error')
    }
  }

  const addStaff = async () => {
    setAddingStaff(true)
    try {
      await api.createUser(newStaff)
      toast('Staff member added')
      setNewStaff({ name: '', email: '', password: '' })
      loadStaff()
    } catch (e: any) {
      toast(e?.message || 'Could not add the staff member', 'error')
    } finally { setAddingStaff(false) }
  }

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
        zones: (s?.shippingZones || []).map((z) => ({ name: z.name, countries: (z.countries || []).join(', '), states: (z.states || []).join(', '), rate: centsToDollars(z.rateCents), free: z.freeThresholdCents != null ? centsToDollars(z.freeThresholdCents) : '' })),
        taxes: (s?.taxRates || []).map((t) => ({ country: t.country, state: t.state, rate: (t.rateBps / 100).toString() })),
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }))

  const addZone = () => set('zones', [...(form.zones || []), { name: '', countries: '', states: '', rate: '', free: '' }])
  const setZone = (i: number, k: string, v: any) => set('zones', form.zones.map((z: any, j: number) => j === i ? { ...z, [k]: v } : z))
  const delZone = (i: number) => set('zones', form.zones.filter((_: any, j: number) => j !== i))
  const addTax = () => set('taxes', [...(form.taxes || []), { country: 'US', state: '', rate: '' }])
  const setTax = (i: number, k: string, v: any) => set('taxes', form.taxes.map((t: any, j: number) => j === i ? { ...t, [k]: v } : t))
  const delTax = (i: number) => set('taxes', form.taxes.filter((_: any, j: number) => j !== i))

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
        shippingZones: (form.zones || []).filter((z: any) => z.name.trim()).map((z: any) => ({
          name: z.name.trim(),
          countries: z.countries.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean),
          states: z.states.split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean),
          rateCents: dollarsToCents(z.rate || '0'),
          freeThresholdCents: z.free === '' ? null : dollarsToCents(z.free),
        })),
        taxRates: (form.taxes || []).filter((t: any) => t.country.trim() || t.state.trim()).map((t: any) => ({
          country: t.country.trim().toUpperCase(),
          state: t.state.trim().toUpperCase(),
          rateBps: Math.round(parseFloat(t.rate || '0') * 100),
        })),
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
        <p className="text-xs text-gray-400">Flat rate + tax above apply when no region zone/rate matches below.</p>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Shipping zones <span className="text-gray-400 font-normal">(by region)</span></h2>
          <button onClick={addZone} className="btn-secondary text-sm">+ Add zone</button>
        </div>
        {(form.zones || []).length === 0 && <p className="text-sm text-gray-400">No zones — the flat rate applies everywhere.</p>}
        {(form.zones || []).map((z: any, i: number) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end border-t pt-3">
            <div className="col-span-3"><label className="label text-xs">Name</label><input className="input" value={z.name} onChange={(e) => setZone(i, 'name', e.target.value)} placeholder="Domestic" /></div>
            <div className="col-span-2"><label className="label text-xs">Countries</label><input className="input" value={z.countries} onChange={(e) => setZone(i, 'countries', e.target.value)} placeholder="US" /></div>
            <div className="col-span-3"><label className="label text-xs">States (blank = all)</label><input className="input" value={z.states} onChange={(e) => setZone(i, 'states', e.target.value)} placeholder="CA, NY" /></div>
            <div className="col-span-1"><label className="label text-xs">Rate $</label><input className="input" value={z.rate} onChange={(e) => setZone(i, 'rate', e.target.value)} placeholder="7.00" /></div>
            <div className="col-span-2"><label className="label text-xs">Free over $</label><input className="input" value={z.free} onChange={(e) => setZone(i, 'free', e.target.value)} placeholder="—" /></div>
            <div className="col-span-1"><button onClick={() => delZone(i)} className="text-red-600 text-sm pb-2">✕</button></div>
          </div>
        ))}
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Tax rates <span className="text-gray-400 font-normal">(by region)</span></h2>
          <button onClick={addTax} className="btn-secondary text-sm">+ Add rate</button>
        </div>
        {(form.taxes || []).length === 0 && <p className="text-sm text-gray-400">No region rates — the flat tax rate applies.</p>}
        {(form.taxes || []).map((t: any, i: number) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end border-t pt-3">
            <div className="col-span-4"><label className="label text-xs">Country</label><input className="input" value={t.country} onChange={(e) => setTax(i, 'country', e.target.value)} placeholder="US" /></div>
            <div className="col-span-4"><label className="label text-xs">State (blank = all)</label><input className="input" value={t.state} onChange={(e) => setTax(i, 'state', e.target.value)} placeholder="CA" /></div>
            <div className="col-span-3"><label className="label text-xs">Rate %</label><input className="input" value={t.rate} onChange={(e) => setTax(i, 'rate', e.target.value)} placeholder="7.25" /></div>
            <div className="col-span-1"><button onClick={() => delTax(i)} className="text-red-600 text-sm pb-2">✕</button></div>
          </div>
        ))}
        <button onClick={save} className="btn-primary mt-2" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="font-semibold text-gray-900">Email</h2>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => navigate('/settings/email')} className="btn-secondary text-sm inline-flex items-center gap-1.5"><AtSign className="h-4 w-4" /> Branded Email</button>
          <button onClick={() => navigate('/settings/email-domain')} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Globe className="h-4 w-4" /> Email Domain</button>
          <button onClick={() => navigate('/settings/email-inbox')} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Inbox className="h-4 w-4" /> Email Inbox</button>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900">Change password</h2>
        <div><label className="label">Current password</label><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
        <div><label className="label">New password</label><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" /></div>
        <button onClick={changePassword} className="btn-secondary" disabled={pwSaving || !pw.current || pw.next.length < 8}>{pwSaving ? 'Saving…' : 'Update password'}</button>
      </div>

      {/* Staff logins. Owner-only: the backend rejects this for role 'staff',
          so the card is hidden rather than showing buttons that 403. */}
      {isOwner && (
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Team</h2>

          <div className="divide-y border rounded-lg">
            {staff.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className={`text-sm font-medium ${u.isActive === false ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{u.name || u.email}</p>
                  <p className="text-xs text-gray-500">{u.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600 capitalize">{u.role}</span>
                  {u.id !== user?.id ? (
                    <button
                      onClick={() => toggleStaffAccess(u.id, u.isActive !== false)}
                      className={`text-xs font-medium ${u.isActive === false ? 'text-green-600 hover:text-green-700' : 'text-red-600 hover:text-red-700'}`}
                    >
                      {u.isActive === false ? 'Restore access' : 'Revoke access'}
                    </button>
                  ) : <span className="text-xs text-gray-400">You</span>}
                </div>
              </div>
            ))}
            {staff.length === 0 && <p className="px-4 py-6 text-sm text-gray-400 text-center">Just you so far</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div><label className="label">Name</label><input className="input" value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })} /></div>
            <div><label className="label">Email</label><input className="input" type="email" value={newStaff.email} onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })} /></div>
            <div><label className="label">Temporary password</label><input className="input" value={newStaff.password} onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })} placeholder="At least 8 characters" /></div>
          </div>
          <p className="text-xs text-gray-400">Share the password with them — they can change it from this page after signing in.</p>
          <button onClick={addStaff} className="btn-primary" disabled={addingStaff || !newStaff.name.trim() || !newStaff.email.trim() || newStaff.password.length < 8}>
            {addingStaff ? 'Adding…' : 'Add staff member'}
          </button>
        </div>
      )}
    </div>
  )
}
