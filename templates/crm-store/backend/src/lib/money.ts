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
