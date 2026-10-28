/** Stored codes in plain words, for the invoice screens (a stored code is never shown as stored). Pure, so a test runs it. */
const WORDS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', viewed: 'Viewed', partial: 'Partly paid', paid: 'Paid', overdue: 'Overdue', void: 'Void', refunded: 'Refunded',
}
const METHOD_WORDS: Record<string, string> = { cash: 'Cash', check: 'Check', card: 'Card', bank_transfer: 'Bank transfer', other: 'Other', stripe: 'Card online', account_balance: 'Account balance' }
const sentence = (s: string) => { const t = s.replace(/_/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : '' }
export const invoiceStatusLabel = (s: unknown) => WORDS[String(s)] ?? sentence(String(s ?? ''))
export const paymentMethodLabel = (m: unknown) => METHOD_WORDS[String(m)] ?? (sentence(String(m ?? '')) || 'Payment')
