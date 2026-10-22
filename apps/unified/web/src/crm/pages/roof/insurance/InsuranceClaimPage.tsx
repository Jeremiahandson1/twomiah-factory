// Moved from templates/crm-roof/frontend/src/pages/roofing/InsuranceClaimPage.tsx (docs/UNIFIED_ROOF_SCREENS.md, the
// insurance group). The claim on an insurance job: its status rail, details, money, the Xactimate scope, supplements and
// the claim's activity trail — over /api/insurance (server/crm/roof/insurance/insurance.ts).
//
// What changed from the template, each because the unified server answers differently or the rulebook says so:
//   · the app's API client — the session is the server's cookies, no token;
//   · supplements and activity are lists, { data, pagination };
//   · approve / deny are offered on `can('insurance:approve')`, the permission those routes ask, not a role list;
//   · the money rule is read per record: a claim or a supplement the server sent with `moneyWithheld` is drawn without
//     figures — never $0 — and a draft whose prices were withheld can have only its reason edited (saving its lines
//     would have written every price back as 0);
//   · the Xactimate files are the signed-in GET /api/insurance/claims/:id/files/:file (invoices:read);
//   · a refusal reads the server's own sentence (a wrong box, a job with no measurement, storage not set up).
import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Shield, Phone, Mail, FileText, Plus, X, Send,
  CheckCircle, XCircle, Clock, MessageSquare, Upload, Download,
  AlertTriangle, DollarSign, Save, ChevronRight, Loader2,
} from 'lucide-react'
import { api } from '../../../../api'
import { useConfirm, useMayWrite, usePermissions, useToast, errorText } from '../../../../shared'
import { formatDate } from '../../../date'

// ── What the server answers (server/crm/roof/insurance/insurance.ts). Numeric columns arrive as strings. ──────────────

type Amount = string | number | null | undefined

interface Claim {
  id: string
  jobId: string
  claimNumber: string
  insuranceCompany: string
  policyNumber?: string | null
  adjusterName?: string | null
  adjusterPhone?: string | null
  adjusterEmail?: string | null
  adjusterCompany?: string | null
  dateOfLoss?: string | null
  causeOfLoss?: string | null
  claimStatus: string
  denialReason?: string | null
  adjusterInspectionDate?: string | null
  deductible?: Amount
  rcv?: Amount
  acv?: Amount
  depreciationHeld?: Amount
  supplementAmount?: Amount
  finalApprovedAmount?: Amount
  xactimateScopeUrl?: string | null
  xactimateExportUrl?: string | null
  /** Set by the server for a seat without invoices:read: the six figures above are absent, not zero. (T63) */
  moneyWithheld?: boolean
}

interface SupplementLine {
  code?: string
  description: string
  qty?: number
  quantity?: number
  unit?: string
  unitPrice?: number
  unitCost?: number
  total?: number
}

interface Supplement {
  id: string
  supplementNumber: string
  status: string
  reason?: string | null
  lineItems?: SupplementLine[] | null
  totalAmount?: Amount
  approvedAmount?: Amount
  denialReason?: string | null
  /** The supplement's totals and its line prices were left out for this seat. */
  moneyWithheld?: boolean
}

interface Activity {
  id: string
  activityType: string
  body: string
  createdAt?: string | null
  metadata?: { callDuration?: string | number; subject?: string } | null
}

interface ExportLine { code: string; description: string; qty: number; unit: string; total?: number }

interface ExportResult {
  lineItems?: ExportLine[]
  basis?: 'ask' | 'approved'
  totals?: { subtotal: number; overhead: number; profit: number; rcvTotal: number }
  moneyWithheld?: boolean
}

/** GET /api/jobs/:id (roofing's job module) — the claim page reads only the job's type. */
interface JobInfo { id: string; jobType?: string | null }

interface ListReply<T> { data: T[]; pagination: { page: number; limit: number; total: number; pages: number } }

/** A line in the supplement forms: money and quantity held as the TEXT being typed (see num0 below). */
interface SupRow { code: string; description: string; qty: string; unit: string; unitPrice: string; total: number }
interface EditRow { code: string; description: string; qty: string; unit: string; unitPrice: string }

type LoadFault = 'notAllowed' | 'failed' | null

/** The refusal's status and code, as the shared client puts them on the error (api/client.ts handleResponse). */
const statusOf = (e: unknown): number | undefined => (e as { status?: number } | null)?.status
const codeOf = (e: unknown): string | undefined => (e as { data?: { code?: string } } | null)?.data?.code

/** The export and the files need the company's document store; until it is set up the server answers 503. */
const STORAGE_NOT_SET_UP = 'Document storage isn’t set up for this account yet, so the scope can’t be saved or opened. Contact Twomiah to have it switched on.'

const CLAIM_STAGES = [
  'filed', 'adjuster_assigned', 'inspection_scheduled',
  'inspected', 'approved', 'closed',
] as const

const CLAIM_STAGE_LABELS: Record<string, string> = {
  filed: 'Filed',
  adjuster_assigned: 'Adjuster Assigned',
  inspection_scheduled: 'Inspection Scheduled',
  inspected: 'Inspected',
  approved: 'Approved',
  supplemented: 'Supplemented',
  denied: 'Denied',
  closed: 'Closed',
}

const ACTIVITY_ICONS: Record<string, string> = {
  note: 'msg', call: 'phone', email: 'mail', inspection: 'check',
  approval: 'check', supplement: 'doc', denial: 'x',
  document_uploaded: 'upload', status_change: 'clock', xactimate_export: 'doc',
}

const SUP_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:text-slate-300 dark:bg-slate-800',
  submitted: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40',
  approved: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
  denied: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
  partial: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
}

function formatStatus(s: string) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function fmt$(n: Amount) {
  if (n == null || n === '') return '—'
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** A stored calendar day (UTC midnight) as the YYYY-MM-DD a date box takes. */
function dayInput(v?: string | null): string {
  if (!v) return ''
  const d = new Date(v)
  return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0]
}

