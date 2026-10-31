// Card on file on the salon's screens (server crm/salon/cardOnFile.ts, /api/card-on-file; hidden feature `card_on_file`):
// the card on a client's chart, and the "Charge a fee" confirmation on a no-show or late cancellation in The Book.
// Cards are kept on the salon's OWN Stripe account and entered on Stripe's page — never typed here, never on the phone app.
// A fee is one confirmed action: the amount the server worked out is shown, the person types why, and the server checks the
// amount shown is the amount it charges.
import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Loader2, X, ExternalLink } from 'lucide-react'
import { api } from '../../../api'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'
import { useAuth, usePermissions, useToast, useConfirm } from '../../../shared'

const fieldClass = 'mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'
const money = (n: number) => '$' + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n)))

export interface SavedCard { id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; consentAt: string | null; consentVia: string | null }
export interface FeeOption { kind: 'no_show' | 'late_cancel'; amount: number | null; available: boolean; why: string | null; /** Which rule set the amount: the service's own, the new-client fee, the salon's, or a mix for a visit of several. */ basis?: 'service' | 'new_client' | 'salon' | 'mixed' | null }
export interface FeeCharge { id: string; kind: string; amount: number; status: string; reason: string | null; failureMessage: string | null; createdAt: string; source?: string; reversedAt?: string | null; reversalReason?: string | null }
const basisWords = (b?: string | null) => (b === 'service' ? 'this service’s own fee' : b === 'new_client' ? 'the new-client fee' : b === 'mixed' ? 'the services’ own fees and the salon’s' : '')

export const cardWords = (c: Pick<SavedCard, 'brand' | 'last4'>) => `${c.brand ? c.brand[0].toUpperCase() + c.brand.slice(1) : 'Card'} ending ${c.last4 || '····'}`
const kindWords = (k: string) => (k === 'no_show' ? 'No-show fee' : 'Late-cancellation fee')

/**
 * A client's card on their chart: which card is kept, who agreed and when, and — for whoever books or checks clients in —
 * the button that opens Stripe's page for the client to enter one, after the person ticks that the client agreed to the
 * policy. Taking a card off sits with whoever may charge (invoices:update), as on the server.
 */
