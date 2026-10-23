// Moved from templates/crm-homecare/frontend/src/components/admin/CaregiverDetail.tsx.
// Complete caregiver record: edit all info, hours, earnings, schedule, background checks. Opened in place by
// Caregivers → "Full Profile" (CaregiverManagement), as in the template.
//
// Replies read (server/crm/homecare):
//   GET   /api/caregivers/:id/summary            hr/caregivers.ts — the overview: earnings { hoursThisMonth, hoursThisWeek,
//                                                totalHours, avgShiftHours, earningsThisMonth (payroll's approved pay;
//                                                only to the person or the payroll) }, clients, recentShifts, schedule
//                                                (from today on), payRates (base-rate history; same rule). No template
//                                                server ever answered it — built in the move.
//   GET   /api/caregivers/:id                    hr/caregivers.ts — the caregiver's record (camelCase, ivrPin, profile).
//                                                The form and header read it where the summary has no profile, so
//                                                "Save" can no longer write a blank name over the caregiver's own.
//   GET   /api/background-checks/caregiver/:id   hr/backgroundChecks.ts — { data }
//   GET   /api/caregiver-profile/:id             hr/caregiverProfile.ts — the record, or 404 none_on_file
//   PUT   /api/caregivers/:id                    care-hr:update
//   PATCH /api/caregiver-profile/:id             care-hr:update — notes, capabilities, limitations, npiNumber, evvWorkerId
//   POST  /api/route-optimizer/geocode           planning/optimizer.ts (care-schedule:update) → { formattedAddress }
//   POST  /api/background-checks                 care-hr:create — status one of pending|in_progress|completed|failed
//   POST  /api/users/:id/reset-password          team:update — reads `password`
//   POST  /api/caregivers/:id/generate-ivr-pin   → { ivrPin };  DELETE /api/caregivers/:id/ivr-pin → done
//   GET   /api/caregiver-rates/:id               payroll/caregiverRates.ts → { base, overtime, premium }: each the rate ROW
//   GET   /api/caregiver-rates/:id/history       { data }: one row per rate (rateType, hourlyRate, effectiveDate)
//   PUT   /api/caregiver-rates/:id               care-payroll:update
//   GET   /api/time-entries/caregiver-history/:id   visits/timeTracking.ts — { data }: startTime, endTime, durationMinutes,
//                                                isComplete, client { firstName, lastName }
//   GET   /api/time-entries/caregiver-gps/:id    { data }: the caregiver's last 100 GPS points (timeEntryId, latitude,
//                                                longitude, accuracy, speed, timestamp) — not per visit; grouped here.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useAuth, useConfirm, useToast, usePermissions } from '../../../../shared'
import { api, errorMessage, rows } from '../lib/http'
import { useMay } from '../lib/useMay'
import { parseLocalDate, toLocalYMD } from '../lib/date'
import { formatAgencyDateTime } from '../lib/agencyClock'
import EligibilityCard, { isWisconsinAgency } from './EligibilityCard'
import { money } from '@twomiah/tenant-ui/src/money'

