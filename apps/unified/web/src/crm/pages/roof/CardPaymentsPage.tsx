// Card payments (roofing parity row 18; Roofr's surcharge and funding dashboard, Leap's reporting). Server: crm/roof/cardSurcharge.ts.
//   · Card surcharge (card_surcharge, not ready): on/off, the percent, the business's card rate where its state caps the surcharge at
//     it, and the 30-day notice the card brands require — with what the business's state allows said plainly; refused where it is not;
//   · Payouts (payments_overview, not ready): what is on its way to the bank and the recent payouts, from the business's own Stripe.
import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Landmark, Loader2 } from 'lucide-react'
import { api } from '../../../api'
import { useAuth, useMayWrite, useToast } from '../../../shared'
import { whenDate } from '@twomiah/tenant-ui/src/time/companyClock'

const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const PAYOUT: Record<string, string> = { paid: 'In the bank', pending: 'On its way', in_transit: 'On its way', canceled: 'Cancelled', failed: 'Failed' }

interface Surcharge { setting: { on: boolean; pct: number; actualFeePct: number | null; noticeGivenAt: string | null }; state: string; rule: { allowed: boolean; reason?: string; cap?: number; needsActualFee?: boolean; note?: string } }

function SurchargeSection() {
  const toast = useToast()
  const mayEdit = useMayWrite('company:update')
  const [s, setS] = useState<Surcharge | null>(null)
  const [form, setForm] = useState({ on: false, pct: '', actualFeePct: '', notice: false })
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/card-payments/surcharge') as Surcharge
      setS(r); setForm({ on: r.setting.on, pct: r.setting.pct ? String(r.setting.pct) : '', actualFeePct: r.setting.actualFeePct == null ? '' : String(r.setting.actualFeePct), notice: !!r.setting.noticeGivenAt })
    } catch (e) { toast.error(errorText(e, 'Could not load the surcharge setting')) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  if (!s) return <Loader2 className="w-5 h-5 animate-spin" />
  const save = async () => {
    setBusy(true)
    try {
      await api.put('/api/card-payments/surcharge', { on: form.on, pct: form.pct === '' ? null : Number(form.pct), actualFeePct: form.actualFeePct === '' ? null : Number(form.actualFeePct), noticeGiven: form.notice })
      toast.success(form.on ? 'Surcharge on — credit card payments now show it' : 'Surcharge off'); await load()
    } catch (e) { toast.error(errorText(e, 'Could not save the surcharge')) }
    finally { setBusy(false) }
  }
  return (
    <section className="rounded-lg border p-4 dark:border-slate-700 space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><CreditCard className="w-5 h-5" /> Card surcharge</h2>
      <p className="text-sm text-gray-600 dark:text-slate-300">Pass the card fee on to customers who pay by <b>credit</b> card. Debit and prepaid cards never pay it. The customer sees it before paying, and it shows on the invoice and receipt as its own line (not taxed).</p>
      {!s.rule.allowed ? (
        <p className="text-sm text-amber-800 dark:text-amber-300" role="status">{s.rule.reason}</p>
      ) : (
        <>
          <p className="text-sm text-gray-600 dark:text-slate-300">{s.state ? `Your business is in ${s.state}. ` : ''}{s.rule.note}</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!mayEdit} checked={form.on} onChange={(e) => setForm({ ...form, on: e.target.checked })} /> Add a surcharge to credit card payments</label>
          <div className="flex flex-wrap gap-3">
            <label className="text-sm">Surcharge %<input className="input w-28 mt-1 block" type="number" min={0} max={s.rule.cap} step="0.01" disabled={!mayEdit} value={form.pct} onChange={(e) => setForm({ ...form, pct: e.target.value })} /></label>
            {s.rule.needsActualFee && <label className="text-sm">What cards cost you %<input className="input w-28 mt-1 block" type="number" min={0} max={10} step="0.01" disabled={!mayEdit} value={form.actualFeePct} onChange={(e) => setForm({ ...form, actualFeePct: e.target.value })} /></label>}
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" disabled={!mayEdit} checked={form.notice} onChange={(e) => setForm({ ...form, notice: e.target.checked })} /> I told my card processor and the card brands at least 30 days before starting to surcharge (Visa’s rule), and my checkout and premises show it.</label>
          {mayEdit && <button className="btn-primary" disabled={busy} onClick={save}>Save</button>}
        </>
      )}
    </section>
  )
}