/** When an activity happened: the day through formatDate, then the time of day. */
function when(v?: string | null): string {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return ''
  return `${formatDate(v)} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

// A money/qty field being typed into holds a STRING, not a number.
//
// The create modal used to coerce on every keystroke — `Number(e.target.value)`, later wrapped in
// `Math.max(0, …)` to stop negatives. That does stop the negative, but it replaces what the typist
// entered with a different, plausible number and says nothing: an intended -1500 becomes a positive
// line nobody queries. Silently rewriting someone's figure is worse than refusing it, because there
// is no wrong-looking value to notice. (roof T18 L7)
//
// So the field keeps the raw text, `num0` is used only to price the row while it is being filled in,
// and the value is checked once on submit — the same shape the EDIT modal below already used.
const num0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
/**
 * A quantity or a price for the RUNNING TOTAL, which is never negative. (T41)
 *
 * num0 above turns half-typed text into 0 so the typist keeps seeing what they typed — but a minus
 * sign is a number, so "-50" priced a line at minus fifty and the modal displayed a supplement worth
 * less than nothing. The server refuses negative money, so that total was a figure it would never
 * accept. Clamped here, and the modal says why below.
 */
const price0 = (v: unknown) => Math.max(0, num0(v))
const anyNegative = (rows: { qty?: string; unitPrice?: string }[]) =>
  rows.some((r) => num0(r.qty) < 0 || num0(r.unitPrice) < 0)
const newSupRow = (): SupRow => ({ code: '', description: '', qty: '1', unit: 'SQ', unitPrice: '', total: 0 })

// Xactimate code options for line item picker
const XACT_CODES = [
  { code: 'RFG 220', desc: 'Remove asphalt shingles', unit: 'SQ' },
  { code: 'RFG 240', desc: 'Asphalt shingles - 30yr', unit: 'SQ' },
  { code: 'RFG 252', desc: 'Roofing felt - 30lb', unit: 'SQ' },
  { code: 'RFG 300', desc: 'Drip edge', unit: 'LF' },
  { code: 'RFG 180', desc: 'Ice & water shield', unit: 'SQ' },
  { code: 'RFG 350', desc: 'Ridge cap shingles', unit: 'LF' },
  { code: 'WTR 052', desc: 'Flashing', unit: 'LF' },
  { code: 'RFG 100', desc: 'Roof deck repair - plywood', unit: 'SF' },
  { code: 'RFG 260', desc: 'Starter strip', unit: 'LF' },
  { code: 'GUT 100', desc: 'Gutter - aluminum', unit: 'LF' },
  { code: 'GUT 110', desc: 'Downspout - aluminum', unit: 'LF' },
  { code: 'SKY 100', desc: 'Skylight replacement', unit: 'EA' },
  { code: 'VNT 100', desc: 'Roof vent', unit: 'EA' },
  { code: 'PLM 100', desc: 'Plumbing stack flashing', unit: 'EA' },
]

const EMPTY_CLAIM = { claimNumber: '', insuranceCompany: '', policyNumber: '', dateOfLoss: '', causeOfLoss: '', deductible: '' }

export default function InsuranceClaimPage() {
  const confirm = useConfirm()
  // Offer a write only where we know it is allowed. Each permission is the one its own route asks for.
  const mayWriteClaim = useMayWrite('insurance:create')
  // The claim's own fields are a PUT, and that route asks for the update verb rather than create.
  const mayEditClaim = useMayWrite('insurance:update')
  const { id: jobId } = useParams<{ id: string }>()
  const toast = useToast()
  const navigate = useNavigate()
  // Approve / deny ask insurance:approve on the server (the template's requireManager, a rank list). Offering the buttons
  // to a seat without it would hand them a 403 on a decision they cannot make. (roof T17)
  const { can } = usePermissions()
  const canDecide = can('insurance:approve')

  const [claim, setClaim] = useState<Claim | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [supplements, setSupplements] = useState<Supplement[]>([])
  const [loading, setLoading] = useState(true)
  // The claim itself failed to load for a reason other than "there is none" — said so, never drawn as an empty job.
  const [loadFailed, setLoadFailed] = useState(false)

  // Activity modal
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityType, setActivityType] = useState('note')
  const [activityBody, setActivityBody] = useState('')
  const [activityMeta, setActivityMeta] = useState<{ callDuration?: string; subject?: string }>({})
  const [submittingActivity, setSubmittingActivity] = useState(false)

  // Supplement modal
  const [supOpen, setSupOpen] = useState(false)
  const [supReason, setSupReason] = useState('')
  const [supLineItems, setSupLineItems] = useState<SupRow[]>([newSupRow()])
  const [supNotes, setSupNotes] = useState('')
  const [submittingSup, setSubmittingSup] = useState(false)

  // Xactimate export
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  // null = loaded fine. 'notAllowed' = this seat may not read it. 'failed' = something else. (T41)
  const [activityError, setActivityError] = useState<LoadFault>(null)
  const [supplementError, setSupplementError] = useState<LoadFault>(null)

  // Starting a claim: the empty state carries the one control that starts one.
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null)
  const [startOpen, setStartOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newClaim, setNewClaim] = useState(EMPTY_CLAIM)

  const load = useCallback(async () => {
    let claimData: Claim
    try {
      claimData = await api.get(`/api/insurance/claims/${jobId}`)
    } catch (e) {
      setClaim(null)
      if (statusOf(e) === 404) {
        // No claim yet. Read the job so the empty state can tell "not filed yet" apart from "this job is not an
        // insurance job" — the create endpoint refuses the second with a 400.
        setLoadFailed(false)
        try { setJobInfo(await api.get(`/api/jobs/${jobId}`)) } catch { setJobInfo(null) }
      } else {
        setLoadFailed(true)
      }
      setLoading(false)
      return
    }
    setClaim(claimData)
    setLoadFailed(false)

    const [act, sup] = await Promise.allSettled([
      api.get(`/api/insurance/claims/${claimData.id}/activity`) as Promise<ListReply<Activity>>,
      api.get(`/api/insurance/claims/${claimData.id}/supplements`) as Promise<ListReply<Supplement>>,
    ])
    // "NO ACTIVITY YET" AND "WE COULD NOT LOAD IT" ARE NOT THE SAME SENTENCE. (T41) A failed read is said as one.
    if (act.status === 'fulfilled') { setActivities(act.value?.data ?? []); setActivityError(null) }
    else { setActivities([]); setActivityError(statusOf(act.reason) === 403 ? 'notAllowed' : 'failed') }
    if (sup.status === 'fulfilled') { setSupplements(sup.value?.data ?? []); setSupplementError(null) }
    else { setSupplements([]); setSupplementError(statusOf(sup.reason) === 403 ? 'notAllowed' : 'failed') }
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  const createClaim = async () => {
    if (!newClaim.claimNumber.trim() || !newClaim.insuranceCompany.trim()) {
      toast.error('Claim number and insurance company are required')
      return
    }
    setCreating(true)
    try {
      // Only the two required fields are always sent; the rest go only when filled, because the server treats '' as a
      // value and would store an empty cause of loss as a real one.
      const payload: Record<string, string> = {
        jobId: String(jobId),
        claimNumber: newClaim.claimNumber.trim(),
        insuranceCompany: newClaim.insuranceCompany.trim(),
      }
      for (const k of ['policyNumber', 'dateOfLoss', 'causeOfLoss', 'deductible'] as const) {
        const v = String(newClaim[k] || '').trim()
        if (v) payload[k] = v
      }
      await api.post('/api/insurance/claims', payload)
      toast.success('Insurance claim started')
      setStartOpen(false)
      setNewClaim(EMPTY_CLAIM)
      await load()
    } catch (e) {
      // 409 means someone else filed it while this page was open — reload onto the real claim rather than reporting a
      // failure the user cannot act on.
      if (statusOf(e) === 409) { toast.error('A claim already exists for this job'); setStartOpen(false); await load(); return }
      toast.error(errorText(e, 'Could not start the claim'))
    } finally {
      setCreating(false)
    }
  }

  const saveClaim = async (updates: Partial<Record<keyof Claim, string>>) => {
    if (!claim) return
    try {
      const updated: Claim = await api.put(`/api/insurance/claims/${claim.id}`, updates)
      setClaim(updated)
      toast.success('Saved')
    } catch (e) {
      // The server names the box it refused ("deductible: must be an amount of 0 or more").
      toast.error(errorText(e, 'Failed to save'))
    }
  }

  const updateStatus = async (status: string) => {
    if (!claim) return
    try {
      const updated: Claim = await api.post(`/api/insurance/claims/${claim.id}/status`, { status })
      setClaim(updated)
      load() // Reload activities
      toast.success(`Status updated to ${formatStatus(status)}`)
    } catch (e) {
      toast.error(errorText(e, 'Failed to update status'))
    }
  }

  const submitActivity = async () => {
    if (!claim || !activityBody.trim()) return
    setSubmittingActivity(true)
    try {
      await api.post(`/api/insurance/claims/${claim.id}/activity`, {
        activityType,
        body: activityBody,
        metadata: Object.keys(activityMeta).length > 0 ? activityMeta : undefined,
      })
      setActivityOpen(false)
      setActivityBody('')
      setActivityMeta({})
      load()
      toast.success('Activity logged')
    } catch (e) {
      toast.error(errorText(e, 'Failed to log activity'))
    } finally {
      setSubmittingActivity(false)
    }
  }

  const createSupplement = async () => {
    if (!claim) return
    if (!supReason.trim()) { toast.error('Reason required'); return }
    // The fields hold text while they are being typed, so this is where it becomes money. A value that is not a number,
    // or is negative, is REFUSED and named — never quietly rounded up to 0. (roof T18 L7)
    const lineItems = supLineItems
      .filter((li) => String(li.description || '').trim())
      .map((li) => ({ ...li, qty: Number(li.qty), unitPrice: Number(li.unitPrice) }))
    if (!lineItems.length) { toast.error('A supplement needs at least one line item'); return }
    if (lineItems.some((li) => !Number.isFinite(li.qty) || li.qty < 0 || !Number.isFinite(li.unitPrice) || li.unitPrice < 0)) {
      toast.error('Quantity and price must be zero or more')
      return
    }
    const total = lineItems.reduce((s, li) => s + num0(li.total), 0)
    if (total <= 0) { toast.error('A supplement needs a total above zero'); return }
    setSubmittingSup(true)
    try {
      // totalAmount is deliberately not sent — the server computes it from the line items.
      await api.post(`/api/insurance/claims/${claim.id}/supplements`, {
        reason: supReason,
        lineItems,
        notes: supNotes || undefined,
      })
      setSupOpen(false)
      setSupReason('')
      setSupLineItems([newSupRow()])
      setSupNotes('')
      load()
      toast.success('Supplement created')
    } catch (e) {
      // Say what the server refused. A bare "Failed to create supplement" on a 400 leaves the typist re-pressing a
      // button that will never work.
      toast.error(errorText(e, 'Failed to create supplement'))
    } finally {
      setSubmittingSup(false)
    }
  }

  const submitSupplement = async (supId: string) => {
    try {
      await api.post(`/api/insurance/supplements/${supId}/submit`)
      load()
      toast.success('Supplement submitted')
    } catch (e) {
      toast.error(errorText(e, 'Failed to submit'))
    }
  }

  // ── editing a draft, and answering a submitted one ───────────────────────────────────────────────
  const [editSup, setEditSup] = useState<Supplement | null>(null)
  const [editReason, setEditReason] = useState('')
  const [editItems, setEditItems] = useState<EditRow[]>([])
  const [savingEdit, setSavingEdit] = useState(false)

  const [decideSup, setDecideSup] = useState<Supplement | null>(null)
  const [decideMode, setDecideMode] = useState<'approve' | 'deny'>('approve')
  const [approvedAmount, setApprovedAmount] = useState('')
  const [denialReason, setDenialReason] = useState('')
  const [deciding, setDeciding] = useState(false)

  const openEditSupplement = (sup: Supplement) => {
    setEditSup(sup)
    setEditReason(sup.reason || '')
    setEditItems((Array.isArray(sup.lineItems) ? sup.lineItems : []).map((li) => ({
      code: li.code || '', description: li.description || '', unit: li.unit || 'EA',
      qty: String(li.qty ?? li.quantity ?? 0), unitPrice: String(li.unitPrice ?? li.unitCost ?? 0),
    })))
  }

  const saveSupplementEdit = async () => {
    if (!editSup) return
    // A draft whose prices the server withheld from this seat: its lines came without them, so sending them back would
    // write every price as 0. Only the reason is changed. (The money rule, T63.)
    if (editSup.moneyWithheld) {
      setSavingEdit(true)
      try {
        await api.put(`/api/insurance/supplements/${editSup.id}`, { reason: editReason })
        setEditSup(null)
        load()
        toast.success('Supplement updated')
      } catch (e) {
        toast.error(errorText(e, 'Failed to update supplement'))
      } finally {
        setSavingEdit(false)
      }
      return
    }
    const lineItems = editItems
      .filter((li) => li.description.trim())
      .map((li) => ({ code: li.code || undefined, description: li.description, unit: li.unit || 'EA', qty: Number(li.qty), unitPrice: Number(li.unitPrice) }))
    if (!lineItems.length) { toast.error('A supplement needs at least one line item'); return }
    if (lineItems.some((li) => !Number.isFinite(li.qty) || li.qty < 0 || !Number.isFinite(li.unitPrice) || li.unitPrice < 0)) {
      toast.error('Quantity and price must be zero or more')
      return
    }
    setSavingEdit(true)
    try {
      // totalAmount is deliberately not sent — the server computes it from the line items.
      await api.put(`/api/insurance/supplements/${editSup.id}`, { reason: editReason, lineItems })
      setEditSup(null)
      load()
      toast.success('Supplement updated')
    } catch (e) {
      toast.error(errorText(e, 'Failed to update supplement'))
    } finally {
      setSavingEdit(false)
    }
  }

  const openDecide = (sup: Supplement, mode: 'approve' | 'deny') => {
    setDecideSup(sup)
    setDecideMode(mode)
    // Changing an existing approval starts from the figure already recorded, not from the ask; falls back to what was
    // requested. A seat the figures were withheld from starts from an empty box. (T41)
    setApprovedAmount(mode === 'approve' ? String(sup.approvedAmount ?? sup.totalAmount ?? '') : '')
    // …and amending a denial starts from the reason on the record, for the same reason.
    setDenialReason(mode === 'deny' ? String(sup.denialReason ?? '') : '')
  }

  const decide = async () => {
    if (!decideSup) return
    if (decideMode === 'approve') {
      const n = Number(approvedAmount)
      if (approvedAmount.trim() === '' || !Number.isFinite(n) || n < 0) { toast.error('Approved amount must be a number of 0 or more'); return }
      // An approval ABOVE the ask is allowed — an adjuster adds scope and the letter comes back higher — so this
      // confirms rather than refuses, and the claim's activity line records that it was above the ask. (T41) Asked only
      // where the ask is known: a seat the figures were withheld from would be comparing against $0.
      const asked = Number(decideSup.totalAmount ?? 0)
      if (!decideSup.moneyWithheld && n > asked + 0.005 && !(await confirm(
        `${decideSup.supplementNumber} asked the carrier for ${fmt$(asked)}, and you are recording ${fmt$(n)}. `
        + 'That is allowed — carriers do allow more than was asked — and the claim history will say so.',
        { title: 'Record more than was asked?', confirmText: 'Record it', danger: false },
      ))) return
    } else if (!denialReason.trim()) {
      toast.error('A denial needs a reason — it is what the claim record shows later')
      return
    }
    setDeciding(true)
    try {
      if (decideMode === 'approve') {
        await api.post(`/api/insurance/supplements/${decideSup.id}/approve`, { approvedAmount: String(Number(approvedAmount).toFixed(2)) })
      } else {
        await api.post(`/api/insurance/supplements/${decideSup.id}/deny`, { denialReason: denialReason.trim() })
      }
      setDecideSup(null)
      load()
      toast.success(decideMode === 'approve' ? 'Supplement approved' : 'Supplement denied')
    } catch (e) {
      toast.error(errorText(e, `Failed to ${decideMode} the supplement`))
    } finally {
      setDeciding(false)
    }
  }

  /**
   * TWO SCOPES, AND THE CONTRACTOR SAYS WHICH. (T41)
   *
   * `basis: 'ask'` is every supplement that has not been denied, at the amounts requested — the document that goes to
   * the carrier. `basis: 'approved'` is only the supplements the carrier approved, reconciled to the approved amount.
   */
  const generateExport = async (basis: 'ask' | 'approved' = 'ask') => {
    if (!claim) return
    setExporting(true)
    try {
      const result: ExportResult = await api.request(`/api/insurance/claims/${claim.id}/xactimate-export?basis=${basis}`, {
        method: 'POST',
        timeoutMs: 300000,
      })
      setExportResult(result)
      load()
      toast.success('Xactimate scope generated')
    } catch (e) {
      if (codeOf(e) === 'storage_not_configured') toast.error(STORAGE_NOT_SET_UP)
      // A job with no measurement is refused with a sentence that says what to add (no_measurement).
      else if (statusOf(e) === 400) toast.error(errorText(e, 'Failed to generate export'))
      else toast.error('Failed to generate export')
    } finally {
      setExporting(false)
    }
  }

  /**
   * Open one of the generated claim documents: GET /api/insurance/claims/:id/files/:file — signed in, the claim's own
   * company, invoices:read.
   *
   * Fetched through the app's client rather than opened as a plain link. A plain link would carry the session cookie
   * (GET needs no X-Auth-Mode header), but the access cookie lasts 15 minutes and only the client renews it — a link
   * clicked after that would open the server's raw 401 JSON in the tab — and a refusal (storage not set up, a seat
   * without invoices:read, a file no longer there) is said here as a sentence. The bytes are handed to the browser as a
   * blob; the object URL is revoked on the next tick. A CSV is saved rather than opened, as the server's
   * Content-Disposition asks.
   */
  const [fetchingDoc, setFetchingDoc] = useState<string | null>(null)
  const openDocument = async (url: string, filename: string) => {
    setFetchingDoc(url)
    try {
      const res = await api.raw(url)
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null
        if (body?.code === 'storage_not_configured') throw new Error(STORAGE_NOT_SET_UP)
        if (res.status === 401) throw new Error('Your session has expired — sign in again.')
        if (res.status === 403) throw new Error('Opening the scope needs permission to see the claim’s figures.')
        if (res.status === 404) throw new Error('That document is no longer there. Build the scope again to make a new one.')
        throw new Error('Could not open that document.')
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      if (filename.endsWith('.csv')) a.download = filename
      else a.target = '_blank'
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 0)
    } catch (e) {
      toast.error(errorText(e, 'Could not open that document.'))
    } finally {
      setFetchingDoc(null)
    }
  }

  const saveAdjusterToDirectory = async () => {
    if (!claim?.adjusterName) { toast.error('Adjuster name required'); return }
    try {
      await api.post('/api/insurance/adjusters', {
        name: claim.adjusterName,
        phone: claim.adjusterPhone,
        email: claim.adjusterEmail,
        adjusterCompany: claim.adjusterCompany ?? undefined,
        insuranceCarrier: claim.insuranceCompany,
      })
      toast.success('Saved to adjuster directory')
    } catch (e) {
      // The directory checks the phone and email the claim's own boxes don't ("must be a phone number…").
      toast.error(errorText(e, 'Failed to save adjuster'))
    }
  }

  const updateSupLineItem = (idx: number, field: keyof SupRow, value: string) => {
    setSupLineItems((prev) => prev.map((li, i) => {
      if (i !== idx) return li
      const updated: SupRow = { ...li, [field]: value }
      if (field === 'qty' || field === 'unitPrice') {
        // Half-typed text ("", "-", "1.") prices as 0 for the running total; it is not written back to the field.
        // price0, not num0: a typed minus sign made the line — and the running total — negative. (T41)
        updated.total = Math.round(price0(updated.qty) * price0(updated.unitPrice) * 100) / 100
      }
      if (field === 'code') {
        const match = XACT_CODES.find((c) => c.code === value)
        if (match) {
          updated.description = match.desc
          updated.unit = match.unit
        }
      }
      return updated
    }))
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" /></div>
  }

  if (!claim && loadFailed) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-8 text-center">
          <Shield className="w-10 h-10 mx-auto text-gray-400 mb-3" />
          <p className="text-sm text-amber-700 dark:text-amber-300">The insurance claim could not be loaded. Reload the page to try again.</p>
        </div>
      </div>
    )
  }

  if (!claim) {
    const notInsurance = !!jobInfo && jobInfo.jobType !== 'insurance'
    return (
      <div className="p-6 max-w-lg mx-auto">
        <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-8 text-center">
          <Shield className="w-10 h-10 mx-auto text-gray-400 mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">No insurance claim yet</h2>

          {notInsurance ? (
            // The create endpoint refuses a non-insurance job with a 400, so say that instead of offering a button that
            // cannot work.
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
              This job is set to <span className="font-medium">{String(jobInfo?.jobType || 'retail')}</span>. Change the job type to
              Insurance on the job first, then start the claim here.
            </p>
          ) : !startOpen ? (
            <>
              <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                Start one to track the adjuster, inspection, supplements and the Xactimate scope.
              </p>
              {mayWriteClaim ? (
                <button
                  onClick={() => setStartOpen(true)}
                  className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-semibold">
                  <Plus className="w-4 h-4" /> Start insurance claim
                </button>
              ) : (
                <p className="mt-5 text-sm text-gray-500 dark:text-slate-400">A manager opens the claim on this job.</p>
              )}
            </>
          ) : (
            <div className="mt-5 text-left space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Claim number <span className="text-red-700 dark:text-red-400">*</span></label>
                <input autoFocus value={newClaim.claimNumber} onChange={(e) => setNewClaim({ ...newClaim, claimNumber: e.target.value })}
                  className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" placeholder="CLM-2026-0001" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Insurance company <span className="text-red-700 dark:text-red-400">*</span></label>
                <input value={newClaim.insuranceCompany} onChange={(e) => setNewClaim({ ...newClaim, insuranceCompany: e.target.value })}
                  className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" placeholder="State Farm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Policy number</label>
                  <input value={newClaim.policyNumber} onChange={(e) => setNewClaim({ ...newClaim, policyNumber: e.target.value })}
                    className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Date of loss</label>
                  <input type="date" value={newClaim.dateOfLoss} onChange={(e) => setNewClaim({ ...newClaim, dateOfLoss: e.target.value })}
                    className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Cause of loss</label>
                  <select value={newClaim.causeOfLoss} onChange={(e) => setNewClaim({ ...newClaim, causeOfLoss: e.target.value })}
                    className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700">
                    <option value="">—</option>
                    <option value="hail">Hail</option>
                    <option value="wind">Wind</option>
                    <option value="fire">Fire</option>
                    <option value="water">Water</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Deductible</label>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={newClaim.deductible}
                    onChange={(e) => setNewClaim({ ...newClaim, deductible: e.target.value })}
                    className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={createClaim} disabled={creating}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-semibold">
                  {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : 'Start claim'}
                </button>
                <button onClick={() => setStartOpen(false)} disabled={creating}
                  className="px-4 py-2 border border-gray-300 dark:border-slate-700 rounded-lg text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // The money on an insurance job, totalled the way the scope export totals it — and the way the trade reads it.
  // The headline is the total approved claim (the carrier's final figure when entered, else RCV + approved
  // supplements), and the ladder under it shows where the money lands: depreciation comes off first, and the deductible
  // comes off the cheque the carrier writes — the homeowner pays it to the contractor. (roof T18 D3)
  // The server leaves the claim's figures off for a seat without invoices:read and says so. Nothing priced is drawn
  // then — every figure below would otherwise read $0.00 and the panel would ask them to "enter the RCV". (T63)
  const showMoney = !claim.moneyWithheld
  const baseRcv = Number(claim.rcv || 0)
  const supTotal = Number(claim.supplementAmount || 0)
  const hasFinal = claim.finalApprovedAmount != null && String(claim.finalApprovedAmount) !== ''
  const totalApproved = hasFinal ? Number(claim.finalApprovedAmount) : baseRcv + supTotal
  const depHeld = Number(claim.depreciationHeld || 0)
  const deductible = Number(claim.deductible || 0)
  const acvNow = totalApproved - depHeld
  const carrierFirstCheck = acvNow - deductible
  const daysSinceLoss = claim.dateOfLoss ? Math.floor((Date.now() - new Date(claim.dateOfLoss).getTime()) / (1000 * 60 * 60 * 24)) : null
  const scopeUrl = claim.xactimateScopeUrl
  const exportUrl = claim.xactimateExportUrl

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 dark:bg-slate-900">
        <button onClick={() => navigate(`/crm/jobs/${jobId}`)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 mb-3 dark:text-slate-400">
          <ArrowLeft className="w-4 h-4" /> Back to Job
        </button>
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-orange-500 dark:text-orange-200" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Insurance Claim — {claim.claimNumber}</h1>
          {claim.claimStatus === 'denied' && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40">DENIED</span>
          )}
          {daysSinceLoss !== null && daysSinceLoss > 45 && (
            <span className="flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" /> {daysSinceLoss}d since loss
            </span>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* LEFT — Timeline (2 cols) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Claim Timeline</h2>
              {/* POST /claims/:id/activity asks insurance:create. A crew reads the trail and does not write to it. (T41) */}
              {mayWriteClaim && (
                <button onClick={() => setActivityOpen(true)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-orange-600 text-white rounded-lg hover:bg-orange-700">
                  <Plus className="w-3.5 h-3.5" /> Log Activity
                </button>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-4 max-h-[600px] overflow-y-auto dark:bg-slate-900">
              {activityError ? (
                <p className="text-sm text-amber-700 dark:text-amber-300 text-center py-8">
                  {activityError === 'notAllowed'
                    ? 'Your role cannot see this claim’s history.'
                    : 'The claim history could not be loaded. Reload the page to try again.'}
                </p>
              ) : activities.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-8">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {activities.map((a, i) => {
                    const iconType = ACTIVITY_ICONS[a.activityType] || 'clock'
                    return (
                      <div key={a.id || i} className="flex gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center dark:bg-slate-800">
                          {iconType === 'phone' && <Phone className="w-3.5 h-3.5 text-blue-500 dark:text-blue-300" />}
                          {iconType === 'mail' && <Mail className="w-3.5 h-3.5 text-purple-500 dark:text-purple-300" />}
                          {iconType === 'check' && <CheckCircle className="w-3.5 h-3.5 text-green-500 dark:text-green-300" />}
                          {iconType === 'x' && <XCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />}
                          {iconType === 'doc' && <FileText className="w-3.5 h-3.5 text-orange-500 dark:text-orange-200" />}
                          {iconType === 'upload' && <Upload className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400" />}
                          {iconType === 'clock' && <Clock className="w-3.5 h-3.5 text-gray-400" />}
                          {iconType === 'msg' && <MessageSquare className="w-3.5 h-3.5 text-blue-400" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 dark:text-slate-100">{a.body}</p>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                            <span>{when(a.createdAt)}</span>
                            {a.metadata?.callDuration && <span>({a.metadata.callDuration} min)</span>}
                            {a.metadata?.subject && <span>Subject: {a.metadata.subject}</span>}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — Claim Details (3 cols) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Claim Status Stepper */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 dark:text-slate-100">Claim Status</h3>
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {CLAIM_STAGES.map((stage, i) => {
                  const currentIdx = (CLAIM_STAGES as readonly string[]).indexOf(claim.claimStatus)
                  const isActive = claim.claimStatus === stage
                  const isPast = i < currentIdx
                  const isDenied = claim.claimStatus === 'denied'

                  return (
                    <div key={stage} className="flex items-center">
                      <button
                        onClick={() => updateStatus(stage)}
                        disabled={!mayWriteClaim}
                        title={mayWriteClaim ? undefined : 'A manager moves the claim along'}
                        className={`flex flex-col items-center px-2 py-1.5 rounded-lg text-[10px] font-medium transition min-w-[80px] ${mayWriteClaim ? '' : 'cursor-default'} ${
                          isActive ? 'bg-orange-100 text-orange-700 ring-2 ring-orange-300 dark:text-orange-200 dark:bg-orange-950/40' :
                          isPast ? 'bg-green-50 text-green-700 dark:text-green-300 dark:bg-green-950/40' :
                          (mayWriteClaim
                            ? 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 dark:text-slate-300 dark:bg-slate-800'
                            : 'bg-gray-50 text-gray-600 dark:text-slate-300 dark:bg-slate-800')
                        } ${isDenied && isActive ? 'bg-red-100 text-red-700 ring-red-300 dark:text-red-400 dark:bg-red-950/40' : ''}`}
                      >
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center mb-1 ${
                          isActive ? 'bg-orange-600 text-white' :
                          isPast ? 'bg-green-700 text-white' :
                          'bg-gray-200 text-gray-600 dark:text-slate-300 dark:bg-slate-700'
                        }`}>
                          {isPast ? <CheckCircle className="w-3 h-3" /> : <span className="text-[8px]">{i + 1}</span>}
                        </div>
                        {CLAIM_STAGE_LABELS[stage]}
                      </button>
                      {i < CLAIM_STAGES.length - 1 && (
                        <ChevronRight className={`w-3 h-3 mx-0.5 flex-shrink-0 ${isPast ? 'text-green-400' : 'text-gray-300'}`} />
                      )}
                    </div>
                  )
                })}
              </div>
              {claim.claimStatus === 'denied' && claim.denialReason && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 dark:text-red-400 dark:bg-red-950/40">
                  <strong>Denial Reason:</strong> {claim.denialReason}
                </div>
              )}
            </div>

            {/* Claim Info */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 dark:text-slate-100">Claim Info</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Claim Number</label>
                  <input defaultValue={claim.claimNumber || ''} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ claimNumber: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Insurance Company</label>
                  <input defaultValue={claim.insuranceCompany || ''} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ insuranceCompany: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Policy Number</label>
                  <input defaultValue={claim.policyNumber || ''} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ policyNumber: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Date of Loss</label>
                  <input type="date" defaultValue={dayInput(claim.dateOfLoss)} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ dateOfLoss: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Cause of Loss</label>
                  <select defaultValue={claim.causeOfLoss || ''} disabled={!mayEditClaim} onChange={(e) => saveClaim({ causeOfLoss: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                    <option value="">Select...</option>
                    <option value="hail">Hail</option>
                    <option value="wind">Wind</option>
                    <option value="fire">Fire</option>
                    <option value="water">Water</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Adjuster Inspection Date</label>
                  <input type="date" defaultValue={dayInput(claim.adjusterInspectionDate)} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ adjusterInspectionDate: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>

              {/* Adjuster */}
              <h4 className="text-xs font-semibold text-gray-700 mt-5 mb-2 dark:text-slate-200">Adjuster</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Name</label>
                  <input defaultValue={claim.adjusterName || ''} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ adjusterName: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Phone</label>
                  <input defaultValue={claim.adjusterPhone || ''} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ adjusterPhone: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Email</label>
                  <input defaultValue={claim.adjusterEmail || ''} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ adjusterEmail: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Company</label>
                  <input defaultValue={claim.adjusterCompany || ''} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ adjusterCompany: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              {mayWriteClaim && (
                <button onClick={saveAdjusterToDirectory} className="mt-3 text-xs text-orange-600 dark:text-orange-200 hover:text-orange-900 dark:hover:text-orange-100 font-medium">
                  Save to Adjuster Directory
                </button>
              )}
            </div>

            {/* Financials */}
            {showMoney && (
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <DollarSign className="w-4 h-4 text-green-500 dark:text-green-300" /> Financials
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Deductible</label>
                  <input defaultValue={String(claim.deductible ?? '')} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ deductible: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">RCV</label>
                  <input defaultValue={String(claim.rcv ?? '')} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ rcv: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">ACV</label>
                  <input defaultValue={String(claim.acv ?? '')} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ acv: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Depreciation Held</label>
                  <input defaultValue={String(claim.depreciationHeld ?? '')} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ depreciationHeld: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Supplement Total</label>
                  <p className="text-sm font-medium text-gray-900 px-3 py-2 dark:text-slate-100">{fmt$(claim.supplementAmount)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Final Approved</label>
                  <input defaultValue={String(claim.finalApprovedAmount ?? '')} readOnly={!mayEditClaim} onBlur={(e) => saveClaim({ finalApprovedAmount: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
              </div>
              {/* NOTHING APPROVED YET MEANS THERE IS NO CHEQUE TO WORK OUT. (T41) With no RCV and no final figure the
                  breakdown would subtract the deductible from nothing and print a NEGATIVE cheque, so the panel says
                  what is missing instead of showing a figure. */}
              {totalApproved <= 0 ? (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Enter the carrier&rsquo;s RCV above and this will work out the first cheque — the approved
                  total less depreciation held and less the deductible you collect from the homeowner.
                </div>
              ) : (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/25">
                <div className="flex items-center justify-between p-3">
                  <span className="text-sm font-medium text-green-800 dark:text-green-200">Total approved (RCV)</span>
                  <span className="text-lg font-bold text-green-700 dark:text-green-200">{fmt$(totalApproved)}</span>
                </div>
                <dl className="border-t border-green-200 dark:border-green-800 px-3 py-2 text-xs text-green-900 dark:text-green-100">
                  {hasFinal ? (
                    <div className="flex justify-between py-0.5">
                      <dt>Carrier&rsquo;s final approved figure</dt>
                      <dd className="tabular-nums">{fmt$(claim.finalApprovedAmount)}</dd>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between py-0.5">
                        <dt>Original RCV</dt>
                        <dd className="tabular-nums">{fmt$(baseRcv)}</dd>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <dt>Approved supplements</dt>
                        <dd className="tabular-nums">+ {fmt$(supTotal)}</dd>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between py-0.5">
                    <dt>Less depreciation held</dt>
                    <dd className="tabular-nums">&minus; {fmt$(depHeld)}</dd>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <dt>Less deductible &mdash; you collect this from the homeowner</dt>
                    <dd className="tabular-nums">&minus; {fmt$(deductible)}</dd>
                  </div>
                  <div className="flex justify-between py-1 mt-1 border-t border-green-200 dark:border-green-800 font-semibold">
                    <dt>Carrier&rsquo;s first cheque (ACV net)</dt>
                    {/* Floored at zero: a negative cheque reads as the carrier invoicing the contractor. */}
                    <dd className="tabular-nums">{fmt$(Math.max(0, carrierFirstCheck))}</dd>
                  </div>
                  {depHeld > 0 && (
                    <p className="pt-1.5 text-green-800 dark:text-green-200">
                      {fmt$(depHeld)} of recoverable depreciation is released once the work is complete and invoiced.
                    </p>
                  )}
                  {carrierFirstCheck <= 0 && (
                    <p className="pt-1.5 text-green-800 dark:text-green-200">
                      The deductible is larger than what the carrier allowed after depreciation, so there is no
                      first cheque on this claim — the homeowner covers the work.
                    </p>
                  )}
                </dl>
              </div>
              )}
            </div>
            )}

            {/* Documents / Xactimate — the scope is a priced document, so it goes with the money (T63) */}
            {showMoney && (
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <FileText className="w-4 h-4 text-gray-400" /> Documents & Xactimate Export
              </h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {scopeUrl && (
                  <button type="button" onClick={() => openDocument(scopeUrl, `scope-${claim.claimNumber || claim.id}.pdf`)} disabled={!!fetchingDoc} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50 dark:text-purple-300 dark:bg-purple-950/40">
                    {fetchingDoc === scopeUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Scope PDF
                  </button>
                )}
                {exportUrl && (
                  <button type="button" onClick={() => openDocument(exportUrl, `scope-${claim.claimNumber || claim.id}.csv`)} disabled={!!fetchingDoc} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50 dark:text-green-300 dark:bg-green-950/40">
                    {fetchingDoc === exportUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} CSV Export
                  </button>
                )}
              </div>
              {/* Two documents, named for what they are rather than hidden behind one button. (T41) */}
              {mayWriteClaim && (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => generateExport('ask')} disabled={exporting} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {exporting ? 'Building scope...' : 'Scope as requested'}
                </button>
                <button onClick={() => generateExport('approved')} disabled={exporting} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50">
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {exporting ? 'Building scope...' : 'Scope as approved'}
                </button>
              </div>
              )}
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400 max-w-prose">
                <strong>As requested</strong> is the document you send the carrier: every supplement that has
                not been denied, at the amounts you asked for. <strong>As approved</strong> is the settled
                scope: only supplements the carrier approved, brought to the amount they approved.
              </p>

              {exportResult && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg dark:bg-slate-900">
                  {/* Which of the two documents this table is, so the figures are never read as the other one. (T41) */}
                  <p className="text-xs font-semibold text-gray-700 mb-2 dark:text-slate-200">
                    Generated Line Items ({exportResult.lineItems?.length || 0})
                    {exportResult.basis === 'approved'
                      ? <span className="ml-2 font-normal text-green-700 dark:text-green-300">— as approved by the carrier</span>
                      : <span className="ml-2 font-normal text-orange-700 dark:text-orange-200">— as requested</span>}
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-gray-500 dark:text-slate-400">
                        <th className="text-left pb-1">Code</th>
                        <th className="text-left pb-1">Description</th>
                        <th className="text-right pb-1">Qty</th>
                        {!exportResult.moneyWithheld && <th className="text-right pb-1">Total</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {exportResult.lineItems?.map((li, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 font-mono">{li.code}</td>
                          <td className="py-1">{li.description}</td>
                          <td className="py-1 text-right">{li.qty} {li.unit}</td>
                          {!exportResult.moneyWithheld && <td className="py-1 text-right">{fmt$(li.total)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {exportResult.totals && (
                    <div className="mt-3 pt-3 border-t space-y-1 text-xs">
                      <div className="flex justify-between"><span>Subtotal</span><span>{fmt$(exportResult.totals.subtotal)}</span></div>
                      <div className="flex justify-between"><span>O&P (10%+10%)</span><span>{fmt$(exportResult.totals.overhead + exportResult.totals.profit)}</span></div>
                      <div className="flex justify-between font-bold"><span>RCV Total</span><span>{fmt$(exportResult.totals.rcvTotal)}</span></div>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

            {/* Supplements */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Supplements</h3>
                {/* POST /claims/:id/supplements asks insurance:create. (T41) */}
                {mayWriteClaim && (
                  <button onClick={() => setSupOpen(true)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-orange-600 text-white rounded-lg hover:bg-orange-700">
                    <Plus className="w-3.5 h-3.5" /> Add Supplement
                  </button>
                )}
              </div>
              {supplementError ? (
                // The template kept this fault and never showed it; an empty list read as "no supplements".
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {supplementError === 'notAllowed'
                    ? 'Your role cannot see this claim’s supplements.'
                    : 'The supplements could not be loaded. Reload the page to try again.'}
                </p>
              ) : supplements.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400">No supplements yet</p>
              ) : (
                <div className="space-y-3">
                  {supplements.map((sup) => {
                    // The server's own flag on this record: no figures for this seat, so none are drawn (not $0).
                    const supMoney = showMoney && !sup.moneyWithheld
                    return (
                    <div key={sup.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-semibold">{sup.supplementNumber}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${SUP_STATUS_COLORS[sup.status] || 'bg-gray-100 dark:bg-slate-800 dark:text-slate-100'}`}>
                            {formatStatus(sup.status)}
                          </span>
                        </div>
                        {supMoney && <span className="text-sm font-bold">{fmt$(sup.totalAmount)}</span>}
                      </div>
                      <p className="text-sm text-gray-600 mb-2 dark:text-slate-400">{sup.reason}</p>
                      {Array.isArray(sup.lineItems) && sup.lineItems.length > 0 && (
                        <table className="w-full text-xs mb-2">
                          <tbody>
                            {sup.lineItems.map((li, i) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-0.5 font-mono text-gray-500 dark:text-slate-400">{li.code || '—'}</td>
                                <td className="py-0.5">{li.description}</td>
                                {supMoney && <td className="py-0.5 text-right">{fmt$(li.total)}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {supMoney && sup.status === 'approved' && sup.approvedAmount && (
                        <p className="text-xs text-green-700 font-medium dark:text-green-300">Approved: {fmt$(sup.approvedAmount)}</p>
                      )}
                      {sup.status === 'denied' && sup.denialReason && (
                        <p className="text-xs text-red-700 dark:text-red-300">Denied: {sup.denialReason}</p>
                      )}
                      {sup.status === 'draft' && mayWriteClaim && (
                        <div className="mt-2 flex items-center gap-4">
                          <button onClick={() => submitSupplement(sup.id)} className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-200 font-medium hover:text-orange-900 dark:hover:text-orange-100">
                            <Send className="w-3 h-3" /> Submit to Carrier
                          </button>
                          {/* PUT /supplements/:id asks insurance:update, not create (the template asked create here). */}
                          {mayEditClaim && (
                            <button onClick={() => openEditSupplement(sup)} className="flex items-center gap-1 text-xs text-gray-600 font-medium hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200">
                              <Save className="w-3 h-3" /> Edit
                            </button>
                          )}
                        </div>
                      )}
                      {/* A CARRIER'S DECISION IS NOT FINAL, AND THE SCREEN HAS TO SAY SO. (T41) The server accepts a
                          decision from submitted, approved and denied (a draft nobody sent has none), so the same two
                          controls are offered on all three, worded for what they do from here. */}
                      {['submitted', 'approved', 'denied'].includes(sup.status) && (
                        canDecide ? (
                          <div className="mt-2 flex items-center gap-4 flex-wrap">
                            <button onClick={() => openDecide(sup, 'approve')} className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium hover:text-green-800 dark:hover:text-green-300">
                              <CheckCircle className="w-3 h-3" /> {sup.status === 'approved' ? 'Change the approved amount' : sup.status === 'denied' ? 'Record an approval instead' : 'Record Approval'}
                            </button>
                            <button onClick={() => openDecide(sup, 'deny')} className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400 font-medium hover:text-red-800 dark:hover:text-red-300">
                              <XCircle className="w-3 h-3" /> {sup.status === 'approved' ? 'Record a denial instead' : sup.status === 'denied' ? 'Change the denial reason' : 'Record Denial'}
                            </button>
                          </div>
                        ) : sup.status === 'submitted' ? (
                          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Awaiting the carrier. A manager records their answer.</p>
                        ) : null
                      )}
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Activity Modal ── */}
      {activityOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setActivityOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Log Activity</h2>
              <button aria-label="Close" onClick={() => setActivityOpen(false)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Type</label>
                <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="w-full text-sm border rounded-lg px-3 py-2">
                  <option value="note">Note</option>
                  <option value="call">Phone Call</option>
                  <option value="email">Email</option>
                  <option value="inspection">Inspection</option>
                  <option value="document_uploaded">Document Upload</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Details</label>
                <textarea value={activityBody} onChange={(e) => setActivityBody(e.target.value)} rows={3} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="What happened?" />
              </div>
              {activityType === 'call' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Duration (minutes)</label>
                  <input type="number" value={activityMeta.callDuration || ''} onChange={(e) => setActivityMeta({ ...activityMeta, callDuration: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              )}
              {activityType === 'email' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Subject</label>
                  <input value={activityMeta.subject || ''} onChange={(e) => setActivityMeta({ ...activityMeta, subject: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setActivityOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400">Cancel</button>
              <button onClick={submitActivity} disabled={submittingActivity} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {submittingActivity ? 'Saving...' : 'Log'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Supplement Modal ── */}
      {supOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSupOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Add Supplement</h2>
              <button aria-label="Close" onClick={() => setSupOpen(false)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Reason for Supplement *</label>
                <textarea value={supReason} onChange={(e) => setSupReason(e.target.value)} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="Why is this supplement needed?" />
              </div>

              {/* Line items */}
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-2 dark:text-slate-200">Line Items</label>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b dark:text-slate-400">
                      <th className="pb-1 w-32">Code</th>
                      <th className="pb-1">Description</th>
                      <th className="pb-1 w-16 text-right">Qty</th>
                      <th className="pb-1 w-16 text-center">Unit</th>
                      <th className="pb-1 w-20 text-right">Price</th>
                      <th className="pb-1 w-20 text-right">Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {supLineItems.map((li, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-1 pr-1">
                          <select value={li.code} onChange={(e) => updateSupLineItem(i, 'code', e.target.value)} className="w-full text-xs border rounded px-1 py-1">
                            <option value="">Select...</option>
                            {XACT_CODES.map((c) => (
                              <option key={c.code} value={c.code}>{c.code}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 pr-1">
                          <input value={li.description} onChange={(e) => updateSupLineItem(i, 'description', e.target.value)} className="w-full text-xs border rounded px-1 py-1" />
                        </td>
                        <td className="py-1 pr-1">
                          <input type="number" min="0" step="any" inputMode="decimal" value={li.qty}
                            onChange={(e) => updateSupLineItem(i, 'qty', e.target.value)}
                            className="w-full text-xs border rounded px-1 py-1 text-right" />
                        </td>
                        <td className="py-1 pr-1">
                          <input value={li.unit} onChange={(e) => updateSupLineItem(i, 'unit', e.target.value)} className="w-full text-xs border rounded px-1 py-1 text-center" />
                        </td>
                        <td className="py-1 pr-1">
                          {/* Holds the raw text: see num0/newSupRow above. */}
                          <input type="number" min="0" step="0.01" inputMode="decimal" value={li.unitPrice}
                            onChange={(e) => updateSupLineItem(i, 'unitPrice', e.target.value)}
                            className="w-full text-xs border rounded px-1 py-1 text-right" />
                        </td>
                        <td className="py-1 pr-1 text-right text-xs font-medium">{fmt$(li.total)}</td>
                        <td className="py-1">
                          {supLineItems.length > 1 && (
                            <button aria-label="Remove line item" onClick={() => setSupLineItems((prev) => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 dark:hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={() => setSupLineItems((prev) => [...prev, newSupRow()])} className="mt-2 text-xs text-orange-600 dark:text-orange-200 hover:text-orange-900 dark:hover:text-orange-100 font-medium">
                  + Add Line Item
                </button>
                <div className="flex flex-col items-end mt-2">
                  <span className="text-sm font-bold">Total: {fmt$(supLineItems.reduce((s, li) => s + price0(li.total), 0))}</span>
                  {anyNegative(supLineItems) && (
                    <span className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      A quantity or price is negative. Those lines count as nothing here, and the carrier
                      cannot be asked for a negative amount — use a separate credit instead.
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Notes (optional)</label>
                <textarea value={supNotes} onChange={(e) => setSupNotes(e.target.value)} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setSupOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400">Cancel</button>
              <button onClick={createSupplement} disabled={submittingSup} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {submittingSup ? 'Creating...' : 'Save as Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit a DRAFT supplement. The server refuses anything else, and recomputes the total from the line items — this
          form never sends one. */}
      {editSup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditSup(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Edit {editSup.supplementNumber}</h2>
              <button aria-label="Close" onClick={() => setEditSup(null)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Reason</label>
            <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2} className="w-full text-sm border rounded-lg px-3 py-2 mb-4" placeholder="Why is this supplement needed?" />

            {editSup.moneyWithheld ? (
              <p className="text-sm text-gray-600 dark:text-slate-400">
                The line prices aren&rsquo;t shown to your role, so only the reason can be changed here. Someone who
                handles the money can change the lines.
              </p>
            ) : (
            <>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 dark:text-slate-400">Line items</label>
              <button onClick={() => setEditItems([...editItems, { code: '', description: '', unit: 'EA', qty: '1', unitPrice: '0' }])} className="text-xs font-medium text-orange-700 dark:text-orange-200 hover:text-orange-900 dark:hover:text-orange-100">+ Add line</button>
            </div>
            <div className="space-y-2">
              {editItems.map((li, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={li.code} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, code: e.target.value } : x))} placeholder="Code" className="col-span-2 text-sm border rounded-lg px-2 py-1.5 font-mono" />
                  <input value={li.description} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} placeholder="Description" className="col-span-4 text-sm border rounded-lg px-2 py-1.5" />
                  <input value={li.unit} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} placeholder="Unit" className="col-span-1 text-sm border rounded-lg px-2 py-1.5" />
                  <input type="number" min="0" step="0.01" value={li.qty} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} placeholder="Qty" className="col-span-2 text-sm border rounded-lg px-2 py-1.5" />
                  <input type="number" min="0" step="0.01" value={li.unitPrice} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} placeholder="Unit price" className="col-span-2 text-sm border rounded-lg px-2 py-1.5" />
                  <button onClick={() => setEditItems(editItems.filter((_, j) => j !== i))} aria-label="Remove line" className="col-span-1 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-400"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">
              Total <span className="font-bold text-gray-900 dark:text-slate-100">{fmt$(editItems.reduce((s, li) => s + price0(li.qty) * price0(li.unitPrice), 0).toFixed(2))}</span>
              {anyNegative(editItems) && (
                <span className="block text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  A quantity or price is negative. Those lines count as nothing here, and the carrier cannot
                  be asked for a negative amount.
                </span>
              )}
              <span className="text-xs"> — calculated from the lines above; the server recomputes it on save.</span>
            </p>
            </>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditSup(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400">Cancel</button>
              <button onClick={saveSupplementEdit} disabled={savingEdit} className="px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record the carrier's answer. insurance:approve — the server asks it too, so this is not the only thing standing
          between a field seat and the decision. */}
      {decideSup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDecideSup(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">
                {decideMode === 'approve' ? 'Record approval' : 'Record denial'} — {decideSup.supplementNumber}
              </h2>
              <button aria-label="Close" onClick={() => setDecideSup(null)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            {!decideSup.moneyWithheld && (
              <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">Requested {fmt$(decideSup.totalAmount)}</p>
            )}

            {decideMode === 'approve' ? (
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Amount the carrier approved *</label>
                <input type="number" min="0" step="0.01" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} className="w-full text-sm border rounded-lg px-3 py-2" />
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  A carrier often approves less than was asked. The claim&rsquo;s supplement total is the sum of what is approved, so this figure is the one that moves the money.
                </p>
              </div>
            ) : (
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Reason given *</label>
                <textarea value={denialReason} onChange={(e) => setDenialReason(e.target.value)} rows={3} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="What the carrier said" />
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Denying one that had been approved takes its amount back off the claim.</p>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setDecideSup(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg dark:text-slate-400">Cancel</button>
              <button
                onClick={decide}
                disabled={deciding}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${decideMode === 'approve' ? 'bg-green-700 hover:bg-green-800' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {deciding ? 'Saving...' : decideMode === 'approve' ? 'Record Approval' : 'Record Denial'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
