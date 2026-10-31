/**
 * The caregiver's day — one place that loads it, keeps it, and does the punches (Twomiah Care).
 *
 * Mounted for every signed-in session but only ACTIVE for the home care vertical. Everything the
 * caregiver screens show comes from here, against the unified server's home care routes
 * (apps/unified/server/crm/homecare): every reply is camelCase and every list is { data, pagination }:
 *
 *   GET  /api/schedules/:me?includeMovedIn=1     schedule rows (+ exceptions) → expanded on the phone
 *   GET  /api/clients                             the caregiver's own clients (server-scoped)
 *   GET  /api/time-entries/active                 the open visit (object or null)
 *   GET  /api/sandata/caregiver-context           who is in Sandata, Medicaid IDs, the visit's EVV call
 *   POST /api/time-entries/clock-in               { clientId, latitude, longitude, offlineAt? }
 *   POST /api/time-entries/:id/clock-out          { latitude, longitude, notes, offlineAt? }
 *   POST /api/time-entries/:id/late-location      a GPS fix that arrived after the tap
 *   POST /api/time-entries/:id/gps                breadcrumbs during the visit
 *   POST /api/time-entries/check-warnings         15-minutes-left / over-time
 *   POST /api/time-entries/:id/photos             visit photos (data URI)
 *   GET  /api/time-entries/geofence/:clientId     the client's geofence radius + home location
 *   …and the counts behind the Today screen's cards (documents to sign, swaps, requests, messages,
 *   notifications, payday verification).
 *
 * Punches that never reach the server are saved on the phone (offlinePunches.ts) and sent, with the
 * tap time, when the signal is back — now, on reconnect, when the app comes to the front, and every
 * 30 seconds while any wait.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import * as Location from 'expo-location'
import { useAuth } from '../auth/AuthContext'
import { isFieldRole } from '../auth/roles'
import { useVertical } from '../vertical/VerticalContext'
import { useToast } from '../components/ToastProvider'
import { careGet, careGetRetry, carePost, punchSender, asList } from './careApi'
import { createPunchQueue, isUnreachable, newLocalId, isOfflineId, OFFLINE_PREFIX, type KV } from './offlinePunches'
import { expandVisits, type ScheduleRow, type Visit } from './schedule'
import { needsSandata, sandataAfterPunch, type SandataClient, type SandataContext } from './sandata'
import {
  clockInBlocker, clockOutNoteBlocker, geofenceVerdict, showPayday, snoozePayday, docsToSign,
  type GeofenceVerdict, type PaydayPending, type PaydaySnooze,
} from './rules'
import { formatClock, ymdOf } from './time'

export const punchQueue = createPunchQueue(AsyncStorage as unknown as KV)

/** GET /api/clients (a caregiver's own clients) — apps/unified/server/crm/homecare/clients/clients.ts. */
export interface CareClient {
  id: string
  firstName: string
  lastName: string
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  phone?: string | null
  latitude?: number | string | null
  longitude?: number | string | null
  assistanceNeeds?: string | null
  allergies?: string | null
  serviceType?: string | null
}

/** The open visit: GET /api/time-entries/active { id, clientId, startTime, clientName }, or a clock-in saved on the phone. */
export interface ActiveVisit {
  id: string
  clientId: string
  startTime: string
  clientName?: string | null
  offline?: boolean
  sandataRequired?: boolean | null
}

export interface Fix { latitude: number; longitude: number; accuracy: number | null; at: number }

export interface VisitPhoto {
  localId: string
  uri: string
  dataUri: string
  status: 'sending' | 'sent' | 'failed' | 'waiting'
}

export type SandataPrompt = { kind: 'in' | 'out'; clientId: string; clientName: string } | null

/** The answers sent with a punch (questions the agency asks at clock-in / clock-out). */
export type Answers = { questionId: string; answer: string }[]

export interface PunchResult { ok: boolean; error?: string; code?: string; queued?: boolean; message?: string }

export interface ClockInCheck {
  blocked: string | null
  openSettings?: boolean
  fix: Fix | null
  denied: boolean
  verdict: GeofenceVerdict
}

