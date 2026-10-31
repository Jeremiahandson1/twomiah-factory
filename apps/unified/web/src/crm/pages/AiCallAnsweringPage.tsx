// AI Call Answering (server crm/comms/aiCallAnswering.ts, /api/ai-call-answering): the business's line answered live by the
// assistant. Everything it can say is on this page, in the owner's words; what it books, quotes and serves comes from the
// Pricebook, Settings › Company's hours and the service area. The recent calls show each transcript, turn by turn.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, PhoneCall } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions, ModuleNotEnabled, featureNotEnabled } from '../../shared'

type When = 'always' | 'business_hours' | 'outside_business_hours' | 'custom'
interface DayHours { open?: string; close?: string; closed?: boolean }
interface Settings {
  enabled: boolean
  when: When
  hours: Record<string, DayHours> | null
  booking: { enabled: boolean; days: number; stepMinutes: number; defaultDurationMinutes: number; sayPrices: boolean }
  area: { zips: string[]; places: string[] }
  transfer: { to: string | null; keywords: string[]; emergencyKeywords: string[]; existingCustomer: boolean; emergency: boolean; outsideHours: boolean }
  recordCalls: boolean
  wording: Record<string, string>
  wordingKeys: string[]
  wordingLabels: Record<string, string>
  wordingVariables: string[]
  defaultWording: Record<string, string>
}
interface Service { id: string; name: string; priceCents: number | null; durationMinutes: number }
interface CallRow { id: string; createdAt: string; callerNumber: string | null; callerName: string | null; contactId: string | null; contactName: string | null; summary: string | null; outcomeLabel: string; jobId: string | null; jobNumber: string | null; recordingUrl: string | null; duration: number | null }
interface Turn { id: string; seq: number; speaker: string; text: string }

const DAYS: Array<[string, string]> = [['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'], ['thursday', 'Thursday'], ['friday', 'Friday'], ['saturday', 'Saturday'], ['sunday', 'Sunday']]
const WHEN: Array<[When, string, string]> = [
  ['always', 'Every call', 'The assistant answers every call, day and night.'],
  ['outside_business_hours', 'Outside business hours', 'Your team answers during the hours in Settings › Company; the assistant takes the rest.'],
  ['business_hours', 'During business hours only', 'The assistant answers inside the hours in Settings › Company; outside them the line rings and takes a message as before.'],
  ['custom', 'Its own hours', 'Set the days and times below.'],
]
const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const field = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const label = 'block text-sm font-medium text-gray-800 dark:text-slate-200'
const hint = 'mt-1 text-xs text-gray-600 dark:text-slate-300'
const errText = 'mt-1 text-xs text-red-700 dark:text-red-300'
const check = 'flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100'
const money = (cents: number) => (cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const lines = (list: string[]) => list.join(', ')
const parseList = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)

