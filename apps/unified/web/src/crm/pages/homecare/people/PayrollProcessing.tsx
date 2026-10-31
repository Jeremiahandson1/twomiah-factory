// Moved from templates/crm-homecare/frontend/src/components/admin/PayrollProcessing.tsx (/crm/payroll).
// Complete payroll: shift reviews, overtime, mileage, PTO, earnings statements, exports.
//
// Replies read (server/crm/homecare, all care-payroll:update unless noted):
//   GET  /api/company                                  shared company row + home care's fields: mileageRate (a decimal string)
//   PUT  /api/company { mileageRate }                  the shared company PUT
//   GET  /api/caregivers                               hr/caregivers.ts — every page (lib/http.ts listAll)
//   POST /api/payroll-shift-reviews/generate-shifts    → { generated, matched, missingPunch, kept }
//   GET  /api/payroll-shift-reviews/shifts             → { shifts, stats }: the review rows in camelCase (caregiverId,
//                                                      timeEntryId, shiftDate, scheduledStart/End, actualStart/End,
//                                                      scheduled/actual/payableMinutes, status, flagReason, resolutionNotes,
//                                                      caregiverFirstName …); stats by status name + total
//   PATCH /api/payroll-shift-reviews/shifts/:id; POST …/shifts/approve-all → { approved }
//   POST /api/payroll/calculate                        → { payroll: [{ caregiverId, firstName, lastName, totalHours,
//                                                      regularHours, overtimeHours, baseRate, otRate, regularPay,
//                                                      overtimePay, wagesPay, grossPay, totalMiles, mileageReimbursement,
//                                                      recordId, status }], unresolvedReviews }
//   PUT  /api/payroll/:caregiverId/approve → the record;  POST /api/payroll/:recordId/process
//   GET  /api/payroll/discrepancies                    → { discrepancies (camelCase: startTime, allottedHours, actualHours,
//                                                      billableHours, discrepancyHours, billablePay, actualPay, overageCost),
//                                                      totals } — the template read snake_case here, so every row was blank
//   POST /api/payroll/export (CSV);  GET /api/payroll/export/quickbooks (CSV)
//   POST /api/mileage (payroll/mileage.ts) reads startLocation / endLocation (the template sent fromLocation /
//        toLocation, which it never read); POST /api/pto (payroll/pto.ts) accepts type pto | vacation | sick only.
// Hours, overtime, wages and gross pay are the server's. Taken out (2026-10-19): the withholding "estimate" (flat
// federal / state / FICA rates typed into Settings — its state default, 7.65%, was the FICA rate — shown as Deductions
// and Net Pay and printed on a "Pay Stub"): withholding depends on each person's W-4 and is the payroll provider's to
// figure, so a printed stub carried invented tax lines. And the weekend / night differential boxes, which no
// calculation read. The statement prints the earnings; the provider's stub is the pay stub.
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth, useToast, usePermissions } from '../../../../shared'
import { api, downloadBlob, errorMessage, rows, saveBlob, listAll } from '../lib/http'
import { formatDate, toLocalYMD } from '../lib/date'
import { formatAgencyDateTime, agencyToday } from '../lib/agencyClock'
import PaydayVerificationSetting from './PaydayVerificationSetting'
import { useMay } from '../lib/useMay'
import { fullName, money as formatCurrency, type CaregiverRow } from './shared'

interface ShiftReview {
  id: string
  caregiverId: string
  timeEntryId: string | null
  shiftDate: string
  scheduledStart: string | null
  scheduledEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  scheduledMinutes: number | null
  actualMinutes: number | null
  payableMinutes: number | null
  status: string
  flagReason: string | null
  resolutionNotes: string | null
  /** care_payroll_rules (rows 19–20): travel to this visit, the breaks, a sleepover. */
  travelPaid?: boolean | null
  travelMinutes?: number | null
  travelMiles?: string | number | null
  mealBreakMinutes?: number | null
  mealWaived?: boolean
  restBreakMissed?: boolean
  isSleepover?: boolean
  caregiverFirstName: string | null
  caregiverLastName: string | null
  clientFirstName: string | null
  clientLastName: string | null
}
type ShiftStats = Record<string, number>

interface PayrollLine {
  caregiverId: string
  firstName: string | null
  lastName: string | null
  totalHours: number
  regularHours: number
  overtimeHours: number
  /** care_payroll_rules only; 0 / absent otherwise. Travel hours are already inside the hours above. */
  doubleTimeHours?: number
  doubleTimePay?: number
  travelHours?: number
  /** care_pickup_rewards only: open-shift pickup bonuses of worked visits, already inside wagesPay and grossPay. */
  bonusPay?: number
  bonusShifts?: number
  baseRate: number
  otRate: number
  regularPay: number
  overtimePay: number
  wagesPay: number
  grossPay: number
  totalMiles: number
  mileageReimbursement: number
  recordId: string | null
  status: string
}
/** A line of the calculation. */
interface PayrollRow extends PayrollLine {
  /** Not in the reply (the template read pto_hours / pto_pay / check_number; absent there too). */
  ptoHours?: number
  ptoPay?: number
  checkNumber?: string
}

interface Discrepancy {
  id: string
  startTime: string
  caregiverFirstName: string | null
  caregiverLastName: string | null
  clientFirstName: string | null
  clientLastName: string | null
  allottedHours: string
  actualHours: string
  billableHours: string
  discrepancyHours: string
  billablePay: string
  actualPay: string
  overageCost: string
}
interface DiscrepancyReport {
  discrepancies: Discrepancy[]
  totals?: { totalShifts: number; overageCount: number; underageCount: number; totalOverageCost: string }
}

