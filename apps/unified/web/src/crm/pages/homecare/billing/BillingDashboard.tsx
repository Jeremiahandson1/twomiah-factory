// Billing & Invoicing: visit invoices (review-then-generate, manual, picked visits, batch, "Create Due Invoices" and the
// billing schedule), A/R aging, authorizations, payments, payer contract rates, the invoice view with its print layout,
// and the exports. Moved from templates/crm-homecare/frontend/src/components/admin/BillingDashboard.tsx.
//
// Server: /api/billing/* (server/crm/homecare/billing/invoices.ts; rows from server/data/homecareBillingRoutes.ts, the
// generator's lines and review rows from core/invoiceEngine.ts — all camelCase), /api/authorizations
// (billing/authorizations.ts: rows carry payerId, authNumber, client {firstName, lastName}, payer {name}),
// /api/stripe/create-payment-link (billing/stripe.ts: { paymentLink }), and the pickers' /api/clients, /api/users,
// /api/referral-sources, /api/care-types (lists). Lists are { data, pagination }; a refusal arrives as an Error whose
// message is the server's sentence (the no-rate refusal carries its fix in that sentence).
//
// The printed invoice's agency block was the template's per-tenant placeholders ({{COMPANY_NAME}} …, filled when the
// tenant's code was generated); it reads the signed-in company (useAuth().company) here.
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useAuth, useConfirm, useToast } from '../../../../shared'
import { api, rows, errorMessage, downloadBlob, saveBlob, listAll } from '../lib/http'
import { useMay } from '../lib/useMay'
// Why a cancelled visit was not billed (schedule_exceptions.cancel_reason) — the one label list.
import { cancelReasonLabel } from '../lib/cancelReasons'
import { toLocalYMD, parseLocalDate } from '../lib/date'
import { formatAgencyDate, agencyWall, agencyToday } from '../lib/agencyClock'
import { money as formatMoney } from '@twomiah/tenant-ui/src/money'

type Num = string | number | null | undefined

// Helper to parse date without timezone shift
const parseDate = (dateStr: string | null | undefined): Date | null => {
  if (!dateStr) return null
  // If it's just a date (YYYY-MM-DD), parse as local time
  if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateStr.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  // If it includes time, also handle it as local
  if (typeof dateStr === 'string' && dateStr.includes('T')) {
    const [datePart] = dateStr.split('T')
    const [year, month, day] = datePart.split('-').map(Number)
    return new Date(year, month - 1, day)
  }
  return parseLocalDate(dateStr)
}

