// The ship-to boxes an order made for a customer, and an order's "Edit" address, share (server orders/shipTo.ts holds
// the same rules: street, city, state, ZIP; the country two letters).
export interface ShipToForm { name: string; line1: string; line2: string; city: string; state: string; postalCode: string; country: string; phone: string }
export const EMPTY_SHIP_TO: ShipToForm = { name: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: 'US', phone: '' }

/** What is missing, said as the server says it; null when the address is whole. */
export function shipToProblem(a: ShipToForm): string | null {
  if (!a.line1.trim()) return 'Enter the street address.'
  if (!a.city.trim()) return 'Enter the city.'
  if (a.state.trim().length < 2) return 'Enter the state.'
  if (a.postalCode.trim().length < 3) return 'Enter the ZIP code.'
  if (a.country.trim().length !== 2) return 'Country is two letters, like US.'
  return null
}

/** An order's kept address back into the boxes. */
export function shipToForm(a: Partial<Record<keyof ShipToForm, string | null | undefined>> | null | undefined): ShipToForm {
  const v = (k: keyof ShipToForm) => String(a?.[k] ?? '')
  return { name: v('name'), line1: v('line1'), line2: v('line2'), city: v('city'), state: v('state'), postalCode: v('postalCode'), country: v('country') || 'US', phone: v('phone') }
}

export function ShipToFields({ idPrefix, value, onChange }: { idPrefix: string; value: ShipToForm; onChange: (v: ShipToForm) => void }) {
  const set = (k: keyof ShipToForm) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value })
  const box = (k: keyof ShipToForm, label: string, extra: Record<string, unknown> = {}) => (
    <div>
      <label className="label" htmlFor={`${idPrefix}-${k}`}>{label}</label>
      <input id={`${idPrefix}-${k}`} className="input" value={value[k]} onChange={set(k)} {...extra} />
    </div>
  )
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {box('name', 'Name on the parcel', { autoComplete: 'name' })}
      {box('phone', 'Phone (for the carrier)', { type: 'tel', autoComplete: 'tel' })}
      <div className="sm:col-span-2">{box('line1', 'Street address', { autoComplete: 'address-line1' })}</div>
      <div className="sm:col-span-2">{box('line2', 'Apartment, suite (optional)', { autoComplete: 'address-line2' })}</div>
      {box('city', 'City', { autoComplete: 'address-level2' })}
      {box('state', 'State', { maxLength: 16, placeholder: 'WI', autoComplete: 'address-level1' })}
      {box('postalCode', 'ZIP code', { maxLength: 12, inputMode: 'numeric', autoComplete: 'postal-code' })}
      {box('country', 'Country', { maxLength: 2, autoComplete: 'country' })}
    </div>
  )
}
