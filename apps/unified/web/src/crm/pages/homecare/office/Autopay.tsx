// Automatic payment (item 3 and parity row 22, care_autopay): a family saves a card — or a US / Canadian bank account — on
// Stripe's own page and each invoice is charged to it when the invoice is sent, on the agency's own Stripe account. This
// screen: what is on file, saving one, the payments that did not go through, charges scheduled for a later day or in parts,
// and the agency's settings (the retry schedule, approval reminders, which ways of paying it offers). The card is never typed
// here; the button opens Stripe's page.
//   GET /api/care-autopay/clients|attention|schedules|settings   PUT /settings   POST /clients/:id/setup { method }
//   DELETE /clients/:id   PUT|DELETE /invoices/:id/schedule   POST /invoices/:id/try-now   (server/crm/homecare/billing/autopayRoutes.ts)
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { moneyCents } from '@twomiah/tenant-ui/src/money'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { useMay } from '../lib/useMay'

interface Card { clientId: string; firstName: string; lastName: string; status: string; pausedReason: string | null; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; method: string; bankName: string | null; savedBy: string | null }
interface Failed { id: string; invoiceId: string; invoiceNumber: string; firstName: string; lastName: string; attemptNo: number; status: string; amountCents: number; failureCode: string | null; hardDecline: boolean; nextAttemptAt: string | null }
interface Scheduled { id: string; invoiceId: string; invoiceNumber: string; firstName: string; lastName: string; chargeOn: string; amountCents: number | null; label: string | null; status: string; owedCents: number }
interface ClientOption { id: string; firstName: string; lastName: string }
interface OpenInvoice { id: string; seqNumber: number | null; invoiceNumber: string; clientId: string; firstName?: string; lastName?: string; total: string; amountPaid: string | null; amountAdjusted: string | null; sentAt: string | null; billTo?: string }
interface Settings {
  retryDays: number[]; approvalReminderDays: number[]; methods: { card: boolean; usBank: boolean; cad: boolean }
  methodLabels: Record<string, string>; ownerSteps: { usBank: string; cad: string }
}

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const dollars = (c: number) => moneyCents(c)
const methodWord = (m: string) => (m === 'us_bank_account' ? 'US bank account' : m === 'acss_debit' ? 'Canadian bank account' : 'card')
const onFile = (c: Card) => (c.method === 'card' ? `${c.brand ?? 'Card'} ending ${c.last4 ?? ''}` : `${c.bankName ? `${c.bankName} ` : ''}bank account ending ${c.last4 ?? ''}`)
const daysText = (d: number[]) => d.join(', ')
const parseDays = (s: string) => s.split(/[,\s]+/).filter(Boolean).map(Number)
const STATUS_WORD: Record<string, string> = { waiting: 'Waiting', charged: 'Charged', failed: 'Did not go through', cancelled: 'Cancelled' }

