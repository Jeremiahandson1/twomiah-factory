// Moved from templates/crm-homecare/frontend/src/components/admin/OnboardingPacketsAdmin.tsx (/crm/onboarding-packets).
// Onboarding queue — post-hire packets. Statuses: sent | opened | in_progress | submitted | expired | cancelled.
// Actions: view detail, resend link, download the Gusto import CSV, mark Gusto-synced, and — for a Wisconsin agency —
// retry a WORCS submission that failed.
//
// Replies read (server/crm/homecare/hr/onboardingPackets.ts, care-hr):
//   GET  /api/onboarding-packets          { data }: id, status, expiresAt, submittedAt, bgcConsentSignedAt, legalFirstName,
//                                         legalLastName, createdAt, caregiverId, firstName, lastName, email,
//                                         gustoEmployeeId, gustoSyncedAt
//   GET  /api/onboarding-packets/:id      the packet (no token, no SSN) + worcsSubmissionPending, the person, events
//   POST /api/onboarding-packets/:id/resend | retry-worcs | mark-gusto-synced { gustoEmployeeId }
//   GET  /api/onboarding-packets/:id/gusto-export.csv   the file
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useToast } from '../../../../shared'
import { api, downloadBlob, errorMessage, rows, saveBlob } from '../lib/http'
import { formatDate } from '../lib/date'
import { formatDateTime } from '../lib/datetime'
import EligibilityCard, { isWisconsinAgency } from './EligibilityCard'
import { useMay } from '../lib/useMay'