interface CareValue {
  enabled: boolean
  userId: string | null
  isCaregiver: boolean
  loading: boolean
  refreshing: boolean
  loadFailed: boolean
  visits: Visit[]
  todayVisits: Visit[]
  today: string
  clients: CareClient[]
  clientName: (id: string | null | undefined) => string
  clientById: (id: string | null | undefined) => CareClient | undefined
  sandata: SandataContext | null
  sandataClient: (id: string | null | undefined) => SandataClient | undefined
  active: ActiveVisit | null
  recent: any[]
  hoursThisWeek: number | null
  unsignedDocs: any[]
  swaps: any[]
  incomingSwaps: any[]
  clientRequests: any[]
  myRequests: any[]
  unreadMessages: number
  unreadNotifications: number
  payday: (PaydayPending & Record<string, any>) | null
  paydayVisible: boolean
  snoozePaydayNow: () => void
  paydayResolved: () => void
  pendingPunches: number
  sendSavedPunches: () => Promise<void>
  sandataPrompt: SandataPrompt
  dismissSandataPrompt: () => void
  clockingIn: boolean
  clockingOut: boolean
  reload: (opts?: { silent?: boolean }) => Promise<void>
  refreshCounts: () => Promise<void>
  warmFix: () => void
  checkClockIn: (clientId: string) => Promise<ClockInCheck>
  clockIn: (clientId: string, fix: Fix | null, answers?: Answers) => Promise<PunchResult>
  clockOut: (notes: string, answers?: Answers) => Promise<PunchResult>
  visitNote: string
  setVisitNote: (v: string) => void
  photos: VisitPhoto[]
  addPhoto: (uri: string, dataUri: string) => void
  retryPhoto: (localId: string) => void
  removePhoto: (localId: string) => void
}

const CareCtx = createContext<CareValue | null>(null)

// v2: the cached rows are the unified server's camelCase; a v1 cache (the old snake_case rows) is never read.
const CACHE_KEY = (u: string) => `twomiah_care_cache_v2_${u}`
const SNOOZE_KEY = (u: string) => `twomiah_care_payday_snooze_v1_${u}`
const NOTE_KEY = (id: string) => `twomiah_care_note_v1_${id}`
const MAX_PHOTO_CHARS = 7_000_000 // the server's limit (~5 MB once decoded)

const sleep = (ms: number) => new Promise<null>((r) => setTimeout(() => r(null), ms))

