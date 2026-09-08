// Staff console PINs — who can log into /console (the bar-phone control
// panel). Add a PIN per person or phone; deactivating one logs that phone out.
// PINs are never shown back; only labels and last use.
import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { api } from '../api/client'
import { Label, Hint } from './Field'

interface StaffPin { id: string; label: string; isActive: boolean; createdAt: string; lastUsedAt: string | null }

function ago(iso: string | null): string {
  if (!iso) return 'never used'
  const ms = Date.now() - new Date(iso).getTime()
  const d = Math.floor(ms / 86400000)
  if (d === 0) return 'used today'
  if (d === 1) return 'used yesterday'
  return `used ${d} days ago`
}

export function StaffPinsCard() {
  const [pins, setPins] = useState<StaffPin[]>([])
  const [label, setLabel] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = () => api.get<{ pins: StaffPin[] }>('/api/admin/staff-pins').then(({ pins }) => setPins(pins)).catch((e) => setError(e.message)).finally(() => setLoaded(true))
  useEffect(() => { load() }, [])

  const add = async () => {
    setBusy(true); setError(null)
    try {
      await api.post('/api/admin/staff-pins', { label, pin })
      setLabel(''); setPin('')
      await load()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  const deactivate = async (p: StaffPin) => {
    if (!confirm(`Deactivate the "${p.label}" PIN? Any phone using it is logged out of the console.`)) return
    setBusy(true); setError(null)
    try { await api.delete(`/api/admin/staff-pins/${p.id}`); await load() } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  const active = pins.filter((p) => p.isActive)
  return (
    <section className="card card-padding mb-6">
      <h2 className="text-lg text-ink mb-1">Staff console PINs</h2>
      <p className="text-muted text-sm mb-4">
        The console at <code>/console</code> is the bar-phone control panel: closing early, 86 an item, tonight's special, taps, the game. Anyone with an active PIN can use it. Give each person or phone its own PIN so you can turn one off without changing the others.
      </p>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}
      {loaded && active.length === 0 && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">No active PIN — nobody can log into the console until you add one.</p>}
      <ul className="divide-y divide-line border border-line rounded-lg mb-4">
        {pins.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div>
              <div className={'text-sm ' + (p.isActive ? 'text-ink' : 'text-muted line-through')}>{p.label}</div>
              <div className="text-xs text-muted">{p.isActive ? ago(p.lastUsedAt) : 'deactivated'}</div>
            </div>
            {p.isActive && <button type="button" onClick={() => deactivate(p)} disabled={busy} className="btn-secondary btn-sm inline-flex items-center gap-1"><X className="w-3 h-3" />Deactivate</button>}
          </li>
        ))}
        {loaded && pins.length === 0 && <li className="px-3 py-2 text-sm text-muted">No PINs yet.</li>}
      </ul>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-3 items-end">
        <div>
          <Label htmlFor="pin-label">Label</Label>
          <input id="pin-label" className="input" placeholder="Bar phone, Jess, Kitchen iPad…" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pin-digits">PIN (4–8 digits)</Label>
          <input id="pin-digits" className="input" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        </div>
        <button type="button" onClick={add} disabled={busy || !label.trim() || pin.length < 4} className="btn-primary inline-flex items-center gap-1 disabled:opacity-40"><Plus className="w-4 h-4" />Add PIN</button>
      </div>
      <Hint>Adding a PIN takes effect immediately and does not need the Save button above.</Hint>
    </section>
  )
}
