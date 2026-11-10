// Where a booking is, as a person reads it: the street line (with the town and state since 11/10) and the ZIP the customer typed,
// which the booking keeps on its own (customer_zip) — field service re-check 11/10: "Where 12 Pine St, Chippewa Falls, WI" left the
// ZIP off the confirmation. One rule for the confirmation page, the emails and the calendar event.
export function whereOf(b: { customerAddress?: string | null; customerZip?: string | null }): string | null {
  const street = String(b.customerAddress || '').trim()
  if (!street) return null
  const zip = String(b.customerZip || '').trim()
  return zip && !street.includes(zip) ? `${street} ${zip}` : street
}
