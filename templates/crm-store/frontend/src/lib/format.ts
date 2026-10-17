export function money(cents: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format((cents || 0) / 100)
}

export function dollarsToCents(dollars: string | number): number {
  const n = typeof dollars === 'string' ? parseFloat(dollars) : dollars
  return Math.round((isNaN(n) ? 0 : n) * 100)
}

export function centsToDollars(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toFixed(2)
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-blue-100 text-blue-700',
  fulfilled: 'bg-indigo-100 text-indigo-700',
  shipped: 'bg-purple-100 text-purple-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  // amber, not orange: orange-* is the shop's brand colour (tailwind.config.js), and a status must not change
  // hue with the brand. 800 on 100 (6.37:1) rather than 700, which only just clears at 4.51:1.
  refunded: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
}
export function statusColor(status: string) {
  return STATUS_COLORS[status] || 'bg-gray-100 text-gray-700'
}
