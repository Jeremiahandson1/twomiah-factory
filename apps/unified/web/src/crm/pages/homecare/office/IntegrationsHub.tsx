// Moved from templates/crm-homecare/frontend/src/components/admin/IntegrationsHub.tsx.
// Changes (each read checked against the unified server, server/crm/homecare/**):
// · Every call goes through the app's client; lists are { data, pagination } (rows()); every field is the server's
//   camelCase. The template read CVHC's snake_case shapes the template's own server never sent (client_first,
//   payer_name, batch_number, total_billed …), so most of its tables printed blanks: they now read what is answered.
// · Each tab, and each overview card, shows only for a seat whose permission its API asks (EVV: evv:delete;
//   authorizations, EDI, remittance: care-billing:read, adding care-billing:create; payroll: care-payroll:update;
//   call tracking: integrations:update — it was "isAdmin"). The template asked every API and showed the empty result.
// · The Failsafe card and "Open Validation Issues" are gone: /api/failsafe was a stub answering an empty list (so the
//   card always said "All Clear"), and it was not moved to the unified server.
// · Accounts receivable by payer shows what GET /api/remittance/payer-summary answers — remittances and the total
//   received per payer. The template's billed / outstanding / aging columns read fields no server sends (always $0.00).
// · An authorization's state (Good, Low, Expiring, Expired, Exhausted) is worked out from the row by the same rules as
//   GET /api/authorizations/summary; the template read a health_status the list never carried (a blank badge), and
//   "remaining" is authorized minus used (the template read a remaining_units that was never sent).
// · EDI download: the link pointed at /api/edi/batch/:id/download (no such path) as a plain href (no session); it is
//   now GET /api/edi/batches/:id/download, saved as a file.
// · Remittance list: /api/remittance/batches (no such path; the tab was always empty) → GET /api/remittance; saving a
//   reviewed remittance: /api/remittance/batch (no such path) → POST /api/remittance.
// · Raw colours are the frame's light/dark tokens; the brand ink is var(--color-teal-dark), the brand button hc-btn-primary.
// · Dates: a calendar day prints through lib/date, an instant (a batch's createdAt) on the agency's clock.
import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { CallTrackingSettings, useToast, usePermissions } from '../../../../shared'
import { api, rows, errorMessage, downloadBlob, saveBlob, listAll } from '../lib/http'
import { parseLocalDate, toLocalYMD } from '../lib/date'
import { formatAgencyDate } from '../lib/agencyClock'
import SandataPanel, { type EvvVisit } from './SandataPanel'
import { money } from '@twomiah/tenant-ui/src/money'

// ─── REPLY SHAPES ─────────────────────────────────────────────────────────────
/** GET /api/sandata/config. */
interface SandataConfig { isConfigured: boolean }
/** GET /api/sandata/status. */
interface EvvStatus {
  sandataConfigured: boolean
  startDate: string
  endDate: string
  summary: { total: number; verified: number; pending: number; ready: number; submitted: number; accepted: number; exceptions: number; needsManual: number; hasIssues: number }
  visits: EvvVisit[]
}
/** GET /api/authorizations/summary (server/data/homecareBillingRoutes.ts authorizationSummary). */
interface AuthSummary { total?: number; active?: number; expired?: number; expiringSoon?: number; lowUnits?: number; exhausted?: number }
/** A row of GET /api/authorizations. */
interface Authorization {
  id: string
  authNumber?: string | null
  procedureCode?: string | null
  authorizedUnits?: string | number | null
  usedUnits?: string | number | null
  lowUnitsAlertThreshold?: string | number | null
  startDate?: string | null
  endDate?: string | null
  status?: string | null
  client?: { firstName?: string | null; lastName?: string | null } | null
  payer?: { name?: string | null } | null
}
/** A row of GET /api/edi/batches. */
interface EdiBatch {
  id: string
  batchNumber?: string | null
  status?: string | null
  claimCount?: number | null
  totalBilled?: string | number | null
  createdAt?: string | null
  payer?: { name?: string | null } | null
  _count?: { claims?: number }
}
/** A row of GET /api/edi/service-codes (the service_codes table). */
interface ServiceCode {
  id: string
  code: string
  modifier1?: string | null
  description?: string | null
  serviceCategory?: string | null
  payerType?: string | null
  unitType?: string | null
  requiresEvv?: boolean | null
}
/** A row of GET /api/remittance (a batch with its payer and lines). */
interface RemittanceBatch {
  id: string
  payerName?: string | null
  checkNumber?: string | null
  paymentDate?: string | null
  totalAmount?: string | number | null
  status?: string | null
  payer?: { name?: string | null } | null
  lineItems?: unknown[]
}
/** A row of GET /api/remittance/payer-summary. */
interface PayerSummary { payerId: string | null; payerName: string; batches: number; totalPaid: number }
/** A row of GET /api/remittance/payers. */
interface Payer { id: string; name: string }
/** A row of GET /api/clients. */
interface ClientLite { id: string; firstName?: string | null; lastName?: string | null }
/** GET /api/gusto/preview. */
interface PayrollPreview {
  preview: Array<{ id: string; firstName?: string | null; lastName?: string | null; regularHours: string; overtimeHours: string; totalHours: string; hourlyRate: string; grossPay: string; gustoMapped: boolean }>
  totals: { employees: number; totalHours: string; totalGross: string; unmapped: number }
  warnings?: { unresolvedReviews?: number; clockEntriesWithoutReview?: number }
}
/** What a remittance OCR upload would answer (the template's contract; the unified server has no such route). */
/** POST /api/payments/scan-check (billing/payments.ts): what was read off the image, and the payer it names. */
interface OcrResult {
  extracted?: { payerName?: string | null; checkNumber?: string | null; checkDate?: string | null; amount?: string | number | null }
  suggestedPayer?: { id?: string } | null
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
type Num = string | number | null | undefined
const fmt$ = (n: Num) => n != null ? money(n) : '—'
const fmtDate = (d: string | null | undefined) => d ? parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtInstant = (d: string | null | undefined) => d ? formatAgencyDate(d, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtNum = (n: Num) => n != null ? parseFloat(String(n || 0)).toFixed(2) : '—'
const num = (n: Num) => parseFloat(String(n ?? 0)) || 0

// Each status's ground and ink: the frame's tokens, light and dark.
type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'
const STATUS_TONE: Record<string, Tone> = {
  accepted: 'success', submitted: 'info', ready: 'success', pending: 'warning',
  exception: 'danger', rejected: 'danger', needs_manual: 'danger',
  matched: 'success', partial: 'warning', unmatched: 'neutral', pending_match: 'info',
  active: 'success', expired: 'danger', exhausted: 'danger', low: 'warning',
  ok: 'success', expiring_soon: 'warning',
}
const TONE_STYLE: Record<Tone, CSSProperties> = {
  success: { background: 'var(--hc-success-bg)', color: 'var(--hc-success-ink)' },
  info: { background: 'var(--hc-info-bg)', color: 'var(--hc-info-ink)' },
  warning: { background: 'var(--hc-warning-bg)', color: 'var(--hc-warning-ink)' },
  danger: { background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)' },
  neutral: { background: 'var(--hc-subtle)', color: 'var(--hc-ink-soft)' },
}
const INK = {
  ink: 'var(--hc-ink)', soft: 'var(--hc-ink-soft)', muted: 'var(--hc-muted)', brand: 'var(--color-teal-dark)',
  green: 'var(--hc-green-ink)', red: 'var(--hc-red-ink)', blue: 'var(--hc-blue-ink)', amber: 'var(--hc-warning-ink)', info: 'var(--hc-info-ink)',
}

const Badge = ({ status, label }: { status?: string | null; label?: string | null }) => (
  <span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.72rem] font-bold" style={TONE_STYLE[STATUS_TONE[String(status)] || 'neutral']}>{label || status}</span>
)

const Card = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div className="rounded-[14px] border p-5" style={{ background: 'var(--hc-surface)', borderColor: 'var(--hc-line)', color: 'var(--hc-ink)', ...style }}>{children}</div>
)

