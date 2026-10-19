// Moved from templates/crm-homecare/frontend/src/components/admin/ShiftApprovals.tsx (ported there from the CVHC home
// care CRM).
//
// Admin queue for time entries that need approval. A shift is flagged
// when it was unscheduled or when actual clock-in/out differs from the
// scheduled window by more than the grace threshold (7 min).
//
// Admin actions: approve as-is, edit billable minutes, or reject (sets
// billable to 0 so the shift doesn't pay out).
//
// Its calls, as the unified server answers them (server/crm/homecare/visits/timeTracking.ts, both evv:delete — the
// office's EVV verb; data/homecareVisits.ts pendingApprovalEntries):
//   GET   /api/time-entries/pending-approval → list reply; rows camelCase (caregiverFirstName, billableHours,
//                                             allottedHours, isPrivatePay, approvalReason …; were snake_case).
//   PATCH /api/time-entries/:id/approve      { billable_minutes?, notes?, reject? } — the route still reads
//                                             billable_minutes in snake_case, so the body is unchanged.
import { useState, useEffect, useCallback, type CSSProperties } from 'react'
import { api, rows, errorMessage } from '../lib/http'
import { formatAgencyDateTime } from '../lib/agencyClock'
import { usePrompt, useToast } from '../../../../shared'
import { CHIP, SOLID, type Tone } from './ui'

/** One flagged, finished punch. Numeric columns arrive as strings. */
interface PendingEntry {
  id: string
  startTime: string | null
  endTime: string | null
  durationMinutes: number | null
  allottedMinutes: number | null
  billableMinutes: number | null
  approvalReason: string | null
  notes: string | null
  hours: string | number | null
  billableHours: string | number | null
  allottedHours: string | number | null
  caregiverFirstName: string | null
  caregiverLastName: string | null
  defaultPayRate: string | number | null
  clientFirstName: string | null
  clientLastName: string | null
  isPrivatePay: boolean | null
  referralPayerType: string | null
  referralSourceName: string | null
}

type ApproveBody = { notes?: string | null; reject?: boolean; billable_minutes?: number }

