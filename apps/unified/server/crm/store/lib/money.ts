// Moved from templates/crm-store/backend/src/lib/money.ts (docs/UNIFIED_STORE_PLAN.md).
// All money is stored and computed in integer minor units (cents). Never use
// floats for money. These helpers keep formatting in one place.

export function formatCents(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

export function sumLineTotals(items: { unitPriceCents: number; quantity: number }[]): number {
  return items.reduce((acc, it) => acc + it.unitPriceCents * it.quantity, 0)
}

/**
 * A price as the product feeds write it (Google Merchant Center, Meta catalog): the amount with two decimals and the
 * ISO currency after it — "1234.50 USD". Read from the integer cents, never through a float sum.
 */
export function feedPrice(cents: number, currency = 'usd'): string {
  const n = Math.max(0, Math.round(cents))
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')} ${currency.toUpperCase()}`
}
