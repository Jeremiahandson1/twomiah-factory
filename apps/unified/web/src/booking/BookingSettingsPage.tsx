// How the business takes bookings: the switches, the services, everyone's hours and days off, service areas, the
// words customers see, the calendar feed, the person's own Google / Outlook calendar, webhooks and bans. Each part saves on its own. The parts that are the
// owner's (services, switches, areas, words, feed, webhooks, bans) are behind bookings:settings; hours and days off,
// the running of the book, behind bookings:update — as on the server.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Trash2, Edit3, X, Copy, ExternalLink, RefreshCw, CalendarCheck } from 'lucide-react'
import { api } from '../api'
import { PageError, useConfirm, useKnownPermission, useMayWrite, useToast } from '../shared'
import { useBookingBasics, dollars, minutesWords, dateWords, type BookingSettings, type Service, type Person } from './common'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
/** The business's one clock, by the name an owner uses (Settings › Company's own list); any other zone as itself. */
const ZONE_NAMES: Record<string, string> = { 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii' }
const zoneWords = (z: string) => ZONE_NAMES[z] || z.replace(/_/g, ' ')

function Section({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section className="card card-padding mb-6">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      {intro && <p className="text-sm text-muted mt-1 mb-4">{intro}</p>}
      {!intro && <div className="mb-4" />}
      {children}
    </section>
  )
}

export function BookingSettingsPage() {
  const { settings, services, people, error, reload } = useBookingBasics()
  const owner = useMayWrite('bookings:settings')
  const runs = useMayWrite('bookings:update')
  if (!settings) return error ? <PageError message={error} /> : <div className="text-muted text-sm">Loading…</div>
  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">Booking settings</h1>
          <p className="text-muted text-sm mt-1">What customers can book, and when.</p>
        </div>
        <a href="/book" target="_blank" rel="noreferrer" className="btn-secondary btn-md"><ExternalLink className="w-4 h-4" />Your booking page</a>
      </div>
      <fieldset disabled={!owner} className="min-w-0"><General settings={settings} onSaved={reload} /></fieldset>
      <Services services={services} mayEdit={owner} onChange={reload} />
      <fieldset disabled={!runs} className="min-w-0"><Hours people={people} /></fieldset>
      <fieldset disabled={!runs} className="min-w-0"><DaysOff people={people} /></fieldset>
      {people.length > 1 && <fieldset disabled={!owner} className="min-w-0"><Zones people={people} /></fieldset>}
      <fieldset disabled={!owner} className="min-w-0"><Words settings={settings} onSaved={reload} /></fieldset>
      {owner && <Feed settings={settings} onSaved={reload} />}
      {owner && <Embed services={services} />}
      <MyCalendar />
      <Webhooks />
      <Bans />
    </div>
  )
}

function useSaver(onSaved: () => void) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (body: Record<string, unknown>) => {
    setBusy(true); setError(null)
    try { await api.patch('/api/booking/settings', body); toast.success('Saved.'); onSaved() } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  return { busy, error, save }
}

