// The address an order ships to, as staff type it (live test 11/11: an order made for a customer — a phone order, one paid
// in person — had no way to take an address, so no label could be bought for it; only the online checkout set one).
// Shopify's draft order takes a shipping address (the customer's own, changeable), and an order not yet fulfilled can have
// its address edited. The same shape the checkout keeps (StoreAddress), with the name it goes to and a phone for the carrier.
import { z } from 'zod'

export const shipToSchema = z.object({
  name: z.string().trim().max(100).optional().nullable(),
  line1: z.string().trim().min(1, 'Enter the street address').max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1, 'Enter the city').max(100),
  state: z.string().trim().min(2, 'Enter the state').max(16),
  postalCode: z.string().trim().min(3, 'Enter the ZIP code').max(12),
  country: z.string().trim().length(2, 'Country is two letters, like US').default('US'),
  phone: z.string().trim().max(30).optional().nullable(),
})
export type ShipTo = z.infer<typeof shipToSchema>

/** As it is kept on the order: no empty extras, the state and country in capitals. */
export function keptShipTo(a: ShipTo) {
  return {
    ...(a.name ? { name: a.name } : {}), line1: a.line1, ...(a.line2 ? { line2: a.line2 } : {}), city: a.city,
    state: a.state.toUpperCase(), postalCode: a.postalCode, country: a.country.toUpperCase(), ...(a.phone ? { phone: a.phone } : {}),
  }
}

/** A customer's saved address as a ship-to, when it is whole (street, city, state, ZIP); otherwise null. */
export function contactShipTo(c: { name?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null; phone?: string | null }) {
  const r = shipToSchema.safeParse({ name: c.name || null, line1: c.address || '', city: c.city || '', state: c.state || '', postalCode: c.zip || '', country: 'US', phone: c.phone || null })
  return r.success ? keptShipTo(r.data) : null
}

/** An order's address may be changed until it is on its way: not shipped, delivered, cancelled or refunded, and no label bought. */
export const SHIP_TO_EDITABLE = ['pending', 'paid', 'fulfilled']
