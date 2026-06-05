import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Edit3, X, Save, Clock, CalendarOff, Calendar, Link2, Link2Off, Type, MapPin, Users, Webhook, RefreshCw, Copy } from 'lucide-react'
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
interface User { id: string; email: string; name: string | null; role: string }
interface Zone { id: string; userId: string; zipList: string | null; centerLat: string | null; centerLng: string | null; radiusMiles: number | null }

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
      <ZonesSection />
      <CalendarSyncSection />
      <IcalFeedSection />
      <WebhooksSection />
      <CopyCustomizationSection />
    </div>
  )
}

interface Connection { id: string; provider: string; externalAccountEmail: string | null; createdAt: string; expiresAt: string | null }

function ZonesSection() {
  const [zones, setZones] = useState<Zone[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newUserId, setNewUserId] = useState('')
  const [newZips, setNewZips] = useState('')

  const load = () => {
    setLoading(true)
    Promise.all([
      api.get<{ zones: Zone[] }>('/api/admin/booking-zones').catch(() => ({ zones: [] as Zone[] })),
      api.get<{ users: User[] }>('/api/admin/users').catch(() => ({ users: [] as User[] })),
    ]).then(([z, u]) => { setZones(z.zones); setUsers(u.users) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const userById = (id: string) => users.find(u => u.id === id)
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null)
    try {
      await api.post('/api/admin/booking-zones', { userId: newUserId, zipList: newZips.replace(/\s/g, '') })
      setNewUserId(''); setNewZips(''); load()
    } catch (e: any) { setError(e?.message) }
  }
  const remove = async (id: string) => {
    if (!confirm('Remove this service zone?')) return
    try { await api.delete(`/api/admin/booking-zones/${id}`); load() }
    catch (e: any) { setError(e?.message) }
  }

  if (users.length === 0) return null  // no crew = no per-crew zones meaningful

  return (
    <section className="card card-padding mb-6">
      <h2 className="text-lg text-ink flex items-center gap-2 mb-3"><MapPin className="w-4 h-4" />Service zones</h2>
      <p className="text-muted text-xs mb-4">Restrict each crew to specific ZIP codes. Customer's ZIP at booking time filters to qualifying crews. Crew without any zone = serves everywhere.</p>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
      <form onSubmit={add} className="flex items-end gap-2 mb-4 flex-wrap">
        <div>
          <Label>Crew</Label>
          <select required value={newUserId} onChange={e => setNewUserId(e.target.value)} className="input" style={{ width: 200 }}>
            <option value="">Pick a crew…</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <Label>Serves ZIPs (comma-separated)</Label>
          <input required value={newZips} onChange={e => setNewZips(e.target.value)} placeholder="53703, 53704, 53705" className="input" />
        </div>
        <button type="submit" className="btn-primary btn-md">Add zone</button>
      </form>
      {loading && <div className="text-muted text-sm">Loading…</div>}
      {!loading && zones.length === 0 && <div className="text-muted text-sm">No zones set — all crews serve everywhere.</div>}
      {!loading && zones.length > 0 && (
        <ul className="divide-y divide-line">
          {zones.map(z => {
            const u = userById(z.userId)
            return (
              <li key={z.id} className="py-3 flex items-center gap-3">
                <Users className="w-4 h-4 text-muted shrink-0" />
                <div className="flex-1">
                  <div className="font-semibold text-ink">{u?.name || u?.email || 'Unknown crew'}</div>
                  <div className="text-xs text-muted font-mono break-all">{z.zipList || '(no ZIPs)'}</div>
                </div>
                <button onClick={() => remove(z.id)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

interface WebhookRow { id: string; url: string; events: string; isActive: boolean; lastDeliveryAt: string | null; lastStatus: number | null; failureCount: number }

function IcalFeedSection() {
  const [token, setToken] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api.get<{ settings: any }>('/api/admin/settings').then(({ settings }) => {
      const t = settings?.bookingIcalFeedToken || ''
      setToken(t)
      setFeedUrl(t ? window.location.origin + '/api/ical/bookings.ics?token=' + t : '')
    }).catch(e => setError(e.message))
  }, [])

  const regenerate = async () => {
    if (token && !confirm('Regenerate the feed URL? The old URL will stop working immediately.')) return
    setBusy(true); setError(null)
    try {
      const { token: t } = await api.post<{ token: string }>('/api/admin/booking-ical-feed/regenerate')
      setToken(t)
      setFeedUrl(window.location.origin + '/api/ical/bookings.ics?token=' + t)
    } catch (e: any) { setError(e?.message) }
    finally { setBusy(false) }
  }

  const copy = () => {
    if (!feedUrl) return
    navigator.clipboard.writeText(feedUrl)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="card card-padding mt-6">
      <h2 className="text-lg text-ink flex items-center gap-2 mb-3"><Calendar className="w-4 h-4" />Subscribe URL (iCal)</h2>
      <p className="text-muted text-xs mb-4">Add this URL to Google Calendar, Apple Calendar, or Outlook (subscribe to calendar). Updates poll automatically. Anyone with the URL can see bookings — regenerate to revoke.</p>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
      {feedUrl ? (
        <div className="flex items-center gap-2">
          <input readOnly value={feedUrl} onClick={(e) => (e.currentTarget.select())} className="input font-mono text-xs flex-1" />
          <button onClick={copy} className="btn-secondary btn-sm inline-flex items-center gap-1.5"><Copy className="w-3.5 h-3.5" />{copied ? 'Copied' : 'Copy'}</button>
          <button onClick={regenerate} disabled={busy} className="btn-secondary btn-sm text-red-600 inline-flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Rotate</button>
        </div>
      ) : (
        <button onClick={regenerate} disabled={busy} className="btn-primary btn-md">{busy ? 'Generating…' : 'Generate feed URL'}</button>
      )}
    </section>
  )
}

function WebhooksSection() {
  const [rows, setRows] = useState<WebhookRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newUrl, setNewUrl] = useState('')
  const [newEvents, setNewEvents] = useState('*')
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    api.get<{ webhooks: WebhookRow[] }>('/api/admin/booking-webhooks')
      .then(({ webhooks }) => setRows(webhooks))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setRevealedSecret(null)
    try {
      const { secret } = await api.post<{ webhook: WebhookRow; secret: string }>('/api/admin/booking-webhooks', { url: newUrl, events: newEvents })
      setNewUrl(''); setNewEvents('*'); setRevealedSecret(secret); load()
    } catch (e: any) { setError(e?.message) }
  }
  const remove = async (w: WebhookRow) => {
    if (!confirm('Delete this webhook? Deliveries stop immediately.')) return
    try { await api.delete(`/api/admin/booking-webhooks/${w.id}`); load() }
    catch (e: any) { setError(e?.message) }
  }
  const toggle = async (w: WebhookRow) => {
    try { await api.patch(`/api/admin/booking-webhooks/${w.id}`, { isActive: !w.isActive }); load() }
    catch (e: any) { setError(e?.message) }
  }

  return (
    <section className="card card-padding mt-6">
      <h2 className="text-lg text-ink flex items-center gap-2 mb-3"><Webhook className="w-4 h-4" />Webhooks</h2>
      <p className="text-muted text-xs mb-4">Receive a JSON POST when a booking event fires. Verify with <code className="bg-paper px-1 rounded">X-Twomiah-Signature</code> (HMAC-SHA256 of body using your secret).</p>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
      {revealedSecret && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-3 mb-3">
          <div className="text-xs text-amber-800 mb-1 font-semibold">Save this secret now — it won't be shown again</div>
          <code className="block font-mono text-xs bg-white p-2 rounded break-all">{revealedSecret}</code>
        </div>
      )}
      <form onSubmit={add} className="flex items-end gap-2 mb-4 flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <Label>Endpoint URL</Label>
          <input required type="url" value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://your-app.com/webhooks/twomiah" className="input" />
        </div>
        <div>
          <Label>Events</Label>
          <select value={newEvents} onChange={e => setNewEvents(e.target.value)} className="input" style={{ width: 200 }}>
            <option value="*">All events</option>
            <option value="booking.created">booking.created</option>
            <option value="booking.cancelled">booking.cancelled</option>
            <option value="booking.completed">booking.completed</option>
            <option value="booking.rescheduled">booking.rescheduled</option>
          </select>
        </div>
        <button type="submit" className="btn-primary btn-md">Add webhook</button>
      </form>
      {loading && <div className="text-muted text-sm">Loading…</div>}
      {!loading && rows.length === 0 && <div className="text-muted text-sm">No webhooks configured.</div>}
      {!loading && rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map(w => (
            <li key={w.id} className="py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-xs text-ink truncate">{w.url}</div>
                <div className="text-xs text-muted">
                  {w.events === '*' ? 'All events' : w.events} · {w.lastDeliveryAt ? `Last: ${w.lastStatus || '?'} at ${new Date(w.lastDeliveryAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}` : 'No deliveries yet'}
                  {w.failureCount > 0 && <span className="text-red-600 ml-2">· {w.failureCount} failures</span>}
                </div>
              </div>
              <button onClick={() => toggle(w)} className="btn-secondary btn-sm">{w.isActive ? 'Disable' : 'Enable'}</button>
              <button onClick={() => remove(w)} className="btn-secondary btn-sm text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CopyCustomizationSection() {
  const [vals, setVals] = useState({ bookingHeroTitle: '', bookingHeroSubtitle: '', bookingConfirmCta: '', bookingThanksMessage: '', bookingDefaultDriveTimeMinutes: 0 })
  const [originalJson, setOriginalJson] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  useEffect(() => {
    api.get<{ settings: any }>('/api/admin/settings')
      .then(({ settings }) => {
        const next = {
          bookingHeroTitle: settings?.bookingHeroTitle || '',
          bookingHeroSubtitle: settings?.bookingHeroSubtitle || '',
          bookingConfirmCta: settings?.bookingConfirmCta || '',
          bookingThanksMessage: settings?.bookingThanksMessage || '',
          bookingDefaultDriveTimeMinutes: settings?.bookingDefaultDriveTimeMinutes || 0,
        }
        setVals(next)
        setOriginalJson(JSON.stringify(next))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const dirty = JSON.stringify(vals) !== originalJson
  const save = async () => {
    setSaving(true); setError(null); setOkMsg(null)
    try {
      await api.patch('/api/admin/settings', {
        bookingHeroTitle: vals.bookingHeroTitle || null,
        bookingHeroSubtitle: vals.bookingHeroSubtitle || null,
        bookingConfirmCta: vals.bookingConfirmCta || null,
        bookingThanksMessage: vals.bookingThanksMessage || null,
        bookingDefaultDriveTimeMinutes: Math.max(0, vals.bookingDefaultDriveTimeMinutes || 0),
      })
      setOriginalJson(JSON.stringify(vals))
      setOkMsg('Saved.')
      setTimeout(() => setOkMsg(null), 2000)
    } catch (e: any) { setError(e?.message) }
    finally { setSaving(false) }
  }

  return (
    <section className="card card-padding mt-6">
      <h2 className="text-lg text-ink flex items-center gap-2 mb-3"><Type className="w-4 h-4" />Public booking page copy</h2>
      <p className="text-muted text-xs mb-4">Customize the headline, button text, and thanks message customers see on /book. Leave blank for defaults.</p>
      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
      {okMsg && <div className="text-green-800 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-3">{okMsg}</div>}
      {loading ? <div className="text-muted text-sm">Loading…</div> : (
        <div className="space-y-3">
          <div>
            <Label>Hero title</Label>
            <input className="input" placeholder='Default: "Book a service"' value={vals.bookingHeroTitle} onChange={e => setVals({ ...vals, bookingHeroTitle: e.target.value })} />
          </div>
          <div>
            <Label>Hero subtitle</Label>
            <input className="input" placeholder="Optional one-line tagline" value={vals.bookingHeroSubtitle} onChange={e => setVals({ ...vals, bookingHeroSubtitle: e.target.value })} />
          </div>
          <div>
            <Label>Submit button</Label>
            <input className="input" placeholder='Default: "Confirm booking"' value={vals.bookingConfirmCta} onChange={e => setVals({ ...vals, bookingConfirmCta: e.target.value })} />
          </div>
          <div>
            <Label>Thanks page title</Label>
            <input className="input" placeholder={'Default: "You\'re booked."'} value={vals.bookingThanksMessage} onChange={e => setVals({ ...vals, bookingThanksMessage: e.target.value })} />
          </div>
          <div>
            <Label>Default drive time between bookings (minutes)</Label>
            <input type="number" min={0} max={240} className="input" value={vals.bookingDefaultDriveTimeMinutes} onChange={e => setVals({ ...vals, bookingDefaultDriveTimeMinutes: parseInt(e.target.value) || 0 })} />
            <p className="text-xs text-muted mt-1">Padding added between any two bookings for the same crew. 0 = off.</p>
          </div>
          <button onClick={save} disabled={saving || !dirty} className="btn-primary btn-md inline-flex items-center gap-1.5 disabled:opacity-40">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save copy'}
          </button>
        </div>
      )}
    </section>
  )
}

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
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<{ rules: Rule[] }>('/api/admin/booking-availability'),
      api.get<{ users: User[] }>('/api/admin/users').catch(() => ({ users: [] as User[] })),
    ])
      .then(([r, u]) => { setRules(r.rules); setUsers(u.users) })
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
            <li key={r.id} className="flex items-center gap-2 flex-wrap">
              {users.length > 0 && (
                <select value={r.userId || ''} onChange={e => updateRule(i, { userId: e.target.value || null })} className="input" style={{ width: 160 }}>
                  <option value="">Any crew</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
              )}
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