export default function Autopay() {
  const may = useMay('care-billing')
  const toast = useToast()
  const [cards, setCards] = useState<Card[]>([])
  const [failed, setFailed] = useState<Failed[]>([])
  const [scheduled, setScheduled] = useState<Scheduled[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [clients, setClients] = useState<ClientOption[]>([])
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([])
  const [pick, setPick] = useState('')
  const [method, setMethod] = useState<'card' | 'us_bank_account' | 'acss_debit'>('card')
  const [busy, setBusy] = useState(false)
  // settings form
  const [retryText, setRetryText] = useState('')
  const [reminderText, setReminderText] = useState('')
  // schedule form
  const [schInvoice, setSchInvoice] = useState('')
  const [schParts, setSchParts] = useState<Array<{ chargeOn: string; amount: string }>>([{ chargeOn: '', amount: '' }])
  const [cancelling, setCancelling] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setCards(rows<Card>(await listAll('/api/care-autopay/clients')))
      setFailed(rows<Failed>(await listAll('/api/care-autopay/attention')))
      setScheduled(rows<Scheduled>(await listAll('/api/care-autopay/schedules')))
      const s = (await api.get('/api/care-autopay/settings')) as Settings
      setSettings(s); setRetryText(daysText(s.retryDays)); setReminderText(daysText(s.approvalReminderDays))
    } catch (e) { toast.error(errorMessage(e, 'Could not load automatic payments')) }
  }, [toast])
  useEffect(() => {
    load()
    listAll('/api/clients').then((d) => setClients(rows<ClientOption>(d))).catch(() => {})
    listAll('/api/billing/invoices', { paymentStatus: 'pending' }).then((d) => setOpenInvoices(rows<OpenInvoice>(d).filter((i) => i.sentAt && (i.billTo ?? 'family') === 'family'))).catch(() => {})
  }, [load])

  const saveCard = async (clientId: string, m = method) => {
    setBusy(true)
    try {
      const r = await api.post(`/api/care-autopay/clients/${clientId}/setup`, { method: m }) as { url: string }
      window.open(r.url, '_blank', 'noopener')
      toast.success('Stripe\'s page is open. Have the family finish there, or copy the address from the new tab to send to them.')
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const remove = async (clientId: string) => {
    try { await api.delete(`/api/care-autopay/clients/${clientId}`); toast.success('Removed'); load() } catch (e) { toast.error(errorMessage(e)) }
  }
  const tryNow = async (invoiceId: string) => {
    try {
      const r = await api.post(`/api/care-autopay/invoices/${invoiceId}/try-now`, {}) as { status: string; reason?: string }
      if (r.status === 'charged') toast.success('Paid'); else if (r.status === 'pending') toast.success('The bank is processing it; the payment lands when it answers.'); else toast.error(r.reason ? `Not paid: ${r.reason}` : 'Not paid')
      load()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const saveSettings = async (patch: Partial<Pick<Settings, 'retryDays' | 'approvalReminderDays' | 'methods'>>) => {
    try {
      const s = (await api.put('/api/care-autopay/settings', patch)) as Settings
      setSettings(s); setRetryText(daysText(s.retryDays)); setReminderText(daysText(s.approvalReminderDays))
      toast.success('Saved')
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const schedule = async () => {
    if (!schInvoice) { toast.error('Choose an invoice.'); return }
    const parts = schParts.filter((p) => p.chargeOn || p.amount).map((p) => ({ chargeOn: p.chargeOn, ...(p.amount ? { amountCents: Math.round(Number(p.amount) * 100) } : {}) }))
    if (!parts.length) { toast.error('Give a date.'); return }
    try {
      await api.put(`/api/care-autopay/invoices/${schInvoice}/schedule`, { parts })
      toast.success(parts.length > 1 ? 'Instalment plan saved' : 'Charge scheduled')
      setSchParts([{ chargeOn: '', amount: '' }]); setSchInvoice(''); load()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const cancelPlan = async (invoiceId: string) => {
    try { await api.delete(`/api/care-autopay/invoices/${invoiceId}/schedule`); toast.success('Taken back'); setCancelling(null); load() } catch (e) { toast.error(errorMessage(e)) }
  }
  const owedOf = (i: OpenInvoice) => Math.max(0, Math.round((Number(i.total) - Number(i.amountPaid || 0) - Number(i.amountAdjusted || 0)) * 100))
  const methodsOffered = settings ? [settings.methods.card && 'card', settings.methods.usBank && 'us_bank_account', settings.methods.cad && 'acss_debit'].filter(Boolean) as string[] : ['card']

  return (
    <div className="p-4 max-w-5xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Automatic payments</h1>
      <p className="text-sm mb-4 text-gray-600 dark:text-slate-400">A family saves a card or bank account once, on Stripe&apos;s own page (from your office or from their portal), and each invoice is charged to it when the invoice is sent — or on the day you schedule, in one go or in parts. Money goes to your own Stripe account. A declined card is tried again on your schedule below, and the family and your office are told each time; a receipt goes to the family after each payment.</p>

      {may.update && (
        <div className="flex flex-wrap items-end gap-3 mb-5">
          <label className="text-sm">Client<br />
            <select className={inp} value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Client">
              <option value="">Choose a client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.lastName}, {c.firstName}</option>)}
            </select>
          </label>
          <label className="text-sm">What to save<br />
            <select className={inp} value={method} onChange={(e) => setMethod(e.target.value as any)} aria-label="What to save">
              {methodsOffered.map((m) => <option key={m} value={m}>{settings?.methodLabels[m] ?? methodWord(m)}</option>)}
            </select>
          </label>
          <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={!pick || busy} onClick={() => saveCard(pick)}>Open Stripe&apos;s page to save it</button>
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
                <td>{f.status === 'needs_action' ? 'The bank needs the account owner to approve — the family is reminded on your days below; ask them to pay from the invoice link.'
                  : f.hardDecline ? 'It can no longer be used — save a new card or account.'
                    : f.nextAttemptAt ? `Try ${f.attemptNo} failed. Next try ${new Date(f.nextAttemptAt).toLocaleDateString()}.` : `Try ${f.attemptNo} failed. No more automatic tries.`}</td>
                <td>{may.update && f.status === 'failed' && !f.hardDecline && f.nextAttemptAt && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => tryNow(f.invoiceId)}>Try now</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      <h2 className="text-base font-semibold mb-1">On file</h2>
      {cards.length === 0 ? <p className="text-sm mb-5 text-gray-600 dark:text-slate-400">Nothing saved yet.</p> : (
        <div className="overflow-x-auto rounded-lg border mb-5 border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <tbody>{cards.map((c) => (
              <tr key={c.clientId} className="border-t first:border-t-0 border-gray-100 dark:border-slate-700">
                <td className="px-3 py-1.5 font-semibold">{c.firstName} {c.lastName}</td>
                <td>{c.status === 'pending' ? 'Waiting for it to be saved on Stripe\'s page' : onFile(c)}{c.status !== 'pending' && c.expMonth && c.expYear ? ` (expires ${String(c.expMonth).padStart(2, '0')}/${c.expYear})` : ''}</td>
                <td>{c.status === 'paused' ? `Paused: ${c.pausedReason ?? 'it cannot be used'}` : c.status === 'active' ? `On${c.savedBy === 'family' ? ' — saved by the family' : c.savedBy === 'client' ? ' — saved by the client' : ''}` : ''}</td>
                <td className="text-right pr-3 whitespace-nowrap">{may.update && <>
                  <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm mr-2" onClick={() => saveCard(c.clientId)}>{c.status === 'paused' || c.status === 'pending' ? 'Save' : 'Replace'}</button>
                  <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => remove(c.clientId)}>Remove</button>
                </>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      <h2 className="text-base font-semibold mb-1">Scheduled charges and instalments</h2>
      <p className="text-sm mb-2 text-gray-600 dark:text-slate-400">An invoice with a scheduled charge is not charged when it is sent; it is charged on the day you pick — the whole balance, or several parts on several days. A part that fails is retried like any other charge.</p>
      {may.update && (
        <div className="rounded-lg border p-3 mb-3 border-gray-200 dark:border-slate-700">
          <label className="text-sm block mb-2">Invoice<br />
            <select className={inp} value={schInvoice} onChange={(e) => setSchInvoice(e.target.value)} aria-label="Invoice to schedule">
              <option value="">Choose a sent, unpaid invoice…</option>
              {openInvoices.map((i) => <option key={i.id} value={i.id}>#{i.seqNumber ?? i.invoiceNumber} — {i.lastName}, {i.firstName} — {dollars(owedOf(i))} owed</option>)}
            </select>
          </label>
          {schParts.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 mb-2">
              <label className="text-sm">{schParts.length > 1 ? `Part ${i + 1} on` : 'Charge on'}<br /><input type="date" className={inp} value={p.chargeOn} onChange={(e) => setSchParts(schParts.map((x, k) => (k === i ? { ...x, chargeOn: e.target.value } : x)))} /></label>
              <label className="text-sm">Amount ($){schParts.length === 1 ? ' — blank for the balance' : ''}<br /><input type="number" min="0.01" step="0.01" className={inp} value={p.amount} onChange={(e) => setSchParts(schParts.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} /></label>
              {schParts.length > 1 && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setSchParts(schParts.filter((_, k) => k !== i))}>Remove part</button>}
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setSchParts([...schParts, { chargeOn: '', amount: '' }])}>Add a part</button>
            <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" onClick={schedule}>{schParts.length > 1 ? 'Save the plan' : 'Schedule it'}</button>
          </div>
        </div>
      )}
      {scheduled.length === 0 ? <p className="text-sm mb-5 text-gray-600 dark:text-slate-400">Nothing scheduled.</p> : (
        <div className="overflow-x-auto rounded-lg border mb-5 border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-3 py-1.5">Client</th><th>Invoice</th><th>On</th><th>Amount</th><th>State</th><th /></tr></thead>
            <tbody>{scheduled.map((s) => (
              <tr key={s.id} className="border-t border-gray-100 dark:border-slate-700">
                <td className="px-3 py-1.5 font-semibold">{s.firstName} {s.lastName}</td>
                <td>#{s.invoiceNumber}{s.label ? ` · ${s.label}` : ''}</td>
                <td>{s.chargeOn}</td>
                <td>{s.amountCents != null ? dollars(s.amountCents) : `the balance (${dollars(s.owedCents)})`}</td>
                <td>{STATUS_WORD[s.status] ?? s.status}</td>
                <td className="text-right pr-3 whitespace-nowrap">{may.update && s.status === 'waiting' && (cancelling === s.invoiceId
                  ? <><span className="mr-2">Take back every waiting part?</span><button type="button" className="hc-btn hc-btn-primary hc-btn-sm mr-1" onClick={() => cancelPlan(s.invoiceId)}>Yes</button><button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setCancelling(null)}>No</button></>
                  : <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setCancelling(s.invoiceId)}>Take back</button>)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      {settings && (
        <>
          <h2 className="text-base font-semibold mb-1">Settings</h2>
          <div className="grid sm:grid-cols-2 gap-4 text-sm mb-5">
            <div>
              <label>Days to wait after each failed try<br />
                <input className={`${inp} w-full`} value={retryText} disabled={!may.update} onChange={(e) => setRetryText(e.target.value)} placeholder="2, 3, 4" />
              </label>
              <p className="text-gray-600 dark:text-slate-400 mt-1">Up to 7 waits adding up to 14 days at most (Stripe allows 8 tries in two weeks). A bank debit is retried only when the account lacked the money, at most twice.</p>
              {may.update && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm mt-1" onClick={() => saveSettings({ retryDays: parseDays(retryText) })}>Save retry schedule</button>}
            </div>
            <div>
              <label>Reminders after &ldquo;the bank needs the owner&rdquo; (days after the notice)<br />
                <input className={`${inp} w-full`} value={reminderText} disabled={!may.update} onChange={(e) => setReminderText(e.target.value)} placeholder="3, 7" />
              </label>
              <p className="text-gray-600 dark:text-slate-400 mt-1">The family gets the same notice again on each of these days while the invoice is still owed.</p>
              {may.update && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm mt-1" onClick={() => saveSettings({ approvalReminderDays: parseDays(reminderText) })}>Save reminders</button>}
            </div>
            <div className="sm:col-span-2">
              <div className="font-semibold mb-1">Ways of paying the agency offers</div>
              {(['card', 'usBank', 'cad'] as const).map((k) => (
                <label key={k} className="block mb-1">
                  <input type="checkbox" className="mr-2" checked={settings.methods[k]} disabled={!may.update} onChange={(e) => saveSettings({ methods: { ...settings.methods, [k]: e.target.checked } })} />
                  {k === 'card' ? settings.methodLabels.card : k === 'usBank' ? settings.methodLabels.us_bank_account : settings.methodLabels.acss_debit}
                  {k !== 'card' && <span className="block ml-6 text-gray-600 dark:text-slate-400">Your step first: {settings.ownerSteps[k]}</span>}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