const fmt$ = (n: unknown) => (n != null ? money(n) : '—')
const fmtHrs = (n: unknown) => (n != null ? `${parseFloat(String(n || 0)).toFixed(2)}h` : '—')
const fmtDate = (d: unknown) => (d ? parseLocalDate(d as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Ink and ground pairs for the record's badges and panels, each with its dark value (lib/homecare.css tokens).
const TONE = {
  success: { ink: 'var(--hc-success-ink)', bg: 'var(--hc-success-bg)', line: 'var(--hc-success-line)' },
  warning: { ink: 'var(--hc-warning-ink)', bg: 'var(--hc-warning-bg)', line: 'var(--hc-warning-line)' },
  danger: { ink: 'var(--hc-danger-ink)', bg: 'var(--hc-danger-bg)', line: 'var(--hc-danger-line)' },
  info: { ink: 'var(--hc-info-ink)', bg: 'var(--hc-info-bg)', line: 'var(--hc-info-line)' },
  neutral: { ink: 'var(--hc-muted)', bg: 'var(--hc-subtle)', line: 'var(--hc-line)' },
} as const
type Tone = keyof typeof TONE

// The template's accent colours, as inks that read on the subtle ground in both themes.
const BRAND_INK = 'var(--color-teal-dark)'
const INDIGO_INK = 'var(--hc-blue-ink)'
const CYAN_INK = 'var(--hc-info-ink)'
const AMBER_INK = 'var(--hc-warning-ink)'
/** White text sits on these in both themes. */
const BRAND_FILL = 'var(--hc-brand-deep)'
const INDIGO_FILL = '#4F46E5'

const s = {
  page: { maxWidth: 960, margin: '0 auto', fontFamily: "'DM Sans', system-ui, sans-serif" } as CSSProperties,
  // A fixed dark header with white text in both themes.
  header: { background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)', borderRadius: 16, padding: '1.75rem 2rem', marginBottom: '1.25rem', color: '#fff', position: 'relative', overflow: 'hidden' } as CSSProperties,
  headerAccent: { position: 'absolute', right: -40, top: -40, width: 220, height: 220, borderRadius: '50%', background: 'rgba(42,187,167,0.12)', pointerEvents: 'none' } as CSSProperties,
  avatar: { width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, var(--hc-brand-deep), #0E7490)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 800, color: '#fff', flexShrink: 0 } as CSSProperties,
  tab: (active: boolean): CSSProperties => ({ padding: '0.55rem 1.1rem', border: 'none', background: 'none', cursor: 'pointer', fontWeight: active ? 800 : 500, fontSize: '0.85rem', color: active ? BRAND_INK : 'var(--hc-muted)', borderBottom: `2px solid ${active ? 'var(--color-teal)' : 'transparent'}`, marginBottom: -2, whiteSpace: 'nowrap', transition: 'all 0.15s' }),
  card: { background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: 14, border: '1px solid var(--hc-line)', padding: '1.25rem', marginBottom: '1rem' } as CSSProperties,
  label: { display: 'block', fontWeight: 700, fontSize: '0.75rem', color: 'var(--hc-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' } as CSSProperties,
  input: { width: '100%', padding: '0.55rem 0.75rem', border: '1px solid var(--hc-line)', borderRadius: 8, fontSize: '0.875rem', boxSizing: 'border-box', background: 'var(--hc-surface)', color: 'var(--hc-ink)', outline: 'none', transition: 'border-color 0.15s' } as CSSProperties,
  /** A filled button (white on a fill dark in both themes). */
  btn: (fill: string = BRAND_FILL): CSSProperties => ({ padding: '0.55rem 1.25rem', background: fill, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }),
  /** An outline button: its ink on the surface. */
  outline: (ink: string): CSSProperties => ({ padding: '0.55rem 1.25rem', background: 'var(--hc-surface)', color: ink, border: `2px solid ${ink}`, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }),
  statBox: (accent: string = BRAND_INK): CSSProperties => ({ padding: '1rem', background: 'var(--hc-subtle)', borderRadius: 12, borderLeft: `4px solid ${accent}`, flex: 1, minWidth: 120 }),
  badge: (tone: Tone): CSSProperties => ({ padding: '2px 10px', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, color: TONE[tone].ink, background: TONE[tone].bg }),
  panel: (tone: Tone): CSSProperties => ({ background: TONE[tone].bg, border: `1px solid ${TONE[tone].line}`, borderRadius: 10, padding: '0.875rem 1rem', fontSize: '0.82rem', color: TONE[tone].ink }),
  th: { padding: '0.4rem 0.75rem', textAlign: 'left', fontWeight: 700, color: 'var(--hc-ink)', borderBottom: '1px solid var(--hc-line)' } as CSSProperties,
  headRow: { background: 'var(--hc-subtle)' } as CSSProperties,
  row: { borderBottom: '1px solid var(--hc-subtle)' } as CSSProperties,
  empty: { color: 'var(--hc-muted)', fontSize: '0.875rem' } as CSSProperties,
}

const TABS = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'personal', label: '👤 Personal Info' },
  { id: 'schedule', label: '📅 Schedule' },
  { id: 'shifts', label: '🕐 Shifts' },
  { id: 'gpsmap', label: '🗺️ GPS Map' },
  { id: 'background', label: '🔍 Background Check' },
  { id: 'evv', label: '📍 EVV / Geofence' },
]

/** GET /api/caregivers/:id (and the summary's profile, were it there). */
interface CaregiverRecord {
  id: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  isActive?: boolean | null
  hireDate?: string | null
  defaultPayRate?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  latitude?: string | null
  longitude?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  ivrPin?: string | null
  createdAt?: string | null
  notes?: string | null
  capabilities?: string | null
  limitations?: string | null
  npiNumber?: string | null
  evvWorkerId?: string | null
  profile?: CaregiverProfileRow | null
}

/** GET /api/caregiver-profile/:id */
interface CaregiverProfileRow {
  notes?: string | null
  capabilities?: string | null
  limitations?: string | null
  npiNumber?: string | null
  evvWorkerId?: string | null
}

/** One shift, from the summary (were it there) or GET /api/time-entries/caregiver-history/:id. */
interface ShiftRow {
  id: string
  clientFirst?: string | null
  clientLast?: string | null
  startTime: string
  endTime?: string | null
  hours?: number | string | null
  isComplete?: boolean | null
  /** Not in the caregiver-history reply (the template read gps_point_count; absent there too). */
  gpsPointCount?: number | string | null
}

/** GET /api/caregivers/:id/summary. No `profile`: the record comes from GET /api/caregivers/:id. */
interface Summary {
  profile?: CaregiverRecord | null
  earnings?: { hoursThisMonth?: unknown; earningsThisMonth?: unknown; hoursThisWeek?: unknown; totalHours?: unknown; avgShiftHours?: unknown } | null
  clients?: Array<{ id: string; firstName?: string; lastName?: string; address?: string; city?: string; shiftCount?: number; totalHours?: unknown; lastVisit?: string | null }>
  recentShifts?: ShiftRow[]
  schedule?: Array<{ id: string; dayOfWeek?: number | null; date?: string | null; startTime?: string | null; endTime?: string | null; shiftHours?: unknown; clientFirst?: string; clientLast?: string; clientAddress?: string | null; clientCity?: string | null; notes?: string | null }>
  payRates?: Array<{ id: string; rate: unknown; effectiveDate?: string | null; notes?: string | null }>
}

/** GET /api/background-checks/caregiver/:id */
interface CheckRow {
  id: string
  checkType: string | null
  provider: string | null
  initiatedDate: string | null
  status: string | null
  expirationDate: string | null
  notes: string | null
}

/** A row of GET /api/caregiver-rates/:id/history (and each value of GET /api/caregiver-rates/:id). */
interface RateRow { id: string; rateType: 'base' | 'overtime' | 'premium' | string; hourlyRate: string; effectiveDate: string | null }

/** A point of GET /api/time-entries/caregiver-gps/:id. */
interface GpsPoint { id: string; timeEntryId: string | null; latitude: string; longitude: string; accuracy: number | null; speed: string | null; timestamp: string }
/** The points of one visit (by timeEntryId), oldest first. */
interface GpsVisit { id: string; points: GpsPoint[] }

/** caregiver-history's row as the shift table reads it. */
function shiftFromHistory(e: any): ShiftRow {
  return {
    id: e.id,
    clientFirst: e.client?.firstName ?? null,
    clientLast: e.client?.lastName ?? null,
    startTime: e.startTime,
    endTime: e.endTime,
    // The reply has minutes, not hours (the template read `hours`, which no reply carried).
    hours: e.durationMinutes != null ? Number(e.durationMinutes) / 60 : null,
    isComplete: e.isComplete,
  }
}

type FormState = {
  firstName: string; lastName: string; email: string; phone: string; payRate: string; address: string; city: string
  state: string; zip: string; hireDate: string; emergencyContactName: string; emergencyContactPhone: string; isActive: boolean
  notes: string; capabilities: string; limitations: string; npiNumber: string; evvWorkerId: string
}
type TextField = Exclude<keyof FormState, 'isActive'>

const EMPTY_BG = { checkType: 'criminal', provider: '', cost: '', notes: '', status: 'pending' }

interface Props {
  caregiverId: string
  onBack: () => void
}

export default function CaregiverDetail({ caregiverId, onBack }: Props) {
  // Each control for whoever the server lets use it: the record is care-hr, pay rates care-payroll, geocoding care-schedule:update, a password reset team:update (lib/useMay.ts).
  const mayHr = useMay('care-hr')
  const mayPayroll = useMay('care-payroll')
  const maySchedule = useMay('care-schedule')
  const { can } = usePermissions()
  const { company } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState<Summary | null>(null)
  const [record, setRecord] = useState<CaregiverRecord | null>(null)
  const [cgProfile, setCgProfile] = useState<CaregiverProfileRow>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [bgChecks, setBgChecks] = useState<CheckRow[]>([])

  // Edit form state
  const [form, setForm] = useState<FormState | null>(null)
  const [bgForm, setBgForm] = useState(EMPTY_BG)
  const [showBgForm, setShowBgForm] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [shiftFilter, setShiftFilter] = useState({ start: '', end: '' })
  const [allShifts, setAllShifts] = useState<ShiftRow[] | null>(null)
  const [gpsData, setGpsData] = useState<GpsVisit[] | null>(null)
  const [gpsLoading, setGpsLoading] = useState(false)
  const [selectedShift, setSelectedShift] = useState<GpsVisit | null>(null)

  // IVR PIN state
  const [ivrPin, setIvrPin] = useState<string | null>(null)
  const [ivrPinLoading, setIvrPinLoading] = useState(false)

  // Pay rates state
  const [caregiverRates, setCaregiverRates] = useState({ base: '', overtime: '', premium: '' })
  const [ratesLoaded, setRatesLoaded] = useState(false)
  const [ratesSaving, setRatesSaving] = useState(false)
  const [rateHistory, setRateHistory] = useState<RateRow[] | null>(null)
  const [showRateHistory, setShowRateHistory] = useState(false)
  const [rateHistoryLoading, setRateHistoryLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sum, bg, prof, rec] = await Promise.all([
        api.get(`/api/caregivers/${caregiverId}/summary`).catch(() => ({})) as Promise<Summary>,
        api.get(`/api/background-checks/caregiver/${caregiverId}`).catch(() => null),
        api.get(`/api/caregiver-profile/${caregiverId}`).catch(() => ({})) as Promise<CaregiverProfileRow>,
        api.get(`/api/caregivers/${caregiverId}`).catch(() => null) as Promise<CaregiverRecord | null>,
      ])
      setData(sum || {})
      setRecord(rec)
      setCgProfile(prof || {})
      setIvrPin(rec?.ivrPin || null)
      setBgChecks(rows<CheckRow>(bg))
      // Populate form from profile - merge summary profile + separate profile endpoint
      const p: CaregiverRecord = sum?.profile || rec || ({} as CaregiverRecord)
      setForm({
        firstName: p.firstName || '',
        lastName: p.lastName || '',
        email: p.email || '',
        phone: p.phone || '',
        payRate: p.defaultPayRate || '',
        address: p.address || '',
        city: p.city || '',
        state: p.state || '',
        zip: p.zip || '',
        hireDate: p.hireDate ? String(p.hireDate).split('T')[0] : '',
        emergencyContactName: p.emergencyContactName || '',
        emergencyContactPhone: p.emergencyContactPhone || '',
        isActive: p.isActive !== false,
        notes: p.notes || prof?.notes || '',
        capabilities: p.capabilities || prof?.capabilities || '',
        limitations: p.limitations || prof?.limitations || '',
        npiNumber: p.npiNumber || prof?.npiNumber || '',
        evvWorkerId: p.evvWorkerId || prof?.evvWorkerId || '',
      })
    } catch {
      toast.error('Failed to load caregiver')
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caregiverId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      await api.put(`/api/caregivers/${caregiverId}`, {
        firstName: form.firstName, lastName: form.lastName, email: form.email,
        phone: form.phone, payRate: parseFloat(form.payRate) || null,
        address: form.address, city: form.city, state: form.state, zip: form.zip,
        hireDate: form.hireDate || null,
        emergencyContactName: form.emergencyContactName,
        emergencyContactPhone: form.emergencyContactPhone,
        isActive: form.isActive,
      })
      // Also save profile notes — and the NPI and EVV worker id, which the form edits and the route reads (the
      // template sent the three notes only, so those two never saved).
      await api.patch(`/api/caregiver-profile/${caregiverId}`, {
        notes: form.notes, capabilities: form.capabilities, limitations: form.limitations,
        npiNumber: form.npiNumber, evvWorkerId: form.evvWorkerId,
      }).catch(() => undefined)
      toast.success('Saved successfully'); setEditing(false); load()
    } catch (e) {
      toast.error(errorMessage(e, 'Save failed'))
    }
    setSaving(false)
  }

  const geocodeAddress = async () => {
    if (!form?.address) { toast.error('Enter an address first'); return }
    setGeocoding(true)
    try {
      const d: { formattedAddress?: string } = await api.post('/api/route-optimizer/geocode', {
        address: form.address, city: form.city, state: form.state, zip: form.zip, entityType: 'caregiver', entityId: caregiverId,
      })
      toast.success(`📍 Geocoded: ${d.formattedAddress}`)
    } catch (e) { toast.error(errorMessage(e, 'Geocoding failed')) }
    setGeocoding(false)
  }

  const addBgCheck = async () => {
    try {
      await api.post('/api/background-checks', { caregiverId, ...bgForm })
      toast.success('Background check added'); setShowBgForm(false); setBgForm(EMPTY_BG); load()
    } catch (e) { toast.error(errorMessage(e, 'Failed')) }
  }

  const deactivate = async () => {
    if (!form) return
    if (!(await confirm(`${form.isActive ? 'Deactivate' : 'Reactivate'} this caregiver?`, { danger: form.isActive }))) return
    try {
      await api.put(`/api/caregivers/${caregiverId}`, { isActive: !form.isActive })
      toast.success(`Caregiver ${form.isActive ? 'deactivated' : 'reactivated'}`); load()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  // The route reads `password` (the template sent `newPassword`, which it never read: every reset was refused). The
  // template's prefix was the generator's {{COMPANY_SHORT}}; here, the company's name.
  const resetPassword = async () => {
    const prefix = String(company?.name || '').replace(/[^A-Za-z]/g, '').slice(0, 8) || 'Care'
    const newPwd = `${prefix}${(form?.lastName || 'X').charAt(0).toUpperCase()}${Math.random().toString(36).slice(-6)}`
    try {
      await api.post(`/api/users/${caregiverId}/reset-password`, { password: newPwd })
      toast.success(`New temp password: ${newPwd} — send to caregiver`)
    } catch (e) { toast.error(errorMessage(e, 'Password reset failed')) }
  }

  // ── IVR PIN functions ───────────────────────────────────────────────────────
  const generateIvrPin = async () => {
    setIvrPinLoading(true)
    try {
      const d: { ivrPin?: string | null } = await api.post(`/api/caregivers/${caregiverId}/generate-ivr-pin`)
      setIvrPin(d.ivrPin || null)
      toast.success('IVR PIN generated')
    } catch (e) { toast.error(errorMessage(e, 'Failed to generate PIN')) }
    setIvrPinLoading(false)
  }

  const clearIvrPin = async () => {
    if (!(await confirm("Clear this caregiver's IVR PIN? They will not be able to use phone clock-in until a new PIN is generated.", { danger: true }))) return
    setIvrPinLoading(true)
    try {
      await api.delete(`/api/caregivers/${caregiverId}/ivr-pin`)
      setIvrPin(null)
      toast.success('IVR PIN cleared')
    } catch (e) { toast.error(errorMessage(e, 'Failed to clear PIN')) }
    setIvrPinLoading(false)
  }

  // ── Pay rates functions ────────────────────────────────────────────────────
  // Each of base / overtime / premium is the rate's row (or null): its figure is hourlyRate. The template printed the
  // row itself (String(d.base)).
  const loadCaregiverRates = useCallback(async () => {
    try {
      const d: { base?: RateRow | null; overtime?: RateRow | null; premium?: RateRow | null } = await api.get(`/api/caregiver-rates/${caregiverId}`)
      setCaregiverRates({
        base: d.base?.hourlyRate != null ? String(d.base.hourlyRate) : '',
        overtime: d.overtime?.hourlyRate != null ? String(d.overtime.hourlyRate) : '',
        premium: d.premium?.hourlyRate != null ? String(d.premium.hourlyRate) : '',
      })
    } catch { /* not set, or not this reader's */ }
    setRatesLoaded(true)
  }, [caregiverId])

  const saveCaregiverRates = async () => {
    setRatesSaving(true)
    try {
      await api.put(`/api/caregiver-rates/${caregiverId}`, {
        base: caregiverRates.base ? parseFloat(caregiverRates.base) : null,
        overtime: caregiverRates.overtime ? parseFloat(caregiverRates.overtime) : null,
        premium: caregiverRates.premium ? parseFloat(caregiverRates.premium) : null,
        effectiveDate: toLocalYMD(new Date()),
      })
      toast.success('Pay rates saved')
      setRateHistory(null) // reset history so it reloads if expanded
    } catch (e) { toast.error(errorMessage(e, 'Failed to save rates')) }
    setRatesSaving(false)
  }

  const loadRateHistory = async () => {
    setRateHistoryLoading(true)
    try {
      setRateHistory(rows<RateRow>(await api.get(`/api/caregiver-rates/${caregiverId}/history`)))
    } catch { setRateHistory([]) }
    setRateHistoryLoading(false)
  }

  useEffect(() => { loadCaregiverRates() }, [loadCaregiverRates])

  // ── SHIFTS / GPS loaders ────────────────────────────────────────────────────
  const loadShifts = async () => {
    // Calendar days: the server reads them on the agency's clock, the To day included.
    const params: Record<string, string> = { limit: '100' }
    if (shiftFilter.start) params.startDate = shiftFilter.start
    if (shiftFilter.end) params.endDate = shiftFilter.end
    try {
      setAllShifts(rows(await api.get(`/api/time-entries/caregiver-history/${caregiverId}`, params)).map(shiftFromHistory))
    } catch (e) { toast.error(errorMessage(e)) }
  }

  const loadGpsData = async () => {
    setGpsLoading(true)
    try {
      const points = rows<GpsPoint>(await api.get(`/api/time-entries/caregiver-gps/${caregiverId}`, { limit: 30 }))
      // The reply is the caregiver's latest points, not visits: grouped by visit (timeEntryId), newest visit first.
      const byVisit = new Map<string, GpsPoint[]>()
      for (const p of points) {
        const key = p.timeEntryId || 'unlinked'
        if (!byVisit.has(key)) byVisit.set(key, [])
        byVisit.get(key)!.push(p)
      }
      const visits: GpsVisit[] = [...byVisit.entries()].map(([id, pts]) => ({
        id, points: [...pts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
      }))
      setGpsData(visits)
      if (visits.length > 0) setSelectedShift(visits[0])
    } catch (e) {
      console.error(e)
      setGpsData([])
    }
    setGpsLoading(false)
  }

  // Load the GPS data the first time the tab opens.
  useEffect(() => {
    if (tab === 'gpsmap' && !gpsData && !gpsLoading) loadGpsData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  if (loading) return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-muted)' }}>Loading caregiver...</div>
  if (!data || !form) return <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-red-ink)' }}>Could not load caregiver data.</div>

  const { earnings, clients, recentShifts, schedule, payRates } = data
  const profile: CaregiverRecord | null = data.profile || record
  const fullName = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim()
  const initials = `${(profile?.firstName || '')[0] || ''}${(profile?.lastName || '')[0] || ''}`.toUpperCase()
  const evvWorkerId = profile?.evvWorkerId || profile?.profile?.evvWorkerId || cgProfile.evvWorkerId || null

  const th = (labels: string[], pad = '0.4rem 0.75rem') => (
    <thead><tr style={s.headRow}>{labels.map((h) => <th key={h} style={{ ...s.th, padding: pad }}>{h}</th>)}</tr></thead>
  )

  // ── OVERVIEW ─────────────────────────────────────────────────────────────────
  const renderOverview = () => (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Hours This Month', val: fmtHrs(earnings?.hoursThisMonth), accent: BRAND_INK },
          { label: 'Approved Pay This Month', val: fmt$(earnings?.earningsThisMonth), accent: INDIGO_INK },
          { label: 'Hours This Week', val: fmtHrs(earnings?.hoursThisWeek), accent: CYAN_INK },
          { label: 'Total Hours (All Time)', val: fmtHrs(earnings?.totalHours), accent: AMBER_INK },
          { label: 'Avg Shift', val: fmtHrs(earnings?.avgShiftHours), accent: INDIGO_INK },
        ].map((s2) => (
          <div key={s2.label} style={s.statBox(s2.accent)}>
            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s2.accent }}>{s2.val}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--hc-muted)', marginTop: 2 }}>{s2.label}</div>
          </div>
        ))}
      </div>

      {/* Clients served */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, marginBottom: '0.75rem', fontSize: '0.9rem' }}>🧑‍🤝‍🧑 Clients Served ({clients?.length || 0})</div>
        {clients && clients.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '0.6rem' }}>
            {clients.map((c) => (
              <div key={c.id} style={{ padding: '0.75rem', background: 'var(--hc-subtle)', borderRadius: 10, border: '1px solid var(--hc-line)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>{c.firstName} {c.lastName}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--hc-muted)' }}>{c.address}, {c.city}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--hc-ink)', marginTop: 4 }}>
                  {c.shiftCount} shifts · {fmtHrs(c.totalHours)} · Last: {fmtDate(c.lastVisit)}
                </div>
              </div>
            ))}
          </div>
        ) : <p style={s.empty}>No completed shifts yet.</p>}
      </div>

      {/* Recent shifts */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, marginBottom: '0.75rem', fontSize: '0.9rem' }}>🕐 Recent Shifts</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          {th(['Client', 'Date', 'Start', 'End', 'Hours', 'Status'])}
          <tbody>
            {recentShifts?.map((sh) => (
              <tr key={sh.id} style={s.row}>
                <td style={{ padding: '0.4rem 0.75rem', fontWeight: 600 }}>{sh.clientFirst} {sh.clientLast}</td>
                <td style={{ padding: '0.4rem 0.75rem', color: 'var(--hc-muted)' }}>{formatAgencyDateTime(sh.startTime, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td style={{ padding: '0.4rem 0.75rem' }}>{formatAgencyDateTime(sh.startTime, { hour: 'numeric', minute: '2-digit' })}</td>
                <td style={{ padding: '0.4rem 0.75rem' }}>{sh.endTime ? formatAgencyDateTime(sh.endTime, { hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                <td style={{ padding: '0.4rem 0.75rem', fontWeight: 700 }}>{sh.hours ? fmtHrs(sh.hours) : '—'}</td>
                <td style={{ padding: '0.4rem 0.75rem' }}>
                  <span style={s.badge(sh.isComplete ? 'success' : 'warning')}>{sh.isComplete ? 'Complete' : 'Active'}</span>
                </td>
              </tr>
            ))}
            {!recentShifts?.length && <tr><td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--hc-muted)' }}>No shifts yet</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Upcoming schedule */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, marginBottom: '0.75rem', fontSize: '0.9rem' }}>📅 Upcoming Schedule ({schedule?.length || 0} shifts)</div>
        {schedule && schedule.length > 0 ? (
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {[...schedule].sort((a, b) => {
              // Sort recurring (dayOfWeek) first by day, then one-time by date
              if (a.dayOfWeek != null && b.dayOfWeek != null) return a.dayOfWeek - b.dayOfWeek
              if (a.dayOfWeek != null) return -1
              if (b.dayOfWeek != null) return 1
              return parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime()
            }).map((sc) => {
              const weekly = sc.dayOfWeek != null
              const tone = TONE[weekly ? 'info' : 'success']
              return (
                <div key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.6rem 0.75rem', background: tone.bg, borderRadius: 8, border: `1px solid ${tone.line}`, color: tone.ink }}>
                  <div style={{ fontWeight: 700, fontSize: '0.82rem', minWidth: 80 }}>
                    {weekly
                      ? <span style={{ padding: '0.15rem 0.5rem', border: `1px solid ${tone.line}`, borderRadius: 5 }}>{DAYS[sc.dayOfWeek as number]} (weekly)</span>
                      : fmtDate(sc.date)}
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{sc.startTime?.slice(0, 5)} – {sc.endTime?.slice(0, 5)}</div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>{sc.clientFirst} {sc.clientLast}</div>
                  {sc.shiftHours ? <span style={{ fontSize: '0.72rem', marginLeft: 'auto' }}>{String(sc.shiftHours)}h</span> : null}
                </div>
              )
            })}
          </div>
        ) : <p style={s.empty}>No upcoming shifts scheduled.</p>}
      </div>
    </div>
  )

  // ── PERSONAL INFO ─────────────────────────────────────────────────────────────
  // A render function, not a component made inside this one (the template's `F`): a component defined in render is a
  // new type on every keystroke, so React remounted the input and it lost focus after each letter.
  const field = (label: string, key: TextField, type = 'text'): ReactNode => (
    <div key={key}>
      <label style={s.label}>{label}</label>
      {editing ? (
        <input type={type} value={form[key] ?? ''} onChange={(e) => setForm((p) => (p ? { ...p, [key]: e.target.value } : p))} style={s.input} />
      ) : (
        <div style={{ padding: '0.55rem 0', fontSize: '0.875rem', color: form[key] ? 'var(--hc-ink)' : 'var(--hc-muted)', borderBottom: '1px solid var(--hc-subtle)' }}>
          {form[key] || '—'}
        </div>
      )}
    </div>
  )

  const textArea = (label: string, key: 'capabilities' | 'limitations', minHeight: number): ReactNode => (
    <div style={{ gridColumn: 'span 2' }}>
      <label style={s.label}>{label}</label>
      {editing
        ? <textarea value={form[key]} onChange={(e) => setForm((p) => (p ? { ...p, [key]: e.target.value } : p))} style={{ ...s.input, minHeight, resize: 'vertical' }} />
        : <div style={{ padding: '0.55rem 0', fontSize: '0.875rem', color: form[key] ? 'var(--hc-ink)' : 'var(--hc-muted)' }}>{form[key] || '—'}</div>}
    </div>
  )

  const renderPersonal = () => (
    <div>
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>Personal Information</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {editing ? (
              <>
                <button style={s.btn()} onClick={save} disabled={saving}>{saving ? 'Saving...' : '💾 Save'}</button>
                <button style={s.outline('var(--hc-muted)')} onClick={() => { setEditing(false); load() }}>Cancel</button>
              </>
            ) : (
              mayHr.update && <button style={s.btn()} onClick={() => setEditing(true)}>✏️ Edit All</button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {field('First Name', 'firstName')}
          {field('Last Name', 'lastName')}
          {field('Email Address', 'email', 'email')}
          {field('Phone', 'phone', 'tel')}
          {field('Hourly Pay Rate ($)', 'payRate', 'number')}
          {field('Hire Date', 'hireDate', 'date')}
          {field('Address', 'address')}
          {field('City', 'city')}
          {field('State', 'state')}
          {field('Zip', 'zip')}
          {field('Emergency Contact Name', 'emergencyContactName')}
          {field('Emergency Contact Phone', 'emergencyContactPhone', 'tel')}
        </div>

        {editing && maySchedule.update && (
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--hc-subtle)' }}>
            <button style={{ ...s.btn(INDIGO_FILL), marginRight: '0.5rem' }} onClick={geocodeAddress} disabled={geocoding}>
              {geocoding ? '📍 Geocoding...' : '📍 Geocode Address (for GPS clock-in)'}
            </button>
            <span style={{ fontSize: '0.78rem', color: 'var(--hc-muted)' }}>Sets GPS coordinates so geofence auto clock-in works</span>
          </div>
        )}
      </div>

      {/* Profile notes */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>Professional Details</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {field('NPI Number (billing)', 'npiNumber')}
          {field('EVV Worker ID (Sandata)', 'evvWorkerId')}
          {textArea('Capabilities / Skills', 'capabilities', 80)}
          {textArea('Limitations / Notes', 'limitations', 60)}
        </div>
      </div>

      {/* Status & account */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>Account Actions</div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {mayHr.update && <button style={s.outline(form.isActive ? 'var(--hc-red-ink)' : BRAND_INK)} onClick={deactivate}>
            {form.isActive ? '🔴 Deactivate' : '🟢 Reactivate'}
          </button>}
          {can('team:update') && <button style={s.outline(INDIGO_INK)} onClick={resetPassword}>🔑 Reset Password</button>}
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--hc-muted)', marginTop: '0.5rem' }}>
          Member since {fmtDate(profile?.createdAt)} · Hire date: {fmtDate(profile?.hireDate) || 'not set'}
        </p>
      </div>

      {/* IVR PIN Management */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>📞 IVR PIN (Phone Clock-In)</div>
        <div style={{ ...s.panel('success'), marginBottom: '1rem', padding: '0.75rem 1rem' }}>
          Caregivers use their 4-digit IVR PIN to clock in/out via phone call. This is required for telephony-based EVV compliance.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ padding: '0.875rem 1.25rem', background: ivrPin ? TONE.info.bg : 'var(--hc-subtle)', borderRadius: 10, border: `1px solid ${ivrPin ? TONE.info.line : 'var(--hc-line)'}`, minWidth: 160, textAlign: 'center' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: ivrPin ? TONE.info.ink : 'var(--hc-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Current PIN</div>
            {ivrPin ? (
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: TONE.info.ink, letterSpacing: '0.25em', fontFamily: 'monospace' }}>{ivrPin}</div>
            ) : (
              <div style={{ fontSize: '0.9rem', color: 'var(--hc-muted)', fontWeight: 600 }}>Not set</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {mayHr.update && <button style={s.btn()} onClick={generateIvrPin} disabled={ivrPinLoading}>
              {ivrPinLoading ? '...' : ivrPin ? '🔄 Regenerate PIN' : '🔑 Generate PIN'}
            </button>}
            {mayHr.update && ivrPin && (
              <button style={s.outline('var(--hc-red-ink)')} onClick={clearIvrPin} disabled={ivrPinLoading}>
                🗑️ Clear PIN
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Caregiver Pay Rates (base / overtime / premium) */}
      <div style={s.card}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>💵 Pay Rates</div>
        {!ratesLoaded ? (
          <div style={{ color: 'var(--hc-muted)', fontSize: '0.85rem' }}>Loading rates...</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              {([['base', 'Base Rate ($/hr)'], ['overtime', 'Overtime Rate ($/hr)'], ['premium', 'Premium Rate ($/hr)']] as const).map(([k, lbl]) => (
                <div key={k}>
                  <label style={s.label}>{lbl}</label>
                  <input
                    type="number" step="0.01" min="0" placeholder="Not set"
                    value={caregiverRates[k]}
                    onChange={(e) => setCaregiverRates((p) => ({ ...p, [k]: e.target.value }))}
                    disabled={!mayPayroll.update}
                    style={s.input}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
              {mayPayroll.update && <button style={s.btn()} onClick={saveCaregiverRates} disabled={ratesSaving}>
                {ratesSaving ? 'Saving...' : '💾 Save Rates'}
              </button>}
              <span style={{ fontSize: '0.78rem', color: 'var(--hc-muted)' }}>
                Current: Base {caregiverRates.base ? fmt$(caregiverRates.base) : 'N/A'} · OT {caregiverRates.overtime ? fmt$(caregiverRates.overtime) : 'N/A'} · Premium {caregiverRates.premium ? fmt$(caregiverRates.premium) : 'N/A'}
              </span>
            </div>
            {/* Rate History expandable */}
            <div style={{ borderTop: '1px solid var(--hc-subtle)', paddingTop: '0.75rem' }}>
              <button
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', color: INDIGO_INK, padding: 0 }}
                onClick={() => { setShowRateHistory((p) => !p); if (!rateHistory) loadRateHistory() }}
              >
                {showRateHistory ? '▾ Hide Rate History' : '▸ Show Rate History'}
              </button>
              {showRateHistory && (
                <div style={{ marginTop: '0.75rem' }}>
                  {rateHistoryLoading ? (
                    <div style={{ color: 'var(--hc-muted)', fontSize: '0.82rem' }}>Loading history...</div>
                  ) : rateHistory && rateHistory.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      {th(['Effective Date', 'Base', 'Overtime', 'Premium'])}
                      <tbody>
                        {/* One row per rate: its figure sits in its type's column (the template read r.base / r.overtime /
                            r.premium, which no row carries, so every cell was "—"). */}
                        {rateHistory.map((r, i) => (
                          <tr key={r.id || i} style={s.row}>
                            <td style={{ padding: '0.4rem 0.75rem', color: 'var(--hc-muted)' }}>{fmtDate(r.effectiveDate)}</td>
                            <td style={{ padding: '0.4rem 0.75rem', fontWeight: 700, color: BRAND_INK }}>{r.rateType === 'base' ? fmt$(r.hourlyRate) : '—'}</td>
                            <td style={{ padding: '0.4rem 0.75rem', fontWeight: 700, color: INDIGO_INK }}>{r.rateType === 'overtime' ? fmt$(r.hourlyRate) : '—'}</td>
                            <td style={{ padding: '0.4rem 0.75rem', fontWeight: 700, color: AMBER_INK }}>{r.rateType === 'premium' ? fmt$(r.hourlyRate) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ color: 'var(--hc-muted)', fontSize: '0.82rem' }}>No rate history found.</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Pay rate history */}
      {payRates && payRates.length > 0 && (
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '0.75rem' }}>💰 Pay Rate History</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            {th(['Rate', 'Effective Date', 'Notes'])}
            <tbody>{payRates.map((r) => (
              <tr key={r.id} style={s.row}>
                <td style={{ padding: '0.4rem 0.75rem', fontWeight: 700, color: BRAND_INK }}>{fmt$(r.rate)}</td>
                <td style={{ padding: '0.4rem 0.75rem', color: 'var(--hc-muted)' }}>{fmtDate(r.effectiveDate)}</td>
                <td style={{ padding: '0.4rem 0.75rem' }}>{r.notes || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )

  // ── SCHEDULE TAB ──────────────────────────────────────────────────────────────
  const renderSchedule = () => {
    const recurring = schedule?.filter((sc) => sc.dayOfWeek != null) || []
    const oneTime = schedule?.filter((sc) => sc.dayOfWeek == null && sc.date) || []
    const cell = { padding: '0.5rem 0.75rem' }
    return (
      <div>
        {/* Recurring schedules */}
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>🔁 Recurring Weekly Schedule ({recurring.length} shifts)</div>
          {recurring.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              {th(['Day', 'Time', 'Hours', 'Client', 'Location', 'Notes'], '0.5rem 0.75rem')}
              <tbody>
                {[...recurring].sort((a, b) => (a.dayOfWeek as number) - (b.dayOfWeek as number)).map((sc) => (
                  <tr key={sc.id} style={s.row}>
                    <td style={cell}>
                      <span style={{ padding: '0.2rem 0.6rem', borderRadius: 6, background: TONE.info.bg, color: TONE.info.ink, fontWeight: 700, fontSize: '0.82rem' }}>
                        {DAYS[sc.dayOfWeek as number]}
                      </span>
                    </td>
                    <td style={{ ...cell, fontWeight: 600 }}>{sc.startTime?.slice(0, 5)} – {sc.endTime?.slice(0, 5)}</td>
                    <td style={{ ...cell, color: 'var(--hc-green-ink)', fontWeight: 700 }}>{sc.shiftHours ? `${String(sc.shiftHours)}h` : '—'}</td>
                    <td style={{ ...cell, fontWeight: 600 }}>{sc.clientFirst} {sc.clientLast}</td>
                    <td style={{ ...cell, color: 'var(--hc-muted)', fontSize: '0.78rem' }}>{sc.clientAddress ? `${sc.clientAddress}, ${sc.clientCity || ''}` : '—'}</td>
                    <td style={cell}>{sc.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={s.empty}>No recurring schedule assigned yet.</p>}
        </div>
        {/* One-time upcoming */}
        <div style={s.card}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>📅 Upcoming One-Time Shifts ({oneTime.length})</div>
          {oneTime.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              {th(['Date', 'Day', 'Time', 'Client', 'Notes'], '0.5rem 0.75rem')}
              <tbody>
                {oneTime.map((sc) => (
                  <tr key={sc.id} style={s.row}>
                    <td style={{ ...cell, fontWeight: 600 }}>{fmtDate(sc.date)}</td>
                    <td style={{ ...cell, color: 'var(--hc-muted)' }}>{sc.date ? DAYS[parseLocalDate(sc.date).getDay()] : '—'}</td>
                    <td style={cell}>{sc.startTime?.slice(0, 5)} – {sc.endTime?.slice(0, 5)}</td>
                    <td style={{ ...cell, fontWeight: 600 }}>{sc.clientFirst} {sc.clientLast}</td>
                    <td style={cell}>{sc.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p style={s.empty}>No upcoming one-time shifts.</p>}
        </div>
      </div>
    )
  }

  // ── SHIFTS TAB ─────────────────────────────────────────────────────────────────
  const renderShifts = () => {
    const shifts: ShiftRow[] = allShifts || recentShifts || []
    const rate = parseFloat(String(profile?.defaultPayRate || 0))
    const totalHrs = shifts.filter((x) => x.isComplete).reduce((sum, x) => sum + parseFloat(String(x.hours || 0)), 0)
    const totalEarn = totalHrs * rate
    const cell = { padding: '0.5rem 0.75rem' }
    return (
      <div>
        <div style={{ ...s.card, display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={s.label}>From</label><input type="date" value={shiftFilter.start} onChange={(e) => setShiftFilter((p) => ({ ...p, start: e.target.value }))} style={{ ...s.input, width: 'auto' }} /></div>
          <div><label style={s.label}>To</label><input type="date" value={shiftFilter.end} onChange={(e) => setShiftFilter((p) => ({ ...p, end: e.target.value }))} style={{ ...s.input, width: 'auto' }} /></div>
          <button style={s.btn()} onClick={loadShifts}>Search</button>
          {allShifts && <button style={s.outline('var(--hc-muted)')} onClick={() => setAllShifts(null)}>Clear</button>}
        </div>
        {allShifts && (
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={s.statBox(BRAND_INK)}><div style={{ fontSize: '1.2rem', fontWeight: 800, color: BRAND_INK }}>{fmtHrs(totalHrs)}</div><div style={{ fontSize: '0.72rem', color: 'var(--hc-muted)' }}>Hours in Period</div></div>
            <div style={s.statBox(INDIGO_INK)}><div style={{ fontSize: '1.2rem', fontWeight: 800, color: INDIGO_INK }}>{fmt$(totalEarn)}</div><div style={{ fontSize: '0.72rem', color: 'var(--hc-muted)' }}>Est. Earnings</div></div>
            <div style={s.statBox(AMBER_INK)}><div style={{ fontSize: '1.2rem', fontWeight: 800, color: AMBER_INK }}>{shifts.length}</div><div style={{ fontSize: '0.72rem', color: 'var(--hc-muted)' }}>Total Shifts</div></div>
          </div>
        )}
        <div style={s.card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            {th(['Client', 'Date', 'Start', 'End', 'Hours', 'Est. Pay', 'GPS', 'Status'], '0.5rem 0.75rem')}
            <tbody>
              {shifts.map((sh) => (
                <tr key={sh.id} style={s.row}>
                  <td style={{ ...cell, fontWeight: 600 }}>{sh.clientFirst} {sh.clientLast}</td>
                  <td style={{ ...cell, color: 'var(--hc-muted)' }}>{formatAgencyDateTime(sh.startTime, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={cell}>{formatAgencyDateTime(sh.startTime, { hour: 'numeric', minute: '2-digit' })}</td>
                  <td style={cell}>{sh.endTime ? formatAgencyDateTime(sh.endTime, { hour: 'numeric', minute: '2-digit' }) : 'Active'}</td>
                  <td style={{ ...cell, fontWeight: 700 }}>{sh.hours ? fmtHrs(sh.hours) : '—'}</td>
                  <td style={{ ...cell, color: BRAND_INK }}>{sh.hours && rate ? fmt$(parseFloat(String(sh.hours)) * rate) : '—'}</td>
                  <td style={cell}>{parseInt(String(sh.gpsPointCount || 0)) > 0 ? `✅ ${sh.gpsPointCount} pts` : '⚠️ No GPS'}</td>
                  <td style={cell}><span style={s.badge(sh.isComplete ? 'success' : 'warning')}>{sh.isComplete ? 'Complete' : 'Active'}</span></td>
                </tr>
              ))}
              {!shifts.length && <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--hc-muted)' }}>{allShifts ? 'No shifts in this date range' : 'Showing last 10 shifts — use search to filter'}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── GPS MAP TAB ───────────────────────────────────────────────────────────────
  const renderGpsMap = () => {
    const shift = selectedShift
    const fmtTs = (ts: unknown) => (ts ? formatAgencyDateTime(ts, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
    const fmtCoord = (n: unknown) => (n != null ? parseFloat(String(n)).toFixed(5) : '—')
    const trail = shift?.points || []

    return (
      <div>
        {gpsLoading && <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>⏳ Loading GPS data...</div>}

        {gpsData && gpsData.length === 0 && (
          <div style={{ ...s.card, textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)' }}>
            No GPS data recorded yet for this caregiver.
          </div>
        )}

        {gpsData && gpsData.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1rem', alignItems: 'start' }}>
            {/* Visit list */}
            <div style={{ ...s.card, padding: '0.75rem', maxHeight: 600, overflowY: 'auto' }}>
              <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                📋 Recent Shifts ({gpsData.length})
              </div>
              {gpsData.map((sh) => {
                const on = selectedShift?.id === sh.id
                return (
                  <div key={sh.id}
                    onClick={() => setSelectedShift(sh)}
                    style={{
                      padding: '0.6rem 0.75rem', borderRadius: 8, marginBottom: '0.4rem', cursor: 'pointer',
                      background: on ? TONE.info.bg : 'var(--hc-subtle)',
                      border: `1.5px solid ${on ? TONE.info.line : 'var(--hc-line)'}`,
                    }}>
                    <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{fmtTs(sh.points[0]?.timestamp)}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--hc-muted)' }}>to {fmtTs(sh.points[sh.points.length - 1]?.timestamp)}</div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--hc-blue-ink)' }}>📍 {sh.points.length} pts</span>
                  </div>
                )
              })}
            </div>

            {/* Visit detail panel */}
            {shift && (
              <div>
                <div style={{ ...s.card, marginBottom: '0.75rem' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
                    🕐 {fmtTs(trail[0]?.timestamp)} – {fmtTs(trail[trail.length - 1]?.timestamp)}
                  </div>
                  {/* The reply carries the GPS points only: the visit's client and its clock-in / clock-out stamps are
                      not in it (the template's panel read them from fields no reply had). */}
                  <div style={{ fontSize: '0.8rem', color: 'var(--hc-muted)' }}>
                    The points recorded during this visit. Its client and the clock-in and clock-out stamps are on the visit itself (Visits &amp; EVV).
                  </div>
                </div>

                {/* GPS Trail */}
                <div style={s.card}>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                    📍 GPS Trail ({trail.length} points)
                    {trail.length > 0 && (
                      <a href={`https://www.google.com/maps/dir/${trail.map((p) => `${p.latitude},${p.longitude}`).join('/')}`}
                        target="_blank" rel="noreferrer"
                        style={{ marginLeft: '0.75rem', fontSize: '0.75rem', color: 'var(--hc-blue-ink)', fontWeight: 400, textDecoration: 'none' }}>
                        🗺️ View Full Route in Google Maps ↗
                      </a>
                    )}
                  </div>
                  {trail.length > 0 ? (
                    <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                        {th(['#', 'Time', 'Latitude', 'Longitude', 'Accuracy', 'Speed'], '0.4rem 0.6rem')}
                        <tbody>
                          {trail.map((pt, i) => (
                            <tr key={pt.id || i} style={s.row}>
                              <td style={{ padding: '0.35rem 0.6rem', color: 'var(--hc-muted)' }}>{i + 1}</td>
                              <td style={{ padding: '0.35rem 0.6rem', fontWeight: 600 }}>{fmtTs(pt.timestamp)}</td>
                              <td style={{ padding: '0.35rem 0.6rem' }}>{fmtCoord(pt.latitude)}</td>
                              <td style={{ padding: '0.35rem 0.6rem' }}>{fmtCoord(pt.longitude)}</td>
                              <td style={{ padding: '0.35rem 0.6rem', color: 'var(--hc-muted)' }}>±{pt.accuracy || '?'}m</td>
                              <td style={{ padding: '0.35rem 0.6rem', color: 'var(--hc-muted)' }}>{pt.speed != null ? `${pt.speed} mph` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--hc-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                      No continuous GPS trail recorded for this shift.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── BACKGROUND CHECKS ─────────────────────────────────────────────────────────
  const renderBackground = () => (
    <div>
      {/* Automated WI caregiver eligibility from the latest WORCS check (Wisconsin agencies) */}
      {isWisconsinAgency(company) && <EligibilityCard caregiverId={caregiverId} />}
      <div style={s.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>🔍 Background Checks</div>
          {mayHr.create && <button style={s.btn()} onClick={() => setShowBgForm((p) => !p)}>{showBgForm ? 'Cancel' : '+ New Check'}</button>}
        </div>

        {showBgForm && (
          <div style={{ background: 'var(--hc-subtle)', borderRadius: 10, padding: '1rem', marginBottom: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div><label style={s.label}>Check Type</label>
              <select value={bgForm.checkType} onChange={(e) => setBgForm((p) => ({ ...p, checkType: e.target.value }))} style={s.input}>
                <option value="criminal">Criminal Background</option>
                <option value="sex_offender">Sex Offender Registry</option>
                <option value="driving">Driving Record (MVR)</option>
                <option value="drug">Drug Screening</option>
                <option value="reference">Reference Check</option>
                <option value="oig">OIG Exclusion Check</option>
                <option value="worcs">WORCs Registry (Wisconsin)</option>
                <option value="full">Full Package</option>
              </select>
            </div>
            <div><label style={s.label}>Provider / Vendor</label>
              <input value={bgForm.provider} onChange={(e) => setBgForm((p) => ({ ...p, provider: e.target.value }))} placeholder="e.g. Checkr, Sterling" style={s.input} />
            </div>
            <div><label style={s.label}>Cost</label>
              <input type="number" value={bgForm.cost} onChange={(e) => setBgForm((p) => ({ ...p, cost: e.target.value }))} placeholder="0.00" style={s.input} />
            </div>
            <div><label style={s.label}>Status</label>
              {/* The statuses the route accepts (hr/backgroundChecks.ts CHECK_STATUSES), as Background Checks offers them.
                  The template offered clear / flagged, which the server refused ("Unknown status"); a check's result
                  (clear / flagged / disqualifying) is set with Update on the Background Checks page. */}
              <select value={bgForm.status} onChange={(e) => setBgForm((p) => ({ ...p, status: e.target.value }))} style={s.input}>
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}><label style={s.label}>Notes</label>
              <textarea value={bgForm.notes} onChange={(e) => setBgForm((p) => ({ ...p, notes: e.target.value }))} style={{ ...s.input, minHeight: 60, resize: 'vertical' }} />
            </div>
            <div style={{ gridColumn: 'span 2' }}><button style={s.btn()} onClick={addBgCheck}>Save Background Check</button></div>
          </div>
        )}

        <div style={{ ...s.panel('info'), marginBottom: '1rem' }}>
          <strong>Wisconsin Requirements:</strong> WORCs registry check required. OIG exclusion check recommended. Background checks should be renewed every 2 years per Wisconsin DHS guidelines.
        </div>

        {bgChecks.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            {th(['Type', 'Provider', 'Date', 'Status', 'Expires', 'Notes'], '0.5rem 0.75rem')}
            <tbody>
              {bgChecks.map((bg) => {
                const exp = bg.expirationDate ? parseLocalDate(bg.expirationDate) : null
                const expired = !!exp && exp < new Date()
                const expiring = !!exp && exp < new Date(Date.now() + 30 * 86400000) && !expired
                const tone: Tone = bg.status === 'completed' ? 'success' : bg.status === 'pending' || bg.status === 'in_progress' ? 'warning' : 'danger'
                const cell = { padding: '0.5rem 0.75rem' }
                return (
                  <tr key={bg.id} style={s.row}>
                    <td style={{ ...cell, fontWeight: 600, textTransform: 'capitalize' }}>{(bg.checkType || '').replace(/_/g, ' ')}</td>
                    <td style={{ ...cell, color: 'var(--hc-muted)' }}>{bg.provider || '—'}</td>
                    <td style={cell}>{fmtDate(bg.initiatedDate)}</td>
                    <td style={cell}>
                      <span style={s.badge(tone)}>{bg.status?.toUpperCase()}</span>
                    </td>
                    <td style={{ ...cell, color: expired ? 'var(--hc-red-ink)' : expiring ? AMBER_INK : 'var(--hc-ink)' }}>
                      {bg.expirationDate ? (expired ? '⛔ Expired' : expiring ? '⚠️ Expiring' : fmtDate(bg.expirationDate)) : '—'}
                    </td>
                    <td style={{ ...cell, color: 'var(--hc-muted)' }}>{bg.notes || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : <p style={s.empty}>No background checks on file. Add one above.</p>}
      </div>
    </div>
  )

  // ── EVV / GEOFENCE TAB ────────────────────────────────────────────────────────
  const renderEVV = () => (
    <div>
      <div style={s.card}>
        <div style={{ fontWeight: 800, fontSize: '0.95rem', marginBottom: '1rem' }}>📍 GPS &amp; Geofence Settings</div>
        <div style={{ ...s.panel('success'), marginBottom: '1rem' }}>
          <strong>How auto clock-in works:</strong> When the caregiver's app detects they're within the geofence radius of a client's address, the system prompts (or automatically) clocks them in. Requires: (1) client address geocoded, (2) caregiver home address geocoded, (3) caregiver phone GPS permissions enabled.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div style={{ padding: '0.875rem', background: 'var(--hc-subtle)', borderRadius: 10 }}>
            <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.25rem' }}>Caregiver Home GPS</div>
            <div style={{ fontSize: '0.875rem', color: profile?.latitude ? 'var(--hc-green-ink)' : 'var(--hc-red-ink)', fontWeight: 600 }}>
              {profile?.latitude ? `✅ Set (${parseFloat(profile.latitude).toFixed(4)}, ${parseFloat(String(profile.longitude)).toFixed(4)})` : "⚠️ Not geocoded — geofence routing won't work"}
            </div>
            {mayHr.update && maySchedule.update && !profile?.latitude && (
              <button style={{ ...s.btn(INDIGO_FILL), marginTop: '0.5rem', fontSize: '0.78rem', padding: '0.35rem 0.75rem' }} onClick={() => { setEditing(true); setTab('personal') }}>
                Go to Personal Info → Geocode Address
              </button>
            )}
          </div>
          <div style={{ padding: '0.875rem', background: 'var(--hc-subtle)', borderRadius: 10 }}>
            <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.25rem' }}>EVV Worker ID (Sandata)</div>
            <div style={{ fontSize: '0.875rem', color: evvWorkerId ? 'var(--hc-green-ink)' : AMBER_INK, fontWeight: 600 }}>
              {evvWorkerId || '⚠️ Not set — needed for Sandata EVV submission'}
            </div>
          </div>
        </div>

        <div style={s.panel('warning')}>
          <strong>To set up auto clock-in for this caregiver's clients:</strong><br />
          Go to <strong>Route Optimizer → Geofence tab</strong> → select each client → enable Auto Clock-In and set radius (default 300ft). Each client needs their address geocoded too.
        </div>
      </div>
    </div>
  )

  const active = profile?.isActive
  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerAccent} />
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, padding: '0.4rem 0.875rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, marginBottom: '1rem' }}>
          ← Back
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={s.avatar}>{initials}</div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#fff' }}>{fullName}</h2>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.75)' }}>{profile?.email}</span>
              <span style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.75)' }}>📞 {profile?.phone || '—'}</span>
              <span style={s.badge(active ? 'success' : 'neutral')}>
                {active ? '● Active' : '○ Inactive'}
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {/* Brand shade 200: the shade every owner colour reads at on this fixed dark header. */}
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'rgb(var(--brand-200))' }}>{fmt$(earnings?.earningsThisMonth)}</div>
            <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.7)' }}>Approved pay this month</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--hc-line)', marginBottom: '1.25rem', overflowX: 'auto' }}>
        {TABS.map((t) => <button key={t.id} style={s.tab(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>

      {tab === 'overview' && renderOverview()}
      {tab === 'personal' && renderPersonal()}
      {tab === 'schedule' && renderSchedule()}
      {tab === 'shifts' && renderShifts()}
      {tab === 'gpsmap' && renderGpsMap()}
      {tab === 'background' && renderBackground()}
      {tab === 'evv' && renderEVV()}
    </div>
  )
}
