// REGISTER SETTINGS — the card reader (Stripe Terminal on the business's own Stripe account), tips on the reader, why
// there is no offline mode, long tabs, the kiosk, online ordering and the DoorDash / Uber Eats links. Read by everyone
// on the register (bar:register); changed by managers and up (bar:update) — the server asks both (barFoodRoutes.ts).
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useConfirm, useMayWrite } from '../../../shared'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED } from './registerUi'

interface Reader { id: string; label: string; deviceType: string | null; serialNumber: string | null; simulated: boolean; status: string | null }
interface Settings {
  terminal: { tipping: boolean }
  tabs: boolean
  kiosk: { payAtCounter: boolean; idleSeconds: number; askTable: boolean }
  ordering: { paused: boolean; leadMinutes: number }
  delivery: { doordashUrl: string | null; ubereatsUrl: string | null }
}
interface Answer { settings: Settings; readers: Reader[]; stripe: { platform: boolean; connected: boolean }; features: { cardReader: boolean; kiosk: boolean; onlineOrdering: boolean } }

function Toggle({ id, label, help, on, disabled, onChange }: { id: string; label: string; help?: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="font-medium text-gray-900 dark:text-slate-100">{label}</label>
        {help && <p className={`text-sm ${MUTED}`}>{help}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
        className={`${BTN} ${on ? ON : OFF} min-w-[72px]`}>{on ? 'On' : 'Off'}</button>
    </div>
  )
}

export default function FoodSettingsPage() {
  const mayEdit = useMayWrite('bar:update')
  const confirm = useConfirm()
  const [a, setA] = useState<Answer | null>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState('')
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [lead, setLead] = useState('')
  const [idle, setIdle] = useState('')
  const [dd, setDd] = useState('')
  const [ue, setUe] = useState('')

  const load = useCallback(async () => {
    try {
      const r: Answer = await api.get('/api/food/settings')
      setA(r); setErr('')
      setLead(String(r.settings.ordering.leadMinutes)); setIdle(String(r.settings.kiosk.idleSeconds))
      setDd(r.settings.delivery.doordashUrl || ''); setUe(r.settings.delivery.ubereatsUrl || '')
    } catch (e) { setErr(errorText(e, 'Could not load the settings. Try again.')) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (key: string, b: Record<string, unknown>, said: string) => {
    setBusy(key); setErr(''); setOk('')
    try { await api.put('/api/food/settings', b); setOk(said); await load() } catch (e) { setErr(errorText(e, 'That did not save.')) } finally { setBusy('') }
  }
  const addReader = async () => {
    setBusy('reader'); setErr(''); setOk('')
    try { await api.post('/api/food/readers', { code, label }); setCode(''); setLabel(''); setOk('Reader added.'); await load() }
    catch (e) { setErr(errorText(e, 'The reader was not added.')) } finally { setBusy('') }
  }
  const removeReader = async (r: Reader) => {
    if (!(await confirm(`${r.label} comes off this register and off your Stripe account. You can pair it again with a new code.`, { title: 'Remove this reader?', confirmText: 'Remove reader' }))) return
    setBusy('rm-' + r.id); setErr('')
    try { await api.delete(`/api/food/readers/${r.id}`); setOk('Reader removed.'); await load() } catch (e) { setErr(errorText(e, 'The reader was not removed.')) } finally { setBusy('') }
  }

  if (!a) return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>
  const s = a.settings

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Register Settings</h1>
        <p className={`text-sm ${MUTED}`}>The card reader, tabs, the kiosk, online ordering and your delivery links.{!mayEdit && ' A manager or the owner changes these.'}</p>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {ok && <p className="text-sm font-medium text-green-800 dark:text-green-300" role="status">{ok}</p>}

      {a.features.cardReader && (
        <section className={`${CARD} space-y-4`} aria-labelledby="fs-reader">
          <h2 id="fs-reader" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Card reader</h2>
          {!a.stripe.connected
            ? <p className="text-sm text-gray-900 dark:text-slate-100">Connect your Stripe account first in <Link className="underline" to="/crm/settings/integrations">Settings › Integrations</Link>. Card payments go to your own Stripe account.</p>
            : <p className={`text-sm ${MUTED}`}>Payments on the reader go to your own Stripe account. A payment is on the check only once Stripe confirms it.</p>}
          {a.readers.length === 0 && <p className={`text-sm ${MUTED}`}>No reader yet. Until there is one, Card on the register records a card you ran on another machine.</p>}
          <ul className="space-y-2">
            {a.readers.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 dark:border-slate-700 px-3 py-2">
                <span className="text-gray-900 dark:text-slate-100"><span className="font-semibold">{r.label}</span>{r.simulated ? ' · test reader' : ''}{r.serialNumber ? ` · ${r.serialNumber}` : ''}</span>
                {mayEdit && <button type="button" className={`${BTN} ${DANGER} inline-flex items-center gap-2`} disabled={!!busy} onClick={() => removeReader(r)}><Trash2 className="w-4 h-4" />Remove</button>}
              </li>
            ))}
          </ul>
          {mayEdit && a.stripe.connected && (
            <form className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end" onSubmit={(e) => { e.preventDefault(); addReader() }}>
              <div>
                <label className={LABEL} htmlFor="fs-code">Pairing code</label>
                <input id="fs-code" className={`${INPUT} mt-1`} value={code} onChange={(e) => setCode(e.target.value)} placeholder="sepia-cerulean-aardvark" autoComplete="off" required />
              </div>
              <div>
                <label className={LABEL} htmlFor="fs-label">Name</label>
                <input id="fs-label" className={`${INPUT} mt-1`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Front bar" />
              </div>
              <button type="submit" className={`${BTN} ${ON} inline-flex items-center gap-2`} disabled={!!busy || !code.trim()}><Plus className="w-4 h-4" />Add reader</button>
              <p className={`text-xs sm:col-span-3 ${MUTED}`}>On the reader: swipe from the left, Settings, Generate pairing code. Your business address must be in Settings › Company (Stripe needs it).</p>
            </form>
          )}
          <Toggle id="fs-tipping" label="Ask for a tip on the reader" help="The reader shows 15%, 18% and 20% before the guest pays. The tip is recorded with the payment." on={s.terminal.tipping} disabled={!mayEdit || !!busy}
            onChange={(v) => save('tip', { tipping: v }, v ? 'The reader will ask for a tip.' : 'The reader will not ask for a tip.')} />
          <div className="rounded-xl border border-amber-300 bg-amber-50 text-gray-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-slate-100 p-3">
            <p className="font-semibold">Offline payments: not available</p>
            <p className="text-sm mt-1">These readers take a card only while they can reach Stripe over the internet. Stripe offers offline card payments only to apps built on its mobile Terminal software, which this register is not, so there is no offline mode to switch on. If the internet drops, take cash, or run the card on another machine and record it with Card (record).</p>
          </div>
        </section>
      )}

      <section className={`${CARD} space-y-4`} aria-labelledby="fs-register">
        <h2 id="fs-register" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Register</h2>
        <Toggle id="fs-tabs" label="Long tabs" help="New tab on the register: a check that stays open under a guest's name. Off, the register rings walk-ups and tables." on={s.tabs} disabled={!mayEdit || !!busy}
          onChange={(v) => save('tabs', { tabs: v }, v ? 'Tabs are on.' : 'Tabs are off.')} />
      </section>

      {a.features.kiosk && (
        <section className={`${CARD} space-y-4`} aria-labelledby="fs-kiosk">
          <h2 id="fs-kiosk" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Kiosk</h2>
          <p className={`text-sm ${MUTED}`}>Open <Link className="underline" to="/crm/kiosk">the kiosk</Link> on a tablet. A manager's till PIN starts it and stops it.</p>
          <Toggle id="fs-counter" label="Pay at the counter" help={a.readers.length ? 'Guests may also order and pay at the counter.' : 'With no card reader, guests order here and pay at the counter.'} on={s.kiosk.payAtCounter} disabled={!mayEdit || !!busy}
            onChange={(v) => save('counter', { kiosk: { payAtCounter: v } }, 'Saved.')} />
          <Toggle id="fs-table" label="Ask for a table number" on={s.kiosk.askTable} disabled={!mayEdit || !!busy} onChange={(v) => save('table', { kiosk: { askTable: v } }, 'Saved.')} />
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save('idle', { kiosk: { idleSeconds: Number(idle) } }, 'Saved.') }}>
            <div>
              <label className={LABEL} htmlFor="fs-idle">Back to the start after (seconds)</label>
              <input id="fs-idle" className={`${INPUT} mt-1 w-40`} inputMode="numeric" value={idle} onChange={(e) => setIdle(e.target.value.replace(/\D/g, ''))} disabled={!mayEdit} />
            </div>
            {mayEdit && <button type="submit" className={`${BTN} ${OFF}`} disabled={!!busy}>Save</button>}
          </form>
        </section>
      )}

      {a.features.onlineOrdering && (
        <section className={`${CARD} space-y-4`} aria-labelledby="fs-online">
          <h2 id="fs-online" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Online ordering</h2>
          <p className={`text-sm ${MUTED}`}>Pickup orders from your website's Order page, paid by card on your Stripe account, taken while the kitchen is open (Bar Settings hours, and the Tonight switch). Each becomes a grill ticket; the <Link className="underline" to="/crm/orders">Orders</Link> screen marks it ready and tells the guest.</p>
          {!a.stripe.connected && <p className="text-sm text-gray-900 dark:text-slate-100">Connect Stripe in <Link className="underline" to="/crm/settings/integrations">Settings › Integrations</Link> before your website takes orders.</p>}
          <Toggle id="fs-pause" label="Pause online orders" help="The website says it is not taking orders right now, until you switch this off." on={s.ordering.paused} disabled={!mayEdit || !!busy}
            onChange={(v) => save('pause', { ordering: { paused: v } }, v ? 'Online orders are paused.' : 'Online orders are back on.')} />
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save('lead', { ordering: { leadMinutes: Number(lead) } }, 'Saved.') }}>
            <div>
              <label className={LABEL} htmlFor="fs-lead">Soonest pickup (minutes from the order)</label>
              <input id="fs-lead" className={`${INPUT} mt-1 w-40`} inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, ''))} disabled={!mayEdit} />
            </div>
            {mayEdit && <button type="submit" className={`${BTN} ${OFF}`} disabled={!!busy}>Save</button>}
          </form>
        </section>
      )}

      <section className={`${CARD} space-y-3`} aria-labelledby="fs-delivery">
        <h2 id="fs-delivery" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Delivery apps</h2>
        <p className={`text-sm ${MUTED}`}>Your store pages on DoorDash and Uber Eats. When set, your website shows "Order on DoorDash" and "Order on Uber Eats" beside your own ordering. Only links on doordash.com (or order.online) and ubereats.com are taken.</p>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); save('delivery', { delivery: { doordashUrl: dd.trim() || null, ubereatsUrl: ue.trim() || null } }, 'Saved.') }}>
          <label className={LABEL} htmlFor="fs-dd">DoorDash store link</label>
          <input id="fs-dd" className={INPUT} type="url" inputMode="url" value={dd} onChange={(e) => setDd(e.target.value)} placeholder="https://www.doordash.com/store/..." disabled={!mayEdit} />
          <label className={`${LABEL} block`} htmlFor="fs-ue">Uber Eats store link</label>
          <input id="fs-ue" className={INPUT} type="url" inputMode="url" value={ue} onChange={(e) => setUe(e.target.value)} placeholder="https://www.ubereats.com/store/..." disabled={!mayEdit} />
          {mayEdit && <button type="submit" className={`${BTN} ${OFF}`} disabled={!!busy}>Save links</button>}
        </form>
      </section>
    </div>
  )
}