export function ClientCardOnFile({ contactId }: { contactId: string }) {
  const { hasFeature } = useAuth()
  const { known, can } = usePermissions()
  const toast = useToast()
  const confirm = useConfirm()
  const show = !!contactId && hasFeature('card_on_file') && known && can('contacts:read')
  const mayAdd = known && (can('schedule:update') || can('schedule:check-in'))
  const mayRemove = known && can('invoices:update')
  const [cards, setCards] = useState<SavedCard[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [policy, setPolicy] = useState<{ words: string; connected: boolean } | null>(null)

  const load = useCallback(() => {
    api.get(`/api/card-on-file/clients/${contactId}/cards`).then((r: any) => setCards(r?.data || [])).catch(() => setCards(null))
  }, [contactId])
  useEffect(() => {
    if (!show) return
    load()
    api.get('/api/card-on-file/policy').then((p: any) => setPolicy({ words: p?.words || '', connected: !!p?.connected })).catch(() => setPolicy(null))
  }, [show, load])

  if (!show || cards === null) return null

  const start = async () => {
    setBusy(true)
    try {
      const r: any = await api.post(`/api/card-on-file/clients/${contactId}/cards/setup`, { clientAgreed: true })
      if (r?.url) window.open(r.url, '_blank', 'noopener')
      setAdding(false); setAgreed(false)
      toast.success('Stripe’s card page is open. Once the client saves their card it shows here.')
      // The card arrives from Stripe a moment after the page closes; look again shortly.
      setTimeout(load, 8000)
    } catch (e: any) {
      toast.error(e?.message || 'The card page could not be opened.')
    } finally { setBusy(false) }
  }
  const remove = async (c: SavedCard) => {
    if (!(await confirm(`Take the ${cardWords(c)} off this client? It will not be charged again.`, { title: 'Remove card', confirmText: 'Remove card' }))) return
    try { await api.delete(`/api/card-on-file/cards/${c.id}`); load() } catch (e: any) { toast.error(e?.message || 'The card could not be removed.') }
  }

  return (
    <section aria-label="Card on file" className="mt-4 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid="client-card-on-file">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100"><CreditCard className="h-4 w-4 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Card on file</h3>
        {mayAdd && !adding && (
          <button onClick={() => setAdding(true)} disabled={policy?.connected === false} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-slate-800">
            {cards.length ? 'Replace card' : 'Add a card'}
          </button>
        )}
      </div>
      {policy?.connected === false && <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">Connect your Stripe account (Settings › Integrations) before keeping cards.</p>}
      {cards.length === 0 && <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">No card on file.</p>}
      {cards.map((c) => (
        <div key={c.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-800 dark:text-slate-200">
          <span>
            <strong>{cardWords(c)}</strong>{c.expMonth && c.expYear ? ` · expires ${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}` : ''}
            <span className="block text-xs text-gray-600 dark:text-slate-300">
              Agreed to the card policy{c.consentAt ? ` on ${momentDate(c.consentAt)}` : ''}{c.consentVia === 'staff_at_desk' ? ' (in person)' : ' (online)'}
            </span>
          </span>
          {mayRemove && <button onClick={() => remove(c)} className="text-sm text-red-700 hover:underline dark:text-red-400">Remove</button>}
        </div>
      ))}
      {adding && (
        <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
          {policy?.words && <p className="text-sm text-gray-800 dark:text-slate-200"><strong>Card policy:</strong> {policy.words}</p>}
          <label className="mt-3 flex items-start gap-2 text-sm text-gray-900 dark:text-slate-100">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 h-4 w-4" />
            The client has read this and agrees to be charged under it.
          </label>
          <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">The card is typed on Stripe&rsquo;s own page, by the client. It is kept on your Stripe account, not here.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={start} disabled={!agreed || busy} className="flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-1.5 text-sm text-white hover:bg-teal-800 disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />} Open the card page
            </button>
            <button onClick={() => { setAdding(false); setAgreed(false) }} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-slate-800">Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Whether the Book should offer "Charge a fee" for this appointment at all: the feature is on and the seat may charge. */
export function useMayChargeFees(): boolean {
  const { hasFeature } = useAuth()
  const { known, can } = usePermissions()
  return hasFeature('card_on_file') && known && can('invoices:update')
}

/** A no-show or a cancellation is where a fee comes up; nothing else is offered the button. */
export const mayHaveFee = (status?: string) => status === 'no_show' || status === 'cancelled'

/**
 * "Charge a fee" for one appointment: the fees the policy allows (and, for those it does not, the plain reason), the card
 * that would be charged, then ONE confirm that names the amount. Earlier attempts on this appointment are listed so a
 * declined card is not charged blind twice.
 */
export function ChargeFeeModal({ appointmentId, clientName, onClose, onDone }: { appointmentId: string; clientName?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [data, setData] = useState<{ options: FeeOption[]; card: SavedCard | null; charges: FeeCharge[] } | null>(null)
  const [loadError, setLoadError] = useState('')
  const [kind, setKind] = useState<'no_show' | 'late_cancel' | ''>('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState('')
  const [outcome, setOutcome] = useState<{ text: string; ok: boolean } | null>(null)
  // Reversing a fee that went through: the whole charge back to the card, with a typed reason (invoices:update, as charging is).
  const mayReverse = useMayChargeFees()
  const [reversing, setReversing] = useState<string | null>(null)
  const [reverseReason, setReverseReason] = useState('')
  const [reverseError, setReverseError] = useState('')

  const load = useCallback(() => {
    api.get(`/api/card-on-file/appointments/${appointmentId}`).then((r: any) => {
      setData(r)
      setKind((k) => k || (r.options.find((o: FeeOption) => o.available)?.kind ?? ''))
    }).catch((e: Error) => setLoadError(e.message || 'The fee options could not be loaded.'))
  }, [appointmentId])
  useEffect(load, [load])

  const chosen = data?.options.find((o) => o.kind === kind)
  const reverse = async (c: FeeCharge) => {
    setBusy(true); setReverseError('')
    try {
      await api.post(`/api/card-on-file/charges/${c.id}/reverse`, { reason: reverseReason })
      toast.success(`Gave ${money(c.amount)} back to the card`)
      setReversing(null); load(); onDone()
    } catch (e: any) { setReverseError(e?.data?.fields?.reason || e?.message || 'The fee could not be reversed.') } finally { setBusy(false) }
  }
  const charge = async () => {
    if (!chosen || chosen.amount == null) return
    setBusy(true); setFieldError('')
    try {
      const r: any = await api.post(`/api/card-on-file/appointments/${appointmentId}/charge`, { kind, amount: chosen.amount, reason })
      if (r.status === 'succeeded') {
        const receipt = r.receipt === 'sent' ? ' A receipt was emailed.' : r.receipt === 'no_email' ? ' There is no email on file for a receipt.' : r.receipt === 'failed' ? ' The receipt email could not be sent.' : ''
        setOutcome({ ok: true, text: `Charged ${money(r.amount)}.${receipt}` })
        toast.success(`Charged ${money(r.amount)}`)
        onDone()
      } else {
        setOutcome({ ok: false, text: r.status === 'needs_action' ? 'The card needs the client to approve it, so it was not charged.' : `The card was declined${r.failureMessage ? `: ${r.failureMessage}` : ''}. Nothing was charged.` })
        load()
      }
    } catch (e: any) {
      setFieldError(e?.data?.fields?.reason || e?.message || 'The fee could not be charged.')
      if (e?.data?.code === 'FEE_CHANGED') load()
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Charge a fee">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Charge a fee{clientName ? ` — ${clientName}` : ''}</h2>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-gray-800 dark:text-slate-300"><X className="h-5 w-5" /></button>
        </div>
        {loadError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{loadError}</p>}
        {!data && !loadError && <div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-500" /></div>}
        {data && outcome && (
          <div className="mt-3">
            <p role="status" className={`text-sm ${outcome.ok ? 'text-green-800 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{outcome.text}</p>
            <div className="mt-4 flex justify-end"><button onClick={outcome.ok ? onClose : () => setOutcome(null)} className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800">{outcome.ok ? 'Done' : 'Back'}</button></div>
          </div>
        )}
        {data && !outcome && (
          <>
            <fieldset className="mt-3 space-y-2">
              <legend className="sr-only">Which fee</legend>
              {data.options.map((o) => (
                <label key={o.kind} className={`flex items-start gap-2 rounded-lg border p-2 text-sm ${o.available ? 'border-gray-300 dark:border-slate-600' : 'border-gray-200 opacity-70 dark:border-slate-700'}`}>
                  <input type="radio" name="fee-kind" disabled={!o.available} checked={kind === o.kind} onChange={() => setKind(o.kind)} className="mt-0.5" />
                  <span className="text-gray-900 dark:text-slate-100">
                    <strong>{kindWords(o.kind)}{o.amount != null ? ` — ${money(o.amount)}` : ''}</strong>
                    {o.available && basisWords(o.basis) && <span className="block text-xs text-gray-700 dark:text-slate-300">From {basisWords(o.basis)}.</span>}
                    {o.why && <span className="block text-xs text-gray-700 dark:text-slate-300">{o.why}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
            {data.card && <p className="mt-3 text-sm text-gray-800 dark:text-slate-200">Card: <strong>{cardWords(data.card)}</strong></p>}
            {chosen?.available && (
              <label className="mt-3 block text-sm font-medium text-gray-900 dark:text-slate-100">
                Why are you charging this?
                <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} placeholder="e.g. Did not arrive, no call" aria-invalid={!!fieldError} />
                {fieldError && <span role="alert" className="mt-1 block text-xs text-red-700 dark:text-red-300">{fieldError}</span>}
              </label>
            )}
            {data.charges.length > 0 && (
              <div className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-700 dark:border-slate-700 dark:text-slate-300">
                <p className="font-medium">Already tried on this appointment</p>
                <ul className="space-y-1">{data.charges.map((c) => (
                  <li key={c.id}>
                    {momentDate(c.createdAt)} · {kindWords(c.kind)} {money(c.amount)} · {c.reversedAt ? `charged, then reversed${c.reversalReason ? ` (${c.reversalReason})` : ''}` : c.status === 'succeeded' ? 'charged' : c.status === 'declined' ? 'declined' : 'needed the client to approve'}{c.source === 'auto' ? ' · automatic' : ''}
                    {mayReverse && c.status === 'succeeded' && !c.reversedAt && reversing !== c.id && (
                      <button onClick={() => { setReversing(c.id); setReverseReason(''); setReverseError('') }} className="ml-2 text-red-700 hover:underline dark:text-red-400">Reverse</button>
                    )}
                    {reversing === c.id && (
                      <span className="mt-1 block">
                        <input aria-label="Why are you reversing this fee?" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} className={fieldClass} placeholder="Why are you reversing this fee?" aria-invalid={!!reverseError} />
                        {reverseError && <span role="alert" className="block text-red-700 dark:text-red-300">{reverseError}</span>}
                        <span className="mt-1 flex gap-2">
                          <button onClick={() => reverse(c)} disabled={busy || reverseReason.trim().length < 3} className="rounded-lg bg-red-700 px-3 py-1 text-white hover:bg-red-800 disabled:opacity-50">Give {money(c.amount)} back</button>
                          <button onClick={() => setReversing(null)} className="rounded-lg border px-3 py-1 hover:bg-gray-50 dark:hover:bg-slate-800">Not now</button>
                        </span>
                      </span>
                    )}
                  </li>
                ))}</ul>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-800">Not now</button>
              <button onClick={charge} disabled={busy || !chosen?.available || reason.trim().length < 3} className="flex items-center gap-1 rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {chosen?.amount != null && chosen.available ? `Charge ${money(chosen.amount)}` : 'Charge'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