function General({ settings, onSaved }: { settings: BookingSettings; onSaved: () => void }) {
  const [f, setF] = useState(() => ({
    enabled: settings.enabled, leadTimeMinutes: String(settings.leadTimeMinutes), maxDaysOut: String(settings.maxDaysOut),
    driveTimeMinutes: String(settings.driveTimeMinutes), selfServiceCutoffMinutes: String(settings.selfServiceCutoffMinutes),
    requireAddress: settings.requireAddress === null ? '' : String(settings.requireAddress), requirePhone: settings.requirePhone, notifyEmail: settings.notifyEmail,
  }))
  const { busy, error, save } = useSaver(onSaved)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save({ ...f, requireAddress: f.requireAddress === '' ? null : f.requireAddress === 'true' })
  }
  return (
    <Section title="Taking bookings" intro="The rules every booking follows, online and at the desk.">
      <form onSubmit={submit} className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.enabled} onChange={(e) => setF((x) => ({ ...x, enabled: e.target.checked }))} />Customers can book online</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* ONE CLOCK: bookings keep time on the business's time zone, set once under Settings › Company (coordinator
              10/23). This was a second zone of its own that could disagree with the reports'. */}
          <div><span className="label">Time zone</span><div id="bs-tz" className="text-sm text-ink py-2"><p>{zoneWords(settings.timezone)} — your business&rsquo;s time zone.</p><Link to="/crm/settings" className="inline-block whitespace-nowrap text-brand-700 hover:underline dark:text-brand-200">Change it in Settings › Company</Link></div></div>
          <div><label htmlFor="bs-lead" className="label">Notice needed (minutes)</label><input id="bs-lead" type="number" min={0} className="input" value={f.leadTimeMinutes} onChange={set('leadTimeMinutes')} /><p className="text-xs text-muted mt-1">{Number(f.leadTimeMinutes) ? `Nothing sooner than ${minutesWords(Number(f.leadTimeMinutes))} from now.` : 'Right up to the start.'}</p></div>
          <div><label htmlFor="bs-max" className="label">How far ahead (days)</label><input id="bs-max" type="number" min={1} max={365} className="input" value={f.maxDaysOut} onChange={set('maxDaysOut')} /></div>
          <div><label htmlFor="bs-drive" className="label">Travel between jobs (minutes)</label><input id="bs-drive" type="number" min={0} className="input" value={f.driveTimeMinutes} onChange={set('driveTimeMinutes')} /></div>
          <div><label htmlFor="bs-cut" className="label">Customers can change it until (minutes before)</label><input id="bs-cut" type="number" min={0} className="input" value={f.selfServiceCutoffMinutes} onChange={set('selfServiceCutoffMinutes')} /></div>
          <div><label htmlFor="bs-addr" className="label">Ask for the address</label><select id="bs-addr" className="input" value={f.requireAddress} onChange={set('requireAddress')}><option value="">Your business type's default</option><option value="true">Yes — we go to them</option><option value="false">No — they come to us</option></select></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.requirePhone} onChange={(e) => setF((x) => ({ ...x, requirePhone: e.target.checked }))} />Phone number required</label>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.notifyEmail} onChange={(e) => setF((x) => ({ ...x, notifyEmail: e.target.checked }))} />Email me each new booking, move and cancellation</label>
        <PageError message={error} />
        <button type="submit" className="btn-primary btn-md" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Section>
  )
}

function Services({ services, mayEdit, onChange }: { services: Service[]; mayEdit: boolean; onChange: () => void }) {
  const confirm = useConfirm()
  const toast = useToast()
  const [editing, setEditing] = useState<Service | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const remove = async (s: Service) => {
    if (!(await confirm(`Past bookings keep their details. Customers can no longer book "${s.name}".`, { title: 'Delete this service?', confirmText: 'Delete' }))) return
    try { await api.delete(`/api/booking/services/${s.id}`); toast.success('Deleted.'); onChange() } catch (e: any) { setError(e.message) }
  }
  return (
    <Section title="Services" intro="What customers can book. Each one has its own page at /book/<its address>.">
      <PageError message={error} className="mb-3" />
      {!services.length && <p className="text-sm text-muted mb-3">No services yet.</p>}
      <ul className="divide-y divide-line">
        {services.map((s) => (
          <li key={s.id} className="py-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-ink">{s.name}{!s.active && <span className="ml-2 text-xs font-normal text-muted">(switched off)</span>}</div>
              <div className="text-xs text-muted">/book/{s.slug} · {minutesWords(s.durationMinutes)}{s.price != null ? ` · ${dollars(s.price)}` : ''}{s.capacity > 1 ? ` · up to ${s.capacity} at a time` : ''}{s.depositAmount || s.depositPercent ? ` · deposit ${s.depositAmount ? dollars(s.depositAmount) : s.depositPercent + '%'}` : ''}</div>
            </div>
            {mayEdit && <button type="button" onClick={() => setEditing(s)} className="btn-secondary btn-sm"><Edit3 className="w-3.5 h-3.5" />Edit</button>}
            {mayEdit && <button type="button" onClick={() => remove(s)} className="btn-secondary btn-sm text-red-700 dark:text-red-300" aria-label={`Delete ${s.name}`}><Trash2 className="w-3.5 h-3.5" /></button>}
          </li>
        ))}
      </ul>
      {mayEdit && <button type="button" onClick={() => setEditing('new')} className="btn-secondary btn-sm mt-3"><Plus className="w-3.5 h-3.5" />Add a service</button>}
      {editing && <ServiceDialog initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChange() }} />}
    </Section>
  )
}

