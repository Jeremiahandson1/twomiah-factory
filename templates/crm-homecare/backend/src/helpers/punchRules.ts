// The billing rule a punch is held to, and the guards around it. Ported from the CVHC home care CRM
// (routes/timeTrackingRoutes.js). Pure functions, so the numbers can be asserted directly.
//
//   Private pay (client.is_private_pay, or the payer's payer_type 'private_pay'):
//       billable = the actual clocked duration.
//   Every other payer (Medicaid, MCO, VA, …):
//       billable = the SCHEDULED minutes of the visit the punch matched; clock variance is tracked
//       but never changes pay. More than 7 minutes off the schedule → needs approval.
//   No schedule matched (non-private): billable = actual, flagged 'unscheduled' for approval.
//   Under 60 seconds: an accidental double tap — billable 0, flagged 'zero_duration'.
//   Over 16 hours: almost certainly a missed clock-out — flagged 'excessive_duration' and billable
//       capped at the scheduled minutes (or 16 h when none).
//   A punch saved on the phone with no signal and sent later: flagged 'offline_punch'.

export const VARIANCE_GRACE_MINUTES = 7
export const MAX_SHIFT_MINUTES = 16 * 60

export interface BillingDecision { billableMinutes: number; needsApproval: boolean; approvalReason: string | null }

export function applyExcessiveDurationGuard(d: { durationMinutes: number; allottedMinutes: number | null } & BillingDecision): BillingDecision {
  if (d.durationMinutes <= MAX_SHIFT_MINUTES) return { billableMinutes: d.billableMinutes, needsApproval: d.needsApproval, approvalReason: d.approvalReason }
  const cap = d.allottedMinutes != null ? d.allottedMinutes : MAX_SHIFT_MINUTES
  return {
    billableMinutes: Math.min(d.billableMinutes, cap),
    needsApproval: true,
    approvalReason: d.approvalReason ? `${d.approvalReason},excessive_duration` : 'excessive_duration',
  }
}

/**
 * The clock-out decision. `durationSeconds` drives the zero-duration guard; minutes are the rounded
 * duration. The auto-close path (a caregiver clocking into the next client) uses the same rule
 * without the zero-duration branch — pass `zeroGuard: false`.
 */
export function decideBilling({ durationSeconds, allottedMinutes, isPrivatePay, zeroGuard = true }: {
  durationSeconds: number; allottedMinutes: number | null; isPrivatePay: boolean; zeroGuard?: boolean
}): BillingDecision & { durationMinutes: number; discrepancyMinutes: number | null } {
  const durationMinutes = Math.round(durationSeconds / 60)
  let d: BillingDecision
  if (zeroGuard && durationSeconds < 60) {
    d = { billableMinutes: 0, needsApproval: true, approvalReason: 'zero_duration' }
  } else if (isPrivatePay) {
    d = { billableMinutes: durationMinutes, needsApproval: false, approvalReason: null }
  } else if (allottedMinutes == null) {
    d = { billableMinutes: durationMinutes, needsApproval: true, approvalReason: 'unscheduled' }
  } else {
    const off = Math.abs(durationMinutes - allottedMinutes) > VARIANCE_GRACE_MINUTES
    d = { billableMinutes: allottedMinutes, needsApproval: off, approvalReason: off ? 'time_variance' : null }
  }
  d = applyExcessiveDurationGuard({ durationMinutes, allottedMinutes, ...d })
  return { ...d, durationMinutes, discrepancyMinutes: allottedMinutes != null ? durationMinutes - allottedMinutes : null }
}

// ── Offline punches ──────────────────────────────────────────────────────────────────────
// A tap that could not reach the server is saved on the phone with the TAP time and replayed later
// as `offlineAt`. The window is bounded: older than 12 h, or claiming the future, is refused.
export const OFFLINE_MAX_AGE_MS = 12 * 60 * 60 * 1000
export const OFFLINE_FUTURE_SLACK_MS = 2 * 60 * 1000

export function parseOfflineAt(offlineAt: unknown, now = Date.now()): { at: Date | null; error?: string; code?: string } {
  if (offlineAt == null || offlineAt === '') return { at: null }
  const at = new Date(String(offlineAt))
  if (isNaN(at.getTime())) return { at: null, error: 'Invalid offline punch time.' }
  if (at.getTime() > now + OFFLINE_FUTURE_SLACK_MS) return { at: null, error: 'Offline punch time is in the future — check the phone clock.' }
  if (at.getTime() < now - OFFLINE_MAX_AGE_MS) {
    return { at: null, error: 'This saved punch is more than 12 hours old — please tell the office your times.', code: 'offline_punch_too_old' }
  }
  return { at }
}

/** Keep the offline flag once set: clock-out recomputes needs_approval from scratch. */
export function withOfflineFlag(d: { needsApproval: boolean; approvalReason: string | null }, isOffline: boolean) {
  if (!isOffline) return { needsApproval: d.needsApproval, approvalReason: d.approvalReason }
  const reasons = String(d.approvalReason || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!reasons.includes('offline_punch')) reasons.push('offline_punch')
  return { needsApproval: true, approvalReason: reasons.join(',') }
}

export const hasOfflineFlag = (reason: unknown) => String(reason || '').split(',').map((s) => s.trim()).includes('offline_punch')
