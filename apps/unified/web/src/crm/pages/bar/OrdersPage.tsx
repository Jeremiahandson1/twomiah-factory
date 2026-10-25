// ORDERS — tonight's website pickup orders and kiosk orders (server: crm/bar/barOrders.ts, /api/food/orders). A paid
// order is already on the grill as a ticket; here staff mark it Ready — the guest is texted (if they asked for texts)
// or emailed "Ready for pickup" — and then Picked up. Times on the company's clock.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { whenTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { api } from '../../../api'
import { useMayWrite } from '../../../shared'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, CARD, MUTED, money, useLive } from './registerUi'

interface Line { name: string; size: string | null; qty: number; note: string | null; unitPriceCents: number }
interface Order { id: string; channel: 'online' | 'kiosk'; status: string; number: number | null; name: string | null; tableLabel: string | null; lines: Line[]; totalCents: number; checkId: string | null; pickupAt: string | null; createdAt: string; readyAt: string | null; phone: string | null; email: string | null }

const STATUS: Record<string, { label: string; cls: string }> = {
  received: { label: 'On the grill', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100' },
  ready: { label: 'Ready', cls: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100' },
  collected: { label: 'Picked up', cls: 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-200' },
  at_counter: { label: 'Pay at counter', cls: 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100' },
}

export default function OrdersPage() {
  const mayRing = useMayWrite('bar:register')
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    try { const r = await api.get('/api/food/orders'); setOrders(r.orders); setErr('') } catch (e) { setErr(errorText(e, 'Could not load the orders.')) }
  }, [])
  useEffect(() => { load() }, [load])
  useLive('bar:register', load, 15000)

  const mark = async (o: Order, to: 'ready' | 'collected') => {
    setBusy(o.id + to); setErr('')
    try { await api.post(`/api/food/orders/${o.id}/${to}`, {}); await load() } catch (e) { setErr(errorText(e, 'That did not save.')) } finally { setBusy('') }
  }

  if (!orders) return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>
  const open = orders.filter((o) => o.status !== 'collected')
  const done = orders.filter((o) => o.status === 'collected')
  const list = showDone ? done : open

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Orders</h1>
          <p className={`text-sm ${MUTED}`}>Tonight's website pickups and kiosk orders. Paid ones are already on the grill.</p>
        </div>
        <div className="flex gap-2">
          <button className={`${BTN} ${showDone ? OFF : ON}`} aria-pressed={!showDone} onClick={() => setShowDone(false)}>Open ({open.length})</button>
          <button className={`${BTN} ${showDone ? ON : OFF}`} aria-pressed={showDone} onClick={() => setShowDone(true)}>Picked up ({done.length})</button>
        </div>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {!list.length && <p className={`text-sm ${MUTED}`}>{showDone ? 'Nothing picked up yet tonight.' : 'No open orders.'}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((o) => {
          const s = STATUS[o.status] || { label: o.status, cls: STATUS.collected.cls }
          return (
            <article key={o.id} className={CARD} aria-label={`Order ${o.number ?? ''} ${o.name ?? ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-gray-900 dark:text-slate-100 truncate">#{o.number} {o.name || (o.tableLabel ? `Table ${o.tableLabel}` : '')}</p>
                  <p className={`text-sm ${MUTED}`}>{o.channel === 'online' ? 'Website pickup' : 'KIOSK'}{o.pickupAt ? ` · pickup ${whenTime(o.pickupAt)}` : ''} · ordered {whenTime(o.createdAt)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${s.cls}`}>{s.label}</span>
              </div>
              <ul className="mt-2 space-y-1 text-sm text-gray-900 dark:text-slate-100">
                {o.lines.map((l, n) => <li key={n}>{l.qty} × {l.name}{l.size ? ` (${l.size})` : ''}{l.note ? <span className={`block text-xs ${MUTED}`}>{l.note}</span> : null}</li>)}
              </ul>
              <p className="mt-2 font-mono text-gray-900 dark:text-slate-100">{money(o.totalCents)}</p>
              {(o.phone || o.email) && <p className={`text-xs ${MUTED}`}>{[o.phone, o.email].filter(Boolean).join(' · ')}</p>}
              {mayRing && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {o.status === 'received' && o.channel === 'online' && <button className={`${BTN} ${ON}`} disabled={!!busy} onClick={() => mark(o, 'ready')}>Ready — tell the guest</button>}
                  {(o.status === 'received' || o.status === 'ready') && <button className={`${BTN} ${OFF}`} disabled={!!busy} onClick={() => mark(o, 'collected')}>Picked up</button>}
                  {o.status === 'at_counter' && o.checkId && <Link className={`${BTN} ${OFF} inline-flex items-center`} to={`/crm/register?check=${o.checkId}`}>Take payment</Link>}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