// Each review status's ink on its ground (the frame's tokens, light and dark).
const shiftStatusConfig: Record<string, { bg: string; color: string; label: string }> = {
  pending:       { bg: 'var(--hc-subtle)', color: 'var(--hc-ink)', label: 'Pending' },
  verified:      { bg: 'var(--hc-info-bg)', color: 'var(--hc-info-ink)', label: 'Verified' },
  approved:      { bg: 'var(--hc-success-bg)', color: 'var(--hc-success-ink)', label: 'Approved' },
  flagged:       { bg: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', label: 'Flagged' },
  missing_punch: { bg: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)', label: 'Missing Punch' },
  excused:       { bg: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)', label: 'Excused' },
  manual_entry:  { bg: 'var(--hc-info-bg)', color: 'var(--hc-info-ink)', label: 'Manual Entry' },
}

const statBox = (accent: string) => ({ flex: 1, minWidth: 120, padding: '0.75rem 1rem', background: 'var(--hc-subtle)', borderRadius: 12, borderLeft: `4px solid ${accent}` })
const fieldBox = { padding: '0.5rem', border: '1px solid var(--hc-line)', borderRadius: 8, fontSize: '0.875rem', background: 'var(--hc-surface)', color: 'var(--hc-ink)' } as const
// The pay stub is a printed page: dark ink on white paper in both themes.
const PAPER = '#ffffff'
const PAPER_INK = '#111827'
const stubCell = { padding: '0.5rem', border: '1px solid #ddd' } as const
const stubNum = { ...stubCell, textAlign: 'right' } as const

export default function PayrollProcessing() {
  // Each control for whoever the server lets use it: the pay run is care-payroll:update, mileage and PTO care-payroll:create, the agency's mileage rate (PUT /api/company) owner or admin (lib/useMay.ts).
  const mayPayroll = useMay('care-payroll')
  const { isAdmin } = usePermissions()
  const { company } = useAuth()
  const toast = useToast()
  const [payPeriod, setPayPeriod] = useState({
    startDate: toLocalYMD(new Date(new Date().setDate(new Date().getDate() - 14))),
    endDate: agencyToday(),
  })
  const [payrollData, setPayrollData] = useState<PayrollRow[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPayroll, setSelectedPayroll] = useState<PayrollRow | null>(null)
  const [filter, setFilter] = useState('all')
  const [message, setMessage] = useState('')
  const [showPayStubModal, setShowPayStubModal] = useState(false)
  const [showMileageModal, setShowMileageModal] = useState(false)
  const [showPTOModal, setShowPTOModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [caregivers, setCaregivers] = useState<CaregiverRow[]>([])
  const [activeTab, setActiveTab] = useState('shifts')
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyReport | null>(null)
  const [discrepancyLoading, setDiscrepancyLoading] = useState(false)
  const [unresolvedReviews, setUnresolvedReviews] = useState(0)

  // Shift review state
  const [shiftData, setShiftData] = useState<{ shifts: ShiftReview[]; stats: ShiftStats }>({ shifts: [], stats: {} })
  const [shiftLoading, setShiftLoading] = useState(false)
  const [shiftFilter, setShiftFilter] = useState('all')
  const [caregiverFilter, setCaregiverFilter] = useState('all')
  const [showFlagModal, setShowFlagModal] = useState(false)
  const [flagShift, setFlagShift] = useState<ShiftReview | null>(null)
  const [flagReason, setFlagReason] = useState('')
  const [showResolveModal, setShowResolveModal] = useState(false)
  const [resolveShift, setResolveShift] = useState<ShiftReview | null>(null)
  const [resolveForm, setResolveForm] = useState({ status: 'manual_entry', payableMinutes: '' as string | number, resolutionNotes: '' })
  // care_payroll_rules (rows 19–20): the pay details of a visit — travel, breaks, sleepover — edited with the resolution.
  const payRulesOn = useAuth().hasFeature('care_payroll_rules')
  const [payDetail, setPayDetail] = useState({ travelPaid: '' as '' | 'yes' | 'no', travelMinutes: '' as string | number, travelMiles: '' as string | number, mealBreakMinutes: '' as string | number, mealWaived: false, restBreakMissed: false, isSleepover: false })

  // Payroll settings
  const [settings, setSettings] = useState({
    overtimeThreshold: 40,
    overtimeRate: 1.5,
    mileageRate: 0.67, // 2024 IRS rate
  })

  // Mileage form
  const [mileageForm, setMileageForm] = useState({ caregiverId: '', date: agencyToday(), miles: '', fromLocation: '', toLocation: '', notes: '' })

  // PTO form
  const [ptoForm, setPtoForm] = useState({ caregiverId: '', type: 'vacation', startDate: '', endDate: '', hours: '', notes: '' })

  // The mileage rate is the agency's (PUT /api/company { mileageRate }) — every caregiver trip is
  // paid at it. The box holds what is typed; it is checked when Settings is saved.
  const [mileageRateText, setMileageRateText] = useState('0.67')
  const [recalcTick, setRecalcTick] = useState(0)

  useEffect(() => {
    loadCaregivers()
    calculatePayroll()
    api.get('/api/company')
      .then((a: { mileageRate?: unknown } | null) => {
        const n = Number(a?.mileageRate)
        if (a && a.mileageRate != null && Number.isFinite(n)) {
          setSettings((prev) => ({ ...prev, mileageRate: n }))
          setMileageRateText(String(n))
          setRecalcTick((t) => t + 1)
        }
      })
      .catch(() => { /* the server still pays trips at the agency rate */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recalculate after the settings state has the new values (a click handler would read the old ones).
  useEffect(() => {
    if (recalcTick > 0) calculatePayroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recalcTick])

  const saveSettings = async () => {
    const s = mileageRateText.trim()
    const rate = Number(s)
    if (s === '' || !Number.isFinite(rate) || rate < 0 || rate > 5) {
      toast.error('The mileage rate must be a number from 0 to 5 dollars a mile')
      return
    }
    if (rate !== settings.mileageRate) {
      try {
        await api.put('/api/company', { mileageRate: s })
      } catch (e) {
        toast.error(errorMessage(e, 'Could not save the mileage rate'))
        return
      }
    }
    setSettings((prev) => ({ ...prev, mileageRate: rate }))
    setShowSettingsModal(false)
    setRecalcTick((t) => t + 1)
  }

  const loadCaregivers = async () => {
    try {
      setCaregivers(rows<CaregiverRow>(await listAll('/api/caregivers')))
    } catch (error) {
      console.error('Failed to load caregivers:', error)
    }
  }

  // ==================== SHIFT REVIEW ====================

  const generateShifts = async () => {
    setShiftLoading(true)
    setMessage('')
    try {
      const genResult: { generated: number; matched: number; missingPunch: number; kept?: number } =
        await api.post('/api/payroll-shift-reviews/generate-shifts', { startDate: payPeriod.startDate, endDate: payPeriod.endDate })
      await loadShifts()
      setMessage(`Generated ${genResult.generated} shift${genResult.generated === 1 ? '' : 's'} (${genResult.matched} matched, ${genResult.missingPunch} missing punch${genResult.kept ? `, ${genResult.kept} earlier decision${genResult.kept === 1 ? '' : 's'} kept` : ''})`)
      setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Failed to generate shifts'))
      console.error('Generate shifts error:', error)
    } finally {
      setShiftLoading(false)
    }
  }

  const loadShifts = async () => {
    try {
      const d: { shifts?: ShiftReview[]; stats?: ShiftStats } = await api.get('/api/payroll-shift-reviews/shifts', { startDate: payPeriod.startDate, endDate: payPeriod.endDate })
      setShiftData({ shifts: d?.shifts || [], stats: d?.stats || {} })
    } catch (e) {
      console.error('Load shifts error:', e)
    }
  }

  const handleShiftAction = async (shiftId: string, status: string, extras: Record<string, unknown> = {}) => {
    try {
      await api.patch(`/api/payroll-shift-reviews/shifts/${shiftId}`, { status, ...extras })
      await loadShifts()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error, 'Failed to update shift'))
    }
  }

  const handleBulkApproveShifts = async (mode: 'clocked' | 'all') => {
    try {
      const result: { approved?: number } = await api.post('/api/payroll-shift-reviews/shifts/approve-all', { startDate: payPeriod.startDate, endDate: payPeriod.endDate, mode })
      await loadShifts()
      const n = result.approved || 0
      setMessage(mode === 'all'
        ? `Approved ${n} shift${n === 1 ? '' : 's'}`
        : `Approved ${n} clocked shift${n === 1 ? '' : 's'}`)
      setTimeout(() => setMessage(''), 5000)
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error, 'Failed to bulk approve'))
    }
  }

  const openFlagModal = (shift: ShiftReview) => {
    setFlagShift(shift)
    setFlagReason('')
    setShowFlagModal(true)
  }

  const handleFlagShift = async (e: FormEvent) => {
    e.preventDefault()
    if (!flagShift) return
    await handleShiftAction(flagShift.id, 'flagged', { flagReason })
    setShowFlagModal(false)
    setFlagShift(null)
  }

  const openResolveModal = (shift: ShiftReview) => {
    setResolveShift(shift)
    setResolveForm({ status: 'manual_entry', payableMinutes: shift.scheduledMinutes || '', resolutionNotes: '' })
    setPayDetail({ travelPaid: shift.travelPaid == null ? '' : shift.travelPaid ? 'yes' : 'no', travelMinutes: shift.travelMinutes ?? '', travelMiles: shift.travelMiles ?? '', mealBreakMinutes: shift.mealBreakMinutes ?? '', mealWaived: !!shift.mealWaived, restBreakMissed: !!shift.restBreakMissed, isSleepover: !!shift.isSleepover })
    setShowResolveModal(true)
  }

  const handleResolveShift = async (e: FormEvent) => {
    e.preventDefault()
    if (!resolveShift) return
    await handleShiftAction(resolveShift.id, resolveForm.status, {
      payableMinutes: resolveForm.status === 'excused' ? 0 : parseInt(String(resolveForm.payableMinutes)) || 0,
      resolutionNotes: resolveForm.resolutionNotes,
      ...(payRulesOn ? {
        travelPaid: payDetail.travelPaid === '' ? null : payDetail.travelPaid === 'yes',
        travelMinutes: payDetail.travelMinutes === '' ? null : Number(payDetail.travelMinutes),
        travelMiles: payDetail.travelMiles === '' ? null : Number(payDetail.travelMiles),
        mealBreakMinutes: payDetail.mealBreakMinutes === '' ? null : Number(payDetail.mealBreakMinutes),
        mealWaived: payDetail.mealWaived, restBreakMissed: payDetail.restBreakMissed, isSleepover: payDetail.isSleepover,
      } : {}),
    })
    setShowResolveModal(false)
    setResolveShift(null)
  }

  const calculatePayroll = async () => {
    setLoading(true)
    setMessage('')
    try {
      const data: { payroll?: PayrollLine[]; unresolvedReviews?: number } = await api.post('/api/payroll/calculate', {
        startDate: payPeriod.startDate,
        endDate: payPeriod.endDate,
        otThreshold: settings.overtimeThreshold,
        otMultiplier: settings.overtimeRate,
      })

      // Hours, overtime (over 40 in each Sun–Sat week), rates and wages are the server's
      // (core/payrollPay.ts) — the same numbers the Gusto CSV and the payroll approval carry.
      const enhanced: PayrollRow[] = (data.payroll || []).map((p) => {
        const grossPay = Number(p.grossPay) || 0 // wages + mileage
        return {
          ...p,
          totalHours: Number(p.totalHours) || 0,
          regularHours: Number(p.regularHours) || 0,
          overtimeHours: Number(p.overtimeHours) || 0,
          doubleTimeHours: Number(p.doubleTimeHours) || 0,
          doubleTimePay: Number(p.doubleTimePay) || 0,
          travelHours: Number(p.travelHours) || 0,
          bonusPay: Number(p.bonusPay) || 0,
          bonusShifts: Number(p.bonusShifts) || 0,
          baseRate: Number(p.baseRate) || 0,
          otRate: Number(p.otRate) || 0,
          totalMiles: Number(p.totalMiles) || 0,
          regularPay: Number(p.regularPay) || 0,
          overtimePay: Number(p.overtimePay) || 0,
          mileageReimbursement: Number(p.mileageReimbursement) || 0,
          grossPay,
          status: p.status || 'draft',
        }
      })

      setPayrollData(enhanced)
      setUnresolvedReviews(Number(data.unresolvedReviews) || 0)
    } catch (error) {
      setMessage('Error: Failed to calculate payroll')
      console.error('Failed to calculate payroll:', error)
    } finally {
      setLoading(false)
    }
  }

  // PUT /api/payroll/:caregiverId/approve { startDate, endDate } — the server refuses while the
  // caregiver has unresolved shift reviews and says so; that message is shown, not swallowed.
  const approveOne = async (caregiverId: string): Promise<{ id: string }> =>
    api.put(`/api/payroll/${caregiverId}/approve`, { startDate: payPeriod.startDate, endDate: payPeriod.endDate })

  const handleApprovePayroll = async (caregiverId: string) => {
    try {
      const rec = await approveOne(caregiverId)
      setPayrollData((prev) => prev.map((p) => (p.caregiverId === caregiverId ? { ...p, status: 'approved', recordId: rec.id } : p)))
      setMessage('✓ Payroll approved')
      setTimeout(() => setMessage(''), 2000)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Approval failed'))
    }
  }

  const handleApproveAll = async () => {
    const drafts = payrollData.filter((p) => p.status === 'draft')
    const failed: string[] = []
    let ok = 0
    for (const p of drafts) {
      try {
        const rec = await approveOne(p.caregiverId)
        ok++
        setPayrollData((prev) => prev.map((x) => (x.caregiverId === p.caregiverId ? { ...x, status: 'approved', recordId: rec.id } : x)))
      } catch (e) { failed.push(`${p.firstName} ${p.lastName}: ${errorMessage(e, 'Approval failed')}`) }
    }
    setMessage(failed.length
      ? `Error: approved ${ok} of ${drafts.length}. ${failed.join(' · ')}`
      : `✓ Approved ${ok} payroll record${ok === 1 ? '' : 's'}`)
    setTimeout(() => setMessage(''), failed.length ? 8000 : 3000)
  }

  // POST /api/payroll/:recordId/process — the record made by the approval.
  const handleProcessPaycheck = async (payroll: PayrollRow) => {
    try {
      if (!payroll.recordId) throw new Error('Approve this payroll first')
      await api.post(`/api/payroll/${payroll.recordId}/process`)
      setPayrollData((prev) => prev.map((p) => (p.caregiverId === payroll.caregiverId ? { ...p, status: 'processed' } : p)))
      setMessage(`✓ Payroll processed for ${payroll.firstName} ${payroll.lastName}`)
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      setMessage('Error: ' + errorMessage(error, 'Processing failed'))
    }
  }

  // The template ignored the reply, so a refused trip still said "✓ Mileage recorded"; the refusal now shows.
  const handleAddMileage = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/mileage', { ...mileageForm, startLocation: mileageForm.fromLocation, endLocation: mileageForm.toLocation })
      setMileageForm({ caregiverId: '', date: agencyToday(), miles: '', fromLocation: '', toLocation: '', notes: '' })
      setShowMileageModal(false)
      setMessage('✓ Mileage recorded')
      setTimeout(() => setMessage(''), 2000)
      calculatePayroll()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  // As with mileage: a refused request now shows instead of "✓ PTO recorded". Every type offered below is one the route
  // takes (server/crm/homecare/payroll/pto.ts PTO_TYPES).
  const handleAddPTO = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/pto', ptoForm)
      setPtoForm({ caregiverId: '', type: 'vacation', startDate: '', endDate: '', hours: '', notes: '' })
      setShowPTOModal(false)
      setMessage('✓ PTO recorded')
      setTimeout(() => setMessage(''), 2000)
      calculatePayroll()
    } catch (error) {
      toast.error('Failed: ' + errorMessage(error))
    }
  }

  const handleExportPayroll = async (format: string) => {
    try {
      const res = await api.raw('/api/payroll/export', {
        method: 'POST', body: JSON.stringify({ startDate: payPeriod.startDate, endDate: payPeriod.endDate, format }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { error?: string }).error || `HTTP ${res.status}`) }
      saveBlob(await res.blob(), `payroll-${payPeriod.startDate}-to-${payPeriod.endDate}.${format}`)
    } catch (error) {
      toast.error('Failed to export: ' + errorMessage(error))
    }
  }

  const handleExportQuickBooks = async () => {
    try {
      const qs = new URLSearchParams({ startDate: payPeriod.startDate, endDate: payPeriod.endDate })
      saveBlob(await downloadBlob(`/api/payroll/export/quickbooks?${qs}`), `quickbooks-payroll-${payPeriod.startDate}-to-${payPeriod.endDate}.csv`)
      setMessage('✓ QuickBooks export downloaded')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      toast.error('Failed to export: ' + errorMessage(error))
    }
  }

  const generatePayStub = (payroll: PayrollRow) => {
    setSelectedPayroll(payroll)
    setShowPayStubModal(true)
  }

  const printPayStub = () => {
    window.print()
  }

  const personName = (first: string | null, last: string | null) => fullName({ firstName: first, lastName: last }) || '—'
  const cgName = (s: { caregiverFirstName: string | null; caregiverLastName: string | null }) => personName(s.caregiverFirstName, s.caregiverLastName)
  const clName = (s: { clientFirstName: string | null; clientLastName: string | null }) => personName(s.clientFirstName, s.clientLastName)

  // Shift computed values
  const shiftCaregivers = [...new Map(
    shiftData.shifts.map((s) => [s.caregiverId, { id: s.caregiverId, name: cgName(s) }]),
  ).values()].sort((a, b) => a.name.localeCompare(b.name))

  const filteredShifts = shiftData.shifts.filter((s) => {
    if (shiftFilter !== 'all' && s.status !== shiftFilter) return false
    if (caregiverFilter !== 'all' && s.caregiverId !== caregiverFilter) return false
    return true
  })

  const formatTime = (time: string) => (time ? time.substring(0, 5) : '--:--')
  const formatMinutes = (min: number | null) => (min != null ? `${(min / 60).toFixed(1)}h` : '--')

  const filteredPayroll = payrollData.filter((p) => filter === 'all' || p.status === filter)

  const totals = {
    totalHours: payrollData.reduce((sum, p) => sum + (p.totalHours || 0), 0),
    totalOvertimeHours: payrollData.reduce((sum, p) => sum + (p.overtimeHours || 0), 0),
    totalMiles: payrollData.reduce((sum, p) => sum + parseFloat(String(p.totalMiles || 0)), 0),
    totalGrossPay: payrollData.reduce((sum, p) => sum + (p.grossPay || 0), 0),
    totalMileageReimbursement: payrollData.reduce((sum, p) => sum + (p.mileageReimbursement || 0), 0),
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft': return 'hc-badge-secondary'
      case 'approved': return 'hc-badge-warning'
      case 'processed': return 'hc-badge-info'
      case 'paid': return 'hc-badge-success'
      default: return 'hc-badge-secondary'
    }
  }

  const loadDiscrepancies = async () => {
    setDiscrepancyLoading(true)
    try {
      setDiscrepancies(await api.get('/api/payroll/discrepancies', { startDate: payPeriod.startDate, endDate: payPeriod.endDate }))
    } catch { /* as the template: the report stays as it was */ }
    setDiscrepancyLoading(false)
  }

  const pendingBadge = (shiftData.stats.pending || 0) + (shiftData.stats.flagged || 0) + (shiftData.stats.missing_punch || 0)

  return (
    <div>
      <PaydayVerificationSetting />
      <div className="page-header">
        <h2>💰 Payroll Processing</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {mayPayroll.create && <button className="hc-btn hc-btn-primary" onClick={() => setShowMileageModal(true)}>🚗 Add Mileage</button>}
          {mayPayroll.create && <button className="hc-btn hc-btn-primary" onClick={() => setShowPTOModal(true)}>🏖️ Add PTO</button>}
          <button className="hc-btn hc-btn-secondary" onClick={() => setShowSettingsModal(true)}>⚙️ Settings</button>
          {mayPayroll.update && <button className="hc-btn hc-btn-secondary" onClick={() => handleExportPayroll('csv')}>📥 CSV</button>}
          {mayPayroll.update && <button className="hc-btn hc-btn-secondary" onClick={handleExportQuickBooks}>📤 QuickBooks</button>}
        </div>
      </div>

      {message && <div className={`alert ${message.includes('Error') ? 'alert-error' : 'alert-success'}`}>{message}</div>}

      {/* Tab selector */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--hc-line)', marginBottom: '1.25rem' }}>
        {([['shifts', '📋 Shift Reviews'], ['payroll', '💰 Payroll'], ['discrepancies', '⚠️ Hour Discrepancies']] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setActiveTab(id); if (id === 'discrepancies') loadDiscrepancies() }}
            style={{
              padding: '0.55rem 1.25rem', border: 'none', background: 'none', cursor: 'pointer',
              fontWeight: activeTab === id ? 800 : 500, fontSize: '0.875rem',
              color: activeTab === id ? 'var(--color-teal-dark)' : 'var(--hc-muted)',
              borderBottom: `2px solid ${activeTab === id ? 'var(--color-teal)' : 'transparent'}`,
              marginBottom: -2,
            }}>
            {label}
            {id === 'shifts' && pendingBadge > 0 && (
              // #DC2626 under white (4.8:1); the template's #EF4444 was 3.8:1.
              <span style={{ marginLeft: 6, background: '#DC2626', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: '0.7rem', fontWeight: 700 }}>
                {pendingBadge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ==================== SHIFT REVIEWS TAB ==================== */}
      {activeTab === 'shifts' && (
        <div>
          {/* Date pickers & Generate button */}
          <div className="hc-card">
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Pay Period Start</label>
                <input type="date" value={payPeriod.startDate} onChange={(e) => setPayPeriod({ ...payPeriod, startDate: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Pay Period End</label>
                <input type="date" value={payPeriod.endDate} onChange={(e) => setPayPeriod({ ...payPeriod, endDate: e.target.value })} />
              </div>
              {mayPayroll.update && <button className="hc-btn hc-btn-primary" onClick={generateShifts} disabled={shiftLoading}>
                {shiftLoading ? 'Generating...' : 'Generate Shifts'}
              </button>}
            </div>
          </div>

          {/* Shift Stats */}
          {shiftData.shifts.length > 0 && (
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {[
                { label: 'Total Shifts', val: shiftData.stats.total || 0, color: 'var(--hc-blue-ink)' },
                { label: 'Pending', val: shiftData.stats.pending || 0, color: 'var(--hc-muted)' },
                { label: 'Verified', val: shiftData.stats.verified || 0, color: 'var(--hc-info-ink)' },
                { label: 'Approved', val: shiftData.stats.approved || 0, color: 'var(--hc-green-ink)' },
                { label: 'Flagged', val: shiftData.stats.flagged || 0, color: 'var(--hc-red-ink)' },
                { label: 'Missing Punch', val: shiftData.stats.missing_punch || 0, color: 'var(--hc-warning-ink)' },
              ].map((s) => (
                <div key={s.label} style={statBox(s.color)}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--hc-muted)', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Shift Filters & Bulk Actions */}
          {shiftData.shifts.length > 0 && (
            <div className="hc-card" style={{ padding: '0.75rem 1rem' }}>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  {[
                    ['all', 'All'], ['pending', 'Pending'], ['verified', 'Verified'], ['approved', 'Approved'],
                    ['flagged', 'Flagged'], ['missing_punch', 'Missing Punch'], ['excused', 'Excused'], ['manual_entry', 'Manual'],
                  ].map(([val, label]) => (
                    <button key={val} className={`filter-tab ${shiftFilter === val ? 'active' : ''}`} onClick={() => setShiftFilter(val)} style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}>
                      {label}
                    </button>
                  ))}
                </div>
                <select value={caregiverFilter} onChange={(e) => setCaregiverFilter(e.target.value)}
                  style={{ ...fieldBox, padding: '0.35rem 0.5rem', borderRadius: 6, fontSize: '0.82rem' }}>
                  <option value="all">All Caregivers</option>
                  {shiftCaregivers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {mayPayroll.update && <button className="hc-btn hc-btn-sm hc-btn-success" onClick={() => handleBulkApproveShifts('clocked')}
                  disabled={!shiftData.shifts.some((s) => ['verified', 'pending'].includes(s.status) && s.timeEntryId)}>
                  Approve Clocked
                </button>}
                {mayPayroll.update && <button className="hc-btn hc-btn-sm hc-btn-warning" onClick={() => handleBulkApproveShifts('all')}
                  disabled={!shiftData.shifts.some((s) => ['verified', 'pending', 'missing_punch'].includes(s.status))}>
                  Approve All
                </button>}
              </div>
            </div>
          )}

          {/* Shift Table */}
          {shiftData.shifts.length === 0 ? (
            <div className="hc-card hc-card-centered">
              <p>No shift data. Select a pay period and click "Generate Shifts" to match schedules against clock-ins.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="hc-table" style={{ fontSize: '0.82rem' }}>
                <thead>
                  <tr>
                    <th>Caregiver</th>
                    <th>Client</th>
                    <th>Date</th>
                    <th>Sched Start</th>
                    <th>Sched End</th>
                    <th>Actual Start</th>
                    <th>Actual End</th>
                    <th>Sched Min</th>
                    <th>Actual Min</th>
                    <th>Payable</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredShifts.map((shift) => {
                    const sc = shiftStatusConfig[shift.status] || shiftStatusConfig.pending
                    return (
                      <tr key={shift.id} style={{
                        background: shift.status === 'missing_punch' || shift.status === 'flagged' ? 'var(--hc-danger-bg)'
                          : shift.status === 'approved' || shift.status === 'verified' ? 'var(--hc-success-bg)'
                            : undefined,
                      }}>
                        <td style={{ fontWeight: 600 }}>{cgName(shift)}</td>
                        <td>{clName(shift)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {formatDate(String(shift.shiftDate).split('T')[0], { weekday: 'short', month: 'short', day: 'numeric' })}
                        </td>
                        <td>{shift.scheduledStart ? formatTime(shift.scheduledStart) : '--'}</td>
                        <td>{shift.scheduledEnd ? formatTime(shift.scheduledEnd) : '--'}</td>
                        <td>
                          {shift.actualStart
                            ? formatAgencyDateTime(shift.actualStart, { hour: '2-digit', minute: '2-digit' })
                            : <span style={{ color: 'var(--hc-red-ink)' }}>--</span>}
                        </td>
                        <td>
                          {shift.actualEnd
                            ? formatAgencyDateTime(shift.actualEnd, { hour: '2-digit', minute: '2-digit' })
                            : <span style={{ color: 'var(--hc-red-ink)' }}>--</span>}
                        </td>
                        <td>{shift.scheduledMinutes != null ? formatMinutes(shift.scheduledMinutes) : '--'}</td>
                        <td>{shift.actualMinutes != null ? formatMinutes(shift.actualMinutes) : '--'}</td>
                        <td style={{ fontWeight: 700, color: 'var(--color-teal-dark)' }}>
                          {shift.payableMinutes != null ? formatMinutes(shift.payableMinutes) : '--'}
                        </td>
                        <td>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: '0.73rem', fontWeight: 700, background: sc.bg, color: sc.color, whiteSpace: 'nowrap' }}>
                            {sc.label}
                          </span>
                          {shift.flagReason && (
                            <div style={{ fontSize: '0.68rem', color: 'var(--hc-muted)', marginTop: 2, maxWidth: 140 }} title={shift.flagReason}>
                              {shift.flagReason.substring(0, 30)}{shift.flagReason.length > 30 ? '...' : ''}
                            </div>
                          )}
                          {shift.resolutionNotes && (
                            <div style={{ fontSize: '0.68rem', color: 'var(--hc-muted)', marginTop: 2, maxWidth: 140 }} title={shift.resolutionNotes}>
                              {shift.resolutionNotes.substring(0, 30)}{shift.resolutionNotes.length > 30 ? '...' : ''}
                            </div>
                          )}
                        </td>
                        <td>
                          {mayPayroll.update && <div style={{ display: 'flex', gap: '0.2rem', flexWrap: 'wrap' }}>
                            {['pending', 'verified'].includes(shift.status) && (
                              <button className="hc-btn hc-btn-sm hc-btn-success" onClick={() => handleShiftAction(shift.id, 'approved')}>Approve</button>
                            )}
                            {['pending', 'verified'].includes(shift.status) && (
                              <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => openFlagModal(shift)} style={{ fontSize: '0.7rem' }}>Flag</button>
                            )}
                            {shift.status === 'flagged' && (
                              <>
                                <button className="hc-btn hc-btn-sm hc-btn-success" onClick={() => handleShiftAction(shift.id, 'approved')}>Approve</button>
                                <button className="hc-btn hc-btn-sm hc-btn-warning" onClick={() => openResolveModal(shift)}>Resolve</button>
                              </>
                            )}
                            {shift.status === 'missing_punch' && (
                              <button className="hc-btn hc-btn-sm hc-btn-warning" onClick={() => openResolveModal(shift)}>Resolve</button>
                            )}
                          </div>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Discrepancies Tab */}
      {activeTab === 'discrepancies' && (
        <div>
          <div style={{ background: 'var(--hc-warning-bg)', border: '1px solid var(--hc-warning-line)', borderRadius: 12, padding: '1rem 1.25rem', marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--hc-warning-ink)' }}>
            <strong>📋 How payroll hours work:</strong> Caregivers are paid for <strong>allotted hours only</strong> — the hours authorized per client per shift.
            If a caregiver clocks in late, their shift end adjusts forward by the late amount so they still get their full allotted time.
            If they work over their allotted hours, only the allotted hours are billable. Punches more than 7 minutes off their allotted time (the same grace as the clock-out rule) are listed here.
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '0.75rem', color: 'var(--hc-muted)', marginBottom: 4 }}>FROM</label>
              <input type="date" value={payPeriod.startDate} onChange={(e) => setPayPeriod((p) => ({ ...p, startDate: e.target.value }))} style={fieldBox} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 700, fontSize: '0.75rem', color: 'var(--hc-muted)', marginBottom: 4 }}>TO</label>
              <input type="date" value={payPeriod.endDate} onChange={(e) => setPayPeriod((p) => ({ ...p, endDate: e.target.value }))} style={fieldBox} />
            </div>
            <button onClick={loadDiscrepancies} style={{ padding: '0.55rem 1.25rem', background: 'var(--hc-brand-deep)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
              {discrepancyLoading ? 'Loading...' : 'Run Report'}
            </button>
          </div>

          {discrepancies?.totals && (
            <>
              {/* Summary — guard on .totals: discrepancies could load without it and
                  reading discrepancies.totals.totalShifts crashed the whole tab. (C-19) */}
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                {[
                  { label: 'Shifts with Discrepancies', val: discrepancies.totals.totalShifts, color: 'var(--hc-blue-ink)' },
                  { label: 'Over Allotted', val: discrepancies.totals.overageCount + ' shifts', color: 'var(--hc-red-ink)' },
                  { label: 'Under Allotted', val: discrepancies.totals.underageCount + ' shifts', color: 'var(--hc-warning-ink)' },
                  { label: 'Total Overage Cost', val: formatCurrency(parseFloat(discrepancies.totals.totalOverageCost || '0')), color: 'var(--hc-red-ink)' },
                ].map((s) => (
                  <div key={s.label} style={{ ...statBox(s.color), minWidth: 140, padding: '1rem' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--hc-muted)', marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Table */}
              {discrepancies.discrepancies.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--hc-muted)', background: 'var(--hc-subtle)', borderRadius: 12 }}>
                  ✅ No significant discrepancies found in this period
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--hc-subtle)' }}>
                        {['Caregiver', 'Client', 'Date', 'Allotted', 'Actual', 'Billable', 'Discrepancy', 'Allotted Pay', 'Actual Cost', 'Overage $'].map((h) => (
                          <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, color: 'var(--hc-ink)', borderBottom: '1px solid var(--hc-line)', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {discrepancies.discrepancies.map((d) => {
                        const over = parseFloat(d.discrepancyHours) > 0
                        const under = parseFloat(d.discrepancyHours) < 0
                        const cell = { padding: '0.5rem 0.75rem' }
                        return (
                          <tr key={d.id} style={{ borderBottom: '1px solid var(--hc-subtle)', background: over ? 'var(--hc-danger-bg)' : under ? 'var(--hc-warning-bg)' : 'var(--hc-surface)' }}>
                            <td style={{ ...cell, fontWeight: 600 }}>{cgName(d)}</td>
                            <td style={cell}>{clName(d)}</td>
                            <td style={{ ...cell, color: 'var(--hc-muted)' }}>{formatAgencyDateTime(d.startTime, { month: 'short', day: 'numeric' })}</td>
                            <td style={cell}>{d.allottedHours}h</td>
                            <td style={cell}>{d.actualHours}h</td>
                            <td style={{ ...cell, fontWeight: 700, color: 'var(--color-teal-dark)' }}>{d.billableHours}h</td>
                            <td style={{ ...cell, fontWeight: 700, color: over ? 'var(--hc-danger-ink)' : under ? 'var(--hc-warning-ink)' : 'var(--hc-ink)' }}>
                              {over ? '+' : ''}{d.discrepancyHours}h {over ? '⚠️ Over' : under ? '⬇️ Short' : ''}
                            </td>
                            <td style={{ ...cell, color: 'var(--hc-green-ink)' }}>{formatCurrency(d.billablePay)}</td>
                            <td style={{ ...cell, color: 'var(--hc-muted)' }}>{formatCurrency(d.actualPay)}</td>
                            <td style={{ ...cell, fontWeight: 700, color: over ? 'var(--hc-danger-ink)' : 'var(--hc-muted)' }}>
                              {over ? formatCurrency(d.overageCost) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'payroll' && (
        <div>
          {/* Summary Cards */}
          <div className="grid">
            <div className="hc-stat-card">
              <h3>Total Hours</h3>
              <div className="value">{totals.totalHours.toFixed(2)}</div>
              <div className="hc-stat-subtext">{totals.totalOvertimeHours.toFixed(2)} overtime</div>
            </div>
            <div className="hc-stat-card">
              <h3>Gross Pay</h3>
              <div className="value">{formatCurrency(totals.totalGrossPay)}</div>
            </div>
            <div className="hc-stat-card">
              <h3>Mileage</h3>
              <div className="value">{totals.totalMiles.toFixed(2)} mi</div>
              <div className="hc-stat-subtext">{formatCurrency(totals.totalMileageReimbursement)} reimbursement</div>
            </div>
          </div>

          {/* Pay Period Selection */}
          <div className="hc-card">
            <h3>Pay Period</h3>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Start Date</label>
                <input type="date" value={payPeriod.startDate} onChange={(e) => setPayPeriod({ ...payPeriod, startDate: e.target.value })} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>End Date</label>
                <input type="date" value={payPeriod.endDate} onChange={(e) => setPayPeriod({ ...payPeriod, endDate: e.target.value })} />
              </div>
              {mayPayroll.update && <button className="hc-btn hc-btn-primary" onClick={calculatePayroll} disabled={loading}>{loading ? 'Calculating...' : 'Calculate'}</button>}
              {mayPayroll.update && <button className="hc-btn hc-btn-success" onClick={handleApproveAll} disabled={!payrollData.some((p) => p.status === 'draft')}>Approve All</button>}
            </div>
          </div>

          {unresolvedReviews > 0 && (
            <div className="alert alert-error" role="status">
              {unresolvedReviews} shift review{unresolvedReviews === 1 ? '' : 's'} in this period still need a decision (pending, flagged or missing punch) and {unresolvedReviews === 1 ? 'is' : 'are'} not paid yet. Resolve {unresolvedReviews === 1 ? 'it' : 'them'} on the Shift Reviews tab.
            </div>
          )}

          {/* Status Filters */}
          <div className="hc-card">
            <div className="filter-tabs">
              {['all', 'draft', 'approved', 'processed', 'paid'].map((f) => (
                <button key={f} className={`filter-tab ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  <span className="filter-count">({payrollData.filter((p) => f === 'all' || p.status === f).length})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Payroll Table */}
          {loading ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : filteredPayroll.length === 0 ? (
            <div className="hc-card hc-card-centered"><p>No approved shift hours in this period. Generate and approve shifts on the Shift Reviews tab (same dates), then Calculate.</p></div>
          ) : (
            <table className="hc-table">
              <thead>
                <tr>
                  <th>Caregiver</th>
                  <th>Regular</th>
                  <th>OT</th>
                  <th>PTO</th>
                  <th>Miles</th>
                  <th>Rate</th>
                  <th>Gross</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayroll.map((payroll) => (
                  <tr key={payroll.caregiverId}>
                    <td><strong>{payroll.firstName} {payroll.lastName}</strong></td>
                    <td>{payroll.regularHours?.toFixed(2)}</td>
                    <td style={{ color: payroll.overtimeHours > 0 ? 'var(--hc-warning-ink)' : undefined }}>
                      {payroll.overtimeHours?.toFixed(2)}
                      {(payroll.doubleTimeHours || 0) > 0 && <div style={{ fontSize: '0.75rem' }}>+ {payroll.doubleTimeHours?.toFixed(2)} double time</div>}
                      {(payroll.travelHours || 0) > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted-ink, inherit)' }}>{payroll.travelHours?.toFixed(2)} travel hrs included</div>}
                    </td>
                    <td>{payroll.ptoHours?.toFixed(2) || '0.0'}</td>
                    <td>{parseFloat(String(payroll.totalMiles || 0)).toFixed(2)}</td>
                    <td>{formatCurrency(payroll.baseRate)}</td>
                    <td style={{ color: 'var(--hc-green-ink)' }}>{formatCurrency(payroll.grossPay)}</td>
                    <td><span className={`hc-badge ${getStatusBadge(payroll.status)}`}>{payroll.status?.toUpperCase()}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => generatePayStub(payroll)}>Statement</button>
                        {mayPayroll.update && payroll.status === 'draft' && <button className="hc-btn hc-btn-sm hc-btn-warning" onClick={() => handleApprovePayroll(payroll.caregiverId)}>Approve</button>}
                        {mayPayroll.update && payroll.status === 'approved' && <button className="hc-btn hc-btn-sm hc-btn-success" onClick={() => handleProcessPaycheck(payroll)}>Process</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Totals Summary */}
          {filteredPayroll.length > 0 && (
            <div className="hc-card" style={{ marginTop: '1rem', background: 'var(--hc-subtle)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                {[
                  ['Total Hours', totals.totalHours.toFixed(2), undefined],
                  ['Overtime', totals.totalOvertimeHours.toFixed(2), 'var(--hc-warning-ink)'],
                  ['Gross Pay', formatCurrency(totals.totalGrossPay), 'var(--hc-green-ink)'],
                ].map(([label, value, color]) => (
                  <div key={label}>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--hc-muted)' }}>{label}</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '1.3rem', fontWeight: 'bold', color }}>{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* The pop-ups sit OUTSIDE the tabs: Settings, Add Mileage and Add PTO are header buttons and
          Flag / Resolve are Shift Reviews actions, so a pop-up inside the Payroll tab never opened from
          the Shift Reviews tab the page lands on (the report's "Payroll Settings does nothing"). */}
      {/* PAY STUB MODAL */}
      {showPayStubModal && selectedPayroll && (
        <div className="modal active">
          <div className="modal-content modal-large" id="pay-stub">
            <div className="modal-header">
              <h2>Earnings Statement</h2>
              <button className="close-btn" onClick={() => setShowPayStubModal(false)}>×</button>
            </div>

            {/* A printed page: dark ink on white paper in either theme. */}
            <div style={{ border: '2px solid #333', padding: '1.5rem', background: PAPER, color: PAPER_INK }}>
              {/* Company Header */}
              <div style={{ textAlign: 'center', marginBottom: '1.5rem', borderBottom: '2px solid #333', paddingBottom: '1rem' }}>
                <h2 style={{ margin: 0, color: 'color-mix(in srgb, var(--hc-primary) 45%, black)' }}>{company?.name || ''}</h2>
                <p style={{ margin: '0.25rem 0 0', color: '#555' }}>Earnings Statement</p>
              </div>

              {/* Employee & Pay Period Info */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div>
                  <p style={{ margin: 0 }}><strong>Employee:</strong> {selectedPayroll.firstName} {selectedPayroll.lastName}</p>
                  <p style={{ margin: '0.25rem 0 0' }}><strong>Employee ID:</strong> {selectedPayroll.caregiverId}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: 0 }}><strong>Pay Period:</strong> {payPeriod.startDate} to {payPeriod.endDate}</p>
                  {selectedPayroll.checkNumber && <p style={{ margin: '0.25rem 0 0' }}><strong>Check #:</strong> {selectedPayroll.checkNumber}</p>}
                </div>
              </div>

              {/* Earnings */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ borderBottom: '1px solid #333', paddingBottom: '0.25rem', marginBottom: '0.5rem' }}>Earnings</h4>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f0f0f0' }}>
                      <th style={{ ...stubCell, textAlign: 'left' }}>Description</th>
                      <th style={stubNum}>Hours</th>
                      <th style={stubNum}>Rate</th>
                      <th style={stubNum}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={stubCell}>Regular Hours</td>
                      <td style={stubNum}>{selectedPayroll.regularHours?.toFixed(2)}</td>
                      <td style={stubNum}>{formatCurrency(selectedPayroll.baseRate)}</td>
                      <td style={stubNum}>{formatCurrency(selectedPayroll.regularPay)}</td>
                    </tr>
                    {selectedPayroll.overtimeHours > 0 && (
                      <tr>
                        <td style={stubCell}>Overtime</td>
                        <td style={stubNum}>{selectedPayroll.overtimeHours?.toFixed(2)}</td>
                        <td style={stubNum}>{formatCurrency(Number(selectedPayroll.otRate || 0))}</td>
                        <td style={stubNum}>{formatCurrency(selectedPayroll.overtimePay)}</td>
                      </tr>
                    )}
                    {(selectedPayroll.doubleTimeHours || 0) > 0 && (
                      <tr>
                        <td style={stubCell}>Double time</td>
                        <td style={stubNum}>{selectedPayroll.doubleTimeHours?.toFixed(2)}</td>
                        <td style={stubNum}>{formatCurrency(selectedPayroll.baseRate * 2)}</td>
                        <td style={stubNum}>{formatCurrency(selectedPayroll.doubleTimePay || 0)}</td>
                      </tr>
                    )}
                    {(selectedPayroll.bonusPay || 0) > 0 && (
                      <tr>
                        <td style={stubCell}>Pickup bonus ({selectedPayroll.bonusShifts || 1} open shift{(selectedPayroll.bonusShifts || 1) === 1 ? '' : 's'})</td>
                        <td style={stubNum}></td>
                        <td style={stubNum}></td>
                        <td style={stubNum}>{formatCurrency(selectedPayroll.bonusPay || 0)}</td>
                      </tr>
                    )}
                    {(selectedPayroll.ptoHours || 0) > 0 && (
                      <tr>
                        <td style={stubCell}>PTO</td>
                        <td style={stubNum}>{selectedPayroll.ptoHours?.toFixed(2)}</td>
                        <td style={stubNum}>{formatCurrency(selectedPayroll.baseRate)}</td>
                        <td style={stubNum}>{formatCurrency(selectedPayroll.ptoPay)}</td>
                      </tr>
                    )}
                    {selectedPayroll.mileageReimbursement > 0 && (
                      <tr>
                        <td style={stubCell}>Mileage Reimbursement</td>
                        <td style={stubNum}>{parseFloat(String(selectedPayroll.totalMiles || 0)).toFixed(2)} mi</td>
                        <td style={stubNum}>${settings.mileageRate}/mi</td>
                        <td style={stubNum}>{formatCurrency(selectedPayroll.mileageReimbursement)}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                      <td colSpan={3} style={stubNum}>Gross Pay</td>
                      <td style={stubNum}>{formatCurrency(selectedPayroll.grossPay)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Withholding is the payroll provider's: it depends on each person's W-4. */}
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#555' }}>
                Taxes and other withholding are calculated by your payroll provider and are not shown on this statement.
              </p>
            </div>

            <div className="modal-actions">
              <button className="hc-btn hc-btn-primary" onClick={printPayStub}>🖨️ Print</button>
              <button className="hc-btn hc-btn-secondary" onClick={() => setShowPayStubModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* MILEAGE MODAL */}
      {showMileageModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>🚗 Add Mileage</h2>
              <button className="close-btn" onClick={() => setShowMileageModal(false)}>×</button>
            </div>
            <form onSubmit={handleAddMileage}>
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={mileageForm.caregiverId} onChange={(e) => setMileageForm({ ...mileageForm, caregiverId: e.target.value })} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Date *</label><input type="date" value={mileageForm.date} onChange={(e) => setMileageForm({ ...mileageForm, date: e.target.value })} required /></div>
                <div className="form-group"><label>Miles *</label><input type="number" step="0.1" min="0" value={mileageForm.miles} onChange={(e) => setMileageForm({ ...mileageForm, miles: e.target.value })} required /></div>
                <div className="form-group"><label>From</label><input type="text" value={mileageForm.fromLocation} onChange={(e) => setMileageForm({ ...mileageForm, fromLocation: e.target.value })} placeholder="Starting location" /></div>
                <div className="form-group"><label>To</label><input type="text" value={mileageForm.toLocation} onChange={(e) => setMileageForm({ ...mileageForm, toLocation: e.target.value })} placeholder="Destination" /></div>
              </div>
              <div className="form-group"><label>Notes</label><textarea value={mileageForm.notes} onChange={(e) => setMileageForm({ ...mileageForm, notes: e.target.value })} rows={2} /></div>
              <p className="text-muted">Paid at the agency rate: ${settings.mileageRate}/mile</p>
              <div className="modal-actions">
                <button type="submit" className="hc-btn hc-btn-primary">Add Mileage</button>
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowMileageModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PTO MODAL */}
      {showPTOModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>🏖️ Add PTO / Time Off</h2>
              <button className="close-btn" onClick={() => setShowPTOModal(false)}>×</button>
            </div>
            <form onSubmit={handleAddPTO}>
              <div className="form-group">
                <label>Caregiver *</label>
                <select value={ptoForm.caregiverId} onChange={(e) => setPtoForm({ ...ptoForm, caregiverId: e.target.value })} required>
                  <option value="">Select caregiver...</option>
                  {caregivers.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Type *</label>
                <select value={ptoForm.type} onChange={(e) => setPtoForm({ ...ptoForm, type: e.target.value })}>
                  <option value="vacation">Vacation</option>
                  <option value="sick">Sick Leave</option>
                  <option value="personal">Personal Day</option>
                  <option value="bereavement">Bereavement</option>
                  <option value="jury_duty">Jury Duty</option>
                  <option value="unpaid">Unpaid Leave</option>
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Start Date *</label><input type="date" value={ptoForm.startDate} onChange={(e) => setPtoForm({ ...ptoForm, startDate: e.target.value })} required /></div>
                <div className="form-group"><label>End Date *</label><input type="date" value={ptoForm.endDate} onChange={(e) => setPtoForm({ ...ptoForm, endDate: e.target.value })} required /></div>
              </div>
              <div className="form-group"><label>Hours *</label><input type="number" step="0.5" min="0" value={ptoForm.hours} onChange={(e) => setPtoForm({ ...ptoForm, hours: e.target.value })} required /></div>
              <div className="form-group"><label>Notes</label><textarea value={ptoForm.notes} onChange={(e) => setPtoForm({ ...ptoForm, notes: e.target.value })} rows={2} /></div>
              <div className="modal-actions">
                <button type="submit" className="hc-btn hc-btn-primary">Add PTO</button>
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowPTOModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SETTINGS MODAL */}
      {showSettingsModal && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>⚙️ Payroll Settings</h2>
              <button className="close-btn" onClick={() => setShowSettingsModal(false)}>×</button>
            </div>

            <div className="form-section">
              <h3>Overtime Rules</h3>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Weekly OT Threshold (hours)</label>
                  <input type="number" value={settings.overtimeThreshold} onChange={(e) => setSettings({ ...settings, overtimeThreshold: parseFloat(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>OT Rate Multiplier</label>
                  <input type="number" step="0.1" value={settings.overtimeRate} onChange={(e) => setSettings({ ...settings, overtimeRate: parseFloat(e.target.value) })} />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>Mileage</h3>
              <div className="form-group">
                <label>Mileage Rate ($/mile)</label>
                <input type="number" step="0.01" value={mileageRateText} onChange={(e) => setMileageRateText(e.target.value)} disabled={!isAdmin} />
                <small className="text-muted">The agency's rate: every caregiver's mileage is paid at it. (2024 IRS standard rate is $0.67/mile.)</small>
              </div>
            </div>

            <div className="modal-actions">
              <button className="hc-btn hc-btn-primary" onClick={saveSettings}>Save &amp; Recalculate</button>
              <button className="hc-btn hc-btn-secondary" onClick={() => { setMileageRateText(String(settings.mileageRate)); setShowSettingsModal(false) }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* FLAG SHIFT MODAL */}
      {showFlagModal && flagShift && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>🚩 Flag Shift</h2>
              <button className="close-btn" onClick={() => setShowFlagModal(false)}>×</button>
            </div>
            <form onSubmit={handleFlagShift}>
              <p style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--hc-ink)' }}>
                <strong>{cgName(flagShift)}</strong> — {clName(flagShift)}
              </p>
              <div className="form-group">
                <label>Flag Reason *</label>
                <textarea value={flagReason} onChange={(e) => setFlagReason(e.target.value)} rows={3} required placeholder="Describe the issue with this shift..." />
              </div>
              <div className="modal-actions">
                <button type="submit" className="hc-btn hc-btn-primary">Flag Shift</button>
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowFlagModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESOLVE SHIFT MODAL */}
      {showResolveModal && resolveShift && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>🔧 Resolve Shift</h2>
              <button className="close-btn" onClick={() => setShowResolveModal(false)}>×</button>
            </div>
            <form onSubmit={handleResolveShift}>
              <p style={{ marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--hc-ink)' }}>
                <strong>{cgName(resolveShift)}</strong> — {clName(resolveShift)}
                <br />
                <span style={{ color: 'var(--hc-muted)', fontSize: '0.8rem' }}>
                  Scheduled: {resolveShift.scheduledMinutes != null ? formatMinutes(resolveShift.scheduledMinutes) : 'N/A'}
                  {resolveShift.actualMinutes != null && ` | Actual: ${formatMinutes(resolveShift.actualMinutes)}`}
                </span>
              </p>
              <div className="form-group">
                <label>Resolution Status *</label>
                <select value={resolveForm.status} onChange={(e) => setResolveForm({ ...resolveForm, status: e.target.value })}>
                  <option value="manual_entry">Manual Entry</option>
                  <option value="approved">Approved</option>
                  <option value="excused">Excused (0 payable)</option>
                </select>
              </div>
              {resolveForm.status !== 'excused' && (
                <div className="form-group">
                  <label>Payable Minutes *</label>
                  <input type="number" min="0" value={resolveForm.payableMinutes} onChange={(e) => setResolveForm({ ...resolveForm, payableMinutes: e.target.value })} required />
                </div>
              )}
              <div className="form-group">
                <label>Resolution Notes</label>
                <textarea value={resolveForm.resolutionNotes} onChange={(e) => setResolveForm({ ...resolveForm, resolutionNotes: e.target.value })} rows={3} placeholder="Explain the resolution..." />
              </div>
              {payRulesOn && (
                <fieldset className="form-group" style={{ border: '1px solid var(--hc-line)', borderRadius: 8, padding: '0.5rem' }}>
                  <legend style={{ fontSize: '0.8rem' }}>Pay details (Pay rules)</legend>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <label>Travel to this visit paid<br /><select value={payDetail.travelPaid} onChange={(e) => setPayDetail({ ...payDetail, travelPaid: e.target.value as '' | 'yes' | 'no' })}><option value="">By the agency's rule</option><option value="yes">Yes</option><option value="no">No</option></select></label>
                    <label>Travel minutes (blank = estimate)<br /><input type="number" min="0" max="240" value={payDetail.travelMinutes} onChange={(e) => setPayDetail({ ...payDetail, travelMinutes: e.target.value })} /></label>
                    <label>Travel miles<br /><input type="number" min="0" step="0.1" value={payDetail.travelMiles} onChange={(e) => setPayDetail({ ...payDetail, travelMiles: e.target.value })} /></label>
                    <label>Meal break taken (minutes)<br /><input type="number" min="0" max="240" value={payDetail.mealBreakMinutes} onChange={(e) => setPayDetail({ ...payDetail, mealBreakMinutes: e.target.value })} /></label>
                    <label><input type="checkbox" checked={payDetail.mealWaived} onChange={(e) => setPayDetail({ ...payDetail, mealWaived: e.target.checked })} /> Meal break waived in writing</label>
                    <label><input type="checkbox" checked={payDetail.restBreakMissed} onChange={(e) => setPayDetail({ ...payDetail, restBreakMissed: e.target.checked })} /> A rest break was missed</label>
                    <label><input type="checkbox" checked={payDetail.isSleepover} onChange={(e) => setPayDetail({ ...payDetail, isSleepover: e.target.checked })} /> Sleepover (payable minutes are the awake time)</label>
                  </div>
                </fieldset>
              )}
              <div className="modal-actions">
                <button type="submit" className="hc-btn hc-btn-primary">Resolve</button>
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowResolveModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