// Format a calendar day for display
const formatDate = (dateStr: string | null | undefined, options: Intl.DateTimeFormatOptions = {}) => {
  const date = parseDate(dateStr)
  if (!date || isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', options)
}

// Generate time options in 15-minute increments
const generateTimeOptions = () => {
  const options: { value: string; label: string }[] = []
  for (let hour = 0; hour < 24; hour++) {
    for (let min = 0; min < 60; min += 15) {
      const h = hour.toString().padStart(2, '0')
      const m = min.toString().padStart(2, '0')
      const value = `${h}:${m}`
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
      const ampm = hour < 12 ? 'AM' : 'PM'
      options.push({ value, label: `${displayHour}:${m.padStart(2, '0')} ${ampm}` })
    }
  }
  return options
}

const TIME_OPTIONS = generateTimeOptions()
// The review tables' rows set their own ground AND ink, resting and hovered, in light and dark. The shared
// .hc-table tr:hover paints the brand colour, on which this ink is unreadable.
const REVIEW_ROW = 'bg-white text-gray-900 hover:!bg-gray-100 dark:bg-slate-800 dark:text-slate-100 dark:hover:!bg-slate-700'

interface LineItem {
  id?: string; description: string | null; hours: Num; rate: Num; rateType?: string | null; amount: Num
  serviceDate: string | null; startTime: string | null; endTime: string | null; caregiverId: string | null
  caregiverFirstName?: string | null; caregiverLastName?: string | null; timeEntryId?: string | null
  billedBasis?: string | null; scheduledMinutes?: number | null; clockedMinutes?: number | null
  timeRange?: string | null; visitNote?: string | null; visitTasks?: unknown
}

// A visit bills two lines (aide + homemaking); its care note prints once, on the first of them. Returns null for a
// missing/blank line so it never matches.
const visitNoteKey = (item: LineItem | undefined) =>
  item && item.serviceDate && item.startTime
    ? `${String(item.serviceDate).slice(0, 10)}|${item.startTime}|${item.caregiverId}`
    : null

// "10:30:00" → "10:30 AM" (schedule times are plain clock times, not instants)
const hhmm12 = (t: string | null | undefined) => {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ampm}`
}

// A line's quantity × rate = amount, in ONE unit — the server's invoiceEngine.lineQuantity. A per-15-minute line reads
// "8 units × $7.50 / 15 min"; an hourly line "2.00 h × $30.00 / h".
const lineQty = (li: LineItem) => {
  const hours = parseFloat(String(li?.hours || 0)) || 0
  const rate = parseFloat(String(li?.rate || 0)) || 0
  if (li?.rateType === '15min') {
    const units = Math.round(hours * 4 * 100) / 100
    return { qty: `${Number.isInteger(units) ? units : units.toFixed(2)} unit${units === 1 ? '' : 's'}`, rate: `${formatMoney(rate)} / 15 min` }
  }
  return { qty: `${hours.toFixed(2)} h`, rate: `${formatMoney(rate)} / h` }
}

/** GET /api/billing/invoices/totals (server/data/homecareBillingRoutes.ts visitInvoiceTotals). */
interface InvoiceTotals {
  outstanding: number; draftCount: number; draftTotal: number
  aging: { current: number; thirtyDays: number; sixtyDays: number; ninetyDays: number; over90: number }
}

interface Invoice {
  id: string; invoiceNumber: string; seqNumber: number | null; clientId: string
  billingPeriodStart: string; billingPeriodEnd: string; paymentDueDate: string | null
  subtotal?: Num; total: Num; amountPaid: Num; amountAdjusted: Num; paymentStatus: string; sentAt: string | null
  notes?: string | null; createdAt?: string | null
  firstName: string | null; lastName: string | null; email: string | null; referralSourceName: string | null; totalHours?: Num
}
interface InvoiceDetail extends Invoice {
  address?: string | null; city?: string | null; state?: string | null; zip?: string | null
  lineItems: LineItem[]
}

// The money rule the reports use (server/data/homecareBilling.ts): a draft (never sent, released or paid) is not
// billed and not owed; a released invoice owes total − paid − written off.
const isReleased = (inv: Invoice) => !!inv?.sentAt || inv?.paymentStatus === 'paid' || inv?.paymentStatus === 'partial'
const balanceOf = (inv: Invoice) =>
  (parseFloat(String(inv?.total || 0)) || 0) - (parseFloat(String(inv?.amountPaid || 0)) || 0) - (parseFloat(String(inv?.amountAdjusted || 0)) || 0)

interface Client {
  id: string; firstName: string; lastName: string; referredById: string | null; careTypeId: string | null
  isPrivatePay: boolean; privatePayRate: Num; privatePayRateType: string | null
}
interface Caregiver { id: string; firstName: string; lastName: string }
interface RefSource { id: string; name: string }
interface CareType { id: string; name: string }
interface Rate {
  id: string; referralSourceId: string; careTypeId: string | null; rateAmount: Num; rateType: string | null
  isActive: boolean | null; effectiveDate: string | null; endDate: string | null
  referralSourceName: string | null; careTypeName: string | null; clientCount: number | null
}
interface MissingRate { payerName: string; careTypeName: string; affectedClients: number }
interface Authorization {
  id: string; clientId: string; payerId: string | null; authNumber: string | null; unitType: string | null
  authorizedUnits: Num; usedUnits: Num; startDate: string | null; endDate: string | null
  client?: { firstName: string | null; lastName: string | null }; payer?: { name: string | null }
}
interface InvoicePayment {
  id: string; paymentDate: string | null; invoiceNumber: string | null; clientName: string | null; amount: Num
  paymentMethod: string | null; referenceNumber: string | null; notes: string | null
}
interface ReconcileRow {
  key: string; serviceDate: string; caregiverName: string; scheduledStart: string | null; scheduledEnd: string | null
  scheduledMinutes: number | null; scheduledAmount: number | null; clockedStartLabel: string | null; clockedEndLabel: string | null
  clockedMinutes: number | null; clockedAmount: number | null; needsChoice: boolean; status: string
  defaultBasis: string; chosenBasis: string; overlapMinutes?: number; overlapWith?: string
}
interface SkippedDay {
  serviceDate: string; reason: string | null; notes: string | null; scheduledStart: string | null; scheduledEnd: string | null
  caregiverName: string | null; reportedBy: string | null; reportedByRole: string | null
}
interface ReconcileData {
  reconcile: ReconcileRow[]; skipped: SkippedDay[]; total: number
  rate: { rate: number; rateType: string; source: string } | null
  counts: { noPunch: number; match: number; unscheduled: number }
}
interface ScheduleRow {
  id: string; firstName: string; lastName: string; isPrivatePay: boolean; billingFrequencyWeeks: number | null
  billedThrough: string | null; payerName: string | null; periodsDue: number
}
interface PickVisit { visitDate: string; startTime: string; endTime: string; minutes: Num; caregiverId: string; caregiverName: string | null; billedOn: string | null }
interface DueResult {
  dryRun: boolean; summary: string
  created: { name: string; invoiceNumber: string; seqNumber?: number | null; period: string; total: number; hours: number }[]
  skipped: { name: string; period?: string; reason: string; needsReview?: boolean }[]
  emptyPeriods: { name: string; period: string }[]
}
interface ManualLine {
  caregiverId: string; caregiverName: string; description: string; hours: string; rate: string
  serviceDate: string; startTime: string; endTime: string; _source?: string
}
interface EditLine {
  description: string; hours: string; rate: string; serviceDate: string; caregiverId: string | null; timeEntryId: string | null
  startTime: string | null; endTime: string | null; billedBasis: string | null; scheduledMinutes: number | null
  clockedMinutes: number | null; writeOff: boolean
}
interface ResolvedRate { rate: number; rateType: string; source: string }

const EMPTY_MANUAL_LINE: ManualLine = { caregiverId: '', caregiverName: '', description: 'Home Care Services', hours: '', rate: '', serviceDate: '', startTime: '', endTime: '' }
/** Every client and caregiver for the pickers (both lists page at 50 by default). */

const BillingDashboard = () => {
  // Each control for whoever the server lets use it (care-billing create / update / delete): the office manager reads
  // billing and changes none of it, and was offered every button (lib/useMay.ts).
  const may = useMay('care-billing')
  const toast = useToast()
  const confirm = useConfirm()
  const { company } = useAuth()
  // Each panel the header buttons open is scrolled into view, so it never opens below the fold.
  const generateRef = useRef<HTMLDivElement>(null), reconcileRef = useRef<HTMLDivElement>(null), manualRef = useRef<HTMLDivElement>(null), batchRef = useRef<HTMLDivElement>(null)
  const scheduleRef = useRef<HTMLDivElement>(null), pickRef = useRef<HTMLDivElement>(null), dueRef = useRef<HTMLDivElement>(null)
  const reveal = (ref: RefObject<HTMLDivElement | null>) => setTimeout(() => { try { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* old browser */ } }, 0)
  const [activeTab, setActiveTab] = useState('invoices')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  // The headline figures over EVERY invoice (GET /api/billing/invoices/totals): the list above is its first page.
  const [totals, setTotals] = useState<InvoiceTotals | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [caregivers, setCaregivers] = useState<Caregiver[]>([])
  const [referralSources, setReferralSources] = useState<RefSource[]>([])
  const [careTypes, setCareTypes] = useState<CareType[]>([])
  const [rates, setRates] = useState<Rate[]>([])
  const [missingRates, setMissingRates] = useState<MissingRate[]>([])

  // Detect payer × care-type combos with active clients but no rate. The banner appears in the Rates tab so admins can
  // see which combos will be refused at invoice time. Re-read after every rate change too.
  const loadMissingRates = () => {
    api.get('/api/billing/missing-rates')
      .then((d) => setMissingRates(rows<MissingRate>(d)))
      .catch(() => setMissingRates([]))
  }
  useEffect(() => {
    if (activeTab !== 'rates') return
    loadMissingRates()
  }, [activeTab])
  const [authorizations, setAuthorizations] = useState<Authorization[]>([])
  const [payments, setPayments] = useState<InvoicePayment[]>([])
  const [loading, setLoading] = useState(true)
  const [showGenerateForm, setShowGenerateForm] = useState(false)
  const [dueRunning, setDueRunning] = useState(false)
  const [dueResult, setDueResult] = useState<DueResult | null>(null)
  const [showSchedulePanel, setShowSchedulePanel] = useState(false)
  const [billingSchedule, setBillingSchedule] = useState<ScheduleRow[]>([])
  const [showReconcile, setShowReconcile] = useState(false)
  const [reconcileData, setReconcileData] = useState<ReconcileData | null>(null)
  const [reconcileChoices, setReconcileChoices] = useState<Record<string, string>>({})
  const [reconcileLoading, setReconcileLoading] = useState(false)
  const [showSettledDays, setShowSettledDays] = useState(false)
  const [showPickPanel, setShowPickPanel] = useState(false)
  const [pickForm, setPickForm] = useState({ clientId: '', from: '', to: '' })
  const [pickVisits, setPickVisits] = useState<PickVisit[]>([])
  const [pickChosen, setPickChosen] = useState<Record<string, boolean>>({})
  const [pickLoading, setPickLoading] = useState(false)
  const [showManualForm, setShowManualForm] = useState(false)
  const [showBatchForm, setShowBatchForm] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null)
  const [showRateForm, setShowRateForm] = useState(false)
  const [message, setMessage] = useState('')

  const [formData, setFormData] = useState({ clientId: '', billingPeriodStart: '', billingPeriodEnd: '', notes: '' })
  const [batchFormData, setBatchFormData] = useState({ billingPeriodStart: '', billingPeriodEnd: '', clientFilter: 'all', referralSourceId: '' })
  const [rateFormData, setRateFormData] = useState({ referralSourceId: '', careTypeId: '', rateAmount: '', rateType: 'hourly' })
  const [authFormData, setAuthFormData] = useState({
    clientId: '', referralSourceId: '', authorizationNumber: '', serviceType: '', authorizedUnits: '', unitType: '15min', startDate: '', endDate: '', notes: '',
  })
  const [paymentFormData, setPaymentFormData] = useState({
    invoiceId: '', amount: '', paymentDate: agencyToday(), paymentMethod: 'check', referenceNumber: '', notes: '',
  })
  const [adjustmentFormData, setAdjustmentFormData] = useState({ invoiceId: '', amount: '', type: 'write_off', reason: '', notes: '' })
  const [manualFormData, setManualFormData] = useState({ clientId: '', billingPeriodStart: '', billingPeriodEnd: '', notes: '' })
  const [detailedMode, setDetailedMode] = useState(true) // Default to detailed (best practice)
  const [manualLineItems, setManualLineItems] = useState<ManualLine[]>([{ ...EMPTY_MANUAL_LINE }])

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    try {
      const [invoiceRes, clientRes, rsRes, ctRes, ratesRes, caregiversRes] = await Promise.all([
        api.get('/api/billing/invoices'),
        listAll('/api/clients'),
        api.get('/api/referral-sources'),
        api.get('/api/care-types'),
        api.get('/api/billing/referral-source-rates'),
        listAll('/api/users').catch(() => null),
      ])
      setInvoices(rows<Invoice>(invoiceRes))
      try { setTotals(await api.get('/api/billing/invoices/totals')) } catch { setTotals(null) }
      setClients(rows<Client>(clientRes))
      setReferralSources(rows<RefSource>(rsRes))
      setCareTypes(rows<CareType>(ctRes))
      setRates(rows<Rate>(ratesRes))
      setCaregivers(rows<Caregiver>(caregiversRes))

      // The optional lists: a refusal leaves them empty.
      try { setAuthorizations(rows<Authorization>(await api.get('/api/authorizations'))) } catch { console.log('Authorizations endpoint not available') }
      try { setPayments(rows<InvoicePayment>(await api.get('/api/billing/invoice-payments'))) } catch { console.log('Payments endpoint not available') }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (amount: Num) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0)

  // Step 1 of generating: show the producer every day that will be billed and let them settle the ones where the
  // clock-in and the schedule disagree. Billing bills the SHIFT; a short punch used to silently become the price.
  const handleReviewInvoice = async (e: FormEvent) => {
    e.preventDefault()
    if (!formData.clientId || !formData.billingPeriodStart || !formData.billingPeriodEnd) return
    setReconcileLoading(true)
    try {
      const data: ReconcileData = await api.post('/api/billing/invoices/reconcile', {
        clientId: formData.clientId,
        billingPeriodStart: formData.billingPeriodStart,
        billingPeriodEnd: formData.billingPeriodEnd,
      })
      if ((!data.reconcile || data.reconcile.length === 0) && (!data.skipped || data.skipped.length === 0)) {
        toast.error('No scheduled visits or clock-ins found for this client in that period')
        return
      }
      if (!data.reconcile || data.reconcile.length === 0) {
        // Every visit in the period was cancelled as client-unavailable. Nothing to invoice — say why.
        toast.error(`Nothing to bill: all ${data.skipped.length} visit${data.skipped.length === 1 ? '' : 's'} in this period were cancelled (client unavailable / refused)`)
        return
      }
      // Everything starts on its default (scheduled, except unscheduled punches).
      const initial: Record<string, string> = {}
      data.reconcile.forEach((r) => { initial[r.key] = r.defaultBasis })
      setReconcileData(data)
      setReconcileChoices(initial)
      setShowReconcile(true)
      reveal(reconcileRef)
    } catch (err) {
      toast.error(errorMessage(err, 'Could not read this period'))
    } finally {
      setReconcileLoading(false)
    }
  }

  const reconcileTotal = () => {
    if (!reconcileData) return 0
    return reconcileData.reconcile.reduce((sum, r) => {
      const basis = reconcileChoices[r.key] || r.defaultBasis
      const amt = basis === 'clocked' ? r.clockedAmount : r.scheduledAmount
      return sum + (Number(amt) || 0)
    }, 0)
  }

  const handleGenerateInvoice = async (e?: FormEvent) => {
    if (e && e.preventDefault) e.preventDefault()
    try {
      const invoice: { id: string } = await api.post('/api/billing/invoices/generate-with-rates', { ...formData, choices: reconcileChoices })
      setFormData({ clientId: '', billingPeriodStart: '', billingPeriodEnd: '', notes: '' })
      setShowGenerateForm(false)
      setShowReconcile(false)
      setReconcileData(null)
      setReconcileChoices({})
      loadData()
      // Show the invoice as STORED (its lines' units and each visit's care note), not the create response.
      handleViewInvoice(invoice.id)
    } catch (error) {
      toast.error(errorMessage(error, 'The invoice was not created'))
    }
  }

  // Round an ISO timestamp or "HH:MM[:SS]" string to the nearest 15-min slot and return "HH:MM" so it matches the
  // TIME_OPTIONS dropdown values.
  const toQuarterHourHHMM = (input: string | null | undefined) => {
    if (!input) return ''
    let h: number, m: number
    if (typeof input === 'string' && /^\d{1,2}:\d{2}/.test(input)) {
      const parts = input.split(':')
      h = parseInt(parts[0], 10)
      m = parseInt(parts[1], 10)
    } else {
      // A stored moment's hour on the AGENCY's clock, as the dropdown's times are (not the browser's).
      const t = agencyWall(input).time
      if (!t) return ''
      h = Number(t.slice(0, 2))
      m = Number(t.slice(3, 5))
    }
    const rounded = Math.round(m / 15) * 15
    let hh = h + Math.floor(rounded / 60)
    const mm = rounded % 60
    if (hh >= 24) hh -= 24
    return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
  }

  // "📥 Import from Schedule + EVV" → pulls scheduled visits + completed EVV entries for the selected client + date range
  // and populates the manual line items.
  const handleImportFromSchedule = async () => {
    if (!manualFormData.clientId || !manualFormData.billingPeriodStart || !manualFormData.billingPeriodEnd) {
      toast.error('Select client and billing period dates first')
      return
    }
    setPreviewLoading(true)
    try {
      const data: { lineItems: (LineItem & { source?: string })[]; total: number; counts: { total: number; evvConfirmed: number; scheduled: number; unscheduled: number } } =
        await api.post('/api/billing/invoices/preview', {
          clientId: manualFormData.clientId,
          billingPeriodStart: manualFormData.billingPeriodStart,
          billingPeriodEnd: manualFormData.billingPeriodEnd,
        })
      if (!data.lineItems || data.lineItems.length === 0) {
        toast.error('No scheduled visits or EVV entries found for this client in this period.')
        return
      }
      // Map server line items → form line item shape
      const mapped: ManualLine[] = data.lineItems.map((li) => {
        const baseDesc = (li.description || 'Home Care Services').replace(/\s*\([^)]*\)\s*$/, '').trim()
        return {
          caregiverId: li.caregiverId || '',
          caregiverName: `${li.caregiverFirstName || ''} ${li.caregiverLastName || ''}`.trim(),
          description: baseDesc || 'Home Care Services',
          hours: (parseFloat(String(li.hours || 0)) || 0).toFixed(2),
          rate: (parseFloat(String(li.rate || 0)) || 0).toFixed(2),
          serviceDate: li.serviceDate || '',
          startTime: toQuarterHourHHMM(li.startTime),
          endTime: toQuarterHourHHMM(li.endTime),
          _source: li.source, // for UI badge
        }
      })
      setManualLineItems(mapped)
      setDetailedMode(true) // detailed mode needed for dates
      const { counts } = data
      const parts: string[] = []
      if (counts.evvConfirmed) parts.push(`${counts.evvConfirmed} EVV-confirmed`)
      if (counts.scheduled) parts.push(`${counts.scheduled} scheduled-only`)
      if (counts.unscheduled) parts.push(`${counts.unscheduled} unscheduled EVV`)
      setMessage(`✓ Imported ${counts.total} line items (${parts.join(', ')}). Total: ${formatCurrency(data.total)}`)
      setTimeout(() => setMessage(''), 6000)
    } catch (err) {
      toast.error(errorMessage(err, 'Preview failed'))
    } finally {
      setPreviewLoading(false)
    }
  }

  // The rate belongs to the client, not to the invoice form. The server stamps this same value regardless of what we
  // send; we resolve it here only so the operator can see what they're billing before they save.
  const effectiveRateFor = (clientId: string | null | undefined): ResolvedRate | null => {
    const c = clients.find((x) => x.id === clientId)
    if (!c) return null
    const payerId = c.referredById
    if (!c.isPrivatePay && payerId) {
      // Same choice the server makes: the client's care type first, then the payer's default.
      const live = rates.filter((x) => x.referralSourceId === payerId && (x.isActive === true || x.isActive == null))
      const r = live.find((x) => c.careTypeId && x.careTypeId === c.careTypeId) || live.find((x) => !x.careTypeId)
      if (r) return { rate: parseFloat(String(r.rateAmount)), rateType: r.rateType || 'hourly', source: 'payer contract rate' }
    }
    if (c.privatePayRate && parseFloat(String(c.privatePayRate)) > 0) {
      return { rate: parseFloat(String(c.privatePayRate)), rateType: c.privatePayRateType || 'hourly', source: 'client private-pay rate' }
    }
    return null
  }
  // An hourly rate bills hours; a per-15-minute rate bills units (hours × 4) — the server's rule.
  const amountAt = (hours: Num, r: ResolvedRate | null) => {
    if (!r) return 0
    const h = parseFloat(String(hours || 0)) || 0
    return r.rateType === 'hourly' ? h * r.rate : (Math.round(h * 4 * 100) / 100) * r.rate
  }
  const rateLabel = (r: ResolvedRate | { rate: number; rateType: string } | null) => (r ? `${formatMoney(r.rate)}${r.rateType === 'hourly' ? '/h' : '/15 min'}` : 'No rate set')
  const manualRate = effectiveRateFor(manualFormData.clientId)
  const calculateManualTotal = () => manualLineItems.reduce((sum, item) => sum + amountAt(item.hours, manualRate), 0)

  const handleManualInvoice = async (e: FormEvent) => {
    e.preventDefault()
    if (!manualRate) {
      toast.error('This client has no billing rate configured. Set it on the client (Clients → Edit) first.')
      return
    }
    // Rate is stamped from the client record server-side; only hours are entered here.
    const validLineItems = manualLineItems
      .filter((item) => parseFloat(item.hours) > 0)
      .map((item) => ({ ...item, rate: manualRate.rate }))
    if (validLineItems.length === 0) {
      toast.warning('Please add at least one line item with hours')
      return
    }
    // In detailed mode, require date for each line item
    if (detailedMode && validLineItems.some((item) => !item.serviceDate)) {
      toast.warning('Please enter a date for each line item in detailed mode')
      return
    }
    try {
      const invoice: { id: string } = await api.post('/api/billing/invoices/manual', { ...manualFormData, detailedMode, lineItems: validLineItems })
      setManualFormData({ clientId: '', billingPeriodStart: '', billingPeriodEnd: '', notes: '' })
      setManualLineItems([{ ...EMPTY_MANUAL_LINE }])
      setShowManualForm(false)
      loadData()
      handleViewInvoice(invoice.id)
      setMessage('✓ Manual invoice created successfully')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      toast.error(errorMessage(error, 'The invoice was not created'))
    }
  }

  const addManualLineItem = () => setManualLineItems([...manualLineItems, { ...EMPTY_MANUAL_LINE }])
  const removeManualLineItem = (index: number) => {
    if (manualLineItems.length > 1) setManualLineItems(manualLineItems.filter((_, i) => i !== index))
  }

  const updateManualLineItem = (index: number, field: keyof ManualLine, value: string) => {
    const updated = manualLineItems.map((l) => ({ ...l }))
    updated[index][field] = value
    // If selecting a caregiver, also store their name
    if (field === 'caregiverId' && value) {
      const caregiver = caregivers.find((c) => c.id === value)
      if (caregiver) updated[index].caregiverName = `${caregiver.firstName} ${caregiver.lastName}`
    }
    // Auto-calculate hours when start/end times are both set
    if (field === 'startTime' || field === 'endTime') {
      const startTime = field === 'startTime' ? value : updated[index].startTime
      const endTime = field === 'endTime' ? value : updated[index].endTime
      if (startTime && endTime) {
        const [startHour, startMin] = startTime.split(':').map(Number)
        const [endHour, endMin] = endTime.split(':').map(Number)
        let hours = (endHour + endMin / 60) - (startHour + startMin / 60)
        // Handle overnight shifts
        if (hours < 0) hours += 24
        // Round to nearest 0.25 (15 minutes)
        hours = Math.round(hours * 4) / 4
        updated[index].hours = hours.toFixed(2)
      }
    }
    setManualLineItems(updated)
  }

  // Create Due Invoices is two steps: first a DRY RUN (nothing is written) lists what would be created and what would be
  // skipped; only "Create these drafts" on that preview writes anything.
  const runGenerateDue = async (dryRun: boolean) => {
    setDueRunning(true)
    try {
      const result: DueResult = await api.post('/api/billing/invoices/generate-due', { dryRun })
      setDueResult(result)
      reveal(dueRef)
      if (!dryRun) { toast.success(result.summary); loadData() }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not read the due invoices'))
    } finally {
      setDueRunning(false)
    }
  }
  const handleGenerateDue = () => runGenerateDue(true)
  const confirmGenerateDue = async () => {
    const n = dueResult?.created?.length || 0
    if (!(await confirm(`Create ${n} draft invoice${n === 1 ? '' : 's'}? Drafts stay hidden from families until you send or release them.`, { danger: false }))) return
    runGenerateDue(false)
  }

  const loadBillingSchedule = async () => {
    try {
      setBillingSchedule(rows<ScheduleRow>(await api.get('/api/billing/invoices/billing-schedule')))
    } catch (err) { console.error('billing schedule load:', err) }
  }

  const setClientFrequency = async (clientId: string, weeks: string) => {
    try {
      await api.patch(`/api/billing/invoices/billing-schedule/${clientId}`, { weeks: weeks || null })
      loadBillingSchedule()
    } catch (err) { setMessage(`✗ ${errorMessage(err, 'Failed')}`) }
  }

  const pickKey = (v: PickVisit) => `${v.visitDate}|${v.startTime}|${v.caregiverId}`

  const loadPickVisits = async () => {
    if (!pickForm.clientId || !pickForm.from || !pickForm.to) { toast.error('Choose a client and both dates'); return }
    setPickLoading(true)
    try {
      const data = rows<PickVisit>(await api.get('/api/billing/scheduled-visits', { clientId: pickForm.clientId, from: pickForm.from, to: pickForm.to }))
      setPickVisits(data)
      setPickChosen({})
      if (!data.length) toast.error('No scheduled visits for this client in those dates')
    } catch (err) {
      toast.error(errorMessage(err, 'Could not load the visits'))
    } finally {
      setPickLoading(false)
    }
  }

  const createFromPicked = async () => {
    const visits = pickVisits
      .filter((v) => pickChosen[pickKey(v)])
      .map((v) => ({ visitDate: v.visitDate, startTime: String(v.startTime).slice(0, 5), caregiverId: v.caregiverId }))
    if (!visits.length) return
    setPickLoading(true)
    try {
      const data: { id: string; seqNumber: number | null; invoiceNumber: string; visits: number } =
        await api.post('/api/billing/invoices/from-visits', { clientId: pickForm.clientId, visits })
      toast.success(`Draft invoice #${data.seqNumber ?? data.invoiceNumber} created for ${data.visits} visit${data.visits === 1 ? '' : 's'}`)
      setPickVisits([])
      setPickChosen({})
      setShowPickPanel(false)
      loadData()
      handleViewInvoice(data.id)
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create the invoice'))
    } finally {
      setPickLoading(false)
    }
  }

  const handleBatchGenerate = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result: { count: number; total: number; skipped: number; skippedClients?: { name: string; needsReview?: boolean }[] } =
        await api.post('/api/billing/invoices/batch-generate', batchFormData)
      setBatchFormData({ billingPeriodStart: '', billingPeriodEnd: '', clientFilter: 'all', referralSourceId: '' })
      setShowBatchForm(false)
      loadData()
      // A batch cannot ask "scheduled or clocked?", so clients with an unresolved day are skipped — name them, or they
      // read as billed.
      const review = (result.skippedClients || []).filter((s) => s.needsReview).map((s) => s.name)
      setMessage(`✓ Generated ${result.count} invoices totaling ${formatCurrency(result.total)}`
        + (result.skipped ? ` · ${result.skipped} skipped` : '')
        + (review.length ? ` — generate these on their own to review their days: ${review.join(', ')}` : ''))
      setTimeout(() => setMessage(''), review.length ? 15000 : 5000)
    } catch (error) {
      toast.error(errorMessage(error, 'Batch generation failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleViewInvoice = async (invoiceId: string) => {
    try {
      setSelectedInvoice(await api.get(`/api/billing/invoices/${invoiceId}`))
      setShowInvoiceModal(true)
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load the invoice'))
    }
  }

  const handleDeleteInvoice = async (invoiceId: string, invoiceNumber: string) => {
    if (!(await confirm(`Are you sure you want to delete invoice ${invoiceNumber}? This cannot be undone.`, { danger: true }))) return
    try {
      await api.delete(`/api/billing/invoices/${invoiceId}`)
      setMessage(`✓ Invoice ${invoiceNumber} deleted`)
      setTimeout(() => setMessage(''), 3000)
      loadData()
    } catch (error) {
      toast.error(errorMessage(error, 'The invoice was not deleted'))
    }
  }

  const handleMarkPaid = async (invoiceId: string) => {
    try {
      // No paymentDate: the server dates the payment today on the agency's clock (the template sent the browser's
      // instant, which the server cut to its UTC day — tomorrow every US evening).
      const updated: Partial<InvoiceDetail> = await api.put(`/api/billing/invoices/${invoiceId}/payment-status`, { status: 'paid' })
      loadData()
      if (selectedInvoice?.id === invoiceId) setSelectedInvoice({ ...selectedInvoice, ...updated })
      toast.success('Invoice marked paid — a payment for the balance is recorded')
    } catch (error) {
      toast.error(errorMessage(error, 'The invoice was not marked paid'))
    }
  }

  // ── Edit invoice line items (any unpaid invoice) ──────────────────────────
  const [editingInvoice, setEditingInvoice] = useState<InvoiceDetail | null>(null) // invoice being edited
  const [editLines, setEditLines] = useState<EditLine[]>([]) // working copy of rows
  const [savingLineItems, setSavingLineItems] = useState(false)

  const openLineItemEditor = (invoice: InvoiceDetail) => {
    const src: Partial<LineItem>[] = (invoice.lineItems && invoice.lineItems.length)
      ? invoice.lineItems
      : [{ description: 'Home Care Services', hours: invoice.totalHours || '', rate: '' }]
    setEditLines(src.map((li) => ({
      description: li.description || 'Home Care Services',
      hours: li.hours != null ? String(li.hours) : '',
      rate: li.rate != null ? String(li.rate) : '',
      serviceDate: li.serviceDate ? String(li.serviceDate).slice(0, 10) : '',
      caregiverId: li.caregiverId || null,
      timeEntryId: li.timeEntryId || null,
      // kept so an edited line still identifies its visit (care note) and why it bills what it does
      startTime: li.startTime || null,
      endTime: li.endTime || null,
      billedBasis: li.billedBasis || null,
      scheduledMinutes: li.scheduledMinutes ?? null,
      clockedMinutes: li.clockedMinutes ?? null,
      // a $0 line stays a deliberate write-off
      writeOff: li.rate != null && li.rate !== '' && parseFloat(String(li.rate)) === 0,
    })))
    setEditingInvoice(invoice)
  }

  // Rate follows the invoice's client, same as creation — the server stamps it either way.
  const editRateInfo = editingInvoice ? effectiveRateFor(editingInvoice.clientId) : null
  const editRate = editRateInfo?.rate ?? null
  const editLineAmount = (l: EditLine) => (l.writeOff ? 0 : amountAt(l.hours, editRateInfo))
  const editGrandTotal = () => editLines.reduce((s, l) => s + editLineAmount(l), 0)
  const updateEditLine = (idx: number, field: 'description' | 'serviceDate' | 'hours', value: string) =>
    setEditLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)))
  const addEditLine = () => setEditLines((prev) => [...prev, {
    description: 'Home Care Services', hours: '', rate: '', serviceDate: '', caregiverId: null, timeEntryId: null,
    startTime: null, endTime: null, billedBasis: null, scheduledMinutes: null, clockedMinutes: null, writeOff: false,
  }])
  const removeEditLine = (idx: number) => setEditLines((prev) => prev.filter((_, i) => i !== idx))

  const saveLineItems = async () => {
    if (!editingInvoice?.id) return
    const kept = editLines.filter((l) => (l.description || '').trim() || String(l.hours || '').trim())
    // Hours are typed as text and checked here, on save — never clamped while typing.
    const bad = kept.find((l) => !/^\d+(\.\d+)?$/.test(String(l.hours || '').trim()))
    if (bad) { toast.error(`Hours must be a number (line "${bad.description || 'Home Care Services'}")`); return }
    const cleaned = kept
      // No rate is sent for a normal line: the server stamps the client's configured rate. Only a deliberate write-off
      // sends 0. The visit's identity goes back as visitStart / visitEnd (the route's own names for start_time).
      .map((l) => ({
        description: (l.description || '').trim() || 'Home Care Services',
        hours: parseFloat(l.hours),
        ...(l.writeOff ? { rate: 0 } : {}),
        serviceDate: l.serviceDate || null,
        caregiverId: l.caregiverId || null,
        timeEntryId: l.timeEntryId || null,
        visitStart: l.startTime || null,
        visitEnd: l.endTime || null,
        billedBasis: l.billedBasis || null,
        scheduledMinutes: l.scheduledMinutes ?? null,
        clockedMinutes: l.clockedMinutes ?? null,
      }))
    if (cleaned.length === 0) { toast.error('Add at least one line item'); return }
    setSavingLineItems(true)
    try {
      const data: { id: string } = await api.put(`/api/billing/invoices/${editingInvoice.id}/line-items`, { lineItems: cleaned })
      toast.success('Invoice updated')
      setEditingInvoice(null)
      loadData()
      handleViewInvoice(data.id)
    } catch (error) {
      toast.error(errorMessage(error, 'The changes were not saved'))
    } finally {
      setSavingLineItems(false)
    }
  }

  const [sendingInvoiceEmail, setSendingInvoiceEmail] = useState(false)
  const [creatingPaymentLink, setCreatingPaymentLink] = useState(false)

  // Create (or surface) a Stripe payment link for this invoice and copy it to the clipboard so admin can paste it into
  // an email / text.
  const handleCreatePaymentLink = async (invoice: InvoiceDetail) => {
    if (!invoice?.id) return
    setCreatingPaymentLink(true)
    try {
      const data: { paymentLink: string } = await api.post('/api/stripe/create-payment-link', { invoiceId: invoice.id })
      try { await navigator.clipboard.writeText(data.paymentLink) } catch { /* no clipboard: the link is in the toast */ }
      toast.success(`Payment link copied to clipboard: ${data.paymentLink}`)
    } catch (error) {
      toast.error(errorMessage(error, 'No payment link was created'))
    } finally {
      setCreatingPaymentLink(false)
    }
  }

  const handleSendInvoiceEmail = async (invoice: InvoiceDetail) => {
    if (!invoice?.id) return
    const emailTo = invoice.email
    if (!emailTo) { toast.error('No email on file for this client — add one on the client first.'); return }
    const ok = await confirm(`Send invoice #${invoice.invoiceNumber} to ${emailTo}?`, { danger: false })
    if (!ok) return
    setSendingInvoiceEmail(true)
    try {
      const data: { sentTo: string } = await api.post(`/api/billing/invoices/${invoice.id}/send-email`, { email: emailTo })
      toast.success(`Invoice emailed to ${data.sentTo}`)
      // Emailing releases the draft to the family portal — reflect it immediately
      setSelectedInvoice((prev) => (prev && prev.id === invoice.id ? { ...prev, sentAt: prev.sentAt || new Date().toISOString() } : prev))
      loadData()
    } catch (error) {
      toast.error(errorMessage(error, 'The invoice was not sent'))
    } finally {
      setSendingInvoiceEmail(false)
    }
  }

  // Invoices start as drafts the family portal cannot see. Emailing or creating a pay link releases them
  // automatically; this button covers portal-only clients where nothing is emailed.
  const handleReleaseToPortal = async (invoice: InvoiceDetail) => {
    if (!invoice?.id) return
    const ok = await confirm(`Make invoice #${invoice.invoiceNumber} visible in the family portal?`, { danger: false })
    if (!ok) return
    try {
      const data: { sentAt: string } = await api.post(`/api/billing/invoices/${invoice.id}/release`, {})
      toast.success('Invoice released to family portal')
      setSelectedInvoice((prev) => (prev && prev.id === invoice.id ? { ...prev, sentAt: data.sentAt } : prev))
      loadData()
    } catch (error) {
      toast.error(errorMessage(error, 'The invoice was not released'))
    }
  }

  // Pulls a sent invoice back to draft: it disappears from the family portal and its public pay link stops working.
  // The server refuses once a payment is recorded (the portal shows paid/partial invoices regardless).
  const handleRescindInvoice = async (invoice: InvoiceDetail) => {
    if (!invoice?.id) return
    const ok = await confirm(`Rescind invoice #${invoice.invoiceNumber}? It will disappear from the family portal and its pay link will stop working. If it was already emailed, the family still has that copy.`)
    if (!ok) return
    try {
      await api.post(`/api/billing/invoices/${invoice.id}/rescind`, {})
      toast.success('Invoice rescinded — back to draft, hidden from the family portal')
      setSelectedInvoice((prev) => (prev && prev.id === invoice.id ? { ...prev, sentAt: null } : prev))
      loadData()
    } catch (error) {
      toast.error(errorMessage(error, 'The invoice was not rescinded'))
    }
  }

  const handleSendInvoiceReminder = async (invoice: InvoiceDetail) => {
    if (!invoice?.id) return
    if (invoice.paymentStatus === 'paid') {
      toast.info('Invoice is already paid — no reminder needed.')
      return
    }
    const emailTo = invoice.email
    if (!emailTo) { toast.error('No email on file for this client — add one on the client first.'); return }
    const ok = await confirm(`Send a payment reminder for invoice #${invoice.invoiceNumber} to ${emailTo}?`, { danger: false })
    if (!ok) return
    setSendingInvoiceEmail(true)
    try {
      const data: { sentTo: string; daysOverdue: number } = await api.post(`/api/billing/invoices/${invoice.id}/send-reminder`, { email: emailTo })
      const overdueLabel = data.daysOverdue > 0 ? ` (${data.daysOverdue}d overdue)` : ''
      toast.success(`Reminder sent to ${data.sentTo}${overdueLabel}`)
      loadData()
    } catch (error) {
      toast.error(errorMessage(error, 'The reminder was not sent'))
    } finally {
      setSendingInvoiceEmail(false)
    }
  }

  const handleRecordPayment = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/billing/invoice-payments', paymentFormData)
      setPaymentFormData({ invoiceId: '', amount: '', paymentDate: agencyToday(), paymentMethod: 'check', referenceNumber: '', notes: '' })
      setShowPaymentModal(false)
      loadData()
      setMessage('✓ Payment recorded')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      toast.error(errorMessage(error, 'The payment was not recorded'))
    }
  }

  const handleAddAuthorization = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/authorizations', authFormData)
      setAuthFormData({ clientId: '', referralSourceId: '', authorizationNumber: '', serviceType: '', authorizedUnits: '', unitType: '15min', startDate: '', endDate: '', notes: '' })
      setShowAuthModal(false)
      loadData()
      setMessage('✓ Authorization added')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      toast.error(errorMessage(error, 'The authorization was not added'))
    }
  }

  const handleRecordAdjustment = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/billing/invoice-adjustments', adjustmentFormData)
      setAdjustmentFormData({ invoiceId: '', amount: '', type: 'write_off', reason: '', notes: '' })
      setShowAdjustmentModal(false)
      loadData()
      setMessage('✓ Adjustment recorded')
      setTimeout(() => setMessage(''), 3000)
    } catch (error) {
      toast.error(errorMessage(error, 'The adjustment was not recorded'))
    }
  }

  const handleAddRate = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/billing/referral-source-rates', rateFormData)
      setRateFormData({ referralSourceId: '', careTypeId: '', rateAmount: '', rateType: 'hourly' })
      setShowRateForm(false)
      loadData()
      loadMissingRates()
    } catch (error) {
      toast.error(errorMessage(error, 'The rate was not added'))
    }
  }

  const handleDeleteRate = async (rateId: string) => {
    if (!(await confirm('Delete this rate?', { danger: true }))) return
    try {
      await api.delete(`/api/billing/referral-source-rates/${rateId}`)
      loadData()
      loadMissingRates()
    } catch (error) {
      toast.error(errorMessage(error, 'The rate was not deleted'))
    }
  }

  const handleExportCSV = async () => {
    try {
      saveBlob(await downloadBlob('/api/billing/export/invoices-csv'), 'invoices.csv')
    } catch (error) {
      toast.error(errorMessage(error, 'The export failed'))
    }
  }

  const handleExportEVV = async () => {
    try {
      saveBlob(await downloadBlob('/api/billing/export/evv'), `evv-export-${agencyToday()}.csv`)
    } catch (error) {
      toast.error(errorMessage(error, 'The EVV export failed'))
    }
  }

  const daysSince = (day: string | null) => Math.floor((Date.now() - (parseDate(day)?.getTime() ?? 0)) / (1000 * 60 * 60 * 24))

  const calculateAgingBuckets = () => {
    const buckets = { current: 0, thirtyDays: 0, sixtyDays: 0, ninetyDays: 0, over90: 0 }
    invoices.filter((inv) => isReleased(inv) && balanceOf(inv) > 0.005).forEach((inv) => {
      const daysOverdue = daysSince(inv.paymentDueDate)
      const amount = balanceOf(inv)
      if (daysOverdue <= 0) buckets.current += amount
      else if (daysOverdue <= 30) buckets.thirtyDays += amount
      else if (daysOverdue <= 60) buckets.sixtyDays += amount
      else if (daysOverdue <= 90) buckets.ninetyDays += amount
      else buckets.over90 += amount
    })
    return buckets
  }

  const getAuthUsage = (auth: Authorization) => {
    const used = parseFloat(String(auth.usedUnits || 0))
    const authorized = parseFloat(String(auth.authorizedUnits || 0))
    return { used, authorized, remaining: authorized - used, percentage: authorized > 0 ? (used / authorized) * 100 : 0 }
  }

  // Outstanding = released invoices' open balance; Collected = the payments recorded; drafts apart.
  const pendingTotal = invoices.filter((inv) => isReleased(inv)).reduce((sum, inv) => sum + Math.max(0, balanceOf(inv)), 0)
  const paidTotal = payments.reduce((sum, p) => sum + (parseFloat(String(p.amount || 0)) || 0), 0)
  const drafts = invoices.filter((inv) => !isReleased(inv))
  // The server's figures cover every invoice; the page's own sums (its first page) only stand in until they arrive.
  const draftCount = totals ? totals.draftCount : drafts.length
  const draftTotal = totals ? totals.draftTotal : drafts.reduce((sum, inv) => sum + (parseFloat(String(inv.total || 0)) || 0), 0)
  const agingBuckets = totals ? totals.aging : calculateAgingBuckets()
  const outstandingTotal = totals ? totals.outstanding : pendingTotal

  const getClientName = (auth: Authorization) => {
    if (auth.client && (auth.client.firstName || auth.client.lastName)) return `${auth.client.firstName || ''} ${auth.client.lastName || ''}`.trim()
    const c = clients.find((x) => x.id === auth.clientId)
    return c ? `${c.firstName} ${c.lastName}` : 'Unknown'
  }
  const getRSName = (auth: Authorization) => auth.payer?.name || referralSources.find((r) => r.id === auth.payerId)?.name || 'Unknown'
  const invoiceLabel = (inv: Invoice) => (inv.seqNumber != null ? `#${inv.seqNumber}` : inv.invoiceNumber)
  const openPayment = (invoiceId: string) => { setPaymentFormData({ ...paymentFormData, invoiceId }); setShowPaymentModal(true) }

  const tabs = [
    { id: 'invoices', label: '📄 Invoices' },
    { id: 'aging', label: '📊 A/R Aging' },
    { id: 'authorizations', label: '📋 Authorizations' },
    { id: 'payments', label: '💳 Payments' },
    { id: 'rates', label: '💰 Rates' },
  ]

  if (loading) return <div className="loading"><div className="spinner"></div></div>

  // The printed invoice is paper: a white sheet with dark ink in both themes. Its brand bands use the deep end of the
  // brand (homecare.css --hc-brand-deep), dark enough for white text in either theme.
  const coLine = [company?.city, [company?.state, company?.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')

  return (
    <div>
      <div className="page-header">
        <h2>💰 Billing & Invoicing</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {may.create && <>
          <button className="hc-btn hc-btn-primary" onClick={() => { setShowGenerateForm((v) => !v); setShowManualForm(false); reveal(generateRef) }}>📄 New Invoice</button>
          <button className="hc-btn hc-btn-primary" onClick={() => { setShowManualForm((v) => !v); setShowGenerateForm(false); reveal(manualRef) }}>✏️ Manual Invoice</button>
          <button className="hc-btn hc-btn-primary" onClick={handleGenerateDue} disabled={dueRunning}
            title="Previews the draft invoices due for every client with a billing schedule. Nothing is created until you confirm the preview.">
            {dueRunning ? '⏳ Reading…' : '⚡ Create Due Invoices'}
          </button>
          </>}
          <button className="hc-btn hc-btn-secondary" onClick={() => { setShowSchedulePanel(!showSchedulePanel); if (!showSchedulePanel) { loadBillingSchedule(); reveal(scheduleRef) } }}>🗓️ Billing Schedule</button>
          {may.create && <>
          <button className="hc-btn hc-btn-secondary" onClick={() => { setShowPickPanel(!showPickPanel); reveal(pickRef) }}>☑️ Invoice Picked Visits</button>
          <button className="hc-btn hc-btn-secondary" onClick={() => { setShowBatchForm(!showBatchForm); reveal(batchRef) }}>📋 Batch Generate</button>
          </>}
          <button className="hc-btn hc-btn-secondary" onClick={handleExportCSV}>📥 Export CSV</button>
          <button className="hc-btn hc-btn-secondary" onClick={handleExportEVV}>📤 EVV Export</button>
        </div>
      </div>

      {message && <div className="alert alert-success">{message}</div>}

      {/* Create Due Invoices results */}
      {dueResult && (
        <div ref={dueRef} className="hc-card border-l-4 border-indigo-500 dark:border-indigo-400">
          <div className="flex items-center justify-between">
            <h3 className="m-0">⚡ Due Invoices {dueResult.dryRun ? '— preview, nothing created yet' : `— ${dueResult.summary}`}</h3>
            <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setDueResult(null)} aria-label="Close the due-invoices summary">×</button>
          </div>
          {dueResult.dryRun && <p className="mb-0 mt-2 text-sm text-gray-700 dark:text-slate-300">{dueResult.summary}.</p>}
          {dueResult.created.length > 0 && (
            <div className="mt-3">
              <strong className="text-emerald-800 dark:text-emerald-300">{dueResult.dryRun ? 'Would be created as drafts:' : 'Created (drafts — review below, then send):'}</strong>
              {dueResult.created.map((c, i) => (
                <div key={i} className="py-0.5 text-sm text-gray-800 dark:text-slate-200">
                  {c.seqNumber != null ? `#${c.seqNumber}` : c.invoiceNumber} · {c.name} · {c.period} · {Number(c.hours).toFixed(1)}h · {formatCurrency(c.total)}
                </div>
              ))}
            </div>
          )}
          {dueResult.skipped.length > 0 && (
            <div className="mt-3">
              <strong className="text-amber-800 dark:text-amber-300">Skipped — needs your attention:</strong>
              {dueResult.skipped.map((s, i) => (
                <div key={i} className={`py-0.5 text-sm ${s.needsReview ? 'text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-slate-400'}`}>
                  {s.name}{s.period ? ` · ${s.period}` : ''} — {s.reason}
                </div>
              ))}
            </div>
          )}
          {dueResult.emptyPeriods.length > 0 && (
            <div className="mt-3 text-xs text-gray-600 dark:text-slate-400">
              Nothing billable ({dueResult.dryRun ? 'would be skipped forward' : 'skipped forward'}): {dueResult.emptyPeriods.map((e) => `${e.name} ${e.period}`).join(' · ')}
            </div>
          )}
          {dueResult.dryRun && (
            <div className="form-actions">
              {dueResult.created.length > 0
                ? <button type="button" className="hc-btn hc-btn-primary" onClick={confirmGenerateDue} disabled={dueRunning}>Create {dueResult.created.length} draft invoice{dueResult.created.length === 1 ? '' : 's'}</button>
                : <span className="text-sm text-gray-700 dark:text-slate-300">Nothing is due — every client with a schedule is current.</span>}
              <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setDueResult(null)}>Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Billing Schedule panel */}
      {showSchedulePanel && (
        <div className="hc-card" ref={scheduleRef}>
          <h3>🗓️ Billing Schedule</h3>
          <p className="mt-0 text-sm text-gray-600 dark:text-slate-400">
            How often each client gets invoiced. "Create Due Invoices" resumes each client from their
            last invoice and creates one draft per complete period. Blank = manual invoicing only.
          </p>
          <div className="overflow-x-auto">
            <table className="hc-table text-sm">
              <thead><tr><th>Client</th><th>Payer</th><th>Frequency</th><th>Billed Through</th><th>Due Now</th></tr></thead>
              <tbody>
                {billingSchedule.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.firstName} {c.lastName}</strong></td>
                    <td>{c.isPrivatePay ? 'Private Pay' : (c.payerName || '—')}</td>
                    <td>
                      <select aria-label={`Billing frequency for ${c.firstName} ${c.lastName}`} value={c.billingFrequencyWeeks || ''} onChange={(e) => setClientFrequency(c.id, e.target.value)} disabled={!may.update}>
                        <option value="">Manual only</option>
                        <option value="1">Every week</option>
                        <option value="2">Every 2 weeks</option>
                        <option value="4">Every 4 weeks</option>
                      </select>
                    </td>
                    <td>{c.billedThrough ? formatDate(c.billedThrough) : <span className="text-amber-800 dark:text-amber-300">no invoice yet — generate the first manually</span>}</td>
                    <td>{c.periodsDue > 0
                      ? <span className="font-bold text-red-700 dark:text-red-300">{c.periodsDue} period{c.periodsDue > 1 ? 's' : ''}</span>
                      : (c.billingFrequencyWeeks ? '✓ current' : '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invoice picked visits — for clients whose caregiver doesn't clock in: pick the scheduled visits one by one;
          anything already on an invoice is marked and cannot be picked. */}
      {showPickPanel && (
        <div className="hc-card" ref={pickRef}>
          <h3>☑️ Invoice Picked Visits</h3>
          <p className="mt-0 text-sm text-gray-600 dark:text-slate-400">
            Choose a client and dates, tick the scheduled visits to bill, and a draft invoice is created for exactly those
            visits. Cancelled visits never appear; visits already billed are marked.
          </p>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="pick-client">Client *</label>
              <select id="pick-client" value={pickForm.clientId} onChange={(e) => setPickForm({ ...pickForm, clientId: e.target.value })}>
                <option value="">Select client...</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.firstName} {client.lastName}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pick-from">From *</label>
              <input id="pick-from" type="date" value={pickForm.from} onChange={(e) => setPickForm({ ...pickForm, from: e.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="pick-to">To *</label>
              <input id="pick-to" type="date" value={pickForm.to} onChange={(e) => setPickForm({ ...pickForm, to: e.target.value })} />
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="hc-btn hc-btn-secondary" onClick={loadPickVisits} disabled={pickLoading}>{pickLoading ? 'Loading…' : 'Show Visits'}</button>
          </div>
          {pickVisits.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="hc-table text-sm">
                <thead><tr><th scope="col"><span className="sr-only">Pick</span></th><th>Date</th><th>Time</th><th>Caregiver</th><th>Hours</th><th>Billed</th></tr></thead>
                <tbody>
                  {pickVisits.map((v) => {
                    const key = pickKey(v)
                    return (
                      <tr key={key}>
                        <td>
                          <input type="checkbox" aria-label={`Bill the ${formatDate(v.visitDate)} ${hhmm12(v.startTime)} visit`}
                            disabled={!!v.billedOn} checked={!!pickChosen[key]}
                            onChange={(e) => setPickChosen((prev) => ({ ...prev, [key]: e.target.checked }))} />
                        </td>
                        <td>{formatDate(v.visitDate, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                        <td>{hhmm12(v.startTime)}–{hhmm12(v.endTime)}</td>
                        <td>{v.caregiverName || '—'}</td>
                        <td>{(Number(v.minutes) / 60).toFixed(2)}</td>
                        <td>{v.billedOn ? <span className="text-gray-600 dark:text-slate-400">on {v.billedOn}</span> : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="form-actions">
                <button type="button" className="hc-btn hc-btn-primary" onClick={createFromPicked} disabled={pickLoading || !Object.values(pickChosen).some(Boolean)}>
                  Create Draft Invoice ({Object.values(pickChosen).filter(Boolean).length} visit{Object.values(pickChosen).filter(Boolean).length === 1 ? '' : 's'})
                </button>
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => { setShowPickPanel(false); setPickVisits([]); setPickChosen({}) }}>Close</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid">
        <div className="hc-stat-card">
          <h3>Outstanding A/R</h3>
          <div className="value" style={{ color: 'var(--hc-red-ink)' }}>{formatCurrency(outstandingTotal)}</div>
          {draftCount > 0 && (
            <p className="m-0 text-xs text-gray-600 dark:text-slate-400">
              + {formatCurrency(draftTotal)} in {draftCount} draft{draftCount === 1 ? '' : 's'} not sent yet (not billed)
            </p>
          )}
        </div>
        <div className="hc-stat-card">
          <h3>Collected (All Time)</h3>
          <div className="value" style={{ color: 'var(--hc-green-ink)' }}>{formatCurrency(paidTotal)}</div>
        </div>
        <div className="hc-stat-card">
          <h3>Over 90 Days</h3>
          <div className="value" style={{ color: agingBuckets.over90 > 0 ? 'var(--hc-red-ink)' : 'var(--hc-green-ink)' }}>{formatCurrency(agingBuckets.over90)}</div>
        </div>
        <div className="hc-stat-card">
          <h3>Active Authorizations</h3>
          <div className="value">{authorizations.filter((a) => { const end = parseDate(a.endDate); return !!end && end >= new Date() }).length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="hc-card">
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          {tabs.map((tab) => (
            <button key={tab.id} className={`hc-btn ${activeTab === tab.id ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
          ))}
        </div>
      </div>

      {/* Generate Invoice — step 2: review the days before the invoice exists */}
      {showReconcile && reconcileData && (() => {
        const reviewRows = reconcileData.reconcile
        // Any day whose clock-in differs from its schedule gets the Scheduled / Clocked buttons — not just the ones over
        // the 7-minute grace. The server bills whichever basis is picked per day.
        const differs = (r: ReconcileRow) => r.status !== 'no_punch' && r.status !== 'unscheduled'
          && r.clockedMinutes != null && r.scheduledMinutes != null
          && r.clockedMinutes !== r.scheduledMinutes
        const needs = reviewRows.filter((r) => r.needsChoice || differs(r))
        const settled = reviewRows.filter((r) => !(r.needsChoice || differs(r)))
        const choosable = needs.filter((r) => r.status !== 'unscheduled')
        const pickAll = (basis: string) => setReconcileChoices((prev) => {
          const next = { ...prev }
          choosable.forEach((r) => { next[r.key] = basis })
          return next
        })
        const money = (n: Num) => `${formatMoney((Number(n) || 0))}`
        const mins = (m: number | null | undefined) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`)
        // Punch times come back already on the agency's clock (clockedStartLabel).
        const clockRange = (r: ReconcileRow) => (r.clockedStartLabel ? `${r.clockedStartLabel}–${r.clockedEndLabel || '…'}` : '')
        const pick = (key: string, basis: string) => setReconcileChoices((prev) => ({ ...prev, [key]: basis }))
        // A self-contained pill: its ground and its ink are set together, in both themes.
        const pill = (active: boolean, danger: boolean) => `rounded-md border px-3 py-1 text-xs font-bold ${active
          ? (danger
            ? 'border-red-600 bg-red-100 text-red-800 dark:border-red-400 dark:bg-red-900/40 dark:text-red-200'
            : 'border-emerald-600 bg-emerald-100 text-emerald-800 dark:border-emerald-400 dark:bg-emerald-900/40 dark:text-emerald-200')
          : 'border-gray-300 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}`
        const overlaps = reviewRows.filter((r) => (r.overlapMinutes ?? 0) > 0)

        return (
          <div className="hc-card" style={{ maxWidth: 'none' }} ref={reconcileRef}>
            <h3>🧾 Review Before Invoicing</h3>
            <p className="mt-0 text-sm text-gray-600 dark:text-slate-400">
              Days with no clock-in bill their <strong>scheduled</strong> hours.{' '}
              {needs.length === 0 ? 'Every clock-in matches its schedule.'
                : needs.length === 1 ? 'This day clocked in differently from the schedule — pick which to bill.'
                  : `These ${needs.length} days clocked in differently from the schedule — pick which to bill for each.`}
              {reconcileData.rate && <> Billing at {rateLabel({ rate: Number(reconcileData.rate.rate), rateType: reconcileData.rate.rateType })} ({reconcileData.rate.source === 'client_private_pay_rate' ? 'client private-pay rate' : 'payer contract rate'}).</>}
            </p>
            {choosable.length > 1 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-700 dark:text-slate-200">Set all {choosable.length} days to:</span>
                <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => pickAll('scheduled')}>Scheduled</button>
                <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => pickAll('clocked')}>Clocked</button>
              </div>
            )}

            {overlaps.length > 0 && (
              <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200">
                <div className="mb-1 font-extrabold">⚠️ Possible double-billed handoff — two schedules overlap on the same day</div>
                <div className="text-sm">
                  {overlaps.map((r) => (
                    <div key={'ov-' + r.key}>
                      {formatDate(r.serviceDate, { month: 'short', day: 'numeric' })}: {r.caregiverName} {hhmm12(r.scheduledStart)}–{hhmm12(r.scheduledEnd)} overlaps {r.overlapWith} by {mins(r.overlapMinutes)} — both bill in full
                    </div>
                  ))}
                  <div className="mt-1 font-semibold">Fix the schedule for those days (trim the handed-off hours), then re-open this review.</div>
                </div>
              </div>
            )}

            {needs.length === 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                ✅ Nothing to resolve — every clock-in matches its schedule.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="hc-table text-sm">
                  <thead><tr><th>Date</th><th>Caregiver</th><th>Scheduled</th><th>Clocked</th><th>Bill</th></tr></thead>
                  <tbody>
                    {needs.map((r) => {
                      const chosen = reconcileChoices[r.key] || r.defaultBasis
                      const wild = r.clockedMinutes != null && !!r.scheduledMinutes && r.clockedMinutes > r.scheduledMinutes * 2
                      // A punch with no schedule behind it: the schedule is the invoice, so the default is DON'T BILL —
                      // fix the schedule and re-open, or explicitly bill a genuine extra visit.
                      const noSched = r.status === 'unscheduled'
                      const short = (r.clockedMinutes ?? 0) < (r.scheduledMinutes ?? 0)
                      return (
                        <tr key={r.key} className={REVIEW_ROW}>
                          <td><strong>{formatDate(r.serviceDate, { month: 'short', day: 'numeric' })}</strong></td>
                          <td>{r.caregiverName}</td>
                          <td>{noSched
                            ? <span className="font-bold text-red-700 dark:text-red-300">not on schedule</span>
                            : <>{hhmm12(r.scheduledStart)}–{hhmm12(r.scheduledEnd)}<br />
                              <span className="text-gray-600 dark:text-slate-400">{mins(r.scheduledMinutes)} · {money(r.scheduledAmount)}</span></>}</td>
                          <td>
                            {clockRange(r)}<br />
                            <span className={short ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}>
                              {mins(r.clockedMinutes)} · {money(r.clockedAmount)}
                              {noSched ? '' : short ? ' (short)' : ' (over)'}
                            </span>
                            {wild && <div className="text-xs text-red-700 dark:text-red-300">likely a missed clock-out</div>}
                            {noSched && <div className="text-xs text-gray-600 dark:text-slate-400">add it to the schedule if this visit should bill normally</div>}
                          </td>
                          <td>
                            <div className="flex gap-1.5">
                              {noSched ? (
                                <>
                                  <button type="button" className={pill(chosen !== 'clocked', false)} onClick={() => pick(r.key, 'skip')}>Don't bill $0.00</button>
                                  <button type="button" className={pill(chosen === 'clocked', true)} onClick={() => pick(r.key, 'clocked')}>Bill clocked {money(r.clockedAmount)}</button>
                                </>
                              ) : (
                                <>
                                  <button type="button" className={pill(chosen === 'scheduled', false)} onClick={() => pick(r.key, 'scheduled')}>Scheduled {money(r.scheduledAmount)}</button>
                                  <button type="button" className={pill(chosen === 'clocked', wild)} onClick={() => pick(r.key, 'clocked')}>Clocked {money(r.clockedAmount)}</button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="mt-3">
              <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setShowSettledDays(!showSettledDays)}>
                {showSettledDays ? 'Hide' : 'Show'} the other {settled.length} day{settled.length === 1 ? '' : 's'}
              </button>
              <span className="ml-3 text-sm text-gray-600 dark:text-slate-400">
                {reconcileData.counts.noPunch} with no clock-in · {reconcileData.counts.match} matching · {reconcileData.counts.unscheduled} unscheduled
              </span>
            </div>

            {showSettledDays && (
              <div className="mt-2 overflow-x-auto">
                <table className="hc-table text-sm">
                  <thead><tr><th>Date</th><th>Caregiver</th><th>Billing</th><th>Basis</th><th>Amount</th></tr></thead>
                  <tbody>
                    {settled.map((r) => (
                      <tr key={r.key} className={REVIEW_ROW}>
                        <td>{formatDate(r.serviceDate, { month: 'short', day: 'numeric' })}</td>
                        <td>{r.caregiverName}</td>
                        <td>{r.chosenBasis === 'scheduled' ? `${hhmm12(r.scheduledStart)}–${hhmm12(r.scheduledEnd)}` : clockRange(r)}</td>
                        <td>{r.status === 'no_punch' ? 'no clock-in' : r.status === 'unscheduled' ? 'unscheduled visit' : 'matches'}</td>
                        <td>{money(r.chosenBasis === 'clocked' ? r.clockedAmount : r.scheduledAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {(reconcileData.skipped || []).length > 0 && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                <div className="mb-1 font-extrabold">
                  🚫 Not billed — {reconcileData.skipped.length} visit{reconcileData.skipped.length === 1 ? '' : 's'} cancelled in this period
                </div>
                <div className="mb-2 text-sm">These days are excluded from the invoice on purpose. They are listed so you can see why they are missing.</div>
                <div className="overflow-x-auto">
                  <table className="hc-table mb-0 text-sm">
                    <thead><tr><th>Date</th><th>Scheduled</th><th>Caregiver</th><th>Reason</th><th>Reported by</th><th>Note</th></tr></thead>
                    <tbody>
                      {reconcileData.skipped.map((s, i) => (
                        <tr key={`${s.serviceDate}-${i}`} className={REVIEW_ROW}>
                          <td>{formatDate(s.serviceDate, { month: 'short', day: 'numeric' })}</td>
                          <td>{hhmm12(s.scheduledStart)}–{hhmm12(s.scheduledEnd)}</td>
                          <td>{s.caregiverName || '—'}</td>
                          <td className="font-bold">{cancelReasonLabel(s.reason)}</td>
                          <td>{s.reportedBy || '—'}{s.reportedByRole === 'caregiver' ? ' (caregiver)' : ''}</td>
                          <td>{(s.notes || '').replace(/^Client unavailable — [^:]+:?\s*/, '') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-lg font-extrabold text-gray-900 dark:text-slate-100">Invoice total: {money(reconcileTotal())}</div>
              <div className="flex gap-2">
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => { setShowReconcile(false); setReconcileData(null) }}>Back</button>
                <button type="button" className="hc-btn hc-btn-primary" onClick={() => handleGenerateInvoice()}>Create Invoice</button>
              </div>
            </div>
          </div>
        )
      })()}

      {showGenerateForm && !showReconcile && (
        <div className="hc-card hc-card-form" ref={generateRef}>
          <h3>Generate Invoice</h3>
          <form onSubmit={handleReviewInvoice}>
            <div className="form-grid">
              <div className="form-group">
                <label>Client *</label>
                <select value={formData.clientId} onChange={(e) => setFormData({ ...formData, clientId: e.target.value })} required>
                  <option value="">Select client...</option>
                  {clients.map((client) => <option key={client.id} value={client.id}>{client.firstName} {client.lastName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Billing Period Start *</label>
                <input type="date" value={formData.billingPeriodStart} onChange={(e) => setFormData({ ...formData, billingPeriodStart: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Billing Period End *</label>
                <input type="date" value={formData.billingPeriodEnd} onChange={(e) => setFormData({ ...formData, billingPeriodEnd: e.target.value })} required />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="hc-btn hc-btn-primary" disabled={reconcileLoading}>
                {reconcileLoading ? 'Reading the period…' : 'Review Days →'}
              </button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowGenerateForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Manual Invoice Form */}
      {showManualForm && (
        <div className="hc-card" style={{ maxWidth: 'none' }} ref={manualRef}>
          <h3>✏️ Manual Invoice Entry</h3>
          <p className="text-muted">Create an invoice with manually entered line items (no time entries required).</p>
          <form onSubmit={handleManualInvoice}>
            <div className="form-grid">
              <div className="form-group">
                <label>Client *</label>
                <select value={manualFormData.clientId} onChange={(e) => setManualFormData({ ...manualFormData, clientId: e.target.value })} required>
                  <option value="">Select client...</option>
                  {clients.map((client) => <option key={client.id} value={client.id}>{client.firstName} {client.lastName}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Billing Period Start *</label>
                <input type="date" value={manualFormData.billingPeriodStart} onChange={(e) => setManualFormData({ ...manualFormData, billingPeriodStart: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Billing Period End *</label>
                <input type="date" value={manualFormData.billingPeriodEnd} onChange={(e) => setManualFormData({ ...manualFormData, billingPeriodEnd: e.target.value })} required />
              </div>
            </div>

            {/* Import from Schedule + EVV — pulls all shifts for the selected client + dates */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-800 dark:bg-blue-950/40">
              <div className="text-sm text-blue-900 dark:text-blue-200">
                <strong>📥 Auto-fill line items</strong> from this client's schedule and any
                completed EVV visits in the period. You can edit before saving.
              </div>
              <button type="button" className="hc-btn hc-btn-primary" onClick={handleImportFromSchedule} disabled={previewLoading}>
                {previewLoading ? 'Loading…' : '📥 Import from Schedule + EVV'}
              </button>
            </div>

            {/* Mode Toggle */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '1.5rem', marginBottom: '1rem', padding: '0.75rem', background: 'var(--hc-subtle)', borderRadius: '8px', flexWrap: 'wrap' }}>
              <label style={{ fontWeight: '600', margin: 0, marginRight: '0.5rem' }}>Format:</label>
              <button type="button" className={`hc-btn hc-btn-sm ${!detailedMode ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setDetailedMode(false)}>Summary</button>
              <button type="button" className={`hc-btn hc-btn-sm ${detailedMode ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setDetailedMode(true)}>Detailed ✓</button>
            </div>

            <h4 style={{ marginTop: '1rem', marginBottom: '1rem' }}>Line Items</h4>

            {/* Card-based line items for better responsiveness */}
            {manualLineItems.map((item, index) => (
              <div key={index} style={{ border: '1px solid var(--hc-line)', borderRadius: '8px', padding: '1rem', marginBottom: '0.75rem', background: 'var(--hc-subtle)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <strong style={{ color: 'var(--hc-ink-soft)' }}>Line Item {index + 1}</strong>
                    {item._source === 'evv_confirmed' && (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[0.7rem] font-bold text-green-800 dark:bg-green-900/40 dark:text-green-200">✓ EVV CONFIRMED</span>
                    )}
                    {item._source === 'scheduled' && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">📅 SCHEDULED (no EVV)</span>
                    )}
                    {item._source === 'unscheduled_evv' && (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[0.7rem] font-bold text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">⚠ UNSCHEDULED EVV</span>
                    )}
                  </div>
                  {manualLineItems.length > 1 && (
                    <button type="button" className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => removeManualLineItem(index)}>✕ Remove</button>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                  {detailedMode && (
                    <div className="form-group" style={{ margin: 0 }}>
                      <label style={{ fontSize: '0.8rem' }}>Date *</label>
                      <input type="date" value={item.serviceDate} onChange={(e) => updateManualLineItem(index, 'serviceDate', e.target.value)} required={detailedMode} />
                    </div>
                  )}

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>Caregiver</label>
                    <select value={item.caregiverId} onChange={(e) => updateManualLineItem(index, 'caregiverId', e.target.value)}>
                      <option value="">Select...</option>
                      {caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
                    </select>
                  </div>

                  <div className="form-group" style={{ margin: 0, gridColumn: 'span 2' }}>
                    <label style={{ fontSize: '0.8rem' }}>Description</label>
                    <input type="text" value={item.description} onChange={(e) => updateManualLineItem(index, 'description', e.target.value)} placeholder="Home Care Services" />
                  </div>

                  {detailedMode && (
                    <>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.8rem' }}>Start Time</label>
                        <select value={item.startTime} onChange={(e) => updateManualLineItem(index, 'startTime', e.target.value)}>
                          <option value="">Select...</option>
                          {TIME_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.8rem' }}>End Time</label>
                        <select value={item.endTime} onChange={(e) => updateManualLineItem(index, 'endTime', e.target.value)}>
                          <option value="">Select...</option>
                          {TIME_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>Hours *</label>
                    <input type="number" step="0.25" min="0" value={item.hours} onChange={(e) => updateManualLineItem(index, 'hours', e.target.value)} placeholder="0.00" required />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>Rate</label>
                    <div
                      title={manualRate ? `From the ${manualRate.source} — change it on the client, not here` : 'Select a client with a configured rate'}
                      className={`whitespace-nowrap rounded-md border border-gray-200 bg-gray-100 px-2.5 py-2 font-bold dark:border-slate-600 dark:bg-slate-700 ${manualRate ? 'text-gray-900 dark:text-slate-100' : 'text-red-700 dark:text-red-300'}`}
                    >
                      {rateLabel(manualRate)}
                    </div>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8rem' }}>Amount</label>
                    <div className="rounded-md bg-green-50 p-2.5 font-semibold text-green-800 dark:bg-green-950/40 dark:text-green-200">
                      {formatCurrency(amountAt(item.hours, manualRate))}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Totals row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'var(--hc-info-bg)', borderRadius: '8px', marginBottom: '1rem' }}>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={addManualLineItem}>+ Add Line Item</button>
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: 'var(--hc-info-ink)', marginRight: '1rem' }}>Total:</span>
                <strong style={{ fontSize: '1.3rem', color: 'var(--hc-info-ink)' }}>{formatCurrency(calculateManualTotal())}</strong>
              </div>
            </div>

            <div className="form-group">
              <label>Notes</label>
              <textarea value={manualFormData.notes} onChange={(e) => setManualFormData({ ...manualFormData, notes: e.target.value })} rows={2} placeholder="Optional notes..." />
            </div>

            <div className="form-actions">
              <button type="submit" className="hc-btn hc-btn-primary">Create Invoice</button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={() => { setShowManualForm(false); setManualLineItems([{ ...EMPTY_MANUAL_LINE }]) }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Batch Generate Form */}
      {showBatchForm && (
        <div className="hc-card hc-card-form" ref={batchRef}>
          <h3>Batch Generate Invoices</h3>
          <p className="text-muted">Generate invoices for all clients with billable hours in the selected period.</p>
          <form onSubmit={handleBatchGenerate}>
            <div className="form-grid">
              <div className="form-group">
                <label>Start Date *</label>
                <input type="date" value={batchFormData.billingPeriodStart} onChange={(e) => setBatchFormData({ ...batchFormData, billingPeriodStart: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>End Date *</label>
                <input type="date" value={batchFormData.billingPeriodEnd} onChange={(e) => setBatchFormData({ ...batchFormData, billingPeriodEnd: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Client Type</label>
                <select value={batchFormData.clientFilter} onChange={(e) => setBatchFormData({ ...batchFormData, clientFilter: e.target.value })}>
                  <option value="all">All Clients</option>
                  <option value="insurance">Insurance Only</option>
                  <option value="private">Private Pay Only</option>
                </select>
              </div>
              <div className="form-group">
                <label>Specific Payer</label>
                <select value={batchFormData.referralSourceId} onChange={(e) => setBatchFormData({ ...batchFormData, referralSourceId: e.target.value })}>
                  <option value="">All Payers</option>
                  {referralSources.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="hc-btn hc-btn-primary" disabled={loading}>{loading ? 'Generating...' : 'Generate All'}</button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowBatchForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* INVOICES TAB */}
      {activeTab === 'invoices' && (
        invoices.length === 0 ? (
          <div className="hc-card hc-card-centered"><p>No invoices yet. Generate your first invoice above.</p></div>
        ) : (
          <table className="hc-table">
            <thead>
              <tr>
                <th>Invoice #</th><th>Client</th><th>Payer</th><th>Period</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const paid = parseFloat(String(invoice.amountPaid || 0))
                const total = parseFloat(String(invoice.total || 0))
                const balance = balanceOf(invoice)
                return (
                  <tr key={invoice.id}>
                    <td>
                      {invoice.seqNumber != null && <div className="text-[0.95rem] font-extrabold">#{invoice.seqNumber}</div>}
                      <div className="font-mono text-[0.7rem] text-gray-600 dark:text-slate-400" title="Internal unique code (use this for system lookups)">
                        {invoice.invoiceNumber}
                      </div>
                    </td>
                    <td>{invoice.firstName} {invoice.lastName}</td>
                    <td>{invoice.referralSourceName || <span className="hc-badge hc-badge-info">Private</span>}</td>
                    <td>{formatDate(invoice.billingPeriodStart)} - {formatDate(invoice.billingPeriodEnd)}</td>
                    <td><strong>{formatCurrency(total)}</strong></td>
                    <td style={{ color: 'var(--hc-green-ink)' }}>{formatCurrency(paid)}</td>
                    <td style={{ color: balance > 0 ? 'var(--hc-red-ink)' : 'var(--hc-green-ink)' }}>{formatCurrency(balance)}</td>
                    <td>
                      <span className={`hc-badge ${invoice.paymentStatus === 'paid' ? 'hc-badge-success' : invoice.paymentStatus === 'partial' ? 'hc-badge-warning' : 'hc-badge-danger'}`}>
                        {invoice.paymentStatus?.toUpperCase()}
                      </span>
                      {!invoice.sentAt && (
                        <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-[0.7rem] font-bold text-gray-800 dark:bg-slate-700 dark:text-slate-200"
                          title="Not visible in the family portal until you send or release it">
                          🔒 DRAFT
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button className="hc-btn hc-btn-sm hc-btn-primary" onClick={() => handleViewInvoice(invoice.id)}>View</button>
                        {may.create && invoice.paymentStatus !== 'paid' && (
                          <button className="hc-btn hc-btn-sm hc-btn-success" onClick={() => openPayment(invoice.id)}>Pay</button>
                        )}
                        {may.delete && <button className="hc-btn hc-btn-sm hc-btn-danger" aria-label={`Delete invoice ${invoiceLabel(invoice)}`} onClick={() => handleDeleteInvoice(invoice.id, invoiceLabel(invoice))}>🗑️</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      )}

      {/* A/R AGING TAB */}
      {activeTab === 'aging' && (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
            <div className="hc-stat-card" style={{ borderLeftColor: '#28a745' }}><h3>Current</h3><div className="value">{formatCurrency(agingBuckets.current)}</div></div>
            <div className="hc-stat-card" style={{ borderLeftColor: '#ffc107' }}><h3>1-30 Days</h3><div className="value">{formatCurrency(agingBuckets.thirtyDays)}</div></div>
            <div className="hc-stat-card" style={{ borderLeftColor: '#fd7e14' }}><h3>31-60 Days</h3><div className="value">{formatCurrency(agingBuckets.sixtyDays)}</div></div>
            <div className="hc-stat-card" style={{ borderLeftColor: '#dc3545' }}><h3>61-90 Days</h3><div className="value">{formatCurrency(agingBuckets.ninetyDays)}</div></div>
            <div className="hc-stat-card" style={{ borderLeftColor: '#721c24', background: agingBuckets.over90 > 0 ? 'var(--hc-danger-bg)' : undefined }}><h3>Over 90</h3><div className="value">{formatCurrency(agingBuckets.over90)}</div></div>
          </div>
          <div className="hc-card">
            <h3>Outstanding Invoices</h3>
            <p className="mt-0 text-sm text-gray-600 dark:text-slate-400">Sent or released invoices with a balance. Drafts are not owed until you send or release them.</p>
            <table className="hc-table">
              <thead>
                <tr><th>Invoice #</th><th>Client</th><th>Payer</th><th>Due Date</th><th>Days Overdue</th><th>Balance</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {invoices.filter((inv) => isReleased(inv) && balanceOf(inv) > 0.005)
                  .sort((a, b) => (parseDate(a.paymentDueDate)?.getTime() ?? 0) - (parseDate(b.paymentDueDate)?.getTime() ?? 0))
                  .map((invoice) => {
                    const daysOverdue = daysSince(invoice.paymentDueDate)
                    const balance = balanceOf(invoice)
                    return (
                      <tr key={invoice.id}>
                        <td>
                          {invoice.seqNumber != null && <div className="font-extrabold">#{invoice.seqNumber}</div>}
                          <div className="font-mono text-[0.7rem] text-gray-600 dark:text-slate-400">{invoice.invoiceNumber}</div>
                        </td>
                        <td>{invoice.firstName} {invoice.lastName}</td>
                        <td>{invoice.referralSourceName || 'Private Pay'}</td>
                        <td>{formatDate(invoice.paymentDueDate)}</td>
                        <td><span className={`hc-badge ${daysOverdue <= 0 ? 'hc-badge-success' : daysOverdue <= 30 ? 'hc-badge-warning' : 'hc-badge-danger'}`}>{daysOverdue <= 0 ? 'Current' : `${daysOverdue} days`}</span></td>
                        <td><strong>{formatCurrency(balance)}</strong></td>
                        <td>
                          {may.create && <>
                          <button className="hc-btn hc-btn-sm hc-btn-success" onClick={() => openPayment(invoice.id)}>Pay</button>
                          <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => { setAdjustmentFormData({ ...adjustmentFormData, invoiceId: invoice.id }); setShowAdjustmentModal(true) }}>Adjust</button>
                          </>}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* AUTHORIZATIONS TAB */}
      {activeTab === 'authorizations' && (
        <div className="hc-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Service Authorizations</h3>
            {may.create && <button className="hc-btn hc-btn-primary" onClick={() => setShowAuthModal(true)}>+ Add Authorization</button>}
          </div>
          {authorizations.length === 0 ? (
            <p className="text-muted text-center">No authorizations on file.</p>
          ) : (
            <table className="hc-table">
              <thead>
                <tr><th>Client</th><th>Payer</th><th>Auth #</th><th>Service</th><th>Authorized</th><th>Used</th><th>Remaining</th><th>Period</th><th>Status</th></tr>
              </thead>
              <tbody>
                {authorizations.map((auth) => {
                  const usage = getAuthUsage(auth)
                  const end = parseDate(auth.endDate)
                  const isExpired = !!end && end < new Date()
                  const isLow = usage.percentage >= 80
                  return (
                    <tr key={auth.id} style={{ background: isExpired ? 'var(--hc-danger-bg)' : isLow ? 'var(--hc-warning-bg)' : undefined }}>
                      <td><strong>{getClientName(auth)}</strong></td>
                      <td>{getRSName(auth)}</td>
                      <td>{auth.authNumber}</td>
                      {/* The service type the add form sends is not a column of authorizations (it was never stored). */}
                      <td>—</td>
                      <td>{usage.authorized} {auth.unitType}</td>
                      <td>{usage.used.toFixed(2)} ({usage.percentage.toFixed(0)}%)</td>
                      <td style={{ color: usage.remaining < 10 ? 'var(--hc-red-ink)' : 'var(--hc-green-ink)', fontWeight: 'bold' }}>{usage.remaining.toFixed(2)}</td>
                      <td>{formatDate(auth.startDate)} - {formatDate(auth.endDate)}</td>
                      <td>{isExpired ? <span className="hc-badge hc-badge-danger">EXPIRED</span> : isLow ? <span className="hc-badge hc-badge-warning">LOW</span> : <span className="hc-badge hc-badge-success">ACTIVE</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* PAYMENTS TAB */}
      {activeTab === 'payments' && (
        <div className="hc-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Payment History</h3>
            {may.create && <button className="hc-btn hc-btn-primary" onClick={() => setShowPaymentModal(true)}>+ Record Payment</button>}
          </div>
          {payments.length === 0 ? (
            <p className="text-muted text-center">No payments recorded.</p>
          ) : (
            <table className="hc-table">
              <thead>
                <tr><th>Date</th><th>Invoice #</th><th>Client</th><th>Amount</th><th>Method</th><th>Reference #</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{formatDate(payment.paymentDate)}</td>
                    <td><strong>{payment.invoiceNumber}</strong></td>
                    <td>{payment.clientName}</td>
                    <td style={{ color: 'var(--hc-green-ink)', fontWeight: 'bold' }}>{formatCurrency(payment.amount)}</td>
                    <td><span className="hc-badge hc-badge-info">{payment.paymentMethod?.toUpperCase()}</span></td>
                    <td>{payment.referenceNumber || '-'}</td>
                    <td>{payment.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* RATES TAB */}
      {activeTab === 'rates' && (
        <div className="hc-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>Payer Contract Rates</h3>
            {may.create && <button className="hc-btn hc-btn-primary" onClick={() => setShowRateForm(!showRateForm)}>{showRateForm ? 'Cancel' : '+ Add Rate'}</button>}
          </div>

          {missingRates.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
              <div className="mb-1.5 font-bold text-amber-900 dark:text-amber-200">
                ⚠️ {missingRates.length} payer × care-type combo{missingRates.length === 1 ? '' : 's'} have active clients but no configured rate
              </div>
              <div className="text-sm text-amber-900 dark:text-amber-200">
                Invoices for these clients will be refused until a rate exists. Click "Add Rate" above and configure each:
              </div>
              <div className="mt-2 grid gap-1">
                {missingRates.map((m, i) => (
                  <div key={i} className="flex justify-between rounded bg-white px-2 py-1 text-sm text-gray-900 dark:bg-slate-800 dark:text-slate-100">
                    <span><strong>{m.payerName}</strong> + <strong>{m.careTypeName}</strong></span>
                    <span className="text-gray-600 dark:text-slate-400">{m.affectedClients} client{Number(m.affectedClients) === 1 ? '' : 's'} affected</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {showRateForm && (
            <form onSubmit={handleAddRate} style={{ marginBottom: '1.5rem', padding: '1rem', background: 'var(--hc-subtle)', borderRadius: '8px' }}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Payer *</label>
                  <select value={rateFormData.referralSourceId} onChange={(e) => setRateFormData({ ...rateFormData, referralSourceId: e.target.value })} required>
                    <option value="">Select payer...</option>
                    {referralSources.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Care Type *</label>
                  <select value={rateFormData.careTypeId} onChange={(e) => setRateFormData({ ...rateFormData, careTypeId: e.target.value })} required>
                    <option value="">Select care type...</option>
                    {careTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Rate Type *</label>
                  <select value={rateFormData.rateType} onChange={(e) => setRateFormData({ ...rateFormData, rateType: e.target.value })}>
                    <option value="hourly">Per Hour</option>
                    <option value="15min">Per 15 Minutes</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Rate Amount *</label>
                  <input type="number" step="0.01" min="0" value={rateFormData.rateAmount} onChange={(e) => setRateFormData({ ...rateFormData, rateAmount: e.target.value })} required />
                </div>
              </div>
              <div className="form-actions"><button type="submit" className="hc-btn hc-btn-primary">Add Rate</button></div>
            </form>
          )}
          {rates.length === 0 ? (
            <p className="text-muted text-center">No rates configured.</p>
          ) : (
            <table className="hc-table">
              <thead><tr><th>Payer</th><th>Care Type</th><th>Rate</th><th>Type</th><th>Effective</th><th title="Active clients with this payer + care type combo">Clients</th><th>Actions</th></tr></thead>
              <tbody>
                {rates.map((rate) => {
                  const count = Number(rate.clientCount || 0)
                  const retired = rate.isActive === false
                  return (
                    <tr key={rate.id} className={retired ? 'opacity-60' : ''}>
                      <td><strong>{rate.referralSourceName}</strong></td>
                      <td>{rate.careTypeName || <em className="text-gray-600 dark:text-slate-400">any</em>}</td>
                      <td><strong>{formatCurrency(rate.rateAmount)}</strong></td>
                      <td><span className="hc-badge hc-badge-info">{rate.rateType === 'hourly' ? 'Per Hour' : 'Per 15 Min'}</span></td>
                      <td>
                        {formatDate(rate.effectiveDate)}
                        {retired && <div className="text-xs text-gray-600 dark:text-slate-400">retired {rate.endDate ? formatDate(rate.endDate) : ''} — still prices the days before</div>}
                      </td>
                      <td>
                        {retired ? '—' : count > 0
                          ? <span className="font-semibold text-emerald-700 dark:text-emerald-300">{count} {count === 1 ? 'client' : 'clients'}</span>
                          : <span className="text-amber-700 dark:text-amber-300" title="No active clients use this rate — orphaned config?">⚠️ none</span>}
                      </td>
                      <td>{may.delete && <button className="hc-btn hc-btn-sm hc-btn-danger" onClick={() => handleDeleteRate(rate.id)}>Delete</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* PAYMENT MODAL */}
      {showPaymentModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Record Payment</h2>
              <button className="close-btn" aria-label="Close" onClick={() => setShowPaymentModal(false)}>×</button>
            </div>
            <form onSubmit={handleRecordPayment}>
              <div className="form-group">
                <label>Invoice *</label>
                <select value={paymentFormData.invoiceId} onChange={(e) => setPaymentFormData({ ...paymentFormData, invoiceId: e.target.value })} required>
                  <option value="">Select invoice...</option>
                  {invoices.filter((i) => i.paymentStatus !== 'paid').map((inv) => (
                    <option key={inv.id} value={inv.id}>{inv.seqNumber != null ? `#${inv.seqNumber} (${inv.invoiceNumber})` : inv.invoiceNumber} - {inv.firstName} {inv.lastName} - {formatCurrency(inv.total)}</option>
                  ))}
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group"><label>Amount *</label><input type="number" step="0.01" min="0" value={paymentFormData.amount} onChange={(e) => setPaymentFormData({ ...paymentFormData, amount: e.target.value })} required /></div>
                <div className="form-group"><label>Payment Date *</label><input type="date" value={paymentFormData.paymentDate} onChange={(e) => setPaymentFormData({ ...paymentFormData, paymentDate: e.target.value })} required /></div>
                <div className="form-group">
                  <label>Payment Method</label>
                  <select value={paymentFormData.paymentMethod} onChange={(e) => setPaymentFormData({ ...paymentFormData, paymentMethod: e.target.value })}>
                    <option value="check">Check</option><option value="ach">ACH</option><option value="credit_card">Credit Card</option><option value="cash">Cash</option><option value="eft">EFT</option>
                  </select>
                </div>
                <div className="form-group"><label>Reference #</label><input type="text" value={paymentFormData.referenceNumber} onChange={(e) => setPaymentFormData({ ...paymentFormData, referenceNumber: e.target.value })} placeholder="Check # or transaction ID" /></div>
              </div>
              <div className="form-group"><label>Notes</label><textarea value={paymentFormData.notes} onChange={(e) => setPaymentFormData({ ...paymentFormData, notes: e.target.value })} rows={2} /></div>
              <div className="modal-actions">
                <button type="submit" className="hc-btn hc-btn-primary">Record Payment</button>
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowPaymentModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AUTHORIZATION MODAL */}
      {showAuthModal && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>Add Authorization</h2>
              <button className="close-btn" aria-label="Close" onClick={() => setShowAuthModal(false)}>×</button>
            </div>
            <form onSubmit={handleAddAuthorization}>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Client *</label>
                  <select value={authFormData.clientId} onChange={(e) => setAuthFormData({ ...authFormData, clientId: e.target.value })} required>
                    <option value="">Select client...</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Payer *</label>
                  <select value={authFormData.referralSourceId} onChange={(e) => setAuthFormData({ ...authFormData, referralSourceId: e.target.value })} required>
                    <option value="">Select payer...</option>
                    {referralSources.map((rs) => <option key={rs.id} value={rs.id}>{rs.name}</option>)}
                  </select>
                </div>
                <div className="form-group"><label>Authorization # *</label><input type="text" value={authFormData.authorizationNumber} onChange={(e) => setAuthFormData({ ...authFormData, authorizationNumber: e.target.value })} required /></div>
                <div className="form-group"><label>Service Type</label><input type="text" value={authFormData.serviceType} onChange={(e) => setAuthFormData({ ...authFormData, serviceType: e.target.value })} placeholder="e.g., Personal Care" /></div>
                <div className="form-group"><label>Authorized Units *</label><input type="number" step="0.25" min="0" value={authFormData.authorizedUnits} onChange={(e) => setAuthFormData({ ...authFormData, authorizedUnits: e.target.value })} required /></div>
                <div className="form-group">
                  <label>Unit Type</label>
                  <select value={authFormData.unitType} onChange={(e) => setAuthFormData({ ...authFormData, unitType: e.target.value })}>
                    <option value="15min">15-Minute Units</option><option value="hours">Hours</option><option value="visits">Visits</option><option value="days">Days</option>
                  </select>
                </div>
                <div className="form-group"><label>Start Date *</label><input type="date" value={authFormData.startDate} onChange={(e) => setAuthFormData({ ...authFormData, startDate: e.target.value })} required /></div>
                <div className="form-group"><label>End Date *</label><input type="date" value={authFormData.endDate} onChange={(e) => setAuthFormData({ ...authFormData, endDate: e.target.value })} required /></div>
              </div>
              <div className="form-group"><label>Notes</label><textarea value={authFormData.notes} onChange={(e) => setAuthFormData({ ...authFormData, notes: e.target.value })} rows={2} /></div>
              <div className="modal-actions">
                <button type="submit" className="hc-btn hc-btn-primary">Add Authorization</button>
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowAuthModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADJUSTMENT MODAL */}
      {showAdjustmentModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Record Adjustment</h2>
              <button className="close-btn" aria-label="Close" onClick={() => setShowAdjustmentModal(false)}>×</button>
            </div>
            <form onSubmit={handleRecordAdjustment}>
              <div className="form-group">
                <label>Invoice *</label>
                <select value={adjustmentFormData.invoiceId} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, invoiceId: e.target.value })} required>
                  <option value="">Select invoice...</option>
                  {invoices.filter((i) => i.paymentStatus !== 'paid').map((inv) => <option key={inv.id} value={inv.id}>{inv.seqNumber != null ? `#${inv.seqNumber} (${inv.invoiceNumber})` : inv.invoiceNumber} - {formatCurrency(inv.total)}</option>)}
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label>Type *</label>
                  <select value={adjustmentFormData.type} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, type: e.target.value })}>
                    <option value="write_off">Write Off</option><option value="adjustment">Adjustment</option><option value="discount">Discount</option><option value="refund">Refund</option>
                  </select>
                </div>
                <div className="form-group"><label>Amount *</label><input type="number" step="0.01" min="0" value={adjustmentFormData.amount} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, amount: e.target.value })} required /></div>
              </div>
              <div className="form-group"><label>Reason *</label><input type="text" value={adjustmentFormData.reason} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, reason: e.target.value })} placeholder="e.g., Uncollectable" required /></div>
              <div className="form-group"><label>Notes</label><textarea value={adjustmentFormData.notes} onChange={(e) => setAdjustmentFormData({ ...adjustmentFormData, notes: e.target.value })} rows={2} /></div>
              <div className="modal-actions">
                <button type="submit" className="hc-btn hc-btn-primary">Record Adjustment</button>
                <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setShowAdjustmentModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INVOICE DETAIL MODAL - Professional Print Layout */}
      {showInvoiceModal && selectedInvoice && (
        <div className="modal active">
          <div className="modal-content modal-large" style={{ maxWidth: '900px' }}>
            {/* Screen-only header */}
            <div className="modal-header no-print">
              <h2>Invoice {selectedInvoice.seqNumber != null ? `#${selectedInvoice.seqNumber}` : selectedInvoice.invoiceNumber}
                {selectedInvoice.seqNumber != null && (
                  <span className="ml-2 font-mono text-[0.7rem] font-normal text-gray-600 dark:text-slate-400">{selectedInvoice.invoiceNumber}</span>
                )}
              </h2>
              <button className="close-btn" aria-label="Close" onClick={() => setShowInvoiceModal(false)}>×</button>
            </div>

            {/* Printable Invoice */}
            <div id="printable-invoice" className="invoice-print-container">
              <style>{`
                @media print {
                  @page { margin: 10mm; size: letter; }
                  body * { visibility: hidden; }
                  #printable-invoice, #printable-invoice * { visibility: visible; }
                  html, body { height: auto !important; overflow: visible !important; }
                  #root, .main-content, .container { overflow: visible !important; height: auto !important; }
                  .sidebar { display: none !important; }
                  .main-content { margin-left: 0 !important; width: 100% !important; }
                  .modal, .modal.active {
                    position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important;
                    height: auto !important; overflow: visible !important; background: none !important; padding: 0 !important;
                    display: block !important;
                  }
                  .modal-content, .modal-large {
                    position: relative !important; overflow: visible !important; max-height: none !important; height: auto !important;
                    box-shadow: none !important; padding: 0 !important; margin: 0 !important; max-width: 100% !important; width: 100% !important;
                  }
                  #printable-invoice { position: relative !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
                  .no-print { display: none !important; visibility: hidden !important; }
                  .invoice-table tr { page-break-inside: avoid; break-inside: avoid; }
                }
                .invoice-print-container {
                  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                  color: #333; background: white; padding: 20px; line-height: 1.3; font-size: 12px;
                }
                .invoice-header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
                .invoice-header-left { display: flex; flex-direction: column; }
                .invoice-logo-large { max-width: 200px; height: auto; margin-bottom: 15px; }
                .invoice-company-info { font-size: 12px; color: #555; line-height: 1.5; }
                .invoice-company-name { font-size: 16px; font-weight: 600; color: #333; margin-bottom: 3px; }
                .invoice-header-right { text-align: right; }
                /* Scoped to the sheet: the app's dark-mode heading rule (.dark h1, index.css) out-specifies a bare class and
                   printed a white title on this always-white paper (1.00:1, found in the browser 2026-10-19). */
                .invoice-print-container .invoice-title-large { font-size: 36px; font-weight: 300; color: #333; margin: 0; letter-spacing: 2px; }
                .invoice-number-display { font-size: 14px; color: #555; margin-top: 5px; }
                .invoice-balance-box { margin-top: 15px; text-align: right; }
                .invoice-balance-label { font-size: 11px; color: #6b7280; text-transform: uppercase; }
                .invoice-balance-amount { font-size: 28px; font-weight: 600; color: var(--hc-brand-deep); }
                .invoice-details-row { display: flex; justify-content: space-between; margin-bottom: 15px; padding-bottom: 15px; }
                .invoice-bill-to { flex: 1; }
                .invoice-bill-to-label { font-size: 11px; color: #6b7280; margin-bottom: 5px; }
                .invoice-bill-to-name { font-size: 15px; font-weight: 600; color: #333; margin-bottom: 3px; }
                .invoice-bill-to-address { font-size: 12px; color: #555; line-height: 1.5; }
                .invoice-dates { text-align: right; }
                .invoice-date-row { display: flex; justify-content: flex-end; gap: 20px; margin-bottom: 6px; font-size: 13px; }
                .invoice-date-label { color: #555; }
                .invoice-date-value { font-weight: 500; min-width: 100px; text-align: right; }
                .invoice-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }
                .invoice-table thead { background: var(--hc-brand-deep); }
                .invoice-table th { color: white; padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; border: none; }
                .invoice-table th:first-child { width: 30px; text-align: center; }
                .invoice-table th:nth-child(2) { width: auto; }
                .invoice-table th:nth-child(3) { width: 60px; text-align: right; }
                .invoice-table th:nth-child(4) { width: 70px; text-align: right; }
                .invoice-table th:last-child { width: 90px; text-align: right; }
                .invoice-table td { padding: 6px 12px; border-bottom: 1px solid #eee; font-size: 13px; vertical-align: middle; }
                .invoice-table td:first-child { text-align: center; color: #6b7280; }
                .invoice-table td:nth-child(3) { text-align: right; }
                .invoice-table td:nth-child(4) { text-align: right; }
                .invoice-table td:last-child { text-align: right; font-weight: 500; }
                .invoice-item-description { font-weight: 500; color: #333; }
                .invoice-item-details { font-size: 11px; color: #6b7280; margin-top: 3px; line-height: 1.4; }
                .invoice-totals-section { display: flex; justify-content: flex-end; margin-top: 0; }
                .invoice-totals-box { width: 280px; }
                .invoice-total-row { display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
                .invoice-total-row:last-child { border-bottom: none; }
                .invoice-total-label { color: #555; }
                .invoice-total-value { font-weight: 500; text-align: right; min-width: 80px; }
                .invoice-total-row.grand-total { background: var(--hc-brand-deep); color: white; font-weight: 600; font-size: 14px; }
                .invoice-total-row.grand-total .invoice-total-label,
                .invoice-total-row.grand-total .invoice-total-value { color: white; font-weight: 600; }
                .invoice-notes-section { margin-top: 20px; padding-top: 10px; }
                .invoice-notes-label { font-size: 12px; font-weight: 600; color: #333; margin-bottom: 5px; }
                .invoice-notes-text { font-size: 12px; color: #555; white-space: pre-line; }
                .invoice-footer-section { margin-top: 25px; padding-top: 10px; border-top: 1px solid #ddd; text-align: center; color: #6b7280; font-size: 11px; }
              `}</style>

              {/* Header Row: Logo+Company on Left, Invoice Title+Balance on Right */}
              <div className="invoice-header-row">
                <div className="invoice-header-left">
                  {company?.logo && (
                    <img src={company.logo} alt={company?.name || ''} className="invoice-logo-large"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  )}
                  <div className="invoice-company-info">
                    <div className="invoice-company-name">{company?.name}</div>
                    {company?.address && <div>{company.address}</div>}
                    {coLine && <div>{coLine}</div>}
                    <div>U.S.A</div>
                    {company?.phone && <div>{company.phone}</div>}
                    {company?.email && <div>{company.email}</div>}
                  </div>
                </div>
                <div className="invoice-header-right">
                  <h1 className="invoice-title-large">INVOICE</h1>
                  <div className="invoice-number-display">
                    {selectedInvoice.seqNumber != null ? `Invoice #${selectedInvoice.seqNumber}` : `# ${selectedInvoice.invoiceNumber}`}
                    {selectedInvoice.seqNumber != null && (
                      <div style={{ fontSize: '0.7rem', color: '#6b7280', fontFamily: 'monospace', fontWeight: 400 }}>Ref: {selectedInvoice.invoiceNumber}</div>
                    )}
                  </div>
                  <div className="invoice-balance-box">
                    <div className="invoice-balance-label">Balance Due</div>
                    <div className="invoice-balance-amount">{formatCurrency(balanceOf(selectedInvoice))}</div>
                  </div>
                </div>
              </div>

              {/* Details Row: Bill To on Left, Dates on Right */}
              <div className="invoice-details-row">
                <div className="invoice-bill-to">
                  <div className="invoice-bill-to-label">Bill To</div>
                  <div className="invoice-bill-to-name">{selectedInvoice.firstName} {selectedInvoice.lastName}</div>
                  <div className="invoice-bill-to-address">
                    {selectedInvoice.address && <>{selectedInvoice.address}<br /></>}
                    {selectedInvoice.city && <>{selectedInvoice.city}<br /></>}
                    {selectedInvoice.state && <>{selectedInvoice.state}<br /></>}
                    U.S.A
                  </div>
                </div>
                <div className="invoice-dates">
                  <div className="invoice-date-row">
                    <span className="invoice-date-label">Invoice Date :</span>
                    {/* created_at is an instant: its day on the agency's clock */}
                    <span className="invoice-date-value">{formatAgencyDate(selectedInvoice.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </div>
                  <div className="invoice-date-row">
                    <span className="invoice-date-label">Terms :</span>
                    {/* The invoice engine sets the due date 30 days after the billing period ends (core/invoiceEngine.ts);
                        the terms say so. They read "Due on Receipt" beside that later due date. */}
                    <span className="invoice-date-value">{selectedInvoice.paymentDueDate ? '30 days after the period ends' : 'Due on Receipt'}</span>
                  </div>
                  <div className="invoice-date-row">
                    <span className="invoice-date-label">Due Date :</span>
                    <span className="invoice-date-value">
                      {(selectedInvoice.paymentDueDate || selectedInvoice.billingPeriodEnd)
                        ? formatDate(selectedInvoice.paymentDueDate || selectedInvoice.billingPeriodEnd, { day: '2-digit', month: 'short', year: 'numeric' })
                        : formatAgencyDate(selectedInvoice.createdAt, { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <table className="invoice-table">
                <thead>
                  <tr><th>#</th><th>Item & Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
                </thead>
                <tbody>
                  {selectedInvoice.lineItems?.length > 0 ? (
                    selectedInvoice.lineItems.map((item, idx) => {
                      const tasks = Array.isArray(item.visitTasks) ? (item.visitTasks as { done?: boolean; taskName?: string }[]) : []
                      return (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td>
                            <div className="invoice-item-description">{item.description || 'Home Care Services'}</div>
                            <div className="invoice-item-details">
                              {item.serviceDate && formatDate(item.serviceDate, { month: '2-digit', day: '2-digit' })}
                              {item.caregiverFirstName && ` - ${item.caregiverFirstName} ${item.caregiverLastName}`}
                              {item.timeRange && ` ${item.timeRange}`}
                            </div>
                            {/* The visit's care note, printed once per visit (a visit bills two lines — aide + homemaking —
                                and the payer wants the documentation for the care, not for each split line). */}
                            {item.visitNote && visitNoteKey(item) !== visitNoteKey(selectedInvoice.lineItems[idx - 1]) && (
                              <div className="invoice-item-note" style={{ fontSize: '0.78em', color: '#555', fontStyle: 'italic', marginTop: '2px' }}>
                                {tasks.filter((t) => t.done).map((t) => t.taskName).join('; ')}
                                {tasks.some((t) => t.done) ? ' — ' : ''}
                                {item.visitNote}
                              </div>
                            )}
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>{lineQty(item).qty}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{lineQty(item).rate}</td>
                          <td>{(parseFloat(String(item.amount)) || 0).toFixed(2)}</td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td>1</td>
                      <td>
                        <div className="invoice-item-description">Home Care Services</div>
                        <div className="invoice-item-details">{formatDate(selectedInvoice.billingPeriodStart)} - {formatDate(selectedInvoice.billingPeriodEnd)}</div>
                      </td>
                      <td>{(parseFloat(String(selectedInvoice.totalHours ?? 0)) || 0).toFixed(2)}</td>
                      <td>—</td>
                      <td>{(parseFloat(String(selectedInvoice.total)) || 0).toFixed(2)}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Totals */}
              <div className="invoice-totals-section">
                <div className="invoice-totals-box">
                  <div className="invoice-total-row">
                    <span className="invoice-total-label">Sub Total</span>
                    <span className="invoice-total-value">{(parseFloat(String(selectedInvoice.subtotal || selectedInvoice.total)) || 0).toFixed(2)}</span>
                  </div>
                  <div className="invoice-total-row">
                    <span className="invoice-total-label">Total</span>
                    <span className="invoice-total-value"><strong>{formatMoney((parseFloat(String(selectedInvoice.total)) || 0))}</strong></span>
                  </div>
                  {parseFloat(String(selectedInvoice.amountPaid || 0)) > 0 && (
                    <div className="invoice-total-row">
                      <span className="invoice-total-label">Amount Paid</span>
                      <span className="invoice-total-value" style={{ color: '#1e7e34' }}>-{formatMoney(parseFloat(String(selectedInvoice.amountPaid)))}</span>
                    </div>
                  )}
                  {parseFloat(String(selectedInvoice.amountAdjusted || 0)) > 0 && (
                    <div className="invoice-total-row">
                      <span className="invoice-total-label">Written Off / Discount</span>
                      <span className="invoice-total-value">-{formatMoney(parseFloat(String(selectedInvoice.amountAdjusted)))}</span>
                    </div>
                  )}
                  <div className="invoice-total-row grand-total">
                    <span className="invoice-total-label">Balance Due</span>
                    <span className="invoice-total-value">{formatMoney(balanceOf(selectedInvoice))}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="invoice-notes-section">
                <div className="invoice-notes-label">Notes</div>
                <div className="invoice-notes-text">{selectedInvoice.notes || 'Thanks for your business.'}</div>
              </div>

              {/* Footer */}
              <div className="invoice-footer-section">
                <div>{company?.name}</div>
                <div>Thank you for choosing us for your home care needs.</div>
              </div>
            </div>

            {/* Draft / released state (screen only) */}
            <div className={`no-print mt-4 rounded-lg border px-3.5 py-2.5 text-sm ${selectedInvoice.sentAt
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200'
              : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'}`}>
              {selectedInvoice.sentAt
                ? `✓ Sent — visible in the family portal since ${formatAgencyDate(selectedInvoice.sentAt)}`
                : '🔒 DRAFT — the family cannot see this invoice until you send it, create a pay link, or release it to the portal.'}
            </div>

            {/* Action Buttons (screen only) */}
            <div className="modal-actions no-print" style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--hc-line)' }}>
              {may.update && !selectedInvoice.sentAt && (
                <button className="hc-btn hc-btn-success" onClick={() => handleReleaseToPortal(selectedInvoice)}>👁️ Release to Portal</button>
              )}
              {may.update && selectedInvoice.sentAt && !['paid', 'partial'].includes(selectedInvoice.paymentStatus) && (
                <button className="hc-btn hc-btn-warning" onClick={() => handleRescindInvoice(selectedInvoice)}>↩️ Rescind (hide from portal)</button>
              )}
              {selectedInvoice.paymentStatus !== 'paid' && (
                <>
                  {may.update && <button className="hc-btn hc-btn-secondary" onClick={() => openLineItemEditor(selectedInvoice)}>✏️ Edit Line Items</button>}
                  {may.create && <button className="hc-btn hc-btn-success" onClick={() => { setPaymentFormData({ ...paymentFormData, invoiceId: selectedInvoice.id }); setShowInvoiceModal(false); setShowPaymentModal(true) }}>💳 Record Payment</button>}
                  {may.update && <button className="hc-btn hc-btn-warning" onClick={() => handleMarkPaid(selectedInvoice.id)}>✓ Mark Paid</button>}
                  {may.update && <button className="hc-btn hc-btn-primary" onClick={() => handleCreatePaymentLink(selectedInvoice)} disabled={creatingPaymentLink}>
                    {creatingPaymentLink ? '🔗 Generating...' : '🔗 Get Stripe Pay Link'}
                  </button>}
                </>
              )}
              {may.update && <button className="hc-btn hc-btn-info" onClick={() => handleSendInvoiceEmail(selectedInvoice)} disabled={sendingInvoiceEmail}>
                {sendingInvoiceEmail ? '📧 Sending...' : '📧 Send Invoice'}
              </button>}
              {may.update && selectedInvoice.paymentStatus !== 'paid' && (
                <button className="hc-btn hc-btn-warning" onClick={() => handleSendInvoiceReminder(selectedInvoice)} disabled={sendingInvoiceEmail}>
                  {sendingInvoiceEmail ? '⏰ Sending...' : '⏰ Send Reminder'}
                </button>
              )}
              <button className="hc-btn hc-btn-primary" onClick={() => window.print()}>🖨️ Print Invoice</button>
              <button className="hc-btn hc-btn-secondary" onClick={() => setShowInvoiceModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT LINE ITEMS MODAL — after the invoice modal it is opened from, so it sits on top of it (the template rendered
          it first, under the invoice modal of the same z-index). Its table uses the invoice table's look, whose styles
          the invoice modal above carries. */}
      {editingInvoice && (
        <div className="modal active">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h2>Edit Invoice {editingInvoice.seqNumber != null ? `#${editingInvoice.seqNumber}` : editingInvoice.invoiceNumber}</h2>
              <button className="close-btn" aria-label="Close the line-item editor" onClick={() => setEditingInvoice(null)}>×</button>
            </div>
            <p className="text-muted" style={{ marginTop: 0 }}>
              Edit, add, or remove line items, then save — totals recalculate automatically. A paid invoice can't be edited.
            </p>
            <table className="invoice-table">
              <thead>
                <tr><th style={{ width: '38%' }}>Description</th><th>Date</th><th>Hours</th><th>Rate</th><th>Amount</th><th></th></tr>
              </thead>
              <tbody>
                {editLines.map((l, idx) => (
                  <tr key={idx}>
                    <td><input type="text" value={l.description} onChange={(e) => updateEditLine(idx, 'description', e.target.value)} placeholder="Home Care Services" style={{ width: '100%' }} /></td>
                    <td><input type="date" value={l.serviceDate} onChange={(e) => updateEditLine(idx, 'serviceDate', e.target.value)} /></td>
                    <td><input type="text" inputMode="decimal" aria-label={`Hours, line ${idx + 1}`} value={l.hours} onChange={(e) => updateEditLine(idx, 'hours', e.target.value)} style={{ width: 80 }} /></td>
                    <td title="Set on the client (Clients → Edit), not per line">
                      {l.writeOff ? <span className="text-gray-600 dark:text-slate-400">$0 (write-off)</span> : editRate != null ? rateLabel(editRateInfo) : <span className="text-red-700 dark:text-red-300">No rate set</span>}
                    </td>
                    <td>{formatCurrency(editLineAmount(l))}</td>
                    <td><button type="button" className="hc-btn hc-btn-secondary" onClick={() => removeEditLine(idx)} title="Remove line" aria-label={`Remove line ${idx + 1}`}>🗑️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={addEditLine}>+ Add Line</button>
              <div style={{ fontWeight: 700 }}>Total: {formatCurrency(editGrandTotal())}</div>
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button type="button" className="hc-btn hc-btn-primary" onClick={saveLineItems} disabled={savingLineItems}>{savingLineItems ? 'Saving…' : 'Save Changes'}</button>
              <button type="button" className="hc-btn hc-btn-secondary" onClick={() => setEditingInvoice(null)} disabled={savingLineItems}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BillingDashboard
