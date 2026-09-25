/** lib/square/texts.ts — the two order texts. Transactional only; dry, like the rest of the copy. */
export function firedText(company: string, pickupAt: Date | null, tz: string): string {
  const at = pickupAt ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(pickupAt) : null
  return `${company}: your order's on the grill.` + (at ? ` Ready around ${at}.` : '')
}
export function readyText(company: string): string {
  return `${company}: your order is up. Pick it up at the bar.`
}
