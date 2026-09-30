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

/**
 * Who took this date of birth down — named, not assumed. (T52 N5)
 *
 * The ID-check banner on an order said "The kiosk recorded …" on every order carrying a date of
 * birth, and several doors write that column: the kiosk (routes/kiosk.ts), the public order-ahead
 * page (routes/menu.ts), and the till (routes/orders.ts), which is also where an offline sale lands
 * when the device reconnects. A budtender reading "the kiosk" on an order the customer placed on
 * their phone is being told something untrue about where the number came from — and the whole point
 * of that sentence is to say how much to trust it before they look at the card. An unattended
 * tablet, a form somebody filled in at home, and a colleague typing at the till are three different
 * amounts of trust.
 *
 * Where the order does not say — rows older than the `source` column, and imports — it claims
 * nothing it cannot show.
 */
export function dobSourceLabel(
  o: { source?: string | null; kioskSessionId?: string | null; type?: string | null } | null | undefined,
): string {
  const source = String(o?.source || '').toLowerCase()
  if (o?.kioskSessionId || source === 'kiosk') return 'The kiosk recorded'
  if (source === 'online' || source === 'online_order' || String(o?.type || '') === 'online') {
    return 'The customer gave'
  }
  if (source === 'pos' || source === 'walk_in') return 'The till recorded'
  if (source === 'external_pos' || String(o?.type || '') === 'external_pos') return 'The imported sale carries'
  return 'This order carries'
}
