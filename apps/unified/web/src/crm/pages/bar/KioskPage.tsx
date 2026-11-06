// THE KIOSK — a tablet on the counter, full screen, locked. A manager's till PIN starts it and stops it (the server
// checks the PIN itself, whoever the tablet is signed in as: /api/food/kiosk/unlock). While it is on, this browser
// cannot leave it for any other screen of the app (KioskLock, crm/verticals/bar.tsx).
//
// The guest: Touch to order → the menu (sizes, add-ons) → their name (and table) → pay on the card reader, or at the
// counter where the owner allows it. Only a paid order reaches the grill, marked KIOSK; a counter order waits on the
// register until it is paid. Untouched for the owner's idle time, it goes back to the start and forgets the order.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Lock, Minus, Plus, ShoppingBag, X } from 'lucide-react'
import { api } from '../../../api'
import { useMayWrite } from '../../../shared'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, DANGER, LABEL, INPUT, MUTED, money, Dialog } from './registerUi'
import { ChargeWaiting, useCharge, type Charge } from './terminalUi'
import { kioskLocked, setKioskLock } from './kioskLock'

interface Size { id: string; name: string; priceCents: number | null }
interface Mod { id: string; name: string; priceCents: number }
interface Item { id: string; name: string; is86ed: boolean; stockCount?: number | null; description?: string | null; imageUrl?: string | null; sizes: Size[]; modifiers?: Mod[] }
interface Section { id: string; name: string; kind: string; items: Item[] }
interface KState { menu: Section[]; kiosk: { idleSeconds: number; askTable: boolean; payAtCounter: boolean }; reader: boolean; readerSimulated?: boolean; payAtCounter: boolean; taxRateBps: number; businessName: string }
interface Line { key: string; item: Item; size: Size; mods: Mod[]; qty: number }
interface Order { id: string; status: string; number: number | null; name: string | null; totalCents: number }

const lineEach = (l: Line) => (l.size.priceCents || 0) + l.mods.reduce((n, m) => n + m.priceCents, 0)
/** The register's tax rule (barMenuSizes.ts taxOn): on the whole subtotal, half a cent up. The server's total is the one charged. */
const taxOn = (sub: number, bps: number) => Math.floor((sub * bps + 5000) / 10000)