const SectionHeader = ({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-start justify-between gap-2">
    <div>
      <h3 className="m-0 text-base font-extrabold" style={{ color: INK.ink }}>{icon} {title}</h3>
      {sub && <p className="mt-0.5 text-[0.78rem]" style={{ color: INK.muted }}>{sub}</p>}
    </div>
    {action}
  </div>
)

const Btn = ({ onClick, children, disabled, small, outline, violet }: { onClick?: () => void; children: ReactNode; disabled?: boolean; small?: boolean; outline?: boolean; violet?: boolean }) => {
  const size = small ? 'px-3 py-1.5 text-[0.78rem]' : 'px-5 py-2.5 text-[0.85rem]'
  const base = `rounded-lg font-bold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 ${size}`
  if (outline) {
    return <button type="button" onClick={onClick} disabled={disabled} className={`${base} border-2`} style={{ background: 'var(--hc-surface)', color: INK.brand, borderColor: INK.brand }}>{children}</button>
  }
  // Violet-600 under white reads 5.7:1 in both themes.
  if (violet) return <button type="button" onClick={onClick} disabled={disabled} className={`${base} bg-violet-600 text-white hover:bg-violet-700`}>{children}</button>
  return <button type="button" onClick={onClick} disabled={disabled} className={`hc-btn hc-btn-primary ${base}`}>{children}</button>
}

const Tile = ({ value, label, color = INK.ink, ground = 'var(--hc-subtle)' }: { value: ReactNode; label: string; color?: string; ground?: string }) => (
  <div className="rounded-[10px] p-3 text-center" style={{ background: ground }}>
    <div className="text-2xl font-extrabold" style={{ color }}>{value}</div>
    <div className="text-[0.72rem]" style={{ color: INK.soft }}>{label}</div>
  </div>
)

const TH = ({ children }: { children: ReactNode }) => (
  <th className="whitespace-nowrap border-b px-3 py-2 text-left font-bold" style={{ color: INK.soft, borderColor: 'var(--hc-line)' }}>{children}</th>
)
const Code = ({ children }: { children: ReactNode }) => (
  <code className="rounded px-1.5 py-px text-[0.78rem]" style={{ background: 'var(--hc-subtle)', color: INK.ink }}>{children}</code>
)
const FIELD = 'w-full rounded-md border px-2 py-2 text-sm'
const fieldStyle: CSSProperties = { background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderColor: 'var(--hc-line)' }
const LABEL = 'mb-1 block text-[0.78rem] font-semibold'
const rowLine: CSSProperties = { borderBottom: '1px solid var(--hc-line)' }

/** An authorization's state, by the rules GET /api/authorizations/summary counts with. */
function authHealth(a: Authorization): { key: string; label: string } {
  const today = toLocalYMD(new Date())
  const in30 = toLocalYMD(new Date(Date.now() + 30 * 86400000))
  const end = a.endDate ? String(a.endDate).slice(0, 10) : ''
  const remaining = num(a.authorizedUnits) - num(a.usedUnits)
  if (a.status === 'exhausted') return { key: 'exhausted', label: 'Exhausted' }
  if (end && end < today) return { key: 'expired', label: 'Expired' }
  if (a.status && a.status !== 'active') return { key: a.status, label: a.status }
  if (end && end <= in30) return { key: 'expiring_soon', label: 'Expiring' }
  if (remaining <= num(a.lowUnitsAlertThreshold ?? 20)) return { key: 'low', label: '⚠ Low' }
  return { key: 'ok', label: 'Good' }
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
type TabId = 'overview' | 'evv' | 'authorizations' | 'claims' | 'remittance' | 'payroll' | 'calltracking'
const TABS: Array<{ id: TabId; label: string; permission?: string }> = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'evv', label: '🏠 EVV', permission: 'evv:delete' },
  { id: 'authorizations', label: '📋 Authorizations', permission: 'care-billing:read' },
  { id: 'claims', label: '📄 EDI Claims', permission: 'care-billing:read' },
  { id: 'remittance', label: '💵 Remittance', permission: 'care-billing:read' },
  { id: 'payroll', label: '💰 Payroll', permission: 'care-payroll:update' },
  { id: 'calltracking', label: '📞 Call Tracking', permission: 'integrations:update' },
]

