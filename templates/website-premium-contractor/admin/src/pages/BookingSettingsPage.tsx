import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Edit3, X, Save, Clock, CalendarOff, Calendar, Link2, Link2Off } from 'lucide-react'
import { api } from '../api/client'
import { Label } from '../components/Field'

interface Service {
  id: string
  slug: string
  name: string
  description: string | null
  durationMinutes: number
  priceCents: number | null
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  slotGranularityMinutes: number
  isActive: boolean
  displayOrder: number
  rebookIntervalDays?: number | null
}
interface Rule { id: string; userId: string | null; dayOfWeek: number; startMinute: number; endMinute: number }
interface Blackout { id: string; date: string; startMinute: number | null; endMinute: number | null; reason: string | null; userId: string | null }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function BookingSettingsPage() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to="/bookings" className="text-muted hover:text-ink flex items-center gap-1.5 text-sm mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to bookings
      </Link>
      <h1 className="text-3xl text-ink mb-1">Booking settings</h1>
      <p className="text-muted text-sm mb-8">Configure the services people can book and when you're available.</p>
      <ServicesSection />
      <AvailabilitySection />
      <BlackoutsSection />
      <CalendarSyncSection />
    </div>
  )
}

interface Connection { id: string; provider: string; externalAccountEmail: string | null; createdAt: string; expiresAt: string | null }

function CalendarSyncSection() {
  const [connections, setConnections] = useState<Connection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    api.get<{ connections: Connection[] }>('/api/admin/calendar/connections')
      .then(({ connections }) => setConnections(connections))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const params = new URLSearchParams(window.location.search)
    const handle = (key: string, label: string) => {
      if (params.get(key) === 'connected') setOkMsg(label + ' connected.')
      else if (params.get(key) === 'denied') setError(label + ' connection cancelled or denied.')
      const url = new URL(window.location.href); url.searchParams.delete(key); window.history.replaceState({}, '', url.toString())
    }
    if (params.get('google')) handle('google', 'Google Calendar')
    if (params.get('outlook')) handle('outlook', 'Outlook Calendar')
  }, [])

  const connect = async (provider: 'google' | 'outlook') => {
    setConnecting(true); setError(null)
    try {
      const { url } = await api.get<{ url: string }>('/api/admin/calendar/' + provider + '/connect-url')
      window.location.href = url
    } catch (e: any) { setError(e.message); setConnecting(false) }
  }

  const disconnect = async (id: string) => {
    if (!confirm('Disconnect this calendar? New bookings will stop showing up there.')) return
    setError(null)
    try { await api.delete(`/api/admin/calendar/connections/${id}`); load() }
    catch (e: any) { setError(e.message) }
  }

  const googleConn = connections.find(c => c.provider === 'google')
  const outlookConn = connections.find(c => c.provider === 'outlook')

  const row = (provider: 'google' | 'outlook', label: string, conn: Connection | undefined) => (
    <li className="py-3 px-4 border border-line rounded-lg flex items-center gap-3">
      <div className="w-8 h-8 rounded bg-paper grid place-items-center"><Calendar className="w-4 h-4 text-ink-soft" /></div>
      <div className="flex-1">
        <div className="font-semibold text-ink">{label}</div>
        <div className="text-xs text-muted">{conn ? `Connected as ${conn.externalAccountEmail || 'account'}` : 'Not connected'}</div>
      </div>
      {conn ? (
        <button onClick={() => disconnect(conn.id)} className="btn-secondary btn-sm text-red-600 inline-flex items-center gap-1.5">
          <Link2Off className="w-3.5 h-3.5" />Disconnect
        </button>
      ) : (
        <button onClick={() => connect(provider)} disabled={connecting} className="btn-primary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
          <Link2 className="w-3.5 h-3.5" />{connecting ? 'Opening…' : 'Connect ' + label.split(' ')[0]}
        </button>
      )}
    </li>
  )

  return (
    <section className="card card-padding mt-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg text-ink flex items-center gap-2"><Calendar className="w-4 h-4" />Calendar sync</h2>
          <p className="text-muted text-xs mt-1">Bookings show up on your connected calendar automatically. External events you block off (lunch, doctor appointment) count against your availability. Customer cancellations remove the event.</p>
        </div>
      </div>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
      {okMsg && <div className="text-green-800 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">{okMsg}</div>}
      {loading ? <div className="text-muted text-sm">Loading…</div> : (
        <ul className="space-y-2">
          {row('google', 'Google Calendar', googleConn)}
          {row('outlook', 'Outlook Calendar', outlookConn)}
        </ul>
      )}
    </section>
  )
}

