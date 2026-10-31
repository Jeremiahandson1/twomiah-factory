// Automatic card payment (item 3, care_autopay): a family saves a card on Stripe's own page and each invoice is charged to it
// as it is sent, on the agency's own Stripe account. This screen: the cards on file, saving one, and the payments that did not go
// through. The card is never typed here; the button opens Stripe's page.
//   GET /api/care-autopay/clients|attention   POST /clients/:id/setup   DELETE /clients/:id   POST /invoices/:id/try-now
//   (server/crm/homecare/billing/autopayRoutes.ts)
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { moneyCents } from '@twomiah/tenant-ui/src/money'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { useMay } from '../lib/useMay'

interface Card { clientId: string; firstName: string; lastName: string; status: string; pausedReason: string | null; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null }
interface Failed { id: string; invoiceId: string; invoiceNumber: string; firstName: string; lastName: string; attemptNo: number; status: string; amountCents: number; failureCode: string | null; hardDecline: boolean; nextAttemptAt: string | null }
interface ClientOption { id: string; firstName: string; lastName: string }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const dollars = (c: number) => moneyCents(c)

export default function Autopay() {
  const may = useMay('care-billing')
  const toast = useToast()
  const [cards, setCards] = useState<Card[]>([])
  const [failed, setFailed] = useState<Failed[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setCards(rows<Card>(await listAll('/api/care-autopay/clients')))
      setFailed(rows<Failed>(await listAll('/api/care-autopay/attention')))
    } catch (e) { toast.error(errorMessage(e, 'Could not load automatic payments')) }
  }, [toast])
  useEffect(() => { load(); listAll('/api/clients').then((d) => setClients(rows<ClientOption>(d))).catch(() => {}) }, [load])

  const saveCard = async (clientId: string) => {
    setBusy(true)
    try {
      const r = await api.post(`/api/care-autopay/clients/${clientId}/setup`, {}) as { url: string }
      window.open(r.url, '_blank', 'noopener')
      toast.success('Stripe\'s page is open. Have the card owner finish there, or copy the address from the new tab to send to them.')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async (clientId: string) => {
    try { await api.delete(`/api/care-autopay/clients/${clientId}`); toast.success('Card removed'); load() } catch (e) { toast.error(errorMessage(e)) }
  }
  const tryNow = async (invoiceId: string) => {
    try {
      const r = await api.post(`/api/care-autopay/invoices/${invoiceId}/try-now`, {}) as { status: string; reason?: string }
      if (r.status === 'charged') toast.success('Paid'); else toast.error(r.reason ? `Not paid: ${r.reason}` : 'Not paid')
      load()
    } catch (e) { toast.error(errorMessage(e)) }
  }

  return (
    <div className="p-4 max-w-4xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Automatic payments</h1>
      <p className="text-sm mb-4 text-gray-600 dark:text-slate-400">A family saves a card once, on Stripe&apos;s own page, and each invoice is charged to it when the invoice is sent. Money goes to your own Stripe account. A declined card is tried again 2, 3 and 4 days later, and the family and your office are told each time.</p>

      {may.update && (
        <div className="flex flex-wrap items-end gap-3 mb-5">
          <label className="text-sm">Client<br />
            <select className={inp} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Client">
              <option value="">Choose a client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.lastName}, {c.firstName}</option>)}
            </select>
          </label>
          <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={!pick || busy} onClick={() => saveCard(pick)}>Save a card on Stripe&apos;s page</button>
        </div>
      )}

      <h2 className="text-base font-semibold mb-1">Did not go through</h2>
      {failed.length === 0 ? <p className="text-sm mb-5 text-gray-600 dark:text-slate-400">Nothing waiting.</p> : (
        <div className="overflow-x-auto rounded-lg border mb-5 border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-3 py-1.5">Client</th><th>Invoice</th><th>Amount</th><th>What happened</th><th /></tr></thead>
            <tbody>{failed.map((f) => (
              <tr key={f.id} className="border-t border-gray-100 dark:border-slate-700">
                <td className="px-3 py-1.5 font-semibold">{f.firstName} {f.lastName}</td>
                <td>#{f.invoiceNumber}</td>
                <td>{dollars(f.amountCents)}</td>
                <td>{f.status === 'needs_action' ? 'The bank needs the card owner to approve — ask the family to pay from the invoice link.'
                  : f.hardDecline ? 'The card can no longer be used — save a new card.'
                    : f.nextAttemptAt ? `Try ${f.attemptNo} failed. Next try ${new Date(f.nextAttemptAt).toLocaleDateString()}.` : `Try ${f.attemptNo} failed. No more automatic tries.`}</td>
                <td>{may.update && f.status === 'failed' && !f.hardDecline && f.attemptNo < 4 && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => tryNow(f.invoiceId)}>Try now</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      <h2 className="text-base font-semibold mb-1">Cards on file</h2>
      {cards.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">No cards yet.</p> : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <tbody>{cards.map((c) => (
              <tr key={c.clientId} className="border-t first:border-t-0 border-gray-100 dark:border-slate-700">
                <td className="px-3 py-1.5 font-semibold">{c.firstName} {c.lastName}</td>
                <td>{c.status === 'pending' ? 'Waiting for the card to be saved' : `${c.brand ?? 'Card'} ending ${c.last4 ?? ''}`}</td>
                <td>{c.status === 'paused' ? `Paused: ${c.pausedReason ?? 'the card cannot be used'}` : c.status === 'active' ? 'On' : ''}</td>
                <td className="text-right pr-3 whitespace-nowrap">{may.update && <>
                  <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm mr-2" onClick={() => saveCard(c.clientId)}>{c.status === 'paused' || c.status === 'pending' ? 'Save a card' : 'Replace card'}</button>
                  <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => remove(c.clientId)}>Remove</button>
                </>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
