// An expandable background-check SUMMARY for a caregiver serving the client: what was checked, by whom, its status and
// dates — never findings, notes or reference numbers (the server does not send them). Shared by the client portal and
// the family portal. Moved from templates/crm-homecare/frontend/src/components/portal/CaregiverBackgroundChecks.tsx.
//
// Server: GET {apiBase}/portal/caregivers/:caregiverId/background-checks — the client portal's at /api/portal/…
// (clientPortal.ts), the family portal's at /api/family-portal/portal/… (familyPortal.ts). A list ({ data, pagination })
// of { id, checkType, provider, status, initiatedDate, expirationDate }; refused 403 for a caregiver not serving them.
// The template also read result and completedDate, which neither server sends; they stay read, so a check the server
// one day answers with them shows them.
import { useState } from 'react'
import { formatDate } from '../lib/date'
import { listRows, usePortal, SESSION_EXPIRED } from './portalHttp'

interface Check {
  id: string
  checkType?: string | null
  provider?: string | null
  status?: string | null
  result?: string | null
  initiatedDate?: string | null
  completedDate?: string | null
  expirationDate?: string | null
}

// Wisconsin's checks are named for Wisconsin only where the agency is in Wisconsin.
const typeLabels = (state?: string | null): Record<string, string> => {
  const wi = String(state || '').toUpperCase() === 'WI'
  return {
    worcs: wi ? 'Wisconsin Caregiver Background Check (WI DOJ)' : 'State Caregiver Background Check',
    criminal: 'Criminal History',
    sex_offender: 'Sex Offender Registry',
    caregiver_registry: wi ? 'WI Caregiver Misconduct Registry' : 'Caregiver Misconduct Registry',
    driving: 'Driving Record',
    drug_screen: 'Drug Screening',
  }
}

const typeLabel = (t: string | null | undefined, state?: string | null) =>
  (t && typeLabels(state)[t]) || (t || 'Background Check').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// Ink and ground in pairs (homecare.css tokens): the template's #d4edda/#155724 and kin, with dark partners.
const OK = { bg: 'var(--hc-success-bg)', fg: 'var(--hc-success-ink)' }
const WAIT = { bg: 'var(--hc-warning-bg)', fg: 'var(--hc-warning-ink)' }
const INFO = { bg: 'var(--hc-info-bg)', fg: 'var(--hc-info-ink)' }

const statusBadge = (check: Check) => {
  const result = String(check.result || '').toLowerCase()
  const status = String(check.status || '').toLowerCase()
  if (result === 'clear' || result === 'passed') return { label: '✓ Clear', ...OK }
  if ((status === 'completed' || status === 'cleared' || status === 'passed') && !result) return { label: '✓ Completed', ...OK }
  if (status === 'pending' || status === 'in_progress') return { label: 'In Progress', ...WAIT }
  return { label: check.result || check.status || 'On File', ...INFO }
}

// Calendar dates arrive as YYYY-MM-DD; read as that day (lib/date), not as UTC midnight.
const fmtDate = (d: string | null | undefined): string | null => {
  if (!d) return null
  return formatDate(String(d).slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) || null
}

export default function CaregiverBackgroundChecks({ caregiverId, apiBase, agencyState }: { caregiverId: string; apiBase: string; agencyState?: string | null }) {
  const portal = usePortal()
  const [open, setOpen] = useState(false)
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const wi = String(agencyState || '').toUpperCase() === 'WI'

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && checks === null && !loading) {
      setLoading(true)
      portal.get(`${apiBase}/portal/caregivers/${caregiverId}/background-checks`)
        .then((reply) => setChecks(listRows<Check>(reply)))
        .catch((err: Error) => setError(err.message === SESSION_EXPIRED ? 'Session expired — please sign in again.' : 'Could not load background check information.'))
        .finally(() => setLoading(false))
    }
  }

  return (
    <div style={{ marginTop: '10px' }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          background: 'none', border: '1px solid var(--hcp-navy)', color: 'var(--hcp-navy)',
          padding: '6px 12px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
        }}
      >
        🛡️ Background Check {open ? '▲' : '▼'}
      </button>

      {open && (
        <div style={{ marginTop: '10px', background: 'var(--hc-subtle)', borderRadius: '8px', padding: '12px 14px', border: '1px solid var(--hc-line)' }}>
          {loading && <div style={{ color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }}>Loading…</div>}
          {error && <div style={{ color: 'var(--hc-red-ink)', fontSize: '0.85rem' }}>{error}</div>}

          {checks && checks.length === 0 && (
            <div style={{ color: 'var(--hc-ink-soft)', fontSize: '0.85rem' }}>
              Background check records for this caregiver are on file with the office.
              Please contact your care coordinator for details.
            </div>
          )}

          {checks && checks.length > 0 && checks.map((check) => {
            const badge = statusBadge(check)
            const completed = check.completedDate
            const initiated = check.initiatedDate
            const expires = check.expirationDate
            return (
              <div key={check.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--hc-line)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--hc-ink)' }}>{typeLabel(check.checkType, agencyState)}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--hc-ink-soft)', marginTop: '2px' }}>
                    {check.provider && <span>{check.provider}</span>}
                    {fmtDate(completed) && <span> · Completed {fmtDate(completed)}</span>}
                    {!completed && fmtDate(initiated) && <span> · Started {fmtDate(initiated)}</span>}
                    {fmtDate(expires) && <span> · Valid through {fmtDate(expires)}</span>}
                  </div>
                </div>
                <span style={{ background: badge.bg, color: badge.fg, padding: '3px 10px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {badge.label}
                </span>
              </div>
            )
          })}

          {checks && checks.length > 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--hc-ink-soft)', marginTop: '8px' }}>
              {wi
                ? 'All caregivers are screened in accordance with the Wisconsin Caregiver Law before serving clients.'
                : 'All caregivers are screened before serving clients.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
