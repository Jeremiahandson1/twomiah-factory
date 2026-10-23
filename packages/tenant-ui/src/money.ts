// Money as the screens show it, in one place. The sign goes BEFORE the dollar sign: a selection credit of 200 reads
// "-$200.00", never "$-200.00" (live test 2026-10-22, contractor). Every screen that glued a "$" to a number it had
// formatted itself — `$${n.toFixed(2)}`, `'$' + n` — printed the second for any negative amount; they all call this now.
//
//   money(-200)            "-$200.00"
//   money(1234.5)          "$1,234.50"
//   money(1234.5, 0)       "$1,235"        whole dollars
//   money(null)            "$0.00"         anything that is not a number reads as nothing owed
//   moneyCents(-1999)      "-$19.99"       an amount kept in cents
//   signedMoney(5)         "+$5.00"        a difference, where the plus is part of the meaning
export function money(n: unknown, digits = 2): string {
  const v = Number(n)
  if (n === null || n === undefined || n === '' || !Number.isFinite(v)) return digits ? `$${(0).toFixed(digits)}` : '$0'
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  // A value that rounds to zero is not shown as "-$0.00".
  const negative = v < 0 && Number(s.replace(/,/g, '')) !== 0
  return (negative ? '-$' : '$') + s
}

export const moneyCents = (cents: unknown, digits = 2): string => money(cents === null || cents === undefined || cents === '' ? cents : Number(cents) / 100, digits)

/** A difference: "+$5.00", "-$5.00", "$0.00". */
export function signedMoney(n: unknown, digits = 2): string {
  const s = money(n, digits)
  return Number(n) > 0 && s !== money(0, digits) ? `+${s}` : s
}

/** A short figure for a chart axis or a tile: "$12.3k", "-$150k"; under a thousand, money(). */
export function moneyCompact(n: number): string {
  if (Math.abs(n) < 1000) return money(n)
  return `${n < 0 ? '-' : ''}$${(Math.abs(n) / 1000).toFixed(Math.abs(n) >= 100_000 ? 0 : 1)}k`
}
