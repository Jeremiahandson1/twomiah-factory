// Portal appointments (salon): upcoming, past and booking a new one, all in the client's own portal.
//   · Upcoming — when, what and with whom (first name). "Move or cancel" opens the booking's private page, where the salon's notice rules decide
//     whether it can still be changed: for a booking made online, the page it already has; for one made at the desk, the same page is made for it
//     when the client asks (portal.ts POST /appointments/:id/manage). Where it cannot be (several services, no email…) the client is told to call.
//   · Past — the visits that happened, each with "Book again" for that service.
//   · Book — the booking page's own services, people, days and times, with the client's details already known. A salon that asks for a deposit,
//     a card or forms first sends the client to the booking page for that step.
// No prices, notes or formulas ever reach these pages (portal.ts GET /p/:token/appointments).
import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarCheck, CalendarPlus, History } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, card, btnPrimary, btnSecondary, inputCls, labelCls } from './common'

export interface PortalAppointment {
  id: string; startTime: string; endTime?: string | null; status: string
  service: string | null; with: string | null; manageUrl: string | null; canManage?: boolean
}
interface PastVisit { id: string; startTime: string; service: string | null; with: string | null; bookAgain: { slug: string; name: string } | null }
interface BookService { slug: string; name: string; description: string | null; durationMinutes: number; price: string | number | null; priceIsFrom?: boolean }
interface Slot { time: string; label: string }

const when = (iso: string, tz?: string | null) => {
  try { return new Date(iso).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', ...(tz ? { timeZone: tz } : {}) }) } catch { return iso }
}
const dayWords = (iso: string) => { try { return new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) } catch { return iso } }
const length = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`)
const priceWords = (s: BookService) => (s.price == null || Number(s.price) <= 0 ? '' : ` · ${s.priceIsFrom ? 'from ' : ''}$${Number(s.price).toFixed(Number(s.price) % 1 ? 2 : 0)}`)

type Tab = 'upcoming' | 'past' | 'book'

export function PortalAppointments() {
  const { config, company } = usePortal()
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'past' ? 'past' : params.get('tab') === 'book' ? 'book' : 'upcoming'
  const go = (t: Tab, extra: Record<string, string> = {}) => setParams(t === 'upcoming' ? {} : { tab: t, ...extra })
  const tabBtn = (t: Tab, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button type="button" role="tab" aria-selected={tab === t} onClick={() => go(t)}
      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-orange-500 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-600'}`}>
      <Icon className="w-4 h-4" />{label}
    </button>
  )
  return (
    <div>
      <PageTitle title={config.labels.appointments} subtitle={tab === 'upcoming' ? 'What you have booked with us.' : tab === 'past' ? 'Your earlier visits.' : 'Book a new appointment.'} />
      <div role="tablist" aria-label="Appointments" className="mb-5 flex flex-wrap gap-2">
        {tabBtn('upcoming', 'Upcoming', CalendarCheck)}{tabBtn('past', 'Past', History)}{tabBtn('book', 'Book an appointment', CalendarPlus)}
      </div>
      {tab === 'upcoming' && <Upcoming tz={(company as any)?.timeZone} onBook={() => go('book')} />}
      {tab === 'past' && <Past tz={(company as any)?.timeZone} onAgain={(slug) => go('book', { service: slug })} />}
      {tab === 'book' && <Book initial={params.get('service')} tz={(company as any)?.timeZone} onDone={() => go('upcoming')} />}
    </div>
  )
}

