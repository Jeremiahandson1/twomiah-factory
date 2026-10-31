// What sits beside an invoice (packages/tenant-ui InvoiceDetailPage `aside`): consumer financing (./financing.tsx), the
// automatic reminders this invoice has had (server crm/billing/invoiceReminders.ts), and — on a salon sale — the client's
// loyalty standing and tier perk for the desk at checkout (pages/salon/loyaltyTiers.tsx).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BellRing } from 'lucide-react'
import { api } from '../api'
import { usePermissions } from '../shared'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { FinancingPanel } from './financing'
import { ClientLoyaltyCard } from './pages/salon/loyaltyTiers'
import { GiftCardPayPanel } from './pages/salon/GiftCards'
import { ChairCheckoutPanel, RetailSellPanel, SaleReceiptButton, TipSplitPanel } from './pages/salon/ChairCheckout'
import { verticalScreens } from './vertical'

interface Entry { kind: string; step: string; status: string; sentTo: string | null; detail: string | null; at: string }

/** "Due soon", "7 days overdue", "Late fee" — the step in words. */
function stepWords(e: Entry): string {
  if (e.kind === 'invoice_late_fee') return 'Late fee added'
  const name = e.step.split(':')[0]
  if (name === 'due_soon') return '“Due soon” reminder'
  const m = /^overdue_(\d+)$/.exec(name)
  return m ? `Overdue reminder (${m[1]} day${m[1] === '1' ? '' : 's'})` : 'Reminder'
}
const STATUS: Record<string, string> = { sent: 'sent', failed: 'not sent', skipped: 'not sent', sending: 'sending' }

/** The automatic reminders this invoice has had, and where to switch them on when they are off. */
export function InvoiceRemindersPanel({ invoiceId, status }: { invoiceId: string; status?: string }) {
  const { can, known } = usePermissions()
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    api.get(`/api/invoice-reminders/history/${invoiceId}`).then((r: { data: Entry[] }) => { if (live) setEntries(r?.data || []) }).catch(() => { if (live) setEntries(null) })
    api.get('/api/invoice-reminders/settings').then((r: { enabled: boolean }) => { if (live) setOn(!!r?.enabled) }).catch(() => { if (live) setOn(null) })
    return () => { live = false }
  }, [invoiceId])
  if (entries === null || on === null) return null
  if (!entries.length && (status === 'draft' || status === 'paid' || status === 'void')) return null
  return (
    <section aria-label="Automatic reminders" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid="invoice-reminders-panel">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100"><BellRing className="h-4 w-4 text-orange-600 dark:text-orange-300" aria-hidden="true" />Automatic reminders</h2>
      {entries.length ? (
        <ul className="mt-2 space-y-1.5 text-sm text-gray-700 dark:text-slate-200">
          {entries.map((e, i) => (
            <li key={i}>
              <span className="font-medium">{stepWords(e)}</span>{e.kind === 'invoice_late_fee' ? '' : ` — ${STATUS[e.status] || e.status}${e.sentTo && e.status === 'sent' ? ` to ${e.sentTo}` : ''}`}, {whenDateTime(e.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              {e.status !== 'sent' && e.detail && <span className="block text-xs text-gray-600 dark:text-slate-300">{e.detail}</span>}
              {e.kind === 'invoice_late_fee' && e.detail && <span className="block text-xs text-gray-600 dark:text-slate-300">{e.detail}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">{on ? 'None sent yet. A reminder goes before the due date and after it, as set in Settings.' : 'Automatic reminders are off.'}</p>
      )}
      {(!known || can('company:update')) && <Link to="/crm/settings/invoice-reminders" className="mt-2 inline-block text-sm font-medium text-orange-700 hover:underline dark:text-orange-200">Invoice reminder settings</Link>}
    </section>
  )
}

const isSalon = () => { const h = verticalScreens().home; return typeof h === 'string' && h === 'salon' }

/** The quote's and the invoice's aside, as InvoiceDetailPage and QuoteDetailPage render it. */
export function DocumentAside({ kind, record, reload }: { kind: 'quote' | 'invoice'; record: Record<string, any>; reload?: () => void }) {
  return (
    <>
      <FinancingPanel kind={kind} record={record} />
      {kind === 'invoice' && record?.id && <InvoiceRemindersPanel invoiceId={String(record.id)} status={String(record.status || '')} />}
      {kind === 'invoice' && isSalon() && record?.id && <RetailSellPanel invoiceId={String(record.id)} status={String(record.status || '')} lines={record.lineItems} reload={reload} />}
      {kind === 'invoice' && isSalon() && record?.id && <ChairCheckoutPanel invoiceId={String(record.id)} status={String(record.status || '')} balance={record.balance} reload={reload} />}
      {kind === 'invoice' && isSalon() && record?.id && <TipSplitPanel invoiceId={String(record.id)} reload={reload} />}
      {kind === 'invoice' && isSalon() && record?.id && <SaleReceiptButton invoiceId={String(record.id)} status={String(record.status || '')} />}
      {kind === 'invoice' && isSalon() && record?.id && <GiftCardPayPanel invoiceId={String(record.id)} status={String(record.status || '')} balance={record.balance} reload={reload} />}
      {kind === 'invoice' && isSalon() && record?.contactId && <ClientLoyaltyCard contactId={String(record.contactId)} compact />}
    </>
  )
}