export default function KioskPage() {
  const navigate = useNavigate()
  const mayRing = useMayWrite('bar:register')
  const [st, setSt] = useState<KState | null>(null)
  const [err, setErr] = useState('')
  const [locked, setLocked] = useState(kioskLocked())
  const [phase, setPhase] = useState<'welcome' | 'menu' | 'details' | 'paying' | 'done'>('welcome')
  const [section, setSection] = useState('')
  const [cart, setCart] = useState<Line[]>([])
  const [picking, setPicking] = useState<Item | null>(null)
  const [name, setName] = useState('')
  const [table, setTable] = useState('')
  const [order, setOrder] = useState<Order | null>(null)
  const [pin, setPin] = useState<null | 'start' | 'stop'>(null)
  const [busy, setBusy] = useState(false)
  const [showCart, setShowCart] = useState(false)

  const load = useCallback(async () => {
    try { const r: KState = await api.get('/api/food/kiosk/state'); setSt(r); setSection((cur) => cur || r.menu[0]?.id || ''); setErr('') }
    catch (e) { setErr(errorText(e, 'The kiosk could not load the menu.')) }
  }, [])
  useEffect(() => { load() }, [load])

  const reset = useCallback(() => { setCart([]); setName(''); setTable(''); setOrder(null); setPicking(null); setShowCart(false); setPhase('welcome'); setErr('') }, [])

  // The reader: when Stripe confirms, the order is a paid check; read its number.
  const charge = useCharge(async (c: Charge) => {
    if (c.status === 'succeeded' && order) {
      try { const r = await api.get(`/api/food/kiosk/order/${order.id}`); setOrder(r.order) } catch { /* the thanks screen still shows */ }
      setPhase('done')
    }
  })

  // Idle: back to the start, the order forgotten — never while a card is on the reader.
  const last = useRef(Date.now())
  useEffect(() => {
    const touch = () => { last.current = Date.now() }
    window.addEventListener('pointerdown', touch); window.addEventListener('keydown', touch)
    const t = setInterval(() => {
      if (!st || phase === 'welcome' || phase === 'paying') return
      const limit = (phase === 'done' ? 12 : st.kiosk.idleSeconds) * 1000
      if (Date.now() - last.current > limit) { load(); reset() }
    }, 1000)
    return () => { clearInterval(t); window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch) }
  }, [st, phase, reset, load])

  const sub = useMemo(() => cart.reduce((n, l) => n + l.qty * lineEach(l), 0), [cart])
  const tax = st ? taxOn(sub, st.taxRateBps) : 0
  const count = cart.reduce((n, l) => n + l.qty, 0)

  const place = async (pay: 'reader' | 'counter') => {
    setBusy(true); setErr('')
    try {
      const r = await api.post('/api/food/kiosk/order', { name, table: table || undefined, pay, lines: cart.map((l) => ({ menuItemId: l.item.id, sizeId: l.size.id, modifierIds: l.mods.map((m) => m.id), qty: l.qty })) })
      setOrder(r.order)
      if (r.charge) { charge.setCharge(r.charge); setPhase('paying') } else setPhase('done')
    } catch (e) { setErr(errorText(e, 'The order did not go through. Try again, or order at the counter.')) } finally { setBusy(false) }
  }
  const cancelPaying = async () => {
    if (!order) return
    try { const r = await api.post(`/api/food/kiosk/order/${order.id}/cancel`, {}); if (r.order?.status === 'received') { setOrder(r.order); setPhase('done'); return } } catch { /* back to the order either way */ }
    charge.setCharge(null); setPhase('details')
  }

  if (!st) return <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950">{err ? <FormError message={err} /> : <Loader2 className="w-8 h-8 animate-spin text-gray-500 dark:text-slate-400" />}</div>

  const pinDialog = pin && <KioskPin mode={pin} onClose={() => setPin(null)} onOk={() => {
    if (pin === 'start') { setKioskLock(true); setLocked(true); reset() } else { setKioskLock(false); setLocked(false); navigate('/crm/register') }
    setPin(null)
  }} />

  // ── Not started: what this is, and the manager's PIN to start it ──
  if (!locked) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Order kiosk</h1>
          <p className={MUTED}>Guests order from this tablet and pay on {st.reader ? 'the card reader' : 'the counter'}{st.reader && st.payAtCounter ? ' or at the counter' : ''}. Paid orders go to the grill marked KIOSK. A manager's till PIN starts it and stops it; while it runs, this tablet shows nothing else.</p>
          {!st.menu.length && <p className="text-sm text-gray-900 dark:text-slate-100">Nothing on the menu has a price yet. Add prices under Menu first.</p>}
          <div className="flex flex-wrap gap-2">
            {mayRing && <button className={`${BTN} ${ON} inline-flex items-center gap-2`} disabled={!st.menu.length} onClick={() => setPin('start')}><Lock className="w-4 h-4" />Start the kiosk</button>}
            <button className={`${BTN} ${OFF}`} onClick={() => navigate('/crm/register')}>Back to the register</button>
          </div>
        </div>
        {pinDialog}
      </div>
    )
  }

  const staff = <button type="button" className="fixed top-3 right-3 z-40 text-xs px-3 py-2 rounded-lg border border-gray-300 bg-white/90 text-gray-700 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200" onClick={() => setPin('stop')}>Staff</button>

  if (phase === 'welcome') {
    return (
      <>
        <button type="button" className="min-h-screen w-full flex flex-col items-center justify-center gap-6 bg-orange-600 text-white p-6" onClick={() => { last.current = Date.now(); setPhase('menu') }}>
          <span className="text-3xl sm:text-5xl font-bold text-center">{st.businessName}</span>
          <span className="text-xl sm:text-3xl font-semibold">Touch to order</span>
        </button>
        {staff}
        {pinDialog}
      </>
    )
  }

  if (phase === 'paying' && charge.charge) {
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Pay on the card reader</h1>
          <ChargeWaiting charge={charge.charge} simulated={!!st.readerSimulated} err={charge.err} onCancel={cancelPaying} onSimulate={charge.simulate} />
          {charge.charge.status !== 'pending' && charge.charge.status !== 'succeeded' && (
            <div className="flex flex-wrap gap-2">
              <button className={`${BTN} ${ON}`} onClick={() => { charge.setCharge(null); setPhase('details') }}>Try again</button>
              {st.payAtCounter && <button className={`${BTN} ${OFF}`} onClick={() => { charge.setCharge(null); place('counter') }}>Pay at the counter</button>}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (phase === 'done' && order) {
    const paid = order.status === 'received'
    return (
      <button type="button" className="min-h-screen w-full flex flex-col items-center justify-center gap-4 bg-white dark:bg-slate-950 p-6 text-center" onClick={() => { load(); reset() }}>
        <span className="text-3xl font-bold text-gray-900 dark:text-slate-100">Thanks{order.name ? `, ${order.name}` : ''}!</span>
        {order.number !== null && <span className="text-5xl font-bold text-orange-700 dark:text-orange-300">#{order.number}</span>}
        <span className="text-xl text-gray-800 dark:text-slate-200">{paid ? 'Your order is in. We will call your name.' : `Please pay ${money(order.totalCents)} at the counter. Your food starts when you pay.`}</span>
        <span className={`text-sm ${MUTED}`}>Touch to start a new order</span>
      </button>
    )
  }

  const items = st.menu.find((s) => s.id === section)?.items || []
  const cartPanel = (
    <div className="flex flex-col h-full">
      <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-2">Your order</h2>
      {!cart.length && <p className={`text-sm ${MUTED}`}>Nothing yet. Touch an item to add it.</p>}
      <ul className="space-y-2 flex-1 overflow-y-auto">
        {cart.map((l) => (
          <li key={l.key} className="rounded-xl border border-gray-200 dark:border-slate-700 p-2">
            <div className="flex justify-between gap-2 text-gray-900 dark:text-slate-100"><span className="font-semibold">{l.item.name}{l.size.name !== 'Regular' && l.item.sizes.length > 1 ? ` (${l.size.name})` : ''}</span><span className="font-mono">{money(l.qty * lineEach(l))}</span></div>
            {l.mods.length > 0 && <p className={`text-xs ${MUTED}`}>{l.mods.map((m) => m.name).join(' · ')}</p>}
            <div className="flex items-center gap-2 mt-1">
              <button type="button" aria-label={`One fewer ${l.item.name}`} className={`${BTN} ${OFF} px-3`} onClick={() => setCart((c) => c.flatMap((x) => x.key !== l.key ? [x] : x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []))}><Minus className="w-4 h-4" /></button>
              <span className="min-w-[2ch] text-center text-gray-900 dark:text-slate-100">{l.qty}</span>
              <button type="button" aria-label={`One more ${l.item.name}`} className={`${BTN} ${OFF} px-3`} onClick={() => setCart((c) => c.map((x) => x.key === l.key ? { ...x, qty: Math.min(20, x.qty + 1) } : x))}><Plus className="w-4 h-4" /></button>
            </div>
          </li>
        ))}
      </ul>
      <dl className="text-sm mt-2 space-y-1">
        <div className="flex justify-between"><dt className={MUTED}>Subtotal</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(sub)}</dd></div>
        <div className="flex justify-between"><dt className={MUTED}>Tax</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(tax)}</dd></div>
        <div className="flex justify-between text-lg font-bold"><dt className="text-gray-900 dark:text-slate-100">Total</dt><dd className="font-mono text-gray-900 dark:text-slate-100">{money(sub + tax)}</dd></div>
      </dl>
      <button type="button" className={`${BTN} ${ON} mt-3 min-h-[56px] text-lg`} disabled={!cart.length} onClick={() => { setShowCart(false); setPhase('details') }}>Checkout</button>
      <button type="button" className={`${BTN} ${OFF} mt-2`} onClick={() => { load(); reset() }}>Start over</button>
    </div>
  )

  if (phase === 'details') {
    const needName = !(st.kiosk.askTable && table.trim()) && !name.trim()
    return (
      <div className="min-h-screen bg-white dark:bg-slate-950 flex items-start sm:items-center justify-center p-4">
        {staff}
        <div className="max-w-md w-full space-y-4 mt-10 sm:mt-0">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Almost done</h1>
          <div>
            <label className={LABEL} htmlFor="k-name">Your name</label>
            <input id="k-name" className={`${INPUT} mt-1 text-lg`} value={name} onChange={(e) => setName(e.target.value.slice(0, 30))} autoComplete="off" />
          </div>
          {st.kiosk.askTable && (
            <div>
              <label className={LABEL} htmlFor="k-table">Table number (if you have one)</label>
              <input id="k-table" className={`${INPUT} mt-1 text-lg`} inputMode="numeric" value={table} onChange={(e) => setTable(e.target.value.replace(/[^\w-]/g, '').slice(0, 10))} />
            </div>
          )}
          <p className="text-lg font-bold text-gray-900 dark:text-slate-100">Total {money(sub + tax)}</p>
          <FormError message={err} />
          <div className="grid gap-2">
            {st.reader && <button type="button" className={`${BTN} ${ON} min-h-[56px] text-lg`} disabled={busy || needName} onClick={() => place('reader')}>Pay with card</button>}
            {st.payAtCounter && <button type="button" className={`${BTN} ${st.reader ? OFF : ON} min-h-[56px] text-lg`} disabled={busy || needName} onClick={() => place('counter')}>Pay at the counter</button>}
            <button type="button" className={`${BTN} ${OFF}`} onClick={() => setPhase('menu')}>Back to the menu</button>
          </div>
        </div>
      </div>
    )
  }

  // ── The menu ──
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 lg:grid lg:grid-cols-[minmax(0,1fr)_360px]">
      {staff}
      <main className="p-3 sm:p-4 pb-28 lg:pb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-3 pr-20">{st.businessName}</h1>
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3" role="tablist">
          {st.menu.map((s) => <button key={s.id} role="tab" aria-selected={s.id === section} className={`${BTN} ${s.id === section ? ON : OFF} whitespace-nowrap`} onClick={() => setSection(s.id)}>{s.name}</button>)}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {items.map((i) => {
            const from = Math.min(...i.sizes.map((z) => z.priceCents || 0))
            return (
              <button key={i.id} type="button" disabled={i.is86ed} onClick={() => setPicking(i)}
                className={`text-left rounded-2xl border p-3 min-h-[110px] ${i.is86ed ? 'border-gray-200 bg-gray-100 text-gray-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500' : 'border-gray-200 bg-white text-gray-900 hover:border-orange-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'}`}>
                {i.imageUrl && <img src={i.imageUrl} alt="" className="w-full h-24 object-cover rounded-xl mb-2" />}
                <span className="block font-semibold leading-tight">{i.name}</span>
                {i.description && <span className={`block text-xs mt-1 line-clamp-2 ${i.is86ed ? '' : MUTED}`}>{i.description}</span>}
                <span className="block text-sm mt-1 font-mono">{i.is86ed ? 'Sold out' : `${i.sizes.length > 1 ? 'from ' : ''}${money(from)}`}{!i.is86ed && i.stockCount != null && i.stockCount <= 10 ? <span className={`ml-2 ${MUTED}`}>{i.stockCount} left</span> : null}</span>
              </button>
            )
          })}
        </div>
      </main>
      <aside className="hidden lg:block border-l border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 h-screen sticky top-0">{cartPanel}</aside>
      {/* A phone-sized tablet: the order is a bar along the bottom that opens the panel. */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 p-3 bg-white dark:bg-slate-900 border-t border-gray-200 dark:border-slate-800">
        <button type="button" className={`${BTN} ${ON} w-full min-h-[56px] text-lg inline-flex items-center justify-center gap-2`} onClick={() => setShowCart(true)}><ShoppingBag className="w-5 h-5" />Your order ({count}) · {money(sub + tax)}</button>
      </div>
      {showCart && (
        <div className="lg:hidden fixed inset-0 z-50 bg-white dark:bg-slate-900 p-4 flex flex-col" role="dialog" aria-modal="true" aria-label="Your order">
          <button type="button" aria-label="Close" className="self-end p-2 text-gray-700 dark:text-slate-200" onClick={() => setShowCart(false)}><X className="w-6 h-6" /></button>
          {cartPanel}
        </div>
      )}
      {picking && <PickDialog item={picking} onClose={() => setPicking(null)} onAdd={(size, mods, qty) => {
        setCart((c) => [...c, { key: `${picking.id}-${Date.now()}`, item: picking, size, mods, qty }]); setPicking(null)
      }} />}
      {pinDialog}
    </div>
  )
}

/** One item: its size, its add-ons, how many. */
function PickDialog({ item, onClose, onAdd }: { item: Item; onClose: () => void; onAdd: (size: Size, mods: Mod[], qty: number) => void }) {
  const [size, setSize] = useState<Size>(item.sizes[0])
  const [mods, setMods] = useState<string[]>([])
  const [qty, setQty] = useState(1)
  const chosen = (item.modifiers || []).filter((m) => mods.includes(m.id))
  const each = (size.priceCents || 0) + chosen.reduce((n, m) => n + m.priceCents, 0)
  return (
    <Dialog title={item.name} onClose={onClose}>
      {item.description && <p className={`text-sm mb-3 ${MUTED}`}>{item.description}</p>}
      {item.sizes.length > 1 && (
        <>
          <p className={`${LABEL} mb-2`}>Size</p>
          <div className="grid grid-cols-2 gap-2 mb-3" role="radiogroup" aria-label="Size">
            {item.sizes.map((s) => <button key={s.id} type="button" role="radio" aria-checked={size.id === s.id} className={`${BTN} ${size.id === s.id ? ON : OFF}`} onClick={() => setSize(s)}>{s.name} · {money(s.priceCents)}</button>)}
          </div>
        </>
      )}
      {(item.modifiers || []).length > 0 && (
        <>
          <p className={`${LABEL} mb-2`}>Make it yours</p>
          <div className="grid gap-2 mb-3">
            {(item.modifiers || []).map((m) => {
              const on = mods.includes(m.id)
              return <button key={m.id} type="button" aria-pressed={on} className={`${BTN} ${on ? ON : OFF} flex items-center justify-between gap-3 py-2 text-left`} onClick={() => setMods((cur) => on ? cur.filter((x) => x !== m.id) : [...cur, m.id])}><span>{m.name}</span><span>{m.priceCents ? `+${money(m.priceCents)}` : ''}</span></button>
            })}
          </div>
        </>
      )}
      <div className="flex items-center gap-3">
        <button type="button" aria-label="One fewer" className={`${BTN} ${OFF} px-3`} onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus className="w-4 h-4" /></button>
        <span className="text-lg font-semibold text-gray-900 dark:text-slate-100">{qty}</span>
        <button type="button" aria-label="One more" className={`${BTN} ${OFF} px-3`} onClick={() => setQty((q) => Math.min(20, q + 1))}><Plus className="w-4 h-4" /></button>
        <button type="button" className={`${BTN} ${ON} flex-1`} onClick={() => onAdd(size, chosen, qty)}>Add · {money(each * qty)}</button>
      </div>
    </Dialog>
  )
}

/** The manager's till PIN, checked by the server every time (it starts and stops the kiosk). */
function KioskPin({ mode, onClose, onOk }: { mode: 'start' | 'stop'; onClose: () => void; onOk: () => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog title={mode === 'start' ? 'Start the kiosk' : 'Stop the kiosk'} onClose={onClose}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('')
        try { await api.post('/api/food/kiosk/unlock', { pin, mode }); onOk() } catch (ex) { setErr(errorText(ex, 'That is not a manager PIN.')) } finally { setBusy(false) }
      }}>
        <label className={LABEL} htmlFor="kiosk-pin">Manager's till PIN</label>
        <input id="kiosk-pin" className={`${INPUT} mt-1 text-2xl tracking-[0.4em]`} type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        <p className={`text-sm mt-2 ${MUTED}`}>No PIN yet? The owner or a manager sets one on the Register with Set my till PIN.</p>
        <FormError message={err} className="mt-3" />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${BTN} ${mode === 'stop' ? DANGER : ON}`} disabled={busy || pin.length < 4}>{mode === 'start' ? 'Start' : 'Stop the kiosk'}</button>
        </div>
      </form>
    </Dialog>
  )
}