function PayoutsSection() {
  const [data, setData] = useState<{ available: number; pending: number; payouts: Array<{ id: string; amount: number; status: string; arrivalDate: string | null; failureMessage: string | null }> } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get('/api/card-payments/payouts').then((r: any) => setData(r)).catch((e) => setErr(errorText(e, 'Could not load the payouts'))) }, [])
  return (
    <section className="rounded-lg border p-4 dark:border-slate-700 space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><Landmark className="w-5 h-5" /> Payouts</h2>
      {err ? <p className="text-sm text-amber-800 dark:text-amber-300">{err}</p> : !data ? <Loader2 className="w-5 h-5 animate-spin" /> : (
        <>
          <div className="flex flex-wrap gap-6 text-sm">
            <div><p className="text-gray-500 dark:text-slate-400">Ready to pay out</p><p className="text-lg font-semibold">{money(data.available)}</p></div>
            <div><p className="text-gray-500 dark:text-slate-400">Still clearing</p><p className="text-lg font-semibold">{money(data.pending)}</p></div>
          </div>
          {data.payouts.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No payouts yet.</p> : (
            <ul className="divide-y text-sm dark:divide-slate-700">
              {data.payouts.map((p) => (
                <li key={p.id} className="flex justify-between py-1.5">
                  <span>{p.arrivalDate ? whenDate(p.arrivalDate, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} · {PAYOUT[p.status] || 'On its way'}{p.failureMessage ? ` — ${p.failureMessage}` : ''}</span>
                  <span className="font-medium">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/** Tips (invoice_tips): the business's switch for the tip box on its customers' pay screen (server cardSurcharge.ts /tips). */
function TipsSection() {
  const toast = useToast()
  const mayEdit = useMayWrite('company:update')
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get('/api/card-payments/tips').then((r: any) => setOn(!!r?.on)).catch((e) => { toast.error(errorText(e, 'Could not load the tips setting')); setOn(false) }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (on === null) return <Loader2 className="w-5 h-5 animate-spin" />
  const change = async (next: boolean) => {
    setBusy(true)
    try { await api.put('/api/card-payments/tips', { on: next }); setOn(next); toast.success(next ? 'Tips on — customers can add one when they pay online' : 'Tips off') }
    catch (e) { toast.error(errorText(e, 'Could not save the tips setting')) } finally { setBusy(false) }
  }
  return (
    <section className="rounded-lg border p-4 dark:border-slate-700 space-y-2" data-testid="tips-section">
      <h2 className="font-semibold flex items-center gap-2"><CreditCard className="w-5 h-5" /> Tips</h2>
      <p className="text-sm text-gray-600 dark:text-slate-300">Let customers add a tip when they pay an invoice online. The tip is kept apart from what the invoice owes. The tip box shows on the invoice's pay screen once card payments are connected (Settings › Integrations › Stripe).</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!mayEdit || busy} checked={on} onChange={(e) => change(e.target.checked)} /> Customers can add a tip</label>
    </section>
  )
}

export default function CardPaymentsPage() {
  const { hasFeature } = useAuth()
  const surcharge = hasFeature('card_surcharge'), payouts = hasFeature('payments_overview'), tips = hasFeature('invoice_tips')
  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-5">
      <h1 className="text-2xl font-bold">Card payments</h1>
      {!surcharge && !payouts && !tips && <p className="text-gray-600 dark:text-slate-300">Card payment tools are not turned on for this business.</p>}
      {payouts && <PayoutsSection />}
      {surcharge && <SurchargeSection />}
      {tips && <TipsSection />}
    </div>
  )
}