const STATUS_META: Record<string, { label: string; cls: string }> = {
  sent:        { label: 'Invite Sent', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
  opened:      { label: 'Opened',      cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
  in_progress: { label: 'In Progress', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  submitted:   { label: 'Submitted',   cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' },
  expired:     { label: 'Expired',     cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
  cancelled:   { label: 'Cancelled',   cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
}

interface PacketRow {
  id: string
  status: string
  expiresAt: string | null
  submittedAt: string | null
  bgcConsentSignedAt: string | null
  legalFirstName: string | null
  legalLastName: string | null
  createdAt: string
  caregiverId: string
  firstName: string | null
  lastName: string | null
  email: string | null
  gustoEmployeeId: string | null
  gustoSyncedAt: string | null
}

interface PacketDetail extends PacketRow {
  preferredName: string | null
  pronouns: string | null
  legalMiddleName: string | null
  dateOfBirth: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  driversLicenseNumber: string | null
  driversLicenseState: string | null
  emergencyContactName: string | null
  emergencyContactRelationship: string | null
  emergencyContactPhone: string | null
  bgcConsentSignature: string | null
  bgcConsentIp: string | null
  bgcConsentVersion: string | null
  worcsSubmissionPending: boolean
  events: Array<{ id: string; eventType: string; createdAt: string; ipAddress: string | null }>
}

const fmtDate = (d: unknown) => (d ? formatDate(d as string) : '—')
const fmtDT = (d: unknown) => (d ? formatDateTime(d) : '—')
const btnOutline = 'px-3 py-1.5 rounded-lg border-2 text-sm font-bold bg-white dark:bg-slate-800'
const fieldLabel = 'block text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-slate-300 mb-0.5'
const fieldValue = 'text-sm text-gray-900 dark:text-slate-100 mb-3'

export default function OnboardingPacketsAdmin() {
  // Resend, Retry WORCS and Mark Synced are care-hr:update, the server's check (lib/useMay.ts).
  const mayHr = useMay('care-hr')
  const { company } = useAuth()
  const toast = useToast()
  const wisconsin = isWisconsinAgency(company)
  const [packets, setPackets] = useState<PacketRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'submitted' | 'needs_gusto' | 'all'>('active')
  // While the detail loads it holds the list's row (stub); then the full packet.
  const [detail, setDetail] = useState<{ stub: PacketRow } | PacketDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [gustoInput, setGustoInput] = useState('')
  const [retrying, setRetrying] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setPackets(rows<PacketRow>(await api.get('/api/onboarding-packets')))
    } catch (e) {
      toast.error('Error: ' + errorMessage(e, 'Failed to load packets'))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  const active = (p: PacketRow) => ['sent', 'opened', 'in_progress'].includes(p.status)
  const filtered = packets.filter((p) => {
    if (tab === 'active') return active(p)
    if (tab === 'submitted') return p.status === 'submitted'
    if (tab === 'needs_gusto') return p.status === 'submitted' && !p.gustoSyncedAt
    return true
  })

  const openDetail = async (p: { id: string } & Partial<PacketRow>) => {
    setDetailLoading(true)
    setDetail({ stub: p as PacketRow })
    try {
      const full: PacketDetail = await api.get(`/api/onboarding-packets/${p.id}`)
      setDetail(full)
      setGustoInput(full.gustoEmployeeId || '')
    } catch (e) {
      toast.error('Error: ' + errorMessage(e, 'Load detail failed'))
      setDetail(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const resend = async (p: PacketRow) => {
    try {
      await api.post(`/api/onboarding-packets/${p.id}/resend`)
      toast.success('Fresh invite sent')
      load()
    } catch (e) { toast.error('Error: ' + errorMessage(e, 'Resend failed')) }
  }

  const downloadCsv = (p: { id: string; lastName?: string | null }) => {
    downloadBlob(`/api/onboarding-packets/${p.id}/gusto-export.csv`)
      .then((blob) => saveBlob(blob, `gusto-import-${(p.lastName || 'caregiver').toLowerCase()}.csv`))
      .catch((err) => toast.error('Error: ' + errorMessage(err, 'CSV download failed')))
  }

  const full = detail && 'id' in detail ? detail : null

  const markGustoSynced = async () => {
    if (!full) return
    try {
      await api.post(`/api/onboarding-packets/${full.id}/mark-gusto-synced`, { gustoEmployeeId: gustoInput.trim() || null })
      toast.success('Marked as synced to Gusto')
      openDetail(full)
      load()
    } catch (e) { toast.error('Error: ' + errorMessage(e, 'Mark synced failed')) }
  }

  const retryWorcs = async () => {
    if (!full) return
    setRetrying(true)
    try {
      await api.post(`/api/onboarding-packets/${full.id}/retry-worcs`)
      toast.success('Background check submitted to WORCS')
      openDetail(full)
    } catch (e) {
      toast.error('Error: ' + errorMessage(e, 'WORCS submission failed'))
    } finally {
      setRetrying(false)
    }
  }

  const counts = {
    active: packets.filter(active).length,
    submitted: packets.filter((p) => p.status === 'submitted').length,
    needs_gusto: packets.filter((p) => p.status === 'submitted' && !p.gustoSyncedAt).length,
    all: packets.length,
  }
  const TABS: Array<[keyof typeof counts, string]> = [['active', 'Active'], ['submitted', 'Submitted'], ['needs_gusto', 'Needs Gusto'], ['all', 'All']]
  const heading = detail ? ('stub' in detail ? detail.stub : detail) : null

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-100">📬 Onboarding Packets</h1>
        <p className="text-sm text-gray-600 dark:text-slate-300 mt-1">
          Post-hire: background check consent{wisconsin ? ', WORCS check' : ''}, Gusto sync.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-slate-700 mb-4">
        {TABS.map(([id, name]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 -mb-px text-sm border-b-2 ${tab === id
              ? 'border-primary-600 text-primary-700 dark:text-primary-200 font-extrabold'
              : 'border-transparent text-gray-600 dark:text-slate-300 font-medium'}`}>
            {name} ({counts[id]})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-600 dark:text-slate-300">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-10 text-center">
          <div className="text-3xl">📭</div>
          <div className="font-bold text-gray-800 dark:text-slate-100">No packets in this view</div>
        </div>
      ) : filtered.map((p) => {
        const meta = STATUS_META[p.status] || STATUS_META.sent
        return (
          <div key={p.id} className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 mb-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <div className="font-extrabold text-gray-900 dark:text-slate-100">{p.legalFirstName || p.firstName} {p.legalLastName || p.lastName}</div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${meta.cls}`}>{meta.label}</span>
                  {p.gustoSyncedAt && <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200">Gusto Synced</span>}
                </div>
                <div className="text-sm text-gray-600 dark:text-slate-300">{p.email}</div>
                <div className="text-xs text-gray-600 dark:text-slate-400 mt-1">
                  Hired {fmtDate(p.createdAt)}
                  {p.submittedAt && ` · Submitted ${fmtDate(p.submittedAt)}`}
                  {p.bgcConsentSignedAt && ` · Consent signed ${fmtDate(p.bgcConsentSignedAt)}`}
                  {p.expiresAt && ` · Expires ${fmtDate(p.expiresAt)}`}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 min-w-[150px]">
                <button className={`${btnOutline} border-primary-600 text-primary-700 dark:text-primary-200`} onClick={() => openDetail(p)}>View Detail</button>
                {mayHr.update && ['sent', 'opened', 'in_progress', 'expired'].includes(p.status) && (
                  <button className={`${btnOutline} border-gray-500 text-gray-700 dark:text-slate-200`} onClick={() => resend(p)}>Resend Link</button>
                )}
                {p.status === 'submitted' && !p.gustoSyncedAt && (
                  <button className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 text-sm font-bold" onClick={() => downloadCsv({ id: p.id, lastName: p.lastName })}>Download Gusto CSV</button>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {detail && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null) }}>
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-slate-100">
                {detailLoading ? 'Loading…' : `${heading?.legalFirstName || heading?.firstName} ${heading?.legalLastName || heading?.lastName}`}
              </h2>
              <button className={`${btnOutline} border-gray-400 text-gray-700 dark:text-slate-200`} onClick={() => setDetail(null)}>✕</button>
            </div>

            {!detailLoading && full && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mb-2">
                  <div><span className={fieldLabel}>Preferred Name</span><div className={fieldValue}>{full.preferredName || '—'}</div></div>
                  <div><span className={fieldLabel}>Pronouns</span><div className={fieldValue}>{full.pronouns || '—'}</div></div>
                  <div><span className={fieldLabel}>Legal Full Name</span><div className={fieldValue}>{[full.legalFirstName, full.legalMiddleName, full.legalLastName].filter(Boolean).join(' ') || '—'}</div></div>
                  <div><span className={fieldLabel}>Date of Birth</span><div className={fieldValue}>{fmtDate(full.dateOfBirth)}</div></div>
                  <div className="sm:col-span-2"><span className={fieldLabel}>Address</span><div className={fieldValue}>{full.address ? `${full.address}, ${full.city || ''} ${full.state || ''} ${full.zip || ''}` : '—'}</div></div>
                  <div><span className={fieldLabel}>Driver's License</span><div className={fieldValue}>{full.driversLicenseNumber ? `${full.driversLicenseNumber} (${full.driversLicenseState || '—'})` : '—'}</div></div>
                  <div><span className={fieldLabel}>Emergency Contact</span><div className={fieldValue}>
                    {full.emergencyContactName ? `${full.emergencyContactName} (${full.emergencyContactRelationship || '—'}) · ${full.emergencyContactPhone || '—'}` : '—'}
                  </div></div>
                </div>

                <div className={`rounded-lg border px-4 py-3 mb-4 ${full.bgcConsentSignedAt
                  ? 'bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800'
                  : 'bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800'}`}>
                  <div className={`font-bold mb-1 ${full.bgcConsentSignedAt ? 'text-green-900 dark:text-green-100' : 'text-amber-900 dark:text-amber-100'}`}>
                    {full.bgcConsentSignedAt ? '✅ Background check consent on file' : '⚠️ Consent not yet signed'}
                  </div>
                  {full.bgcConsentSignedAt && (
                    <div className="text-sm text-gray-700 dark:text-slate-200">
                      Signed by <strong>{full.bgcConsentSignature}</strong> on {fmtDT(full.bgcConsentSignedAt)}<br />
                      IP: {full.bgcConsentIp || '—'} · Disclosure v{full.bgcConsentVersion || '—'}
                    </div>
                  )}
                  {mayHr.update && wisconsin && full.worcsSubmissionPending && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-amber-900 dark:text-amber-100">The automatic WORCS submission has not gone through.</span>
                      <button className="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold disabled:opacity-60" onClick={retryWorcs} disabled={retrying}>
                        {retrying ? 'Submitting…' : 'Retry WORCS'}
                      </button>
                    </div>
                  )}
                </div>

                {wisconsin && <EligibilityCard caregiverId={full.caregiverId} />}

                <div className={`rounded-xl border p-4 mb-4 ${full.gustoSyncedAt
                  ? 'bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800'
                  : 'bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800'}`}>
                  <div className="font-extrabold mb-1.5 text-gray-900 dark:text-slate-100">{full.gustoSyncedAt ? '✅ Synced to Gusto' : '📤 Add to Gusto'}</div>
                  {full.gustoSyncedAt ? (
                    <div className="text-sm text-gray-700 dark:text-slate-200">
                      Employee ID: <strong>{full.gustoEmployeeId || '—'}</strong> · Marked {fmtDT(full.gustoSyncedAt)}
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-amber-900 dark:text-amber-100 mb-2.5">
                        Gusto does not offer API access for agencies to auto-create employees. Download the CSV, upload it in Gusto
                        (<strong>Team &gt; Add Employees &gt; CSV Import</strong>), then paste the Gusto employee ID below and click Mark
                        Synced. Gusto will email the caregiver their W-4, I-9, and direct-deposit onboarding.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 text-sm font-bold" onClick={() => downloadCsv({ id: full.id, lastName: full.legalLastName || full.lastName })}>Download Gusto CSV</button>
                        {mayHr.update && <>
                        <input placeholder="Paste Gusto employee ID" value={gustoInput} onChange={(e) => setGustoInput(e.target.value)}
                          className="flex-1 min-w-[180px] rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-1.5 text-sm" />
                        <button className="px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-bold" onClick={markGustoSynced}>Mark Synced</button>
                        </>}
                      </div>
                    </>
                  )}
                </div>

                {Array.isArray(full.events) && full.events.length > 0 && (
                  <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <div className="font-extrabold mb-2 text-gray-900 dark:text-slate-100">Audit Trail</div>
                    <div className="text-sm">
                      {full.events.map((ev) => (
                        <div key={ev.id} className="py-1 border-b border-gray-100 dark:border-slate-700 text-gray-700 dark:text-slate-200">
                          <strong>{ev.eventType}</strong> — {fmtDT(ev.createdAt)}
                          {ev.ipAddress && <span className="text-gray-600 dark:text-slate-400"> · {ev.ipAddress}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