export default function AiCallAnsweringPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('ai-receptionist:update')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [form, setForm] = useState<Settings | null>(null)
  const [text, setText] = useState({ zips: '', places: '', keywords: '', emergencyKeywords: '' })
  const [services, setServices] = useState<Service[]>([])
  const [status, setStatus] = useState('')
  const [calls, setCalls] = useState<CallRow[]>([])
  const [open, setOpen] = useState<{ id: string; turns: Turn[] } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [off, setOff] = useState(false)

  const load = useCallback(async () => {
    try {
      const s: Settings = await api.get('/api/ai-call-answering/settings')
      setSettings(s); setForm(s)
      setText({ zips: lines(s.area.zips), places: lines(s.area.places), keywords: lines(s.transfer.keywords), emergencyKeywords: lines(s.transfer.emergencyKeywords) })
      const [svc, st, cl] = await Promise.all([api.get('/api/ai-call-answering/services'), api.get('/api/ai-call-answering/status'), api.get('/api/ai-call-answering/calls', { limit: 25 })])
      setServices(svc?.data ?? []); setStatus(st?.label ?? ''); setCalls(cl?.data ?? [])
    } catch (e: any) {
      if (featureNotEnabled(e)) setOff(true)
      else setLoadError(e?.message || 'The call answering settings could not be loaded.')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  if (off) return <ModuleNotEnabled title="AI Call Answering" what="Your line is answered live by the assistant, which books visits, answers questions and takes messages in your own words." />
  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!form || !settings) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch })
  const setBooking = (patch: Partial<Settings['booking']>) => set({ booking: { ...form.booking, ...patch } })
  const setTransfer = (patch: Partial<Settings['transfer']>) => set({ transfer: { ...form.transfer, ...patch } })
  const setDay = (day: string, patch: DayHours) => set({ hours: { ...(form.hours || {}), [day]: { ...((form.hours || {})[day] || {}), ...patch } } })

  const save = async () => {
    setSaving(true); setErrors({})
    try {
      const next: Settings = await api.put('/api/ai-call-answering/settings', {
        enabled: form.enabled, when: form.when, hours: form.when === 'custom' ? form.hours : null,
        booking: { ...form.booking, days: Number(form.booking.days), stepMinutes: Number(form.booking.stepMinutes), defaultDurationMinutes: Number(form.booking.defaultDurationMinutes) },
        area: { zips: parseList(text.zips), places: parseList(text.places) },
        transfer: { ...form.transfer, to: form.transfer.to?.trim() || null, keywords: parseList(text.keywords), emergencyKeywords: parseList(text.emergencyKeywords) },
        recordCalls: form.recordCalls,
        wording: form.wording,
      })
      setSettings(next); setForm(next)
      setText({ zips: lines(next.area.zips), places: lines(next.area.places), keywords: lines(next.transfer.keywords), emergencyKeywords: lines(next.transfer.emergencyKeywords) })
      const st = await api.get('/api/ai-call-answering/status'); setStatus(st?.label ?? '')
      toast.success('AI call answering saved')
    } catch (e: any) {
      setErrors(e?.data?.fields || {})
      toast.error(e?.message || 'The settings could not be saved.')
    } finally { setSaving(false) }
  }

  const showCall = async (id: string) => {
    if (open?.id === id) { setOpen(null); return }
    try { const r = await api.get(`/api/ai-call-answering/calls/${id}`); setOpen({ id, turns: r?.turns ?? [] }) } catch (e: any) { toast.error(e?.message || 'The call could not be opened.') }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><PhoneCall className="h-6 w-6 text-orange-600 dark:text-orange-300" aria-hidden="true" /> AI Call Answering</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">
          Your line answered live by the assistant: it books visits into real open times, answers questions about your hours, prices and service area,
          takes a message or puts the caller through to a person. It speaks only the lines on this page, filled in with what you set up elsewhere — your
          <Link to="/crm/pricebook" className="underline"> Pricebook</Link> services and prices, the hours in Settings › Company, and your service area. Anything else gets your fallback line.
        </p>
        {status && <p className="mt-2 inline-block rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-800 dark:bg-slate-800 dark:text-slate-100">{status}</p>}
        {!mayEdit && <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">You can see these settings. Only an owner or admin can change them.</p>}
      </div>

      <section className={box} aria-label="When it answers">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
          <input type="checkbox" checked={form.enabled} disabled={!mayEdit} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4" />
          Answer calls with the assistant
        </label>
        <p className={hint}>Off, the line rings your forwarding number and takes a message as the AI Receptionist always did.</p>
        <fieldset className="mt-4">
          <legend className={label}>When</legend>
          <div className="mt-1 space-y-2">
            {WHEN.map(([id, title, note]) => (
              <label key={id} className="flex items-start gap-2 text-sm text-gray-900 dark:text-slate-100">
                <input type="radio" name="when" checked={form.when === id} disabled={!mayEdit} onChange={() => set({ when: id })} className="mt-0.5 h-4 w-4" />
                <span><span className="font-medium">{title}</span> <span className="text-gray-600 dark:text-slate-300">— {note}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {form.when === 'custom' && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {DAYS.map(([day, name]) => {
              const h = (form.hours || {})[day] || {}
              const on = !!(h.open || h.close) && !h.closed
              return (
                <div key={day} className="flex flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
                  <label className="flex w-28 items-center gap-2"><input type="checkbox" checked={on} disabled={!mayEdit} onChange={(e) => setDay(day, e.target.checked ? { open: h.open || '08:00', close: h.close || '18:00', closed: false } : { open: undefined, close: undefined, closed: true })} className="h-4 w-4" />{name}</label>
                  {on && <><input type="time" value={h.open || ''} disabled={!mayEdit} onChange={(e) => setDay(day, { open: e.target.value })} className={`${field} mt-0 w-32`} aria-label={`${name} from`} /><span>to</span><input type="time" value={h.close || ''} disabled={!mayEdit} onChange={(e) => setDay(day, { close: e.target.value })} className={`${field} mt-0 w-32`} aria-label={`${name} until`} /></>}
                </div>
              )
            })}
            {errors.hours && <p className={`${errText} sm:col-span-2`}>{errors.hours}</p>}
          </div>
        )}
        <label className={`${check} mt-4`}>
          <input type="checkbox" checked={form.recordCalls} disabled={!mayEdit} onChange={(e) => set({ recordCalls: e.target.checked })} className="h-4 w-4" />
          Record calls (the recording is kept on the call, with the transcript)
        </label>
        <p className={hint}>When on, the recording notice below is spoken right after the greeting. Some states require every party to be told; check your state&rsquo;s rule before switching this on.</p>
      </section>

      <section className={box} aria-label="Booking">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Booking</h2>
        <label className={`${check} mt-2`}>
          <input type="checkbox" checked={form.booking.enabled} disabled={!mayEdit} onChange={(e) => setBooking({ enabled: e.target.checked })} className="h-4 w-4" />
          Let the assistant book visits into open times
        </label>
        <p className={hint}>Open times come from Find a time: inside each person&rsquo;s shifts (or your business hours), around the jobs already booked, with time to drive. The job is made the way the Jobs page makes one.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className={label}>Offer times within
            <select value={form.booking.days} disabled={!mayEdit} onChange={(e) => setBooking({ days: Number(e.target.value) })} className={field}>{[3, 5, 7, 10, 14, 21, 31].map((n) => <option key={n} value={n}>{n} days</option>)}</select>
            {errors['booking.days'] && <p className={errText}>{errors['booking.days']}</p>}
          </label>
          <label className={label}>Times start every
            <select value={form.booking.stepMinutes} disabled={!mayEdit} onChange={(e) => setBooking({ stepMinutes: Number(e.target.value) })} className={field}>{[15, 30, 60, 120].map((n) => <option key={n} value={n}>{n === 60 ? 'hour' : n === 120 ? '2 hours' : `${n} minutes`}</option>)}</select>
          </label>
          <label className={label}>A visit with no length set lasts
            <select value={form.booking.defaultDurationMinutes} disabled={!mayEdit} onChange={(e) => setBooking({ defaultDurationMinutes: Number(e.target.value) })} className={field}>{[30, 45, 60, 90, 120, 180, 240].map((n) => <option key={n} value={n}>{n < 60 ? `${n} minutes` : `${n / 60} hour${n > 60 ? 's' : ''}`}</option>)}</select>
          </label>
        </div>
        <label className={`${check} mt-3`}>
          <input type="checkbox" checked={form.booking.sayPrices} disabled={!mayEdit} onChange={(e) => setBooking({ sayPrices: e.target.checked })} className="h-4 w-4" />
          Tell callers the Pricebook price when they ask, and when confirming a booking
        </label>
        <h3 className="mt-4 text-sm font-medium text-gray-800 dark:text-slate-200">Services it can name and book</h3>
        <p className={hint}>Your Pricebook&rsquo;s active services that are shown to customers. Edit them on the <Link to="/crm/pricebook" className="underline">Pricebook</Link> page; a service&rsquo;s labor hours set the visit&rsquo;s length.</p>
        {services.length === 0 ? <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">No services yet — the assistant can only take a message until the Pricebook has one.</p> : (
          <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-slate-800">
            {services.map((s) => <li key={s.id} className="flex justify-between py-1.5 text-gray-900 dark:text-slate-100"><span>{s.name}</span><span className="text-gray-600 dark:text-slate-300">{s.priceCents != null ? money(s.priceCents) : 'no price'} · {s.durationMinutes} min</span></li>)}
          </ul>
        )}
      </section>

      <section className={box} aria-label="Service area">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Service area</h2>
        <p className={hint}>Leave both empty to use the service areas on your website and your booking ZIP zones. With ZIP codes set, a visit outside them is not booked — the caller hears your &ldquo;outside the service area&rdquo; line and can leave a message.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={label}>ZIP codes<textarea value={text.zips} disabled={!mayEdit} onChange={(e) => setText({ ...text, zips: e.target.value })} rows={3} placeholder="53703, 53704, 53711" className={field} />{Object.keys(errors).filter((k) => k.startsWith('area.zips')).map((k) => <p key={k} className={errText}>{errors[k]}</p>)}</label>
          <label className={label}>Places<textarea value={text.places} disabled={!mayEdit} onChange={(e) => setText({ ...text, places: e.target.value })} rows={3} placeholder="Madison, Sun Prairie, Middleton" className={field} />{Object.keys(errors).filter((k) => k.startsWith('area.places')).map((k) => <p key={k} className={errText}>{errors[k]}</p>)}</label>
        </div>
      </section>

      <section className={box} aria-label="Transfers">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Put the caller through to a person</h2>
        <label className={`${label} mt-2`}>Number to transfer to
          <input value={form.transfer.to || ''} disabled={!mayEdit} onChange={(e) => setTransfer({ to: e.target.value })} placeholder="(608) 555-0123" className={`${field} max-w-xs`} />
          {errors['transfer.to'] && <p className={errText}>{errors['transfer.to']}</p>}
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={label}>When the caller says any of these<textarea value={text.keywords} disabled={!mayEdit} onChange={(e) => setText({ ...text, keywords: e.target.value })} rows={2} placeholder="billing, warranty, complaint" className={field} /></label>
          <label className={label}>Emergency words<textarea value={text.emergencyKeywords} disabled={!mayEdit} onChange={(e) => setText({ ...text, emergencyKeywords: e.target.value })} rows={2} className={field} /><span className={hint}>With no number to transfer to, an emergency gets your emergency line and a message is taken.</span></label>
        </div>
        <div className="mt-3 space-y-2">
          <label className={check}><input type="checkbox" checked={form.transfer.emergency} disabled={!mayEdit} onChange={(e) => setTransfer({ emergency: e.target.checked })} className="h-4 w-4" />Transfer on an emergency word</label>
          <label className={check}><input type="checkbox" checked={form.transfer.existingCustomer} disabled={!mayEdit} onChange={(e) => setTransfer({ existingCustomer: e.target.checked })} className="h-4 w-4" />Transfer an existing customer (a caller whose number is on a contact) straight away</label>
          <label className={check}><input type="checkbox" checked={form.transfer.outsideHours} disabled={!mayEdit} onChange={(e) => setTransfer({ outsideHours: e.target.checked })} className="h-4 w-4" />Transfer every call that comes in outside business hours</label>
          <label className={check}><span className="w-4" />Asking for a person (&ldquo;can I talk to someone&rdquo;) always transfers when a number is set.</label>
        </div>
        <p className={hint}>Nobody picks up within 25 seconds: the caller hears your &ldquo;nobody picked up&rdquo; line and can leave a message.</p>
      </section>

      <section className={box} aria-label="Wording">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">What it says</h2>
        <p className={hint}>Every line the assistant can speak. A line left blank uses the standard one shown in grey. You can use these in any line: {settings.wordingVariables.map((v) => <code key={v} className="mx-0.5 rounded bg-gray-100 px-1 dark:bg-slate-800">{`{{${v}}}`}</code>)}.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {settings.wordingKeys.map((k) => (
            <label key={k} className={label}>{settings.wordingLabels[k] || k}
              <textarea value={form.wording[k] ?? ''} disabled={!mayEdit} onChange={(e) => set({ wording: { ...form.wording, [k]: e.target.value } })} rows={2} placeholder={settings.defaultWording[k]} className={field} />
              {errors[`wording.${k}`] && <p className={errText}>{errors[`wording.${k}`]}</p>}
            </label>
          ))}
        </div>
      </section>

      {mayEdit && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{saving ? 'Saving…' : 'Save'}</button>
        </div>
      )}

      <section className={box} aria-label="Recent calls">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Calls the assistant answered</h2>
        {calls.length === 0 ? <p className="mt-2 text-sm text-gray-700 dark:text-slate-300">None yet.</p> : (
          <div className="mt-2 overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
            <thead><tr className="text-left text-xs uppercase tracking-wide text-gray-600 dark:text-slate-300"><th className="py-2 pr-3">When</th><th className="py-2 pr-3">Caller</th><th className="py-2 pr-3">What happened</th><th className="py-2 pr-3">Summary</th><th className="py-2 pr-3">Links</th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {calls.map((c) => (
                <>
                  <tr key={c.id} className="text-gray-900 dark:text-slate-100">
                    <td className="py-2 pr-3 whitespace-nowrap">{when(c.createdAt)}</td>
                    <td className="py-2 pr-3">{c.contactId ? <Link to={`/crm/contacts/${c.contactId}`} className="underline">{c.contactName || c.callerName || c.callerNumber}</Link> : (c.callerName || c.callerNumber || 'Unknown')}</td>
                    <td className="py-2 pr-3">{c.outcomeLabel}</td>
                    <td className="py-2 pr-3 max-w-md">{c.summary || ''}</td>
                    <td className="py-2 pr-3 whitespace-nowrap space-x-2">
                      {c.jobId && <Link to={`/crm/jobs/${c.jobId}`} className="underline">{c.jobNumber}</Link>}
                      {c.recordingUrl && <a href={c.recordingUrl} target="_blank" rel="noreferrer" className="underline">Recording</a>}
                      <button type="button" onClick={() => showCall(c.id)} className="underline">{open?.id === c.id ? 'Hide transcript' : 'Transcript'}</button>
                    </td>
                  </tr>
                  {open?.id === c.id && (
                    <tr key={`${c.id}-t`}><td colSpan={5} className="bg-gray-50 px-3 py-3 dark:bg-slate-800/60">
                      {open.turns.length === 0 ? <p className="text-sm text-gray-700 dark:text-slate-300">Nothing was said.</p> : (
                        <ol className="space-y-1 text-sm">{open.turns.map((t) => <li key={t.id} className="text-gray-900 dark:text-slate-100"><span className="font-medium">{t.speaker === 'caller' ? 'Caller' : 'Assistant'}:</span> {t.text}</li>)}</ol>
                      )}
                    </td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  )
}
