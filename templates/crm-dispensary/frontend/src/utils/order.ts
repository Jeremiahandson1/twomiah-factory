/**
 * How an order is named on screen — one answer, everywhere.
 *
 * An order carries two identifiers: `number`, the human-facing code, and `orderNumber`, a per-company
 * sequence integer. The dashboard showed "#ORD-1145" and the Orders list "#1145" for the same sale,
 * because each surface had picked a different column. (Dispensary T28 L-b)
 *
 * `number` is the one to show. Every path that creates an order writes it — the register as ORD-1145, the
 * kiosk the same way, the online menu as ORD-<base36>, offline sync as ORD-OFF-<base36> — while
 * `orderNumber` only exists where a sequence was allocated, so menu and offline orders have none at all.
 * Showing the integer is therefore both inconsistent and, for those orders, impossible.
 *
 * One fallback only: synthesise the same ORD- shape from the sequence, for rows older than the column.
 *
 * It never falls back to the row id. T24 settled that — the dashboard once printed
 * "#lmb7ijjmytwf3b1y1fw58564" where an order number belongs, and a truncated id that LOOKS like an order
 * number is worse than an em dash that admits there isn't one. check-revenue-one-definition.ts pins it,
 * and caught this helper trying to reintroduce it.
 */
export function orderLabel(o: { number?: string | null; orderNumber?: number | string | null; id?: string | null } | null | undefined): string {
  if (!o) return '—'
  if (o.number) return String(o.number)
  if (o.orderNumber !== null && o.orderNumber !== undefined && String(o.orderNumber) !== '') return `ORD-${o.orderNumber}`
  return '—'
}

/** The same label with the leading # the screens print. */
export const orderRef = (o: Parameters<typeof orderLabel>[0]): string => {
  const label = orderLabel(o)
  return label === '—' ? label : `#${label}`
}
