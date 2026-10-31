// Permits as the screens read them (server/crm/roof/insurance/permits.ts is the master): the record, the words for each status,
// and a fee typed in dollars sent as whole cents — read from the digits, never multiplied, so $0.29 is 29 cents and not 28.99999.
export const PERMIT_STATUSES = ['needed', 'applied', 'issued', 'finaled', 'rejected'] as const
export type PermitStatus = (typeof PERMIT_STATUSES)[number]
export const PERMIT_STATUS_WORDS: Record<PermitStatus, string> = { needed: 'Needed', applied: 'Applied for', issued: 'Issued', finaled: 'Finaled', rejected: 'Rejected' }
/** What each status says about where the permit is, for the board's column heads. */
export const PERMIT_STATUS_HINTS: Record<PermitStatus, string> = {
  needed: 'Not applied for yet', applied: 'Waiting on the city or county', issued: 'In hand — the work can start', finaled: 'Inspected and closed out', rejected: 'Turned down — fix and apply again',
}
/** The next step along, and the button's words for it; none once finaled or rejected. */
export const NEXT_STEP: Record<PermitStatus, { status: PermitStatus; label: string } | null> = {
  needed: { status: 'applied', label: 'Mark applied for' },
  applied: { status: 'issued', label: 'Mark issued' },
  issued: { status: 'finaled', label: 'Mark finaled' },
  finaled: null,
  rejected: { status: 'applied', label: 'Apply again' },
}
/** Common permit types, offered as suggestions; the box takes any words. */
export const PERMIT_TYPE_SUGGESTIONS = ['Building', 'Re-roof', 'Electrical', 'Dumpster / right of way', 'Solar']

export interface JobPermitRow {
  id: string; jobId: string; status: PermitStatus; statusLabel?: string
  permitType?: string | null; jurisdiction?: string | null; permitNumber?: string | null
  /** Absent (with moneyWithheld) for a seat that does not read what the shop pays. */
  feeCents?: number | null; moneyWithheld?: boolean
  feePaidOn?: string | null; appliedOn?: string | null; issuedOn?: string | null; expiresOn?: string | null; finaledOn?: string | null
  expired?: boolean; notes?: string | null
  jobNumber?: string; address?: string | null; city?: string | null; jobStatus?: string; homeowner?: string | null
}

/** '125', '125.5', '$1,250.00' → whole cents; '' → null (no fee); anything else → undefined (not an amount). */
export function centsFromText(text: string): number | null | undefined {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '')
  if (t === '') return null
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return undefined
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0')
}
/** Whole cents as the text a fee box shows: 12550 → '125.50'. */
export const textFromCents = (cents: number | null | undefined): string => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2))
