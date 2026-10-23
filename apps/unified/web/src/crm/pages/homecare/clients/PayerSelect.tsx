// Who pays for a client's care: one of the agency's payers (a referral_sources row — server/crm/homecare/billing/payers.ts),
// or Private pay. Add Client's payer list was empty for an agency that had added no payer yet, with nothing saying why or
// what to do (live test 2026-10-22). Now Private pay is always in the list, and an agency with no payers is told where to
// add one — a link for a seat that may open Financial › Payers & Codes, the words for one that may not. Add Client and
// Edit Client both use it.
import { Link } from 'react-router-dom'
import { usePermissions } from '../../../../shared'
import type { ReferralSource } from './shared'

/** The list's value for Private pay: it sets the client's isPrivatePay, never a payer id. */
export const PRIVATE_PAY = '__private_pay__'

export default function PayerSelect({ id, payers, value, onChange, onPrivatePay }: {
  id?: string
  payers: ReferralSource[]
  value: string
  onChange: (referralSourceId: string) => void
  /** Private pay chosen from the list: the form ticks its Private Pay box. */
  onPrivatePay: () => void
}) {
  const { can } = usePermissions()
  const mayOpenPayers = can('care-billing:read')
  return (
    <>
      <select id={id} value={value} onChange={(e) => (e.target.value === PRIVATE_PAY ? onPrivatePay() : onChange(e.target.value))}>
        <option value="">{payers.length ? 'Select payer...' : 'No payers added yet'}</option>
        <option value={PRIVATE_PAY}>Private pay (the client pays)</option>
        {payers.map((rs) => (<option key={rs.id} value={rs.id}>{rs.name}</option>))}
      </select>
      {payers.length === 0 && (
        <small className="text-muted" data-testid="no-payers-hint" style={{ display: 'block', marginTop: '0.25rem' }}>
          No payers yet — choose Private pay, or add a payer (Medicaid, an MCO, the VA…) under{' '}
          {mayOpenPayers ? <Link to="/crm/payers-service-codes">Financial › Payers &amp; Codes</Link> : 'Financial › Payers & Codes (ask an admin)'}.
        </small>
      )}
    </>
  )
}