export function CareProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth()
  const { vertical } = useVertical()
  // ToastProvider hands out a new object every render; a stable wrapper keeps the effects below
  // (NetInfo listener, flush and breadcrumb intervals) from restarting on every toast.
  const toastLive = useToast()
  const toastRef = useRef(toastLive)
  toastRef.current = toastLive
  const toast = useMemo(() => ({
    success: (m: string) => toastRef.current.success(m),
    error: (m: string) => toastRef.current.error(m),
    warning: (m: string) => toastRef.current.warning(m),
    info: (m: string) => toastRef.current.info(m),
  }), [])
  const userId: string | null = (user as any)?.id || (user as any)?.userId || null
  const enabled = isAuthenticated && vertical === 'homecare' && !!userId
  // The field seat: the server stores a caregiver as 'field' (and older rows 'caregiver' / 'user').
  const isCaregiver = isFieldRole(user?.role)

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [clients, setClients] = useState<CareClient[]>([])
  const [sandata, setSandata] = useState<SandataContext | null>(null)
  const [active, setActive] = useState<ActiveVisit | null>(null)
  const [recent, setRecent] = useState<any[]>([])
  const [hoursThisWeek, setHours] = useState<number | null>(null)
  const [unsignedDocs, setDocs] = useState<any[]>([])
  const [swaps, setSwaps] = useState<any[]>([])
  const [requests, setRequests] = useState<any[]>([])
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [payday, setPayday] = useState<any>(null)
  const [snooze, setSnooze] = useState<PaydaySnooze | null>(null)
  const [pendingPunches, setPendingPunches] = useState(0)
  const [sandataPrompt, setSandataPrompt] = useState<SandataPrompt>(null)
  const [clockingIn, setClockingIn] = useState(false)
  const [clockingOut, setClockingOut] = useState(false)
  const [visitNote, setVisitNoteState] = useState('')
  const [photos, setPhotos] = useState<VisitPhoto[]>([])
  const [today, setToday] = useState(() => ymdOf(new Date()))

  const activeRef = useRef<ActiveVisit | null>(null)
  activeRef.current = active
  const fixRef = useRef<Fix | null>(null)
  const geoCache = useRef(new Map<string, any>())
  const lateFixTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const warned = useRef(new Set<string>())
  // Bumped by every clock-in / clock-out: a load that started before a punch must not overwrite
  // the open visit the punch just set (it read the server before the punch landed).
  const punchGen = useRef(0)

  // ── reset on sign-out / user change ──────────────────────────────────────────
  useEffect(() => {
    setSchedules([]); setClients([]); setSandata(null); setActive(null); setRecent([]); setHours(null)
    setDocs([]); setSwaps([]); setRequests([]); setUnreadMessages(0); setUnreadNotifications(0)
    setPayday(null); setSnooze(null); setPendingPunches(0); setSandataPrompt(null); setPhotos([]); setVisitNoteState('')
    setLoading(true)
    if (!enabled || !userId) return
    ;(async () => {
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY(userId))
        if (raw) {
          const c = JSON.parse(raw)
          // Only fills an empty screen — never overwrites a network answer that arrived first.
          if (Array.isArray(c.schedules)) setSchedules((prev) => (prev.length ? prev : c.schedules))
          if (Array.isArray(c.clients)) setClients((prev) => (prev.length ? prev : c.clients))
        }
      } catch { /* no cache yet */ }
      try {
        const s = await AsyncStorage.getItem(SNOOZE_KEY(userId))
        if (s) setSnooze(JSON.parse(s))
      } catch { /* none */ }
    })()
  }, [enabled, userId])

  const clientById = useCallback((id: string | null | undefined) => clients.find((c) => c.id === id), [clients])
  const clientName = useCallback((id: string | null | undefined) => {
    const c = clients.find((x) => x.id === id)
    if (c) return `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Client'
    const s = schedules.find((x) => x.clientId === id)
    if (s) return `${s.clientFirstName || ''} ${s.clientLastName || ''}`.trim() || 'Client'
    return 'Client'
  }, [clients, schedules])
  const sandataClient = useCallback((id: string | null | undefined) => sandata?.clients?.find((c) => c.id === id), [sandata])

  // ── counts (cheap; polled) ───────────────────────────────────────────────────
  const refreshCounts = useCallback(async () => {
    if (!enabled) return
    const [m, n] = await Promise.all([careGet('/api/messages/unread-count', 10000), careGet('/api/push/unread-count', 10000)])
    if (m.ok && typeof m.data?.count === 'number') setUnreadMessages(m.data.count)
    if (n.ok && typeof n.data?.count === 'number') setUnreadNotifications(n.data.count)
  }, [enabled])

  // ── the full load ───────────────────────────────────────────────────────────
  const reload = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!enabled || !userId) return
    if (!opts.silent) setRefreshing(true)
    setToday(ymdOf(new Date()))
    const gen = punchGen.current
    try {
      const [sch, cl, act, ctx, rec, docs, sw, vcr, hrs, pay] = await Promise.all([
        careGetRetry(`/api/schedules/${encodeURIComponent(userId)}?includeMovedIn=1`),
        careGetRetry('/api/clients'),
        careGet('/api/time-entries/active'),
        careGet('/api/sandata/caregiver-context'),
        careGet('/api/time-entries/recent?limit=20'),
        careGet(`/api/documents/unsigned/${encodeURIComponent(userId)}`),
        careGet('/api/shift-swaps'),
        careGet('/api/visit-change-requests'),
        careGet(`/api/scheduling/caregiver-hours/${encodeURIComponent(userId)}`),
        careGet('/api/payroll-verification/me/pending'),
      ])
      const nextSchedules: ScheduleRow[] | null = sch.ok ? asList<ScheduleRow>(sch.data) : null
      const nextClients: CareClient[] | null = cl.ok ? asList<CareClient>(cl.data) : null
      if (nextSchedules) setSchedules(nextSchedules)
      if (nextClients) setClients(nextClients)
      setLoadFailed(!sch.ok || !cl.ok)
      // Last good roster for a dead network: names and visit times only — no addresses, phone
      // numbers or Medicaid IDs are kept on the phone.
      if (nextSchedules || nextClients) {
        try {
          const prev = JSON.parse((await AsyncStorage.getItem(CACHE_KEY(userId))) || '{}')
          await AsyncStorage.setItem(CACHE_KEY(userId), JSON.stringify({
            schedules: nextSchedules ? nextSchedules.map(({ clientAddress: _a, clientCity: _c, ...s }) => s) : prev.schedules || [],
            clients: nextClients ? nextClients.map((c) => ({ id: c.id, firstName: c.firstName, lastName: c.lastName })) : prev.clients || [],
          }))
        } catch { /* the cache is a bonus */ }
      }

      const ctxData: SandataContext | null = ctx.ok && ctx.data && Array.isArray(ctx.data.clients) ? ctx.data : null
      if (ctx.ok) setSandata(ctxData)

      if (gen !== punchGen.current) {
        // A punch happened while this load was in flight — its own answer is the truth.
      } else if (act.ok) {
        const d = act.data
        if (d && !Array.isArray(d) && d.id) {
          const av = ctxData?.activeVisit && ctxData.activeVisit.timeEntryId === d.id ? ctxData.activeVisit.sandataRequired : undefined
          setActive((prev) => ({
            id: String(d.id), clientId: String(d.clientId), startTime: String(d.startTime), clientName: d.clientName || null,
            sandataRequired: av !== undefined ? av : prev && prev.id === d.id ? prev.sandataRequired ?? null : null,
          }))
        } else {
          // The server has no open visit. A clock-in still saved on this phone is one.
          const saved = await punchQueue.offlineSession(userId)
          setActive(saved ? { ...saved } : null)
        }
      } else {
        const saved = await punchQueue.offlineSession(userId)
        if (saved) setActive((prev) => prev || { ...saved })
      }

      if (rec.ok) setRecent(asList(rec.data))
      setDocs((prev) => docsToSign(prev, docs, () => asList(docs.data)))
      if (sw.ok) setSwaps(asList(sw.data))
      if (vcr.ok) setRequests(asList(vcr.data))
      if (hrs.ok && hrs.data?.totalHours != null) setHours(parseFloat(hrs.data.totalHours) || 0)
      if (pay.ok) setPayday(pay.data?.pending || null)
      setPendingPunches(await punchQueue.count(userId))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
    refreshCounts()
  }, [enabled, userId, refreshCounts])

  useEffect(() => { if (enabled) reload({ silent: true }) }, [enabled, reload])

  // ── send saved punches ──────────────────────────────────────────────────────
  const flushNow = useCallback(async () => {
    if (!enabled || !userId) return
    if (!(await punchQueue.count(userId))) { setPendingPunches(0); return }
    const r = await punchQueue.flush({ userId, send: punchSender })
    setPendingPunches(await punchQueue.count(userId))
    if (r.sent) toast.success(`Saved ${r.sent === 1 ? 'punch' : `${r.sent} punches`} sent to the office.`)
    if (r.rejected.length) {
      Alert.alert(
        'A saved punch was not recorded',
        r.rejected.map((x) => `Your ${x.punch.kind === 'in' ? 'clock-in' : 'clock-out'} at ${formatClock(x.punch.at)}: ${x.error}`).join('\n\n'),
      )
    }
    if (r.sent || r.rejected.length) reload({ silent: true })
  }, [enabled, userId, toast, reload])

  useEffect(() => {
    if (!enabled) return
    flushNow()
    const net = NetInfo.addEventListener((s) => { if (s.isConnected) flushNow() })
    const app = AppState.addEventListener('change', (st) => {
      if (st === 'active') { flushNow(); reload({ silent: true }) }
    })
    const iv = setInterval(() => { flushNow() }, 30000)
    const counts = setInterval(() => { if (AppState.currentState === 'active') refreshCounts() }, 90000)
    return () => { net(); app.remove(); clearInterval(iv); clearInterval(counts) }
  }, [enabled, flushNow, reload, refreshCounts])

  // ── location ────────────────────────────────────────────────────────────────
  const permission = useCallback(async (): Promise<'granted' | 'denied'> => {
    try {
      let p = await Location.getForegroundPermissionsAsync()
      if (p.status !== 'granted' && p.canAskAgain) p = await Location.requestForegroundPermissionsAsync()
      return p.status === 'granted' ? 'granted' : 'denied'
    } catch { return 'denied' }
  }, [])

  const lookup = useCallback(async (): Promise<Fix | null> => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      fixRef.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? null, at: Date.now() }
      return fixRef.current
    } catch { return null }
  }, [])

  /** Start a GPS lookup now so a fix is usually in hand by the time Clock In is tapped. */
  const warmFix = useCallback(() => {
    ;(async () => { if ((await permission()) === 'granted') lookup() })()
  }, [permission, lookup])

  /** A fix without making the caregiver wait: one already in hand, the last known, or a short lookup. */
  const getFix = useCallback(async (maxWaitMs: number): Promise<{ fix: Fix | null; denied: boolean }> => {
    if ((await permission()) !== 'granted') return { fix: null, denied: true }
    const held = fixRef.current
    if (held && Date.now() - held.at < 5 * 60 * 1000) return { fix: held, denied: false }
    try {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 500 })
      if (last) {
        fixRef.current = { latitude: last.coords.latitude, longitude: last.coords.longitude, accuracy: last.coords.accuracy ?? null, at: last.timestamp || Date.now() }
        return { fix: fixRef.current, denied: false }
      }
    } catch { /* fall through to a lookup */ }
    const fix = await Promise.race([lookup(), sleep(maxWaitMs)])
    return { fix, denied: false }
  }, [permission, lookup])

  // A clock-in/out sent without a location: keep trying quietly and stamp the entry
  // (the server only fills a MISSING location, within 15 minutes, flagged 'delayed').
  const cancelLateFix = useCallback(() => { lateFixTimers.current.forEach(clearTimeout); lateFixTimers.current = [] }, [])
  const startLateFix = useCallback((entryId: string, which: 'clock_in' | 'clock_out') => {
    cancelLateFix()
    warmFix()
    for (const delay of [15000, 60000, 180000, 420000, 780000]) {
      lateFixTimers.current.push(setTimeout(async () => {
        const f = fixRef.current && Date.now() - fixRef.current.at < 120000 ? fixRef.current : await lookup()
        if (!f) return
        cancelLateFix()
        await carePost(`/api/time-entries/${entryId}/late-location`, { latitude: f.latitude, longitude: f.longitude, which })
      }, delay))
    }
  }, [cancelLateFix, warmFix, lookup])
  useEffect(() => () => cancelLateFix(), [cancelLateFix])

  // ── during a visit: breadcrumbs + the 15-minute / over-time warnings ─────────
  useEffect(() => {
    if (!enabled || !active || isOfflineId(active.id)) return
    const id = active.id
    const tick = async () => {
      if (AppState.currentState !== 'active') return
      try {
        const p = await Location.getForegroundPermissionsAsync()
        if (p.status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
          fixRef.current = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? null, at: Date.now() }
          carePost(`/api/time-entries/${id}/gps`, {
            latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy,
            speed: loc.coords.speed, heading: loc.coords.heading,
          })
        }
      } catch { /* next tick */ }
      const w = await carePost('/api/time-entries/check-warnings', { timeEntryId: id }, 10000)
      if (w.ok && w.data?.warning) {
        if (!w.data.overTime && !warned.current.has(`${id}:15`)) {
          warned.current.add(`${id}:15`)
          toast.warning(`${w.data.minutesRemaining} min left — start wrapping up your visit.`)
        } else if (w.data.overTime) {
          const k = `${id}:over:${Math.floor(Date.now() / 600000)}`
          if (!warned.current.has(k)) { warned.current.add(k); toast.error(`You are ${w.data.minutesOver} min past the scheduled end — please clock out.`) }
        }
      }
    }
    const iv = setInterval(tick, 60000)
    return () => clearInterval(iv)
  }, [enabled, active?.id, toast])

  // ── visit note draft (kept per visit so a closed app doesn't lose it) ───────
  useEffect(() => {
    if (!active) { setVisitNoteState(''); return }
    let gone = false
    AsyncStorage.getItem(NOTE_KEY(active.id)).then((v) => { if (!gone && v != null) setVisitNoteState(v) }).catch(() => {})
    return () => { gone = true }
  }, [active?.id])
  const setVisitNote = useCallback((v: string) => {
    setVisitNoteState(v)
    const id = activeRef.current?.id
    if (id) AsyncStorage.setItem(NOTE_KEY(id), v).catch(() => {})
  }, [])

  // ── Sandata prompt after a punch ────────────────────────────────────────────
  const afterPunch = useCallback((kind: 'in' | 'out', clientId: string, sandataRequired: boolean | null | undefined) => {
    const r = sandataAfterPunch(kind, sandata?.clients?.find((c) => c.id === clientId), sandataRequired)
    if (r?.type === 'prompt') setSandataPrompt({ kind: r.kind, clientId: r.clientId, clientName: r.clientName })
    else if (r?.type === 'week_met') toast.success(`EVV hours for ${r.clientName || 'this client'} are done this week — no Sandata check-in for this visit.`)
  }, [sandata, toast])

  // ── geofence ────────────────────────────────────────────────────────────────
  const geofenceFor = useCallback(async (clientId: string) => {
    if (geoCache.current.has(clientId)) return geoCache.current.get(clientId)
    const r = await careGet(`/api/time-entries/geofence/${encodeURIComponent(clientId)}`, 8000)
    if (!r.ok) return null
    const g = {
      radiusFeet: Number(r.data?.settings?.radiusFeet) || 300,
      requireGps: r.data?.settings ? r.data.settings.requireGps !== false : false,
      lat: r.data?.client?.latitude ?? null,
      lng: r.data?.client?.longitude ?? null,
    }
    geoCache.current.set(clientId, g)
    return g
  }, [])

  const checkClockIn = useCallback(async (clientId: string): Promise<ClockInCheck> => {
    const blocked = clockInBlocker({ clientId, active: activeRef.current, busy: clockingIn, activeClientName: activeRef.current ? (activeRef.current.clientName || clientName(activeRef.current.clientId)) : null })
    if (blocked) return { blocked, fix: null, denied: false, verdict: { status: 'unknown', reason: 'no_fix' } }
    const [{ fix, denied }, geo] = await Promise.all([getFix(6000), geofenceFor(clientId)])
    const c = clients.find((x) => x.id === clientId)
    const gpsRequired = needsSandata(sandata?.clients?.find((x) => x.id === clientId)) || !!geo?.requireGps
    if (denied && gpsRequired) {
      return {
        blocked: 'Location is off for this app. This client\'s visits need your location to clock in (EVV). Turn on Location for this app in your phone\'s Settings, then try again.',
        openSettings: true, fix: null, denied: true, verdict: { status: 'unknown', reason: 'no_fix' },
      }
    }
    const verdict = geofenceVerdict({ fix, clientLat: geo?.lat ?? c?.latitude, clientLng: geo?.lng ?? c?.longitude, radiusFeet: geo?.radiusFeet })
    return { blocked: null, fix, denied, verdict }
  }, [clockingIn, clientName, getFix, geofenceFor, clients, sandata])

  // ── clock in ────────────────────────────────────────────────────────────────
  const clockIn = useCallback(async (clientId: string, fix: Fix | null, answers?: Answers): Promise<PunchResult> => {
    if (!userId) return { ok: false, error: 'Not signed in.' }
    const blocked = clockInBlocker({ clientId, active: activeRef.current, busy: clockingIn, activeClientName: activeRef.current ? (activeRef.current.clientName || clientName(activeRef.current.clientId)) : null })
    if (blocked) return { ok: false, error: blocked }
    setClockingIn(true)
    punchGen.current++
    const tapAt = new Date().toISOString() // the real clock-in time, even if the send fails
    const name = clientName(clientId)
    try {
      const res = await carePost('/api/time-entries/clock-in', { clientId, latitude: fix?.latitude ?? null, longitude: fix?.longitude ?? null, ...(answers?.length ? { answers } : {}) })
      if (isUnreachable(res.status)) {
        const localId = newLocalId()
        const saved = await punchQueue.save({ userId, localId, kind: 'in', at: tapAt, clientId, latitude: fix?.latitude ?? null, longitude: fix?.longitude ?? null, answers })
        if (!saved) return { ok: false, error: 'No signal, and this phone could not save the clock-in. Call the office with your start time.' }
        setActive({ id: `${OFFLINE_PREFIX}${localId}`, offline: true, clientId, startTime: tapAt, clientName: name })
        setPendingPunches(await punchQueue.count(userId))
        afterPunch('in', clientId, null)
        return { ok: true, queued: true, message: `No signal — clock-in saved on your phone at ${formatClock(tapAt)}. It sends by itself when you have signal.` }
      }
      if (!res.ok) return { ok: false, error: res.data?.error || res.error || 'Clock-in failed.', code: res.data?.code }
      // The new time entry (camelCase): id, clientId, startTime, sandataRequired — the server's EVV call for this visit.
      const d = res.data || {}
      setActive({
        id: String(d.id), clientId: String(d.clientId || clientId), startTime: String(d.startTime || tapAt),
        clientName: name, sandataRequired: d.sandataRequired ?? null,
      })
      afterPunch('in', clientId, d.sandataRequired)
      if (!fix && d.id) startLateFix(String(d.id), 'clock_in')
      return { ok: true, message: fix ? `Clocked in with ${name}.` : `Clocked in with ${name} — location wasn't ready; still trying in the background.` }
    } finally {
      punchGen.current++ // and again when it lands: a load started mid-punch is stale too
      setClockingIn(false)
    }
  }, [userId, clockingIn, clientName, afterPunch, startLateFix])

  // ── visit photos ────────────────────────────────────────────────────────────
  const sendPhoto = useCallback(async (entryId: string, p: VisitPhoto): Promise<boolean> => {
    setPhotos((list) => list.map((x) => (x.localId === p.localId ? { ...x, status: 'sending' } : x)))
    const r = await carePost(`/api/time-entries/${entryId}/photos`, { imageBase64: p.dataUri, category: 'visit' }, 60000)
    setPhotos((list) => list.map((x) => (x.localId === p.localId ? { ...x, status: r.ok ? 'sent' : 'failed', dataUri: r.ok ? '' : x.dataUri } : x)))
    if (!r.ok && r.status >= 400 && r.status < 500) toast.error(r.error || 'Photo was not accepted.')
    return r.ok
  }, [toast])

  const addPhoto = useCallback((uri: string, dataUri: string) => {
    if (!dataUri.startsWith('data:image')) { toast.error('That photo could not be read.'); return }
    if (dataUri.length > MAX_PHOTO_CHARS) { toast.error('That photo is too large to send. Try again a little further back.'); return }
    const a = activeRef.current
    if (!a) { toast.error('Clock in first — photos belong to a visit.'); return }
    const p: VisitPhoto = { localId: newLocalId(), uri, dataUri, status: isOfflineId(a.id) ? 'waiting' : 'sending' }
    setPhotos((list) => [...list, p])
    if (!isOfflineId(a.id)) sendPhoto(a.id, p)
  }, [toast, sendPhoto])

  const retryPhoto = useCallback((localId: string) => {
    const a = activeRef.current
    const p = photos.find((x) => x.localId === localId)
    if (!a || !p || isOfflineId(a.id) || !p.dataUri) return
    sendPhoto(a.id, p)
  }, [photos, sendPhoto])
  const removePhoto = useCallback((localId: string) => setPhotos((l) => l.filter((x) => x.localId !== localId || x.status === 'sent')), [])

  // A visit clocked in with no signal reaches the server mid-visit (the saved punch synced): the
  // open visit now has its real id. Carry the note draft over and send the photos that waited.
  const prevActive = useRef<ActiveVisit | null>(null)
  useEffect(() => {
    const prev = prevActive.current
    prevActive.current = active
    if (!prev || !active || !isOfflineId(prev.id) || isOfflineId(active.id) || prev.clientId !== active.clientId) return
    if (visitNote) AsyncStorage.setItem(NOTE_KEY(active.id), visitNote).catch(() => {})
    AsyncStorage.removeItem(NOTE_KEY(prev.id)).catch(() => {})
    for (const p of photos) if (p.status === 'waiting' && p.dataUri) sendPhoto(active.id, p)
  }, [active?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── clock out ───────────────────────────────────────────────────────────────
  const clockOut = useCallback(async (notes: string, answers?: Answers): Promise<PunchResult> => {
    const a = activeRef.current
    if (!a || !userId) return { ok: false, error: 'No open visit.' }
    const offline = isOfflineId(a.id)
    const noteBlock = clockOutNoteBlocker({ offline, note: notes })
    if (noteBlock) return { ok: false, error: noteBlock, code: 'note_required' }
    if (clockingOut) return { ok: false, error: 'Working on it — no need to tap again.' }
    setClockingOut(true)
    punchGen.current++
    cancelLateFix()
    const tapAt = new Date().toISOString()
    const clientId = a.clientId
    // Failed or waiting photos are retried at clock-out; one still sending finishes on its own.
    const unsent = photos.filter((p) => p.status === 'failed' || p.status === 'waiting')
    const finishSavedOffline = async (): Promise<PunchResult> => {
      afterPunch('out', clientId, a.sandataRequired)
      setActive(null); setPhotos([])
      AsyncStorage.removeItem(NOTE_KEY(a.id)).catch(() => {})
      setPendingPunches(await punchQueue.count(userId))
      return {
        ok: true, queued: true,
        message: `No signal — clock-out saved on your phone at ${formatClock(tapAt)}. It sends by itself when you have signal.${unsent.length ? ' Photos can\'t be saved without signal.' : ''}`,
      }
    }
    try {
      const { fix } = await getFix(2500)
      if (offline) {
        // Its clock-in is still on the phone — queue the clock-out behind it.
        const saved = await punchQueue.save({ userId, localId: newLocalId(), kind: 'out', at: tapAt, inLocalId: a.id.slice(OFFLINE_PREFIX.length), entryId: null, latitude: fix?.latitude ?? null, longitude: fix?.longitude ?? null, notes, answers })
        if (!saved) return { ok: false, error: 'This phone could not save the clock-out. Call the office with your end time.' }
        return await finishSavedOffline()
      }
      const res = await carePost(`/api/time-entries/${a.id}/clock-out`, { latitude: fix?.latitude ?? null, longitude: fix?.longitude ?? null, notes, ...(answers?.length ? { answers } : {}) })
      if (isUnreachable(res.status)) {
        const saved = await punchQueue.save({ userId, localId: newLocalId(), kind: 'out', at: tapAt, inLocalId: null, entryId: a.id, latitude: fix?.latitude ?? null, longitude: fix?.longitude ?? null, notes, answers })
        if (!saved) return { ok: false, error: 'No signal, and this phone could not save the clock-out. Call the office with your end time.' }
        return await finishSavedOffline()
      }
      if (!res.ok) return { ok: false, error: res.data?.error || res.error || 'Clock-out failed.', code: res.data?.code }
      if (!fix) startLateFix(a.id, 'clock_out')
      let failed = 0
      for (const p of unsent) if (!p.dataUri || !(await sendPhoto(a.id, p))) failed++
      const sandataRequired = res.data && res.data.sandataRequired != null ? res.data.sandataRequired : a.sandataRequired
      afterPunch('out', clientId, sandataRequired)
      setActive(null); setPhotos([])
      AsyncStorage.removeItem(NOTE_KEY(a.id)).catch(() => {})
      reload({ silent: true })
      return { ok: true, message: failed ? `Clocked out. ${failed} photo${failed === 1 ? '' : 's'} could not be uploaded.` : 'Clocked out.' }
    } finally {
      punchGen.current++
      setClockingOut(false)
    }
  }, [userId, clockingOut, photos, cancelLateFix, getFix, afterPunch, startLateFix, sendPhoto, reload])

  // ── payday verification ─────────────────────────────────────────────────────
  const snoozePaydayNow = useCallback(() => {
    if (!payday || !userId) return
    const s = snoozePayday(payday, Date.now())
    setSnooze(s)
    AsyncStorage.setItem(SNOOZE_KEY(userId), JSON.stringify(s)).catch(() => {})
  }, [payday, userId])
  const paydayResolved = useCallback(() => setPayday(null), [])

  const visits = useMemo(() => {
    const names: Record<string, string> = {}
    for (const c of clients) names[c.id] = `${c.firstName || ''} ${c.lastName || ''}`.trim()
    return expandVisits(schedules, today, 14, names)
  }, [schedules, clients, today])
  const todayVisits = useMemo(() => visits.filter((v) => v.date === today), [visits, today])

  const me = userId
  const value: CareValue = {
    enabled, userId, isCaregiver, loading, refreshing, loadFailed,
    visits, todayVisits, today,
    clients, clientName, clientById,
    sandata, sandataClient,
    active, recent, hoursThisWeek,
    unsignedDocs,
    swaps,
    incomingSwaps: swaps.filter((s) => s.targetId === me && s.status === 'pending'),
    clientRequests: requests.filter((r) => r.requestedBy === 'client'),
    myRequests: requests.filter((r) => r.requestedBy === 'caregiver'),
    unreadMessages, unreadNotifications,
    payday, paydayVisible: showPayday(payday, snooze, Date.now()), snoozePaydayNow, paydayResolved,
    pendingPunches, sendSavedPunches: flushNow,
    sandataPrompt, dismissSandataPrompt: () => setSandataPrompt(null),
    clockingIn, clockingOut,
    reload, refreshCounts, warmFix, checkClockIn, clockIn, clockOut,
    visitNote, setVisitNote,
    photos, addPhoto, retryPhoto, removePhoto,
  }

  return <CareCtx.Provider value={value}>{children}</CareCtx.Provider>
}

/** The caregiver's day. Only meaningful inside the home care vertical. */
export function useCare(): CareValue {
  const v = useContext(CareCtx)
  if (!v) throw new Error('useCare must be used inside <CareProvider>')
  return v
}

/** For shared chrome (the tab bar) that renders in every vertical. */
export const useCareOptional = () => useContext(CareCtx)