function Upcoming({ tz, onBook }: { tz?: string | null; onBook: () => void }) {
  const { fetch: portalFetch } = usePortal()
  const [rows, setRows] = useState<PortalAppointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [calls, setCalls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  useEffect(() => { portalFetch('/appointments').then((d) => setRows(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  const manage = async (id: string) => {
    setBusy(id); setCalls((c) => ({ ...c, [id]: '' }))
    try {
      const r = await portalFetch(`/appointments/${id}/manage`, { method: 'POST' })
      window.location.assign(r.url)
    } catch (e) { setCalls((c) => ({ ...c, [id]: (e as Error).message || 'Please call us to change this appointment.' })) } finally { setBusy('') }
  }
  if (loading) return <Spinner />
  return (
    <div>
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows.length === 0 ? <Empty icon={CalendarCheck} text="You have no upcoming appointments."><button type="button" onClick={onBook} className={`${btnPrimary} mt-4`}>Book an appointment</button></Empty> : (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id} className={`${card} p-5`}>
              <p className="font-semibold text-gray-900 dark:text-slate-100">{a.service || 'Appointment'}{a.with ? ` with ${a.with}` : ''}</p>
              <p className="text-sm text-gray-600 dark:text-slate-300">{when(a.startTime, tz)}</p>
              <p className="mt-2 text-sm">
                {a.manageUrl
                  ? <a href={a.manageUrl} className="text-teal-700 underline dark:text-teal-300">Move or cancel</a>
                  : a.canManage
                    ? <button type="button" disabled={busy === a.id} onClick={() => manage(a.id)} className="text-teal-700 underline dark:text-teal-300">Move or cancel</button>
                    : <span className="text-gray-600 dark:text-slate-300">To change this one, please call us.</span>}
              </p>
              {calls[a.id] && <p role="alert" className="mt-1 text-sm text-gray-700 dark:text-slate-200">{calls[a.id]}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Past({ tz, onAgain }: { tz?: string | null; onAgain: (slug: string) => void }) {
  const { fetch: portalFetch } = usePortal()
  const [rows, setRows] = useState<PastVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { portalFetch('/appointments/past').then((d) => setRows(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)).finally(() => setLoading(false)) }, [portalFetch])
  if (loading) return <Spinner />
  return (
    <div>
      {error && <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {rows.length === 0 ? <Empty icon={History} text="No earlier visits yet." /> : (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id} className={`${card} p-5 flex flex-wrap items-center justify-between gap-3`}>
              <div>
                <p className="font-semibold text-gray-900 dark:text-slate-100">{a.service || 'Appointment'}{a.with ? ` with ${a.with}` : ''}</p>
                <p className="text-sm text-gray-600 dark:text-slate-300">{when(a.startTime, tz)}</p>
              </div>
              {a.bookAgain && <button type="button" onClick={() => onAgain(a.bookAgain!.slug)} className={btnSecondary} aria-label={`Book ${a.bookAgain.name} again`}>Book again</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Book({ initial, tz, onDone }: { initial: string | null; tz?: string | null; onDone: () => void }) {
  const { fetch: portalFetch } = usePortal()
  const [services, setServices] = useState<BookService[] | null>(null)
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([])
  const [slug, setSlug] = useState(initial || '')
  const [who, setWho] = useState('')
  const [dates, setDates] = useState<string[] | null>(null)
  const [date, setDate] = useState('')
  const [times, setTimes] = useState<Slot[] | null>(null)
  const [time, setTime] = useState('')
  const [notes, setNotes] = useState('')
  const [phone, setPhone] = useState('')
  const [askPhone, setAskPhone] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [booked, setBooked] = useState<{ url: string; status: string; next: string | null } | null>(null)
  const whoQ = who ? `?who=${encodeURIComponent(who)}` : ''

  useEffect(() => {
    let live = true
    portalFetch('/book/services').then((d) => { if (live) setServices(Array.isArray(d) ? d : []) }).catch((e) => { if (live) { setServices([]); setError((e as Error).message) } })
    portalFetch('/book/people').then((d) => { if (live) setPeople(Array.isArray(d) ? d : []) }).catch(() => {})
    return () => { live = false }
  }, [portalFetch])

  const loadDates = useCallback(() => {
    if (!slug) return
    setDates(null); setDate(''); setTimes(null); setTime(''); setError('')
    portalFetch(`/book/services/${encodeURIComponent(slug)}/dates${whoQ}`).then((d) => setDates(Array.isArray(d) ? d : [])).catch((e) => { setDates([]); setError((e as Error).message) })
  }, [portalFetch, slug, whoQ])
  useEffect(loadDates, [loadDates])

  const pickDate = (d: string) => {
    setDate(d); setTime(''); setTimes(null); setError('')
    portalFetch(`/book/services/${encodeURIComponent(slug)}/times?date=${d}${who ? `&who=${encodeURIComponent(who)}` : ''}`).then((t) => setTimes(Array.isArray(t) ? t : [])).catch((e) => { setTimes([]); setError((e as Error).message) })
  }
  const confirm = async () => {
    setBusy(true); setError('')
    try {
      const r = await portalFetch(`/book/services/${encodeURIComponent(slug)}`, { method: 'POST', body: JSON.stringify({ date, time, who: who || undefined, notes: notes || undefined, phone: phone || undefined }) })
      setBooked(r)
    } catch (e) { const m = (e as Error).message || 'That could not be booked.'; if (/phone/i.test(m)) setAskPhone(true); setError(m) } finally { setBusy(false) }
  }

  if (services === null) return <Spinner />
  if (booked) {
    return (
      <div className={`${card} p-6`} role="status">
        <p className="font-semibold text-gray-900 dark:text-slate-100">{booked.next ? 'Your time is held.' : 'You are booked.'}</p>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">
          {booked.next === 'forms' ? 'We need a few forms from you before we can confirm it.' : booked.next === 'card' ? 'We need a card on file before we can confirm it.' : booked.next === 'deposit' ? 'A deposit confirms it.' : 'We have sent you a confirmation.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href={booked.url} className={btnPrimary}>{booked.next ? 'Finish booking' : 'View this booking'}</a>
          <button type="button" onClick={onDone} className={btnSecondary}>Back to my appointments</button>
        </div>
      </div>
    )
  }
  if (services.length === 0) return <Empty icon={CalendarPlus} text={error || 'Online booking is not open right now. Please call us.'} />
  const svc = services.find((s) => s.slug === slug)
  return (
    <div className="space-y-5">
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <fieldset>
        <legend className={labelCls}>Service</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <button key={s.slug} type="button" aria-pressed={slug === s.slug} onClick={() => { setSlug(s.slug) }}
              className={`${card} p-4 text-left ${slug === s.slug ? 'ring-2 ring-orange-500' : ''}`}>
              <span className="block font-medium text-gray-900 dark:text-slate-100">{s.name}</span>
              <span className="block text-sm text-gray-600 dark:text-slate-300">{length(s.durationMinutes)}{priceWords(s)}</span>
            </button>
          ))}
        </div>
      </fieldset>
      {svc && people.length > 0 && (
        <label className="block">
          <span className={labelCls}>With</span>
          <select className={inputCls} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Anyone available</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      {svc && (
        <fieldset>
          <legend className={labelCls}>Day</legend>
          {dates === null ? <Spinner className="py-4" /> : dates.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-300">{people.length > 0 && !who ? 'Choose who you would like to see to see their days.' : 'No days are open for this service right now.'}</p> : (
            <div className="flex flex-wrap gap-2">
              {dates.map((d) => <button key={d} type="button" aria-pressed={date === d} onClick={() => pickDate(d)} className={`${date === d ? btnPrimary : btnSecondary}`}>{dayWords(d)}</button>)}
            </div>
          )}
        </fieldset>
      )}
      {date && (
        <fieldset>
          <legend className={labelCls}>Time</legend>
          {times === null ? <Spinner className="py-4" /> : times.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-300">No times left that day — try another.</p> : (
            <div className="flex flex-wrap gap-2">
              {times.map((t) => <button key={t.time} type="button" aria-pressed={time === t.time} onClick={() => setTime(t.time)} className={`${time === t.time ? btnPrimary : btnSecondary}`}>{t.label}</button>)}
            </div>
          )}
        </fieldset>
      )}
      {time && (
        <div className="space-y-3">
          <label className="block">
            <span className={labelCls}>Anything we should know? (optional)</span>
            <textarea className={inputCls} rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {askPhone && (
            <label className="block">
              <span className={labelCls}>Phone number</span>
              <input className={inputCls} type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          )}
          <button type="button" disabled={busy} onClick={confirm} className={btnPrimary}>Book {svc?.name} on {dayWords(date)} at {times?.find((t) => t.time === time)?.label}</button>
          <p className="text-xs text-gray-500 dark:text-slate-400">Times are on the salon&rsquo;s clock{tz ? ` (${tz.replace('_', ' ')})` : ''}.</p>
        </div>
      )}
    </div>
  )
}
