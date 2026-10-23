// What the booking screens share: the shapes the API answers, the business's clock, and the status pill.
//
// Every date and time on these screens is the BUSINESS'S, whatever zone the person looking is in. The site's screens
// read and wrote the browser's own clock (datetime-local → toISOString), so an owner travelling, or a manager in the
// next state, booked and saw every appointment an hour or more out.
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useKnownPermission } from '../shared'
import { money } from '@twomiah/tenant-ui/src/money'
import { mayBeGivenWork } from '@twomiah/tenant-ui/src/people/work'

export interface Booking {
  id: string
  serviceId: string | null
  serviceName?: string | null
  /** The assigned person's name (sent with the booking: not every seat may read the team list). */
  assignedName?: string | null
  contactId: string | null
  seriesId: string | null
  seriesIndex: number | null
  startAt: string
  endAt: string
  customerName: string
  customerEmail: string
  customerPhone: string | null
  customerAddress: string | null
  customerZip: string | null
  customerNotes: string | null
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  assignedUserId: string | null
  source: string
  depositAmount: string | null
  depositStatus: string
  tipAmount: string | null
  cancelledReason: string | null
  createdAt: string
}

export interface Service {
  id: string
  slug: string
  name: string
  description: string | null
  durationMinutes: number
  price: string | null
  depositAmount: string | null
  depositPercent: number | null
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  slotStepMinutes: number
  capacity: number
  tipPresets: number[] | null
  rebookIntervalDays: number | null
  active: boolean
  sortOrder: number
}

export interface BookingSettings {
  enabled: boolean
  timezone: string
  leadTimeMinutes: number
  maxDaysOut: number
  driveTimeMinutes: number
  selfServiceCutoffMinutes: number
  depositHoldMinutes: number
  requireAddress: boolean | null
  requirePhone: boolean
  notifyEmail: boolean
  notifySms: boolean
  heroTitle: string | null
  heroSubtitle: string | null
  confirmCta: string | null
  thanksMessage: string | null
  confirmationEmailSubject: string | null
  confirmationEmailIntro: string | null
  reviewLink: string | null
  icalFeedToken: string | null
}

export interface Person { id: string; name: string; email: string; role: string }

/** The booking settings (for the business's zone) and the team (for names) — what most booking screens need first. */
export function useBookingBasics() {
  // The team list is asked for only where the seat may read it (users:read or team:read): staff were refused it on
  // every booking screen.
  const readsUsers = useKnownPermission('users:read')
  const readsTeam = useKnownPermission('team:read')
  const mayReadPeople = readsUsers === null || readsTeam === null ? null : readsUsers || readsTeam
  const [settings, setSettings] = useState<BookingSettings | null>(null)
  const [services, setServices] = useState<Service[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [error, setError] = useState<string | null>(null)
  const reload = () => Promise.all([
    api.get('/api/booking/settings'),
    api.get('/api/booking/services'),
    mayReadPeople ? api.get('/api/company/users').catch(() => []) : Promise.resolve([]),
  ]).then(([s, sv, u]: [BookingSettings, { data: Service[] }, any]) => {
    setSettings(s)
    setServices(sv.data)
    const rows = Array.isArray(u) ? u : u?.data ?? []
    // Only seats that can do the work are bookable (people/work.ts — the server's rule too): never a view-only seat or a
    // switched-off login (landscaping live test 2026-10-22 listed the viewer as a bookable person).
    setPeople(rows.filter(mayBeGivenWork).map((p: any) => ({ id: p.id, name: [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email, email: p.email, role: p.role })))
  }).catch((e) => setError(e.message))
  // Waits until the permissions are known, so a refused read is never made.
  useEffect(() => { if (mayReadPeople !== null) reload() }, [mayReadPeople])
  return { settings, services, people, error, reload }
}

/** A formatter on the business's clock. */
export function onClock(timezone: string) {
  const f = (iso: string | Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: timezone, ...opts }).format(new Date(iso))
  const parts = (iso: string | Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
  }
  return {
    /** Tue, Nov 3 */
    day: (iso: string | Date) => f(iso, { weekday: 'short', month: 'short', day: 'numeric' }),
    /** Tuesday, November 3, 2026 */
    longDay: (iso: string | Date) => f(iso, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    /** 9:30 AM */
    time: (iso: string | Date) => f(iso, { hour: 'numeric', minute: '2-digit' }),
    /** The zone's short name: CST */
    zone: (iso: string | Date = new Date()) => f(iso, { timeZoneName: 'short' }).split(' ').pop(),
    /** YYYY-MM-DD and HH:MM on the business's clock. */
    date: (iso: string | Date) => parts(iso).date,
    hm: (iso: string | Date) => parts(iso).time,
    today: () => parts(new Date()).date,
  }
}

/** A calendar date (YYYY-MM-DD) as words, without any clock shifting it. */
export const dateWords = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => {
  const [y, m, day] = d.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(Date.UTC(y, m - 1, day)))
}
export const addDays = (d: string, n: number) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10) }
export const weekdayOf = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)).getUTCDay() }

export const STATUS_LABEL: Record<Booking['status'], string> = { pending: 'Deposit due', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show' }
const STATUS_STYLE: Record<Booking['status'], string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  confirmed: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
  completed: 'bg-green-50 text-green-800 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900',
  cancelled: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  no_show: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
}
export function StatusPill({ status }: { status: Booking['status'] }) {
  return <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
}
export const blockStyle = (status: Booking['status']) => ({
  pending: 'bg-amber-100 border-amber-300 text-amber-950 dark:bg-amber-900/50 dark:border-amber-700 dark:text-amber-100',
  confirmed: 'bg-blue-100 border-blue-300 text-blue-950 dark:bg-blue-900/50 dark:border-blue-700 dark:text-blue-100',
  completed: 'bg-green-100 border-green-300 text-green-950 dark:bg-green-900/50 dark:border-green-700 dark:text-green-100',
  cancelled: 'bg-gray-100 border-gray-300 text-gray-600 line-through dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400',
  no_show: 'bg-red-100 border-red-300 text-red-950 dark:bg-red-900/50 dark:border-red-700 dark:text-red-100',
})[status]

export const minutesWords = (m: number) => (m % 60 === 0 ? `${m / 60} hr` : m > 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`)
export const dollars = (v: string | number | null | undefined) => (v == null || v === '' ? '' : money(v, Number(v) % 1 ? 2 : 0))