const EMPTY_AUTH = { clientId: '', payerId: '', authNumber: '', procedureCode: 'T1019', authorizedUnits: '', startDate: '', endDate: '', notes: '' }
const EMPTY_REMIT = { payerId: '', payerName: '', checkNumber: '', checkDate: '', paymentDate: '', totalAmount: '', notes: '', lineItems: [] as Array<Record<string, unknown>> }

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function IntegrationsHub() {
  const toast = useToast()
  const { known, can } = usePermissions()
  const mayEvv = can('evv:delete')
  const mayBilling = can('care-billing:read')
  const mayBillingCreate = can('care-billing:create')
  const mayPayroll = can('care-payroll:update')
  const tabs = TABS.filter((t) => !t.permission || can(t.permission))
  const [tab, setTab] = useState<TabId>('overview')
  const [sandataConfig, setSandataConfig] = useState<SandataConfig | null>(null)
  const [evvData, setEvvData] = useState<EvvStatus | null>(null)
  const [authSummary, setAuthSummary] = useState<AuthSummary | null>(null)
  const [authorizations, setAuthorizations] = useState<Authorization[]>([])
  const [ediBatches, setEdiBatches] = useState<EdiBatch[]>([])
  const [remittanceBatches, setRemittanceBatches] = useState<RemittanceBatch[]>([])
  const [payerSummary, setPayerSummary] = useState<PayerSummary[]>([])
  const [payrollPreview, setPayrollPreview] = useState<PayrollPreview | null>(null)
  const [clients, setClients] = useState<ClientLite[]>([])
  const [payers, setPayers] = useState<Payer[]>([])
  const [serviceCodes, setServiceCodes] = useState<ServiceCode[]>([])
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string[]>([])

  /** A read whose failure leaves the section empty, as the template's did. */
  const get = useCallback(async <T,>(url: string): Promise<T | null> => {
    try { return (await api.get(url)) as T } catch { return null }
  }, [])

  // Payroll form
  const [payPeriod, setPayPeriod] = useState({ start: '', end: '' })

  // Authorization form
  const [authForm, setAuthForm] = useState(EMPTY_AUTH)
  const [showAuthForm, setShowAuthForm] = useState(false)

  // Remittance upload
  const [uploadState, setUploadState] = useState<null | 'uploading' | OcrResult>(null)
  const [remitForm, setRemitForm] = useState(EMPTY_REMIT)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const loadAuthorizations = useCallback(() => { get('/api/authorizations').then((d) => d && setAuthorizations(rows<Authorization>(d))) }, [get])
  const loadRemittances = useCallback(() => { get('/api/remittance').then((d) => d && setRemittanceBatches(rows<RemittanceBatch>(d))) }, [get])

  // Staggered, as the template's were (a burst of reads trips the rate limit); each only for a seat that may make it.
  useEffect(() => {
    if (!known) return
    let live = true
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const loadCore = async () => {
      await Promise.all([
        mayEvv ? get<SandataConfig>('/api/sandata/config').then((d) => live && d && setSandataConfig(d)) : null,
      ])
      if (mayBilling) {
        await delay(400)
        await Promise.all([
          get<AuthSummary>('/api/authorizations/summary').then((d) => live && d && setAuthSummary(d)),
          get('/api/remittance/payer-summary').then((d) => live && d && setPayerSummary(rows<PayerSummary>(d))),
        ])
        await delay(400)
        await Promise.all([
          listAll('/api/clients').catch(() => null).then((d) => live && d && setClients(rows<ClientLite>(d))),
          get('/api/remittance/payers').then((d) => live && d && setPayers(rows<Payer>(d))),
        ])
        await delay(400)
        get('/api/edi/service-codes').then((d) => live && d && setServiceCodes(rows<ServiceCode>(d)))
      }
      if (mayEvv) get<EvvStatus>('/api/sandata/status').then((d) => live && d && setEvvData(d))
    }
    loadCore()
    return () => { live = false }
  }, [known, mayEvv, mayPayroll, mayBilling, get])

  useEffect(() => {
    const t = setTimeout(() => {
      if (tab === 'authorizations') loadAuthorizations()
      if (tab === 'claims') get('/api/edi/batches').then((d) => d && setEdiBatches(rows<EdiBatch>(d)))
      if (tab === 'remittance') loadRemittances()
    }, 300)
    return () => clearTimeout(t)
  }, [tab, get, loadAuthorizations, loadRemittances])

  const setLoad = (key: string, val: boolean) => setLoading((p) => ({ ...p, [key]: val }))
  const reloadEvv = () => {
    get<SandataConfig>('/api/sandata/config').then((d) => d && setSandataConfig(d))
    get<EvvStatus>('/api/sandata/status').then((d) => d && setEvvData(d))
  }

  // ── Overview Tab ─────────────────────────────────────────────────────────────
  const renderOverview = () => {
    const totalReceived = payerSummary.reduce((s, p) => s + num(p.totalPaid), 0)
    const totalBatches = payerSummary.reduce((s, p) => s + (p.batches || 0), 0)
    const authWarn = (authSummary?.expiringSoon || 0) + (authSummary?.expired || 0) > 0

    return (
      <div className="grid gap-4">
        {/* Integration status row */}
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
          {mayEvv && (
            <Card style={{ borderLeft: `4px solid ${sandataConfig?.isConfigured ? 'var(--hc-primary)' : '#F59E0B'}` }}>
              <div className="mb-1.5 text-[0.85rem] font-bold">🏠 Sandata EVV</div>
              {sandataConfig?.isConfigured
                ? <><Badge status="active" label="✓ Connected" /><p className="mt-1.5 text-[0.78rem]" style={{ color: INK.muted }}>{evvData?.summary?.accepted || 0} accepted · {evvData?.summary?.exceptions || 0} exceptions</p></>
                : <><Badge status="pending" label="⚠ Not Configured" /><p className="mt-1.5 text-[0.75rem]" style={{ color: INK.amber }}>Enter the Sandata account on the EVV tab</p></>}
            </Card>
          )}
          {mayPayroll && (
            <Card style={{ borderLeft: '4px solid var(--hc-primary)' }}>
              {/* It told the owner to add the Gusto key to the server — a setting no owner can reach, for a push the server
                  refuses (/api/gusto/export answers 501). What the owner CAN do is the CSV, every pay period (live test,
                  2026-10-22). No setting names on this page. */}
              <div className="mb-1.5 text-[0.85rem] font-bold">💰 Gusto Payroll</div>
              <Badge status="active" label="CSV export" />
              <p className="mt-1.5 text-[0.75rem]" style={{ color: INK.muted }}>On the Payroll tab, download the hours as a CSV and upload it in Gusto.</p>
            </Card>
          )}
          {mayBilling && (
            <Card style={{ borderLeft: `4px solid ${authWarn ? '#F59E0B' : 'var(--hc-primary)'}` }}>
              <div className="mb-1.5 text-[0.85rem] font-bold">📋 Authorizations</div>
              <p className="m-0 text-lg font-extrabold" style={{ color: INK.ink }}>{authSummary?.active || 0} Active</p>
              <p className="mt-0.5 text-[0.78rem]" style={{ color: (authSummary?.expiringSoon || 0) > 0 ? INK.amber : INK.muted }}>
                {authSummary?.expiringSoon || 0} expiring soon · {authSummary?.lowUnits || 0} low units
              </p>
            </Card>
          )}
        </div>

        {/* Payments received by payer */}
        {mayBilling && (
          <Card>
            <SectionHeader icon="💵" title="Payments Received by Payer" sub="Recorded remittances, totalled by payer" />
            <div className="mb-4 grid grid-cols-2 gap-3">
              <Tile value={totalBatches} label="Remittances" />
              <Tile value={fmt$(totalReceived)} label="Received" color={INK.brand} ground="var(--color-teal-light)" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.82rem]">
                <thead>
                  <tr style={{ background: 'var(--hc-subtle)' }}>
                    <TH>Payer</TH><TH>Remittances</TH><TH>Received</TH>
                  </tr>
                </thead>
                <tbody>
                  {payerSummary.map((p) => (
                    <tr key={p.payerId || 'unassigned'} style={rowLine}>
                      <td className="px-3 py-2 font-semibold" style={{ color: INK.ink }}>{p.payerName}</td>
                      <td className="px-3 py-2" style={{ color: INK.soft }}>{p.batches}</td>
                      <td className="px-3 py-2 font-bold" style={{ color: INK.brand }}>{fmt$(p.totalPaid)}</td>
                    </tr>
                  ))}
                  {payerSummary.length === 0 && <tr><td colSpan={3} className="p-8 text-center" style={{ color: INK.muted }}>No remittances recorded yet</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    )
  }

  // ── EVV Tab ──────────────────────────────────────────────────────────────────
  const renderEVV = () => {
    const visits = evvData?.visits || []
    return (
      <div className="grid gap-4">
        {!sandataConfig?.isConfigured && (
          <Card style={{ background: 'var(--hc-warning-bg)', borderColor: 'var(--hc-warning-line)', color: 'var(--hc-warning-ink)' }}>
            <h4 className="mb-2 font-bold">⚠️ Alternate EVV Certification In Progress</h4>
            <p className="mb-2 text-sm">EVV records are created automatically at clock-out. Submission to the Sandata aggregator activates once certification issues the agency's credentials — until then, keep entering visits the way your state requires.</p>
            <div className="grid gap-1 text-[0.82rem]">
              <div><strong>Step 1:</strong> Start alternate-EVV certification with Sandata for your state</div>
              <div><strong>Step 2:</strong> Clear the readiness issues below (Medicaid IDs, worker IDs, payer codes, service codes)</div>
              <div><strong>Step 3:</strong> When credentials arrive, enter them in the Sandata account form below</div>
            </div>
          </Card>
        )}

        <SandataPanel visits={visits} onChanged={reloadEvv} />

        {/* Summary cards */}
        {evvData && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' }}>
            <Tile value={evvData.summary?.total || 0} label="Total" />
            <Tile value={evvData.summary?.verified || 0} label="Verified" color={INK.brand} />
            <Tile value={evvData.summary?.ready || 0} label="Ready to Submit" color={INK.info} />
            <Tile value={evvData.summary?.submitted || 0} label="Submitted" color={INK.blue} />
            <Tile value={evvData.summary?.accepted || 0} label="Accepted" color={INK.green} />
            <Tile value={evvData.summary?.exceptions || 0} label="Exceptions" color={INK.red} />
          </div>
        )}

        {/* EVV table */}
        <Card>
          <SectionHeader icon="🏠" title="EVV Visits" sub="Last 7 days"
            action={
              <Btn disabled={!sandataConfig?.isConfigured || selected.length === 0 || loading.submit}
                onClick={async () => {
                  setLoad('submit', true)
                  try {
                    const d: { queued?: number } = await api.post('/api/sandata/submit', { visitIds: selected })
                    toast.success(`Queued ${d?.queued ?? 0} visits for Sandata submission`)
                    setSelected([])
                    reloadEvv()
                  } catch (err) { toast.error(errorMessage(err, 'Submission failed')) }
                  setLoad('submit', false)
                }}>
                {loading.submit ? 'Submitting...' : '📤 Submit to Sandata'}{selected.length > 0 ? ` (${selected.length})` : ''}
              </Btn>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[0.82rem]">
              <thead>
                <tr style={{ background: 'var(--hc-subtle)' }}>
                  <th className="w-8 p-2"><input type="checkbox" aria-label="Select every visit ready to submit" onChange={(e) => { if (e.target.checked) setSelected(visits.filter((v) => v.sandataStatus === 'ready').map((v) => v.id)); else setSelected([]) }} /></th>
                  {['Date', 'Client', 'Caregiver', 'Code', 'Units', 'GPS', 'EVV Status', 'Sandata'].map((h) => <TH key={h}>{h}</TH>)}
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id} style={{ ...rowLine, background: selected.includes(v.id) ? 'var(--color-teal-light)' : 'var(--hc-surface)' }}>
                    <td className="p-2 text-center">
                      {v.sandataStatus === 'ready' && <input type="checkbox" aria-label="Select visit" checked={selected.includes(v.id)} onChange={(e) => setSelected((p) => e.target.checked ? [...p, v.id] : p.filter((id) => id !== v.id))} />}
                    </td>
                    <td className="px-3 py-2">{fmtDate(v.serviceDate)}</td>
                    <td className="px-3 py-2 font-semibold">{v.clientFirst} {v.clientLast}</td>
                    <td className="px-3 py-2">{v.cgFirst} {v.cgLast}</td>
                    <td className="px-3 py-2"><Code>{v.serviceCode}{v.modifier ? ` ${v.modifier}` : ''}</Code></td>
                    <td className="px-3 py-2">{fmtNum(v.unitsOfService)}</td>
                    <td className="px-3 py-2">{v.gpsInLat ? '✅ In' : '⚠️'} {v.gpsOutLat ? '/ Out' : ''}</td>
                    <td className="px-3 py-2"><Badge status={v.isVerified ? 'active' : 'pending'} label={v.isVerified ? 'Verified' : 'Pending'} /></td>
                    <td className="px-3 py-2"><Badge status={v.sandataStatus} label={v.sandataStatus} /></td>
                  </tr>
                ))}
                {visits.length === 0 && <tr><td colSpan={9} className="p-8 text-center" style={{ color: INK.muted }}>No EVV visits in this period</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    )
  }

  // ── Authorizations Tab ────────────────────────────────────────────────────────
  const importMidas = async (file: File) => {
    const text = await file.text()
    const lines = text.split('\n')
    const headers = lines[0].split(',').map((h) => h.trim())
    const csvRows = lines.slice(1).filter((l) => l.trim()).map((l) => {
      const vals = l.split(',')
      const obj: Record<string, string> = {}
      headers.forEach((h, i) => { obj[h] = vals[i]?.trim() || '' })
      return obj
    })
    try {
      // billing/authorizations.ts POST /import-csv → { imported, skipped: [{ row, reason }] } (built 2026-10-19: no server
      // had answered this, so the import never imported). A skipped row says which line and why.
      const d: { imported?: number; skipped?: Array<{ row: number; reason: string }> } = await api.post('/api/authorizations/import-csv', { rows: csvRows })
      const skipped = d?.skipped || []
      toast.success(`Imported ${d?.imported ?? 0} authorization${d?.imported === 1 ? '' : 's'}${skipped.length ? `; skipped ${skipped.length}` : ''}`)
      if (skipped.length) toast.error(skipped.slice(0, 3).map((x) => `Line ${x.row}: ${x.reason}`).join(' · ') + (skipped.length > 3 ? ` · and ${skipped.length - 3} more` : ''))
      loadAuthorizations()
    } catch (err) { toast.error(errorMessage(err, 'Import failed')) }
  }

  const saveAuthorization = async () => {
    try {
      await api.post('/api/authorizations', authForm)
      toast.success('Authorization saved')
      setShowAuthForm(false)
      setAuthForm(EMPTY_AUTH)
      loadAuthorizations()
      get<AuthSummary>('/api/authorizations/summary').then((d) => d && setAuthSummary(d))
    } catch (err) { toast.error(errorMessage(err, 'Failed')) }
  }

  const renderAuthorizations = () => (
    <div className="grid gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' }}>
        <Tile value={authSummary?.active || 0} label="Active" color={INK.brand} />
        <Tile value={authSummary?.expiringSoon || 0} label="Expiring Soon" color={INK.amber} />
        <Tile value={authSummary?.lowUnits || 0} label="Low Units" color={INK.red} />
        <Tile value={authSummary?.exhausted || 0} label="Exhausted" color={INK.red} />
        <Tile value={authSummary?.expired || 0} label="Expired" color={INK.muted} />
      </div>

      {/* MIDAS import info */}
      {mayBillingCreate && (
        <Card style={{ background: 'var(--hc-info-bg)', borderColor: 'var(--hc-info-line)', color: 'var(--hc-info-ink)' }}>
          <div className="flex items-start gap-3">
            <span className="text-2xl">📥</span>
            <div>
              <p className="mb-1 text-sm font-bold">Import from MIDAS</p>
              <p className="mb-2 text-[0.82rem]">Export authorizations from the MIDAS portal as CSV, then import here. Expected columns: MemberID, AuthNumber, ServiceCode, AuthorizedUnits, StartDate, EndDate</p>
              <label className="cursor-pointer rounded-lg bg-indigo-600 px-3.5 py-1.5 text-[0.82rem] font-bold text-white hover:bg-indigo-700">
                📂 Import MIDAS CSV
                <input type="file" accept=".csv" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) importMidas(file)
                }} />
              </label>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <SectionHeader icon="📋" title="Authorization Tracker" sub="MIDAS authorizations and burn-down"
          action={mayBillingCreate ? <Btn onClick={() => setShowAuthForm((p) => !p)}>{showAuthForm ? 'Cancel' : '+ Add Auth'}</Btn> : undefined}
        />

        {showAuthForm && (
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-[10px] p-4 md:grid-cols-2" style={{ background: 'var(--hc-subtle)' }}>
            <div><label className={LABEL}>Client *</label>
              <select className={FIELD} style={fieldStyle} value={authForm.clientId} onChange={(e) => setAuthForm((p) => ({ ...p, clientId: e.target.value }))}>
                <option value="">Select client...</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
            </div>
            <div><label className={LABEL}>Payer</label>
              <select className={FIELD} style={fieldStyle} value={authForm.payerId} onChange={(e) => setAuthForm((p) => ({ ...p, payerId: e.target.value }))}>
                <option value="">Select payer...</option>
                {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label className={LABEL}>Auth Number</label>
              <input className={FIELD} style={fieldStyle} value={authForm.authNumber} onChange={(e) => setAuthForm((p) => ({ ...p, authNumber: e.target.value }))} placeholder="e.g. 12345678" />
            </div>
            <div><label className={LABEL}>Service Code</label>
              <select className={FIELD} style={fieldStyle} value={authForm.procedureCode} onChange={(e) => setAuthForm((p) => ({ ...p, procedureCode: e.target.value }))}>
                {serviceCodes.map((sc) => <option key={sc.id} value={sc.code}>{sc.code}{sc.modifier1 ? ` ${sc.modifier1}` : ''} — {sc.description}</option>)}
              </select>
            </div>
            <div><label className={LABEL}>Authorized Units *</label>
              <input type="number" className={FIELD} style={fieldStyle} value={authForm.authorizedUnits} onChange={(e) => setAuthForm((p) => ({ ...p, authorizedUnits: e.target.value }))} placeholder="e.g. 312" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={LABEL}>Start Date *</label>
                <input type="date" className={FIELD} style={fieldStyle} value={authForm.startDate} onChange={(e) => setAuthForm((p) => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div><label className={LABEL}>End Date *</label>
                <input type="date" className={FIELD} style={fieldStyle} value={authForm.endDate} onChange={(e) => setAuthForm((p) => ({ ...p, endDate: e.target.value }))} />
              </div>
            </div>
            <div className="md:col-span-2">
              <Btn onClick={saveAuthorization}>Save Authorization</Btn>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.82rem]">
            <thead>
              <tr style={{ background: 'var(--hc-subtle)' }}>
                {['Client', 'Payer', 'Auth #', 'Code', 'Units Used/Auth', 'Remaining', 'Expires', 'Status'].map((h) => <TH key={h}>{h}</TH>)}
              </tr>
            </thead>
            <tbody>
              {authorizations.map((a) => {
                const authorized = num(a.authorizedUnits)
                const used = num(a.usedUnits)
                const remaining = authorized - used
                const pctUsed = authorized > 0 ? (used / authorized * 100) : 0
                const barColor = pctUsed > 90 ? '#EF4444' : pctUsed > 70 ? '#F59E0B' : 'var(--hc-primary)'
                const health = authHealth(a)
                const endSoon = a.endDate ? parseLocalDate(a.endDate) < new Date(Date.now() + 30 * 86400000) : false
                return (
                  <tr key={a.id} style={rowLine}>
                    <td className="px-3 py-2 font-semibold">{a.client?.firstName} {a.client?.lastName}</td>
                    <td className="px-3 py-2" style={{ color: INK.muted }}>{a.payer?.name || '—'}</td>
                    <td className="px-3 py-2"><Code>{a.authNumber || '—'}</Code></td>
                    <td className="px-3 py-2"><Code>{a.procedureCode || '—'}</Code></td>
                    <td className="min-w-[140px] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--hc-line)' }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(pctUsed, 100)}%`, background: barColor }} />
                        </div>
                        <span className="whitespace-nowrap text-[0.72rem]" style={{ color: INK.soft }}>{fmtNum(a.usedUnits)}/{fmtNum(a.authorizedUnits)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 font-bold" style={{ color: remaining < 20 ? INK.red : INK.soft }}>{remaining.toFixed(2)}</td>
                    <td className="px-3 py-2" style={{ color: endSoon ? INK.red : INK.soft }}>{fmtDate(a.endDate)}</td>
                    <td className="px-3 py-2"><Badge status={health.key} label={health.label} /></td>
                  </tr>
                )
              })}
              {authorizations.length === 0 && <tr><td colSpan={8} className="p-8 text-center" style={{ color: INK.muted }}>No authorizations yet. Add one manually or import from MIDAS.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )

  // ── Claims / EDI Tab ──────────────────────────────────────────────────────────
  const downloadEdi = async (b: EdiBatch) => {
    try {
      saveBlob(await downloadBlob(`/api/edi/batches/${b.id}/download`), `${b.batchNumber || 'edi-batch'}.837`)
    } catch (err) { toast.error(errorMessage(err, 'Download failed')) }
  }

  const renderClaims = () => (
    <div className="grid gap-4">
      <Card>
        <SectionHeader icon="📄" title="EDI 837 Claim Batches" sub="Generated claim files for WPS/clearinghouse"
          action={<Btn outline onClick={() => { toast.info('Select claims from Billing → Claims first, then generate') }}>ℹ️ How to Use</Btn>}
        />
        <div className="mb-4 rounded-[10px] border px-4 py-3.5 text-[0.82rem]" style={{ background: 'var(--hc-success-bg)', borderColor: 'var(--hc-success-line)', color: 'var(--hc-success-ink)' }}>
          <strong>Workflow:</strong> Billing → Claims → select approved claims → Generate EDI 837 → download .edi file → upload to WPS Provider Portal or your clearinghouse (Availity, Change Healthcare, etc.)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.82rem]">
            <thead>
              <tr style={{ background: 'var(--hc-subtle)' }}>
                {['Batch #', 'Payer', 'Claims', 'Total Billed', 'Generated', 'Status', ''].map((h) => <TH key={h}>{h}</TH>)}
              </tr>
            </thead>
            <tbody>
              {ediBatches.map((b) => (
                <tr key={b.id} style={rowLine}>
                  <td className="px-3 py-2"><Code>{b.batchNumber}</Code></td>
                  <td className="px-3 py-2">{b.payer?.name || '—'}</td>
                  <td className="px-3 py-2">{b._count?.claims ?? b.claimCount ?? 0}</td>
                  <td className="px-3 py-2 font-bold">{fmt$(b.totalBilled)}</td>
                  <td className="px-3 py-2" style={{ color: INK.muted }}>{fmtInstant(b.createdAt)}</td>
                  <td className="px-3 py-2"><Badge status={b.status} label={b.status} /></td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => downloadEdi(b)} className="text-[0.78rem] font-bold hover:underline" style={{ color: INK.brand }}>⬇ Download .edi</button>
                  </td>
                </tr>
              ))}
              {ediBatches.length === 0 && <tr><td colSpan={7} className="p-8 text-center" style={{ color: INK.muted }}>No EDI batches yet</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Service codes reference */}
      <Card>
        <SectionHeader icon="🗂️" title="Service Code Reference" sub="Wisconsin Medicaid procedure codes in your system" />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.78rem]">
            <thead>
              <tr style={{ background: 'var(--hc-subtle)' }}>
                {['Code', 'Modifier', 'Description', 'Category', 'Payer', 'Unit', 'EVV Required'].map((h) => <TH key={h}>{h}</TH>)}
              </tr>
            </thead>
            <tbody>
              {serviceCodes.map((sc) => (
                <tr key={sc.id} style={rowLine}>
                  <td className="px-3 py-1.5"><code className="font-extrabold" style={{ color: INK.info }}>{sc.code}</code></td>
                  <td className="px-3 py-1.5">{sc.modifier1 || '—'}</td>
                  <td className="px-3 py-1.5" style={{ color: INK.soft }}>{sc.description}</td>
                  <td className="px-3 py-1.5" style={{ color: INK.muted }}>{sc.serviceCategory}</td>
                  <td className="px-3 py-1.5">{sc.payerType === 'all' ? 'All' : sc.payerType}</td>
                  <td className="px-3 py-1.5">{sc.unitType}</td>
                  <td className="px-3 py-1.5">{sc.requiresEvv ? '✅ Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )

  // ── Remittance Tab ────────────────────────────────────────────────────────────
  const uploadRemittance = async (file: File) => {
    setUploadState('uploading')
    // The app's check reader (billing/payments.ts scan-check). The screen posted to /api/remittance/upload, which no
    // server had, so a check or statement was never read (2026-10-19). It reads images: a photo or scan.
    const fd = new FormData()
    fd.append('check', file)
    try {
      const d: OcrResult = await api.upload('/api/payments/scan-check', fd)
      setUploadState(d)
      setRemitForm((p) => ({
        ...p,
        payerName: d.extracted?.payerName || '', checkNumber: d.extracted?.checkNumber || '',
        checkDate: d.extracted?.checkDate || '', totalAmount: d.extracted?.amount != null ? String(d.extracted.amount) : '',
        payerId: d.suggestedPayer?.id || '',
        lineItems: [],
      }))
    } catch (err) { toast.error(errorMessage(err, 'OCR failed')); setUploadState(null) }
  }

  const saveRemittance = async () => {
    // Blank optionals are left off: an empty string into a payer, date or amount column is refused.
    const body: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(remitForm)) if (v !== '') body[k] = v
    try {
      const d: { lineItems?: unknown[] } = await api.post('/api/remittance', body)
      toast.success(`Saved. ${d?.lineItems?.length ?? 0} line item(s) recorded.`)
      setUploadState(null)
      setRemitForm(EMPTY_REMIT)
      loadRemittances()
    } catch (err) { toast.error(errorMessage(err, 'Save failed')) }
  }

  const remitField = (key: 'payerName' | 'checkNumber' | 'totalAmount' | 'checkDate' | 'paymentDate', text: string, type = 'text') => (
    <div>
      <label className={LABEL}>{text}</label>
      <input type={type} className={FIELD} style={fieldStyle} value={remitForm[key]} onChange={(e) => setRemitForm((p) => ({ ...p, [key]: e.target.value }))} />
    </div>
  )

  const renderRemittance = () => (
    <div className="grid gap-4">
      <Card>
        <SectionHeader icon="📷" title="Upload Remittance / Check"
          sub="Photo or scan → OCR reads it → match to claims automatically"
          action={mayBillingCreate ? <Btn onClick={() => fileRef.current?.click()} disabled={uploadState === 'uploading'}>📷 Upload Check / Statement</Btn> : undefined}
        />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) uploadRemittance(file)
        }} />

        {uploadState && uploadState !== 'uploading' && (
          <div className="mb-4 rounded-[10px] border p-4" style={{ background: 'var(--hc-success-bg)', borderColor: 'var(--hc-success-line)' }}>
            <p className="mb-3 font-bold" style={{ color: 'var(--hc-success-ink)' }}>✅ OCR Complete — Verify and Save</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2" style={{ color: INK.ink }}>
              {remitField('payerName', 'Payer Name *')}
              <div>
                <label className={LABEL}>Match to Existing Payer</label>
                <select className={FIELD} style={fieldStyle} value={remitForm.payerId} onChange={(e) => setRemitForm((p) => ({ ...p, payerId: e.target.value }))}>
                  <option value="">— Select payer —</option>
                  {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {remitField('checkNumber', 'Check Number')}
              {remitField('totalAmount', 'Total Amount *', 'number')}
              {remitField('checkDate', 'Check Date', 'date')}
              {remitField('paymentDate', 'Payment Date', 'date')}
            </div>
            <div className="mt-3 flex gap-2">
              <Btn onClick={saveRemittance}>💾 Save Remittance</Btn>
              <Btn outline onClick={() => setUploadState(null)}>Cancel</Btn>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[0.82rem]">
            <thead>
              <tr style={{ background: 'var(--hc-subtle)' }}>
                {['Payer', 'Check #', 'Date', 'Amount', 'Line Items', 'Status'].map((h) => <TH key={h}>{h}</TH>)}
              </tr>
            </thead>
            <tbody>
              {remittanceBatches.map((b) => (
                <tr key={b.id} style={rowLine}>
                  <td className="px-3 py-2 font-semibold">{b.payer?.name || b.payerName || '—'}</td>
                  <td className="px-3 py-2">{b.checkNumber || '—'}</td>
                  <td className="px-3 py-2" style={{ color: INK.muted }}>{fmtDate(b.paymentDate)}</td>
                  <td className="px-3 py-2 font-bold" style={{ color: INK.brand }}>{fmt$(b.totalAmount)}</td>
                  <td className="px-3 py-2">{b.lineItems?.length || 0}</td>
                  <td className="px-3 py-2"><Badge status={b.status} label={b.status} /></td>
                </tr>
              ))}
              {remittanceBatches.length === 0 && <tr><td colSpan={6} className="p-8 text-center" style={{ color: INK.muted }}>No remittances recorded yet. Upload a check to get started.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )

  // ── Payroll Tab ───────────────────────────────────────────────────────────────
  const period = `startDate=${encodeURIComponent(payPeriod.start)}&endDate=${encodeURIComponent(payPeriod.end)}`
  const loadPreview = async () => {
    setLoad('preview', true)
    try { setPayrollPreview(await api.get(`/api/gusto/preview?${period}`)) } catch (err) { toast.error(errorMessage(err, 'Could not load preview')) }
    setLoad('preview', false)
  }
  const downloadCsv = async () => {
    setLoad('csv', true)
    try { saveBlob(await downloadBlob(`/api/gusto/export-csv?${period}`), `gusto-hours-${payPeriod.start}-to-${payPeriod.end}.csv`) } catch (err) { toast.error(errorMessage(err, 'Export failed')) }
    setLoad('csv', false)
  }

  const renderPayroll = () => {
    const w = payrollPreview?.warnings
    return (
      <div className="grid gap-4">
        {/* What the owner does, in their words. The old card told them to add two server settings to
            "Render env vars" — the server's settings, out of their reach — for a direct push the server refuses (501)
            (live test, 2026-10-22). The CSV is the way hours reach Gusto. */}
        <Card style={{ background: 'var(--hc-subtle)' }}>
          <h4 className="mb-2 font-bold" style={{ color: INK.ink }}>💰 Getting hours into Gusto</h4>
          <div className="grid gap-1 text-[0.82rem]" style={{ color: INK.ink }}>
            <div>1. Set the pay period below and click <strong>Preview</strong>.</div>
            <div>2. Click <strong>⬇ CSV for Gusto</strong> to download the hours.</div>
            <div>3. In Gusto, upload the file into the pay run with Gusto’s hours import.</div>
          </div>
        </Card>

        <Card>
          <SectionHeader icon="💰" title="Payroll Export" sub="Payable hours from approved payroll shift reviews — upload the CSV into Gusto's hours import" />
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className={LABEL}>Pay Period Start</label>
              <input type="date" className="rounded-md border p-2 text-sm" style={fieldStyle} value={payPeriod.start} onChange={(e) => setPayPeriod((p) => ({ ...p, start: e.target.value }))} />
            </div>
            <div>
              <label className={LABEL}>Pay Period End</label>
              <input type="date" className="rounded-md border p-2 text-sm" style={fieldStyle} value={payPeriod.end} onChange={(e) => setPayPeriod((p) => ({ ...p, end: e.target.value }))} />
            </div>
            <Btn disabled={!payPeriod.start || !payPeriod.end || loading.preview} onClick={loadPreview}>{loading.preview ? 'Loading...' : 'Preview'}</Btn>
            {payrollPreview && <>
              <Btn outline disabled={loading.csv} onClick={downloadCsv}>{loading.csv ? 'Preparing...' : '⬇ CSV for Gusto'}</Btn>
            </>}
          </div>

          {payrollPreview && (
            <>
              <div className="mb-4 grid grid-cols-3 gap-3">
                <Tile value={payrollPreview.totals.employees} label="Caregivers" />
                <Tile value={`${payrollPreview.totals.totalHours}h`} label="Total Hours" />
                <Tile value={fmt$(payrollPreview.totals.totalGross)} label="Gross Pay" color={INK.brand} ground="var(--color-teal-light)" />
              </div>
              {((w?.unresolvedReviews || 0) > 0 || (w?.clockEntriesWithoutReview || 0) > 0) && (
                <div className="mb-4 rounded-lg border p-3 text-[0.82rem]" style={{ background: 'var(--hc-danger-bg)', borderColor: 'var(--hc-danger-line)', color: 'var(--hc-danger-ink)' }}>
                  ⚠️ Not in this export:
                  {(w?.unresolvedReviews || 0) > 0 && <> {w?.unresolvedReviews} shift(s) still pending/flagged in Shift Review.</>}
                  {(w?.clockEntriesWithoutReview || 0) > 0 && <> {w?.clockEntriesWithoutReview} clock entr(ies) with no payroll review row (run Reconcile in Payroll first).</>}
                  {' '}Resolve them, then re-preview before uploading to Gusto.
                </div>
              )}
              {payrollPreview.totals.unmapped > 0 && (
                <div className="mb-4 rounded-lg border p-3 text-[0.82rem]" style={{ background: 'var(--hc-warning-bg)', borderColor: 'var(--hc-warning-line)', color: 'var(--hc-warning-ink)' }}>
                  ⚠️ {payrollPreview.totals.unmapped} caregiver(s) not matched to a Gusto employee — check their names match in Gusto before you upload the CSV.
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[0.82rem]">
                  <thead>
                    <tr style={{ background: 'var(--hc-subtle)' }}>
                      {['Caregiver', 'Regular', 'Overtime', 'Total', 'Rate', 'Gross Pay', 'Gusto'].map((h) => <TH key={h}>{h}</TH>)}
                    </tr>
                  </thead>
                  <tbody>
                    {payrollPreview.preview.map((r) => {
                      const ot = num(r.overtimeHours) > 0
                      return (
                        <tr key={r.id} style={rowLine}>
                          <td className="px-3 py-2 font-semibold">{r.firstName} {r.lastName}</td>
                          <td className="px-3 py-2">{r.regularHours}h</td>
                          <td className="px-3 py-2" style={{ color: ot ? INK.amber : INK.muted, fontWeight: ot ? 700 : 400 }}>{r.overtimeHours}h</td>
                          <td className="px-3 py-2 font-bold">{r.totalHours}h</td>
                          <td className="px-3 py-2">{num(r.hourlyRate) ? fmt$(r.hourlyRate) + '/hr' : '—'}</td>
                          <td className="px-3 py-2 font-bold" style={{ color: INK.brand }}>{fmt$(r.grossPay)}</td>
                          <td className="px-3 py-2">{r.gustoMapped ? <Badge status="active" label="✓ Mapped" /> : <Badge status="pending" label="Not Mapped" />}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>
    )
  }

  const allowed = (id: TabId) => tabs.some((t) => t.id === id)

  return (
    <div className="max-w-[1100px]" style={{ color: INK.ink }}>
      <div className="mb-5">
        <h2 className="mb-1 text-[1.3rem] font-extrabold" style={{ color: INK.ink }}>🔌 Integrations Hub</h2>
        <p className="m-0 text-[0.82rem]" style={{ color: INK.muted }}>EVV · MIDAS Authorizations · EDI 837 Claims · Remittance · Payroll</p>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 overflow-x-auto border-b-2" style={{ borderColor: 'var(--hc-line)' }}>
        {tabs.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className="-mb-0.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-[0.85rem] transition-all"
            style={{
              fontWeight: tab === t.id ? 800 : 500,
              color: tab === t.id ? INK.brand : INK.muted,
              borderColor: tab === t.id ? 'var(--hc-primary)' : 'transparent',
            }}>{t.label}</button>
        ))}
      </div>

      {tab === 'overview' && renderOverview()}
      {tab === 'evv' && allowed('evv') && renderEVV()}
      {tab === 'authorizations' && allowed('authorizations') && renderAuthorizations()}
      {tab === 'claims' && allowed('claims') && renderClaims()}
      {tab === 'remittance' && allowed('remittance') && renderRemittance()}
      {tab === 'payroll' && allowed('payroll') && renderPayroll()}
      {tab === 'calltracking' && allowed('calltracking') && <CallTrackingSettings />}
    </div>
  )
}