function ServiceDialog({ initial, onClose, onSaved }: { initial: Service | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [f, setF] = useState(() => ({
    name: initial?.name || '', slug: initial?.slug || '', description: initial?.description || '',
    durationMinutes: String(initial?.durationMinutes ?? 60), price: initial?.price ?? '', slotStepMinutes: String(initial?.slotStepMinutes ?? 30),
    bufferBeforeMinutes: String(initial?.bufferBeforeMinutes ?? 0), bufferAfterMinutes: String(initial?.bufferAfterMinutes ?? 0), capacity: String(initial?.capacity ?? 1),
    depositKind: initial?.depositPercent != null ? 'percent' : initial?.depositAmount != null ? 'amount' : 'none', deposit: initial?.depositPercent != null ? String(initial.depositPercent) : initial?.depositAmount ?? '',
    tips: (initial?.tipPresets || []).join(', '), rebookIntervalDays: initial?.rebookIntervalDays != null ? String(initial.rebookIntervalDays) : '', active: initial?.active ?? true,
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    const tips = f.tips.split(/[\s,%]+/).filter(Boolean).map(Number)
    const body = {
      name: f.name, ...(f.slug ? { slug: f.slug } : {}), description: f.description || null, durationMinutes: f.durationMinutes, price: f.price === '' ? null : f.price,
      slotStepMinutes: f.slotStepMinutes, bufferBeforeMinutes: f.bufferBeforeMinutes, bufferAfterMinutes: f.bufferAfterMinutes, capacity: f.capacity,
      depositAmount: f.depositKind === 'amount' && f.deposit !== '' ? f.deposit : null, depositPercent: f.depositKind === 'percent' && f.deposit !== '' ? f.deposit : null,
      tipPresets: tips.length ? tips : null, rebookIntervalDays: f.rebookIntervalDays === '' ? null : f.rebookIntervalDays, active: f.active,
    }
    try {
      if (initial) await api.patch(`/api/booking/services/${initial.id}`, body); else await api.post('/api/booking/services', body)
      toast.success('Saved.'); onSaved()
    } catch (x: any) { setError(x.message) } finally { setBusy(false) }
  }
  const field = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <div><label htmlFor={`sv-${k}`} className="label">{label}</label><input id={`sv-${k}`} className="input" value={f[k] as string} onChange={set(k)} {...props} /></div>
  )
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="sv-title" className="card card-padding w-full max-w-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 id="sv-title" className="text-xl font-semibold text-ink">{initial ? 'Edit service' : 'New service'}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {field('name', 'Name', { required: true })}
          {field('slug', 'Address (/book/…)', { placeholder: 'Made from the name' })}
          <div><label htmlFor="sv-description" className="label">Description</label><textarea id="sv-description" rows={2} className="input" value={f.description} onChange={set('description')} /></div>
          <div className="grid grid-cols-2 gap-3">
            {field('durationMinutes', 'Length (minutes)', { type: 'number', min: 5, required: true })}
            {field('price', 'Price ($)', { type: 'number', min: 0, step: '0.01' })}
            {field('slotStepMinutes', 'Start times every (minutes)', { type: 'number', min: 5 })}
            {field('capacity', 'Customers per time', { type: 'number', min: 1 })}
            {field('bufferBeforeMinutes', 'Setup before (minutes)', { type: 'number', min: 0 })}
            {field('bufferAfterMinutes', 'Clean-up after (minutes)', { type: 'number', min: 0 })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="sv-depkind" className="label">Deposit</label><select id="sv-depkind" className="input" value={f.depositKind} onChange={set('depositKind')}><option value="none">None</option><option value="amount">A fixed amount</option><option value="percent">A percent of the price</option></select></div>
            {f.depositKind !== 'none' && field('deposit', f.depositKind === 'amount' ? 'Deposit ($)' : 'Deposit (%)', { type: 'number', min: 0 })}
          </div>
          {f.depositKind !== 'none' && <p className="text-xs text-muted">The customer pays it by card on Stripe's page, into your own Stripe account — connect it under <a className="underline" href="/crm/settings/integrations">Settings › Integrations</a>. Until it is connected, bookings are made without a deposit.</p>}
          {field('tips', 'Tip choices (percent)', { placeholder: 'e.g. 15, 20, 25 — leave empty for none' })}
          {field('rebookIntervalDays', 'Ask to book again after (days)', { type: 'number', min: 1, placeholder: 'Never' })}
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />Customers can book it</label>
          <PageError message={error} />
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
            <button type="submit" className="btn-primary btn-md" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface Window { userId: string | null; dayOfWeek: number; start: string; end: string }

function Hours({ people }: { people: Person[] }) {
  const toast = useToast()
  const [rows, setRows] = useState<Window[] | null>(null)
  const [who, setWho] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.get('/api/booking/hours').then((r: { data: Array<{ userId: string | null; dayOfWeek: number; startMinute: number; endMinute: number }> }) =>
      setRows(r.data.map((h) => ({ userId: h.userId, dayOfWeek: h.dayOfWeek, start: hm(h.startMinute), end: h.endMinute === 1440 ? '24:00' : hm(h.endMinute) })))).catch((e: Error) => setError(e.message))
  }, [])
  if (!rows) return <Section title="Opening hours"><PageError message={error} />{!error && <p className="text-sm text-muted">Loading…</p>}</Section>
  const owner = who || null
  const mine = rows.map((r, i) => ({ ...r, i })).filter((r) => r.userId === owner)
  const update = (i: number, patch: Partial<Window>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const save = async () => {
    setBusy(true); setError(null)
    try { await api.put('/api/booking/hours', { hours: rows }); toast.success('Hours saved.') } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }
  const people2 = [{ id: '', name: 'Anyone (the business)' }, ...people]
  const hasOwn = (id: string) => rows.some((r) => r.userId === (id || null))
  return (
    <Section title="Opening hours" intro="When bookings can start. Several windows a day (a lunch break) are fine. Set hours for a person if bookings go to someone in particular; otherwise the business's hours are for anyone.">
      {people.length > 0 && (
        <div className="mb-4">
          <label htmlFor="hr-who" className="label">Hours for</label>
          <select id="hr-who" className="input w-auto" value={who} onChange={(e) => setWho(e.target.value)}>
            {people2.map((p) => <option key={p.id} value={p.id}>{p.name}{hasOwn(p.id) ? '' : ' — none set'}</option>)}
          </select>
        </div>
      )}
      <div className="space-y-2">
        {DAYS.map((name, d) => {
          const today = mine.filter((r) => r.dayOfWeek === d)
          return (
            <div key={d} className="flex flex-wrap items-center gap-2 py-1">
              <span className="w-full sm:w-24 text-sm font-medium text-ink">{name}</span>
              {!today.length && <span className="text-sm text-muted">Closed</span>}
              {today.map((r) => (
                <span key={r.i} className="inline-flex items-center gap-1">
                  <input type="time" aria-label={`${name} opens`} className="input w-[7.25rem] px-2 py-1" value={r.start} onChange={(e) => update(r.i, { start: e.target.value })} />
                  <span className="text-muted">–</span>
                  <input type="time" aria-label={`${name} closes`} className="input w-[7.25rem] px-2 py-1" value={r.end === '24:00' ? '23:59' : r.end} onChange={(e) => update(r.i, { end: e.target.value })} />
                  <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== r.i))} className="btn-secondary btn-sm" aria-label={`Remove this ${name} window`}><X className="w-3.5 h-3.5" /></button>
                </span>
              ))}
              <button type="button" onClick={() => setRows([...rows, { userId: owner, dayOfWeek: d, start: today.length ? '13:00' : '09:00', end: '17:00' }])} className="btn-secondary btn-sm" aria-label={`Add hours on ${name}`}><Plus className="w-3.5 h-3.5" /></button>
            </div>
          )
        })}
      </div>
      <PageError message={error} className="mt-3" />
      <button type="button" onClick={save} className="btn-primary btn-md mt-4" disabled={busy}>{busy ? 'Saving…' : 'Save hours'}</button>
    </Section>
  )
}

function DaysOff({ people }: { people: Person[] }) {
  const confirm = useConfirm()
  const [rows, setRows] = useState<Array<{ id: string; userId: string | null; date: string; startMinute: number | null; endMinute: number | null; reason: string | null }>>([])
  const [f, setF] = useState({ date: '', userId: '', start: '', end: '', reason: '' })
  const [error, setError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const load = () => api.get('/api/booking/days-off', { from: today }).then((r: any) => setRows(r.data)).catch((e: Error) => setError(e.message))
  useEffect(() => { load() }, [])
  const add = async (e: FormEvent) => {
    e.preventDefault(); setError(null)
    try { await api.post('/api/booking/days-off', { ...f, userId: f.userId || null }); setF({ date: '', userId: '', start: '', end: '', reason: '' }); load() } catch (x: any) { setError(x.message) }
  }
  const remove = async (id: string) => {
    if (!(await confirm('Bookings can be made on it again.', { title: 'Remove this day off?', confirmText: 'Remove' }))) return
    try { await api.delete(`/api/booking/days-off/${id}`); load() } catch (x: any) { setError(x.message) }
  }
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name || 'Someone' : 'Everyone')
  return (
    <Section title="Days off" intro="Holidays and time off. Leave the times empty for the whole day.">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 mb-4">
        <div><label htmlFor="do-date" className="label">Date</label><input id="do-date" type="date" required className="input w-auto" value={f.date} min={today} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        {people.length > 0 && <div><label htmlFor="do-who" className="label">Who</label><select id="do-who" className="input w-auto" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
        <div><label htmlFor="do-start" className="label">From</label><input id="do-start" type="time" className="input w-auto" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
        <div><label htmlFor="do-end" className="label">Until</label><input id="do-end" type="time" className="input w-auto" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        <div className="flex-1 min-w-[140px]"><label htmlFor="do-reason" className="label">Why (optional)</label><input id="do-reason" className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        <button type="submit" className="btn-primary btn-md">Add</button>
      </form>
      <PageError message={error} className="mb-3" />
      {!rows.length && <p className="text-sm text-muted">None coming up.</p>}
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="py-2 flex items-center gap-3 text-sm">
            <span className="flex-1 text-ink">{dateWords(r.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {r.startMinute == null ? 'all day' : `${hm(r.startMinute)}–${hm(r.endMinute!)}`} · {nameOf(r.userId)}{r.reason ? ` · ${r.reason}` : ''}</span>
            <button type="button" onClick={() => remove(r.id)} className="btn-secondary btn-sm text-red-700 dark:text-red-300" aria-label="Remove"><Trash2 className="w-3.5 h-3.5" /></button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Zones({ people }: { people: Person[] }) {
  const toast = useToast()
  const [zones, setZones] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.get('/api/booking/zones').then((r: { data: Array<{ userId: string; zips: string[] }> }) => setZones(Object.fromEntries(r.data.map((z) => [z.userId, z.zips.join(', ')])))).catch((e: Error) => setError(e.message))
  }, [])
  const save = async (userId: string) => {
    setError(null)
    try { await api.put(`/api/booking/zones/${userId}`, { zips: zones[userId] || '' }); toast.success('Saved.') } catch (e: any) { setError(e.message) }
  }
  return (
    <Section title="Service areas" intro="The ZIP codes each person covers. When a customer gives their ZIP, only the people who cover it are offered. Someone with no ZIPs covers everywhere.">
      <PageError message={error} className="mb-3" />
      <div className="space-y-3">
        {people.map((p) => (
          <div key={p.id} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]"><label htmlFor={`zn-${p.id}`} className="label">{p.name}</label><input id={`zn-${p.id}`} className="input" placeholder="Everywhere" value={zones[p.id] || ''} onChange={(e) => setZones({ ...zones, [p.id]: e.target.value })} /></div>
            <button type="button" className="btn-secondary btn-md" onClick={() => save(p.id)}>Save</button>
          </div>
        ))}
      </div>
    </Section>
  )
}

function Words({ settings, onSaved }: { settings: BookingSettings; onSaved: () => void }) {
  const [f, setF] = useState(() => ({
    heroTitle: settings.heroTitle || '', heroSubtitle: settings.heroSubtitle || '', confirmCta: settings.confirmCta || '', thanksMessage: settings.thanksMessage || '',
    confirmationEmailSubject: settings.confirmationEmailSubject || '', confirmationEmailIntro: settings.confirmationEmailIntro || '', reviewLink: settings.reviewLink || '',
  }))
  const { busy, error, save } = useSaver(onSaved)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const row = (k: keyof typeof f, label: string, placeholder: string, area = false) => (
    <div><label htmlFor={`wd-${k}`} className="label">{label}</label>{area ? <textarea id={`wd-${k}`} rows={3} className="input" placeholder={placeholder} value={f[k]} onChange={set(k)} /> : <input id={`wd-${k}`} className="input" placeholder={placeholder} value={f[k]} onChange={set(k)} />}</div>
  )
  return (
    <Section title="Words and messages" intro="Leave a box empty for the standard wording. In the email boxes, {service}, {when}, {customerName}, {address} and {company} are filled in for each booking.">
      <form onSubmit={(e) => { e.preventDefault(); save(f) }} className="space-y-3">
        {row('heroTitle', 'Booking page heading', 'Book a service')}
        {row('heroSubtitle', 'Booking page subheading', '')}
        {row('confirmCta', 'Booking button', 'Confirm booking')}
        {row('thanksMessage', 'After booking', "You're booked.")}
        {row('confirmationEmailSubject', 'Confirmation email subject', 'Booking confirmed — {service}')}
        {row('confirmationEmailIntro', 'Confirmation email opening', 'Hi {customerName}, your booking is confirmed.', true)}
        {row('reviewLink', 'Your review link (sent a day after a completed visit)', 'https://g.page/r/…')}
        <PageError message={error} />
        <button type="submit" className="btn-primary btn-md" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Section>
  )
}

function Feed({ settings, onSaved }: { settings: BookingSettings; onSaved: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const url = settings.icalFeedToken ? `${window.location.origin}/api/book/feed/${settings.icalFeedToken}.ics` : null
  const rotate = async () => {
    if (url && !(await confirm('Calendars subscribed to the old address stop updating.', { title: 'Make a new address?', confirmText: 'Make a new one' }))) return
    try { await api.post('/api/booking/settings/feed-token', {}); onSaved() } catch (e: any) { toast.error(e.message) }
  }
  return (
    <Section title="Your bookings in your own calendar" intro="Subscribe to this private address in Google Calendar, Apple Calendar or Outlook. Anyone with it can see your bookings — keep it to yourself.">
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly aria-label="Calendar address" className="input flex-1 min-w-[240px] font-mono text-xs" value={url} />
          <button type="button" className="btn-secondary btn-md" onClick={() => { navigator.clipboard?.writeText(url).then(() => toast.success('Copied.')).catch(() => {}) }}><Copy className="w-4 h-4" />Copy</button>
          <button type="button" className="btn-secondary btn-md" onClick={rotate}><RefreshCw className="w-4 h-4" />New address</button>
        </div>
      ) : <button type="button" className="btn-primary btn-md" onClick={rotate}>Make my calendar address</button>}
    </Section>
  )
}

const PROVIDER_NAMES: Record<string, string> = { google: 'Google Calendar', outlook: 'Outlook' }

/**
 * The signed-in person's own calendar (server/booking/calendars.ts): busy time there isn't offered to customers, and
 * their bookings are put on it. Linking goes through the Factory's Google / Microsoft sign-in and comes back here with
 * ?google= or ?outlook= set to connected or denied.
 */
function MyCalendar() {
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<Array<{ id: string; provider: string; accountEmail: string | null; refusedAt: string | null }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Only the calendars this account can link (their sign-in app is set up); the others get no button.
  const [offered, setOffered] = useState<string[]>([])
  const load = () => api.get('/api/booking/calendar/connections').then((r: any) => setRows(r.data)).catch((e: Error) => setError(e.message))
  useEffect(() => { api.get('/api/booking/calendar/providers').then((r: any) => setOffered(r.providers || [])).catch(() => setOffered([])) }, [])
  useEffect(() => { load() }, [])
  useEffect(() => {
    for (const p of ['google', 'outlook']) {
      const v = params.get(p)
      if (!v) continue
      if (v === 'connected') toast.success(`${PROVIDER_NAMES[p]} linked.`)
      else toast.error(`${PROVIDER_NAMES[p]} wasn't linked — the sign-in was cancelled.`)
      params.delete(p)
      setParams(params, { replace: true })
    }
  }, [])
  const link = async (provider: string) => {
    setBusy(provider); setError(null)
    try { const r = await api.get(`/api/booking/calendar/${provider}/connect-url`); window.location.assign(r.url) } catch (e: any) { setError(e.message); setBusy(null) }
  }
  const unlink = async (id: string, provider: string) => {
    if (!(await confirm('Bookings stop going onto it, and its busy times stop blocking yours. Events already there stay.', { title: `Unlink ${PROVIDER_NAMES[provider]}?`, confirmText: 'Unlink' }))) return
    try {
      const r = await api.delete(`/api/booking/calendar/connections/${id}`)
      // Kept at Google: another Google link here may be on the same account, and Google's revoke would end it too.
      if (r?.stillUsedBy) toast.success(`Unlinked. Twomiah stays in your Google account's permissions because ${r.stillUsedBy === 'google_reviews' ? 'Google Reviews (Settings › Google Reviews) is' : 'another calendar link here is'} connected with it — disconnect that too to remove it there.`)
      load()
    } catch (e: any) { setError(e.message) }
  }
  const linked = new Set((rows || []).map((r) => r.provider))
  return (
    <Section title="Your own calendar" intro="Link your Google or Outlook calendar: times you're busy there aren't offered to customers, and the bookings you're given are put on it. Only you can link or unlink yours.">
      <PageError message={error} className="mb-3" />
      {rows === null ? (!error && <p className="text-sm text-muted">Loading…</p>) : (
        <>
          {rows.length > 0 && (
            <ul className="divide-y divide-line mb-3">
              {rows.map((r) => (
                <li key={r.id} className="py-2 flex flex-wrap items-center gap-3 text-sm">
                  <CalendarCheck className="w-4 h-4 text-muted" aria-hidden="true" />
                  <span className="flex-1 min-w-0 text-ink">
                    {PROVIDER_NAMES[r.provider] || r.provider}{r.accountEmail && <span className="text-muted"> · {r.accountEmail}</span>}
                    {/* Access withdrawn at Google / Microsoft (calendars.ts marks it): its busy times aren't being read. */}
                    {r.refusedAt && <span className="block text-red-700 dark:text-red-300">{r.provider === 'outlook' ? 'Microsoft' : 'Google'} stopped accepting this link, so its busy times aren't blocking yours. Link it again.</span>}
                  </span>
                  {r.refusedAt && offered.includes(r.provider) && (
                    <button type="button" className="btn-primary btn-sm" disabled={busy !== null} onClick={() => link(r.provider)}>{busy === r.provider ? 'Opening…' : 'Link again'}</button>
                  )}
                  <button type="button" onClick={() => unlink(r.id, r.provider)} className="btn-secondary btn-sm">Unlink</button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {offered.length === 0 && rows.length === 0 && <p className="text-sm text-muted">Calendar linking isn't available for this account yet.</p>}
            {offered.filter((p) => !linked.has(p)).map((p) => (
              <button key={p} type="button" className="btn-secondary btn-md" disabled={busy !== null} onClick={() => link(p)}>
                {busy === p ? 'Opening…' : `Link ${PROVIDER_NAMES[p]}`}
              </button>
            ))}
          </div>
        </>
      )}
    </Section>
  )
}

/**
 * Booking on the business's other website: the snippet that frames these booking pages there (/scripts/book-embed.js).
 * The site's own address — the admin may be open at app.<domain>, which hands the website to the domain itself.
 */
function Embed({ services }: { services: Service[] }) {
  const toast = useToast()
  const site = window.location.origin.replace('://app.', '://')
  const [service, setService] = useState('')
  const code = `<div class="twomiah-book"${service ? ` data-service="${service}"` : ''}></div>\n<script src="${site}/scripts/book-embed.js" async></script>`
  return (
    <Section title="Booking on another website" intro="Paste this into another website you run (Wix, Squarespace, WordPress…) where the booking should appear. Customers book there without leaving that page.">
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div className="min-w-[220px]">
          <label htmlFor="embed-service" className="label">Show</label>
          <select id="embed-service" className="input" value={service} onChange={(e) => setService(e.target.value)}>
            <option value="">Every service</option>
            {services.filter((x) => x.active).map((x) => <option key={x.id} value={x.slug}>{x.name} only</option>)}
          </select>
        </div>
        <button type="button" className="btn-secondary btn-md" onClick={() => { navigator.clipboard?.writeText(code).then(() => toast.success('Copied.')).catch(() => {}) }}><Copy className="w-4 h-4" />Copy</button>
      </div>
      <textarea readOnly aria-label="Code to paste" rows={3} className="input w-full font-mono text-xs" value={code} />
    </Section>
  )
}

function Webhooks() {
  const may = useKnownPermission('bookings:settings')
  const confirm = useConfirm()
  const [rows, setRows] = useState<Array<{ id: string; url: string; events: string[]; active: boolean; lastStatus: number | null; failureCount: number }>>([])
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => api.get('/api/booking/webhooks').then((r: any) => setRows(r.data)).catch((e: Error) => setError(e.message))
  useEffect(() => { if (may) load() }, [may])
  if (!may) return null
  const add = async (e: FormEvent) => {
    e.preventDefault(); setError(null)
    try { const w = await api.post('/api/booking/webhooks', { url }); setSecret(w.secret); setUrl(''); load() } catch (x: any) { setError(x.message) }
  }
  const remove = async (id: string) => {
    if (!(await confirm('Bookings stop being sent there.', { title: 'Remove this webhook?', confirmText: 'Remove' }))) return
    try { await api.delete(`/api/booking/webhooks/${id}`); load() } catch (x: any) { setError(x.message) }
  }
  return (
    <Section title="Webhooks" intro="Send each new, moved, cancelled and completed booking to another system you use (https only). Each post is signed with the secret shown when you add it.">
      <form onSubmit={add} className="flex flex-wrap gap-2 mb-3">
        <input type="url" required aria-label="Webhook address" placeholder="https://…" className="input flex-1 min-w-[240px]" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="submit" className="btn-primary btn-md">Add</button>
      </form>
      {secret && <p className="text-sm text-ink bg-paper border border-line rounded-lg p-3 mb-3">The secret, shown only now: <code className="font-mono break-all">{secret}</code></p>}
      <PageError message={error} className="mb-3" />
      <ul className="divide-y divide-line">
        {rows.map((w) => (
          <li key={w.id} className="py-2 flex items-center gap-3 text-sm">
            <span className="flex-1 min-w-0 truncate text-ink font-mono text-xs">{w.url}</span>
            <span className="text-xs text-muted">{w.lastStatus ? `last: ${w.lastStatus}` : 'not sent yet'}{w.failureCount ? ` · ${w.failureCount} failed` : ''}</span>
            <button type="button" onClick={() => remove(w.id)} className="btn-secondary btn-sm text-red-700 dark:text-red-300" aria-label="Remove webhook"><Trash2 className="w-3.5 h-3.5" /></button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Bans() {
  const may = useKnownPermission('bookings:settings')
  const [rows, setRows] = useState<Array<{ id: string; email: string | null; phone: string | null; reason: string | null }>>([])
  const [f, setF] = useState({ email: '', phone: '', reason: '' })
  const [error, setError] = useState<string | null>(null)
  const load = () => api.get('/api/booking/bans').then((r: any) => setRows(r.data)).catch((e: Error) => setError(e.message))
  useEffect(() => { if (may) load() }, [may])
  if (!may) return null
  const add = async (e: FormEvent) => {
    e.preventDefault(); setError(null)
    try { await api.post('/api/booking/bans', f); setF({ email: '', phone: '', reason: '' }); load() } catch (x: any) { setError(x.message) }
  }
  return (
    <Section title="Can't book online" intro="An email or phone number listed here is told to call instead of booking online.">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 mb-3">
        <div className="flex-1 min-w-[180px]"><label htmlFor="bn-email" className="label">Email</label><input id="bn-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="flex-1 min-w-[140px]"><label htmlFor="bn-phone" className="label">Phone</label><input id="bn-phone" type="tel" className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        <div className="flex-1 min-w-[140px]"><label htmlFor="bn-reason" className="label">Why (optional)</label><input id="bn-reason" className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
        <button type="submit" className="btn-primary btn-md">Add</button>
      </form>
      <PageError message={error} className="mb-3" />
      <ul className="divide-y divide-line">
        {rows.map((b) => (
          <li key={b.id} className="py-2 flex items-center gap-3 text-sm">
            <span className="flex-1 text-ink">{[b.email, b.phone].filter(Boolean).join(' · ')}{b.reason ? <span className="text-muted"> — {b.reason}</span> : null}</span>
            <button type="button" onClick={async () => { try { await api.delete(`/api/booking/bans/${b.id}`); load() } catch (x: any) { setError(x.message) } }} className="btn-secondary btn-sm" aria-label="Remove">Remove</button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