function ServicesSection() {
  const [services, setServices] = useState<Service[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Service | null>(null)
  const [newOpen, setNewOpen] = useState(false)

  const load = () => {
    setLoading(true)
    api.get<{ services: Service[] }>('/api/admin/booking-services')
      .then(({ services }) => setServices(services))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const remove = async (s: Service) => {
    if (!confirm(`Delete "${s.name}"? Existing bookings stay; the service just stops being bookable.`)) return
    try { await api.delete(`/api/admin/booking-services/${s.id}`); load() }
    catch (e: any) { setError(e.message) }
  }

  return (
    <section className="card card-padding mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg text-ink">Services</h2>
          <p className="text-muted text-xs mt-1">Each service has its own duration, price, and buffer time.</p>
        </div>
        <button onClick={() => setNewOpen(true)} className="btn-primary btn-sm inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Add service</button>
      </div>
      {loading && <div className="text-muted text-sm">Loading…</div>}
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
      {!loading && services.length === 0 && <div className="text-muted text-sm">No services yet.</div>}
      {!loading && services.length > 0 && (
        <ul className="divide-y divide-line">
          {services.map(s => (
            <li key={s.id} className="py-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="font-semibold text-ink">{s.name} {!s.isActive && <span className="text-xs text-muted font-normal">(hidden)</span>}</div>
                <div className="text-xs text-muted">{s.durationMinutes >= 60 ? (s.durationMinutes / 60) + ' hr' : s.durationMinutes + ' min'}{s.priceCents != null ? ' · $' + (s.priceCents / 100).toFixed(0) : ''}{(s.bufferBeforeMinutes || s.bufferAfterMinutes) ? ' · buffers ' + s.bufferBeforeMinutes + '/' + s.bufferAfterMinutes : ''}</div>
              </div>
              <button onClick={() => setEditing(s)} className="btn-secondary btn-sm"><Edit3 className="w-3.5 h-3.5" /></button>
              <button onClick={() => remove(s)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      {(newOpen || editing) && (
        <ServiceModal
          initial={editing || undefined}
          onClose={() => { setNewOpen(false); setEditing(null) }}
          onSaved={() => { setNewOpen(false); setEditing(null); load() }}
        />
      )}
    </section>
  )
}

function ServiceModal({ initial, onClose, onSaved }: { initial?: Service; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name || '')
  const [slug, setSlug] = useState(initial?.slug || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [duration, setDuration] = useState(initial?.durationMinutes || 60)
  const [priceCents, setPriceCents] = useState<string>(initial?.priceCents != null ? String(initial.priceCents / 100) : '')
  const [bBefore, setBBefore] = useState(initial?.bufferBeforeMinutes || 0)
  const [bAfter, setBAfter] = useState(initial?.bufferAfterMinutes || 0)
  const [granularity, setGranularity] = useState(initial?.slotGranularityMinutes || 30)
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [rebookDays, setRebookDays] = useState<string>(initial?.rebookIntervalDays ? String(initial.rebookIntervalDays) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = !!initial

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setError(null)
    const payload = {
      name, slug, description: description || null,
      durationMinutes: duration,
      priceCents: priceCents ? Math.round(parseFloat(priceCents) * 100) : null,
      bufferBeforeMinutes: bBefore,
      bufferAfterMinutes: bAfter,
      slotGranularityMinutes: granularity,
      isActive,
      rebookIntervalDays: rebookDays ? parseInt(rebookDays, 10) : null,
    }
    try {
      if (isEdit) await api.patch(`/api/admin/booking-services/${initial!.id}`, payload)
      else await api.post('/api/admin/booking-services', payload)
      onSaved()
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card card-padding w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-xl text-ink">{isEdit ? 'Edit service' : 'New service'}</h3>
          <button onClick={onClose} className="text-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div><Label>Name</Label><input className="input" required value={name} onChange={e => { setName(e.target.value); if (!isEdit) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) }} /></div>
          <div><Label>URL slug</Label><input className="input" required pattern="[a-z0-9]([a-z0-9-]{0,80}[a-z0-9])?" value={slug} onChange={e => setSlug(e.target.value)} disabled={isEdit} /></div>
          <div><Label>Description (optional)</Label><textarea className="input" rows={2} value={description} onChange={e => setDescription(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Duration (min)</Label><input type="number" min={1} max={480} className="input" required value={duration} onChange={e => setDuration(parseInt(e.target.value) || 0)} /></div>
            <div><Label>Price ($, optional)</Label><input type="number" min={0} step={0.01} className="input" value={priceCents} onChange={e => setPriceCents(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Buffer before (min)</Label><input type="number" min={0} max={240} className="input" value={bBefore} onChange={e => setBBefore(parseInt(e.target.value) || 0)} /></div>
            <div><Label>Buffer after (min)</Label><input type="number" min={0} max={240} className="input" value={bAfter} onChange={e => setBAfter(parseInt(e.target.value) || 0)} /></div>
            <div><Label>Slot grid (min)</Label><input type="number" min={5} max={240} className="input" value={granularity} onChange={e => setGranularity(parseInt(e.target.value) || 30)} /></div>
          </div>
          <div>
            <Label>Re-book reminder (days after completion, optional)</Label>
            <input type="number" min={0} max={365} className="input" placeholder="e.g. 21 for cleaning, 180 for HVAC tune-ups" value={rebookDays} onChange={e => setRebookDays(e.target.value)} />
            <p className="text-xs text-muted mt-1">If set, customer gets a "ready for your next one?" email this many days after the appointment ends. Leave blank to skip.</p>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />Show on public booking page</label>
          {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary btn-md">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AvailabilitySection() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ rules: Rule[] }>('/api/admin/booking-availability')
      .then(({ rules }) => setRules(rules))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const addRule = () => setRules(r => [...r, { id: 'tmp-' + Date.now(), userId: null, dayOfWeek: 1, startMinute: 9 * 60, endMinute: 17 * 60 }])
  const updateRule = (i: number, patch: Partial<Rule>) => setRules(r => r.map((x, ix) => ix === i ? { ...x, ...patch } : x))
  const removeRule = (i: number) => setRules(r => r.filter((_, ix) => ix !== i))

  const save = async () => {
    setSaving(true); setError(null); setOkMsg(null)
    try {
      await api.put<{ ok: true }>('/api/admin/booking-availability', { rules })
      setOkMsg('Saved.')
      setTimeout(() => setOkMsg(null), 2000)
    } catch (e: any) { setError(e.message) }
    finally { setSaving(false) }
  }

  const minuteToHHMM = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
  const hhmmToMinute = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0) }

  return (
    <section className="card card-padding mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg text-ink flex items-center gap-2"><Clock className="w-4 h-4" />Weekly availability</h2>
          <p className="text-muted text-xs mt-1">When customers can book. Add one row per day-and-window.</p>
        </div>
        <button onClick={addRule} className="btn-primary btn-sm inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Add window</button>
      </div>
      {loading && <div className="text-muted text-sm">Loading…</div>}
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
      {!loading && rules.length === 0 && <div className="text-muted text-sm mb-3">No availability set yet — nothing will appear on the public booking page.</div>}
      {!loading && rules.length > 0 && (
        <ul className="space-y-2 mb-4">
          {rules.map((r, i) => (
            <li key={r.id} className="flex items-center gap-2">
              <select value={r.dayOfWeek} onChange={e => updateRule(i, { dayOfWeek: parseInt(e.target.value) })} className="input" style={{ width: 110 }}>
                {DAYS.map((d, ix) => <option key={ix} value={ix}>{d}</option>)}
              </select>
              <input type="time" value={minuteToHHMM(r.startMinute)} onChange={e => updateRule(i, { startMinute: hhmmToMinute(e.target.value) })} className="input" style={{ width: 130 }} />
              <span className="text-muted text-sm">to</span>
              <input type="time" value={minuteToHHMM(r.endMinute)} onChange={e => updateRule(i, { endMinute: hhmmToMinute(e.target.value) })} className="input" style={{ width: 130 }} />
              <button onClick={() => removeRule(i)} className="btn-secondary btn-sm text-red-600 ml-auto"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary btn-md inline-flex items-center gap-1.5"><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save availability'}</button>
        {okMsg && <span className="text-green-800 text-sm">{okMsg}</span>}
      </div>
    </section>
  )
}

function BlackoutsSection() {
  const [blackouts, setBlackouts] = useState<Blackout[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newDate, setNewDate] = useState('')
  const [newReason, setNewReason] = useState('')

  const load = () => {
    setLoading(true)
    api.get<{ blackouts: Blackout[] }>('/api/admin/booking-blackouts')
      .then(({ blackouts }) => setBlackouts(blackouts))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await api.post('/api/admin/booking-blackouts', { date: newDate, reason: newReason || null })
      setNewDate(''); setNewReason(''); load()
    } catch (e: any) { setError(e.message) }
  }
  const remove = async (b: Blackout) => {
    if (!confirm(`Remove blackout on ${b.date}?`)) return
    try { await api.delete(`/api/admin/booking-blackouts/${b.id}`); load() }
    catch (e: any) { setError(e.message) }
  }

  return (
    <section className="card card-padding">
      <h2 className="text-lg text-ink flex items-center gap-2 mb-3"><CalendarOff className="w-4 h-4" />Blackout dates</h2>
      <p className="text-muted text-xs mb-4">Days you're closed — holidays, vacations, equipment outages.</p>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
      <form onSubmit={add} className="flex items-end gap-2 mb-4">
        <div><Label>Date</Label><input type="date" required className="input" value={newDate} onChange={e => setNewDate(e.target.value)} /></div>
        <div className="flex-1"><Label>Reason (optional)</Label><input type="text" className="input" placeholder="e.g. Christmas" value={newReason} onChange={e => setNewReason(e.target.value)} /></div>
        <button type="submit" className="btn-primary btn-md">Add</button>
      </form>
      {loading && <div className="text-muted text-sm">Loading…</div>}
      {!loading && blackouts.length === 0 && <div className="text-muted text-sm">No blackouts set.</div>}
      {!loading && blackouts.length > 0 && (
        <ul className="divide-y divide-line">
          {blackouts.map(b => (
            <li key={b.id} className="py-2 flex items-center justify-between">
              <div>
                <span className="font-semibold text-ink">{b.date}</span>
                {b.reason && <span className="text-muted text-sm ml-3">{b.reason}</span>}
              </div>
              <button onClick={() => remove(b)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