const fmtHrs = (h: string | number | null | undefined) => (h == null || h === '' ? '—' : `${parseFloat(String(h)).toFixed(2)}h`)
const fmt$ = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)
const fmtDateTime = (t: string | null) => {
  if (!t) return '—'
  return formatAgencyDateTime(t, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const REASON_LABEL: Record<string, string> = {
  unscheduled: 'No schedule linked',
  time_variance: 'Clock time outside 7-min grace',
  zero_duration: 'Clocked out under a minute after clock-in',
  excessive_duration: 'Over 16 hours — likely a missed clock-out (capped)',
  offline_punch: 'Saved on the phone with no signal',
  admin_force_clockout: 'Closed by the office (force clock-out)',
}
// Reasons can be comma-joined ("time_variance,offline_punch").
const reasonLabel = (r: string | null) => (r ? String(r).split(',').map((x) => REASON_LABEL[x.trim()] || x.trim()).join(' · ') : '—')

export default function ShiftApprovals() {
  const toast = useToast()
  const prompt = usePrompt()
  const [list, setList] = useState<PendingEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBillable, setEditBillable] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [busy, setBusy] = useState(false)
  // An optional note typed beside Approve, per row; it is saved with the approval (approval_notes).
  const [approveNotes, setApproveNotes] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setList(rows<PendingEntry>(await api.get('/api/time-entries/pending-approval')))
    } catch (e) {
      setError(errorMessage(e, 'Request failed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const startEdit = (row: PendingEntry) => {
    setEditingId(row.id)
    setEditBillable(String(row.billableMinutes ?? row.allottedMinutes ?? row.durationMinutes ?? 0))
    setEditNotes('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditBillable('')
    setEditNotes('')
  }

  const submit = async (id: string, body: ApproveBody) => {
    setBusy(true)
    try {
      await api.patch(`/api/time-entries/${encodeURIComponent(id)}/approve`, body)
      cancelEdit()
      setApproveNotes((n) => { const x = { ...n }; delete x[id]; return x })
      await load()
    } catch (e) {
      toast.error(errorMessage(e, 'Approval failed'))
    } finally {
      setBusy(false)
    }
  }

  const approveAsIs = (row: PendingEntry) => {
    const note = (approveNotes[row.id] || '').trim()
    submit(row.id, { notes: note || 'Approved as clocked' })
  }
  const reject = async (row: PendingEntry) => {
    const reason = await prompt('Why are you rejecting this shift? (This becomes part of the audit trail.)', { title: 'Reject shift', confirmText: 'Reject' })
    if (reason === null) return // cancelled
    const note = reason.trim() || 'Rejected by admin'
    submit(row.id, { reject: true, notes: note })
  }
  const saveEdit = (row: PendingEntry) => {
    const mins = parseInt(editBillable, 10)
    if (!/^\d+$/.test(String(editBillable).trim()) || Number.isNaN(mins) || mins < 0) { toast.error('Billable minutes must be a non-negative integer'); return }
    submit(row.id, { billable_minutes: mins, notes: editNotes || null })
  }

  const cardStyle: CSSProperties = { background: 'var(--hc-surface)', color: 'var(--hc-ink)', borderRadius: 12, padding: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '0.75rem' }
  const thStyle: CSSProperties = { padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700, color: 'var(--hc-ink-soft)', borderBottom: '1px solid var(--hc-line)', fontSize: '0.78rem' }
  const tdStyle: CSSProperties = { padding: '0.5rem 0.75rem', fontSize: '0.82rem', verticalAlign: 'top' }
  const btn = (bg: string = SOLID.brand): CSSProperties => ({ padding: '0.4rem 0.75rem', background: bg, color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' })
  const badgeStyle: CSSProperties = { padding: '0.2rem 0.5rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 700, display: 'inline-block' }
  const badge = (tone: Tone) => CHIP[tone]
  const smallField: CSSProperties = { padding: '0.25rem', border: '1px solid var(--hc-line)', borderRadius: 4, background: 'var(--hc-surface)', color: 'var(--hc-ink)' }

  if (loading) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--hc-ink-soft)' }}>Loading pending approvals…</div>
  if (error) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--hc-red-ink)' }}>Error: {error}</div>

  return (
    <div style={{ padding: '1rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, marginBottom: '0.25rem' }}>⚠️ Shift Approvals</h1>
        <p style={{ color: 'var(--hc-ink-soft)', fontSize: '0.88rem', margin: 0 }}>
          Review time entries flagged for approval — unscheduled visits or clock variance &gt; 7 min from schedule.
          Caregivers are paid <strong>scheduled hours</strong> for non-private-pay clients; use this page to override in edge cases.
        </p>
      </div>

      {list.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--hc-ink-soft)', padding: '3rem' }}>
          ✅ No shifts awaiting approval.
        </div>
      ) : (
        <div style={{ ...cardStyle, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--hc-subtle)' }}>
                <th style={thStyle}>Caregiver</th>
                <th style={thStyle}>Client / Payer</th>
                <th style={thStyle}>Start</th>
                <th style={thStyle}>End</th>
                <th style={thStyle}>Actual</th>
                <th style={thStyle}>Scheduled</th>
                <th style={thStyle} title="Which figure the system will actually pay">Pay Using</th>
                <th style={thStyle}>Billable</th>
                <th style={thStyle}>Est. Pay</th>
                <th style={thStyle}>Reason</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const payerLabel = r.isPrivatePay ? 'Private Pay' : (r.referralSourceName || r.referralPayerType || '—')
                const estPay = r.billableHours && r.defaultPayRate ? parseFloat(String(r.billableHours)) * parseFloat(String(r.defaultPayRate)) : null
                const isEditing = editingId === r.id
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--hc-subtle)' }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.caregiverFirstName} {r.caregiverLastName}</td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{r.clientFirstName} {r.clientLastName}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--hc-ink-soft)' }}>{payerLabel}</div>
                    </td>
                    <td style={tdStyle}>{fmtDateTime(r.startTime)}</td>
                    <td style={tdStyle}>{fmtDateTime(r.endTime)}</td>
                    <td style={tdStyle}>{fmtHrs(r.hours)}</td>
                    <td style={tdStyle}>{fmtHrs(r.allottedHours)}</td>
                    <td style={tdStyle}>
                      {r.isPrivatePay ? (
                        <span className={badge('indigo')} style={badgeStyle} title="Private pay: bill the actual clocked time">Actual</span>
                      ) : r.allottedHours == null ? (
                        <span className={badge('amber')} style={badgeStyle} title="No schedule linked — needs admin override before pay">Manual</span>
                      ) : (
                        <span className={badge('green')} style={badgeStyle} title="Insurance/MCO: pay the scheduled amount regardless of clock variance">Scheduled</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          value={editBillable}
                          onChange={(e) => setEditBillable(e.target.value)}
                          style={{ ...smallField, width: 70, fontSize: '0.82rem' }}
                        />
                      ) : fmtHrs(r.billableHours)}
                      {isEditing && <div style={{ fontSize: '0.7rem', color: 'var(--hc-ink-soft)' }}>minutes</div>}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--hc-info-ink)', fontWeight: 600 }}>{fmt$(estPay)}</td>
                    <td style={tdStyle}>
                      <span className={badge('amber')} style={badgeStyle}>{reasonLabel(r.approvalReason)}</span>
                      {r.notes && <div style={{ fontSize: '0.7rem', color: 'var(--hc-ink-soft)', marginTop: 4, maxWidth: 200 }}>{r.notes}</div>}
                    </td>
                    <td style={tdStyle}>
                      {isEditing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <input
                            type="text"
                            placeholder="Notes (optional)"
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            style={{ ...smallField, width: 180, fontSize: '0.78rem' }}
                          />
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button disabled={busy} style={btn(SOLID.brand)} onClick={() => saveEdit(r)}>Save</button>
                            <button disabled={busy} style={btn('#6B7280')} onClick={cancelEdit}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <input
                            type="text"
                            placeholder="Note (optional)"
                            aria-label={`Approval note for ${r.caregiverFirstName || ''} ${r.caregiverLastName || ''}`}
                            value={approveNotes[r.id] || ''}
                            maxLength={500}
                            onChange={(e) => setApproveNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) approveAsIs(r) }}
                            style={{ ...smallField, width: 180, fontSize: '0.78rem' }}
                          />
                          <button disabled={busy} style={btn(SOLID.brand)} onClick={() => approveAsIs(r)}>Approve</button>
                          <button disabled={busy} style={btn(SOLID.indigo)} onClick={() => startEdit(r)}>Edit</button>
                          <button disabled={busy} style={btn('#C62828')} onClick={() => reject(r)}>Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

    </div>
  )
}
