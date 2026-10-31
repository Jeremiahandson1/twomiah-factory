// The store's returns at /crm/returns (gap 8 against Shopify's returns, 2026-10-30): what customers have asked to send
// back, and what to do with each — approve or decline, say the parcel has arrived (the stock goes back then), then give
// the money back to the card, as store credit or part of each, or send an exchange. Also the shop's return rule.
//
// GET/POST /api/admin/store-returns (server/crm/store/returns/routes.ts) — behind the store_returns feature, as this
// page's menu row is; reading is orders:read, and the buttons that decide or send money are orders:refund (the server
// refuses a seat without it and the page shows its sentence). The rule is settings:update.
//   · a failed read or action says so in words — never a list that looks empty;
//   · money is shown from the server's figures, in cents, never worked out here.
import { useCallback, useEffect, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useMayWrite } from '../../../../shared'
import { cents } from './lib'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

interface Line { orderItemId: string; quantity: number; productName: string; variantName: string; unitPriceCents: number }
interface Ret {
  id: string; returnNumber: string; status: string; startedBy: string; resolution: 'refund' | 'exchange'; reason: string; reasonLabel: string; note: string | null; wanted: string | null
  preferCredit: boolean; staffNote: string | null; declineReason: string | null; late: boolean
  lineValueCents: number; restockingFeeCents: number; returnShippingFeeCents: number; refundCents: number; creditCents: number
  labelUrl: string | null; labelTracking: string | null; labelCarrier: string | null; createdAt: string
  order: { id: string; orderNumber: string | null; customerName: string | null; customerEmail: string; currency: string } | null
  lines: Line[]; refund: { status: string; amountCents: number; creditCents: number; error: string | null } | null; exchangeOrder: { orderNumber: string | null } | null
}
interface Rule { windowDays: number; restockingFeePercent: number; returnShippingFeeCents: number; labels: boolean; shopperReturns: boolean }
interface Options { open: boolean; why: string | null; windowOpen: boolean; windowEndsAt: string; lines: { orderItemId: string; productName: string; variantName: string; quantity: number; left: number; note: string | null }[] }

const TABS = [
  { key: '', label: 'All' }, { key: 'requested', label: 'To decide' }, { key: 'approved', label: 'On their way back' }, { key: 'received', label: 'To refund or exchange' },
  { key: 'refunded', label: 'Refunded' }, { key: 'exchanged', label: 'Exchanged' }, { key: 'declined', label: 'Declined' },
]
const WORD: Record<string, string> = { requested: 'Waiting for you', approved: 'Approved — on its way back', received: 'Received', refunded: 'Refunded', exchanged: 'Exchanged', declined: 'Declined', cancelled: 'Cancelled' }
const REASONS = [['changed_mind', 'Changed my mind'], ['defective', 'Damaged or defective'], ['wrong_item', 'Wrong item sent'], ['not_as_described', 'Not as described'], ['other', 'Something else']] as const
const dollarsToCents = (v: string) => Math.round(Number(v.replace(/[^0-9.]/g, '')) * 100) || 0
const dollars = (c: number) => (c / 100).toFixed(2)

function Card({ ret, onChange, onError }: { ret: Ret; onChange: () => void; onError: (m: string) => void }) {
  // Deciding a return, receiving it and sending money are orders:refund (the manager's and the owner's); the server asks it too.
  const mayDecide = useMayWrite('orders:refund')
  const [busy, setBusy] = useState(false)
  const [waive, setWaive] = useState(false)
  const [reason, setReason] = useState('')
  const [restock, setRestock] = useState(true)
  const [amount, setAmount] = useState(dollars(ret.refundCents))
  const [credit, setCredit] = useState(dollars(ret.preferCredit ? ret.refundCents : 0))
  const [way, setWay] = useState<'refund' | 'exchange'>(ret.resolution)
  const [sku, setSku] = useState('')
  const [qty, setQty] = useState('1')
  const act = async (path: string, body: object = {}) => {
    setBusy(true); onError('')
    try { await api.post(`/api/admin/store-returns/${ret.id}/${path}`, body); onChange() } catch (e) { onError(errorText(e, 'That did not work')); onChange() } finally { setBusy(false) }
  }
  const fees = ret.restockingFeeCents + ret.returnShippingFeeCents
  const final = ['refunded', 'exchanged', 'declined', 'cancelled'].includes(ret.status)
  return (
    <article className="card p-4 sm:p-5 space-y-3" aria-label={`Return ${ret.returnNumber}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{ret.returnNumber} <span className="text-sm font-normal text-gray-500 dark:text-slate-400">· order {ret.order?.orderNumber ?? '—'} · {ret.order?.customerName || ret.order?.customerEmail}</span></h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">{ret.reasonLabel}{ret.late ? ' · after the return window' : ''} · {ret.startedBy === 'staff' ? 'started by your team' : 'asked by the customer'} · wants {ret.resolution === 'exchange' ? 'an exchange' : ret.preferCredit ? 'store credit' : 'a refund'}</p>
        </div>
        <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{WORD[ret.status] ?? ret.status}</span>
      </header>
      <ul className="text-sm text-gray-700 dark:text-slate-300 list-disc pl-5">
        {ret.lines.map((l) => <li key={l.orderItemId}>{l.quantity} × {l.productName}{l.variantName && l.variantName !== 'Default' ? ` — ${l.variantName}` : ''} <span className="text-gray-500 dark:text-slate-400">({cents(l.unitPriceCents)} each)</span></li>)}
      </ul>
      {ret.note && <p className="text-sm text-gray-700 dark:text-slate-300">“{ret.note}”</p>}
      {ret.wanted && <p className="text-sm text-gray-700 dark:text-slate-300">Would like instead: {ret.wanted}</p>}
      <p className="text-sm text-gray-700 dark:text-slate-300">
        Worth {cents(ret.lineValueCents)}{fees > 0 ? `, less ${cents(fees)} you keep (${ret.restockingFeeCents ? `${cents(ret.restockingFeeCents)} restocking` : ''}${ret.restockingFeeCents && ret.returnShippingFeeCents ? ' and ' : ''}${ret.returnShippingFeeCents ? `${cents(ret.returnShippingFeeCents)} return postage` : ''})` : ''} = <strong>{cents(ret.refundCents)} back</strong>
      </p>
      {ret.declineReason && <p className="text-sm text-gray-700 dark:text-slate-300">Declined: {ret.declineReason}</p>}
      {ret.labelUrl && <p className="text-sm"><a className="underline text-orange-900 dark:text-orange-200" href={ret.labelUrl} target="_blank" rel="noreferrer">Return label</a> ({ret.labelCarrier} {ret.labelTracking})</p>}
      {ret.refund && <p className="text-sm text-gray-700 dark:text-slate-300">Money: {cents(ret.refund.amountCents - ret.refund.creditCents)} to the card{ret.refund.creditCents ? `, ${cents(ret.refund.creditCents)} as store credit` : ''} — {codeLabel(ret.refund.status)}{ret.refund.error ? ` (${ret.refund.error})` : ''}</p>}
      {ret.exchangeOrder && <p className="text-sm text-gray-700 dark:text-slate-300">Exchange sent as order {ret.exchangeOrder.orderNumber}.</p>}

      {mayDecide && ret.status === 'requested' && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-gray-700 dark:text-slate-300 flex items-center gap-2"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} /> Don’t keep the fees</label>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void act('approve', { waiveFees: waive })}>Approve</button>
          <input className="input" aria-label="Why it is declined" placeholder="Why not? (the customer is told)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="btn-secondary" disabled={busy || !reason.trim()} onClick={() => void act('decline', { reason })}>Decline</button>
        </div>
      )}
      {mayDecide && ret.status === 'approved' && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-700 dark:text-slate-300 flex items-center gap-2"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put it back in stock</label>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void act('receive', { restock })}>It has arrived</button>
          {!ret.labelUrl && <button type="button" className="btn-secondary" disabled={busy} onClick={() => void act('label')}>Buy a return label</button>}
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => void act('cancel')}>Cancel this return</button>
        </div>
      )}
      {mayDecide && ret.status === 'received' && (
        <div className="space-y-3">
          <div className="flex gap-2" role="group" aria-label="What to do">
            <button type="button" className={way === 'refund' ? 'btn-primary' : 'btn-secondary'} onClick={() => setWay('refund')}>Give the money back</button>
            <button type="button" className={way === 'exchange' ? 'btn-primary' : 'btn-secondary'} onClick={() => setWay('exchange')}>Send an exchange</button>
          </div>
          {way === 'refund' ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-gray-700 dark:text-slate-300">Refund ($)<input className="input ml-1 w-28" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label className="text-sm text-gray-700 dark:text-slate-300">…of it as store credit ($)<input className="input ml-1 w-28" inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} /></label>
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void act('refund', { amountCents: dollarsToCents(amount), creditCents: dollarsToCents(credit) })}>Refund</button>
              <p className="text-sm text-gray-500 dark:text-slate-400 w-full">The rest, {cents(Math.max(0, dollarsToCents(amount) - dollarsToCents(credit)))}, goes back to the card they paid with.</p>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-gray-700 dark:text-slate-300">Send this item (its SKU)<input className="input ml-1 w-40" value={sku} onChange={(e) => setSku(e.target.value)} /></label>
              <label className="text-sm text-gray-700 dark:text-slate-300">How many<input className="input ml-1 w-20" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
              <button type="button" className="btn-primary" disabled={busy || !sku.trim()} onClick={() => void act('exchange', { items: [{ sku: sku.trim(), quantity: Math.max(1, Number(qty) || 1) }] })}>Send exchange</button>
              <p className="text-sm text-gray-500 dark:text-slate-400 w-full">No charge. It can cost the same as the goods that came back or less; if less, the difference is refunded. It cannot cost more.</p>
            </div>
          )}
        </div>
      )}
      {final && ret.status === 'refunded' && ret.creditCents > 0 && <p className="text-sm text-gray-500 dark:text-slate-400">{cents(ret.creditCents)} was given as store credit (a gift card, emailed to the customer).</p>}
    </article>
  )
}

function RulePanel({ onError }: { onError: (m: string) => void }) {
  const mayEdit = useMayWrite('settings:update')
  const [rule, setRule] = useState<Rule | null>(null)
  const [saved, setSaved] = useState('')
  useEffect(() => { api.get('/api/admin/store-returns/settings').then((r) => setRule(r as Rule)).catch((e) => onError(errorText(e, "Couldn't load the return rule"))) }, [onError])
  if (!rule) return null
  const save = async () => {
    setSaved(''); onError('')
    try { setRule((await api.put('/api/admin/store-returns/settings', rule)) as Rule); setSaved('Saved.') } catch (e) { onError(errorText(e, "Couldn't save the return rule")) }
  }
  return (
    <details className="card p-4">
      <summary className="cursor-pointer font-semibold text-gray-900 dark:text-slate-100">Your return rule</summary>
      <fieldset disabled={!mayEdit} className="mt-3 grid gap-3 sm:grid-cols-2 border-0 p-0 m-0">
        <label className="text-sm text-gray-700 dark:text-slate-300">Days to ask for a return (from when it shipped)
          <input className="input mt-1 w-full" inputMode="numeric" value={rule.windowDays} onChange={(e) => setRule({ ...rule, windowDays: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label className="text-sm text-gray-700 dark:text-slate-300">Restocking fee (% of the goods)
          <input className="input mt-1 w-full" inputMode="decimal" value={rule.restockingFeePercent} onChange={(e) => setRule({ ...rule, restockingFeePercent: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label className="text-sm text-gray-700 dark:text-slate-300">Return postage kept ($)
          <input className="input mt-1 w-full" inputMode="decimal" value={dollars(rule.returnShippingFeeCents)} onChange={(e) => setRule({ ...rule, returnShippingFeeCents: dollarsToCents(e.target.value) })} /></label>
        <div className="space-y-2 text-sm text-gray-700 dark:text-slate-300">
          <label className="flex items-center gap-2"><input type="checkbox" checked={rule.labels} onChange={(e) => setRule({ ...rule, labels: e.target.checked })} /> Buy the customer a return label when I approve (needs Shipping set up)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={rule.shopperReturns} onChange={(e) => setRule({ ...rule, shopperReturns: e.target.checked })} /> Customers can ask for a return from their account</label>
        </div>
      </fieldset>
      <p className="mt-2 text-sm text-gray-500 dark:text-slate-400">The fees are not kept when the return is your fault (damaged, wrong item, not as described), or on an exchange, or when you choose to waive them.</p>
      <div className="mt-3 flex items-center gap-3">{mayEdit ? <button type="button" className="btn-primary" onClick={() => void save()}>Save the rule</button> : <span className="text-sm text-gray-500 dark:text-slate-400">Only the owner changes the return rule.</span>}{saved && <span role="status" className="text-sm text-gray-700 dark:text-slate-300">{saved}</span>}</div>
    </details>
  )
}

function StartPanel({ onDone, onError }: { onDone: () => void; onError: (m: string) => void }) {
  const mayStart = useMayWrite('orders:refund')
  const [number, setNumber] = useState('')
  const [orderId, setOrderId] = useState('')
  const [opts, setOpts] = useState<Options | null>(null)
  const [qty, setQty] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('changed_mind')
  const [resolution, setResolution] = useState<'refund' | 'exchange'>('refund')
  const [late, setLate] = useState(false)
  const [note, setNote] = useState('')
  const find = async () => {
    onError(''); setOpts(null); setQty({})
    try {
      const all = (await api.get('/api/admin/orders')) as { data: { id: string; orderNumber: string | null }[] }
      const hit = all.data.find((o) => (o.orderNumber ?? '').toLowerCase() === number.trim().toLowerCase())
      if (!hit) return onError(`No order ${number.trim()} was found.`)
      setOrderId(hit.id)
      setOpts((await api.get(`/api/admin/store-returns/options/${encodeURIComponent(hit.id)}`)) as Options)
    } catch (e) { onError(errorText(e, "Couldn't look up that order")) }
  }
  const start = async () => {
    onError('')
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([orderItemId, quantity]) => ({ orderItemId, quantity }))
    try {
      await api.post('/api/admin/store-returns', { orderId, items, reason, resolution, note: note || null, allowLate: late })
      setOpts(null); setNumber(''); setQty({}); setNote(''); onDone()
    } catch (e) { onError(errorText(e, "Couldn't start the return")) }
  }
  if (!mayStart) return null
  return (
    <details className="card p-4">
      <summary className="cursor-pointer font-semibold text-gray-900 dark:text-slate-100">Start a return for a customer</summary>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-sm text-gray-700 dark:text-slate-300">Order number<input className="input ml-1" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="ORD-…" /></label>
        <button type="button" className="btn-secondary" disabled={!number.trim()} onClick={() => void find()}>Find</button>
      </div>
      {opts && (
        <div className="mt-3 space-y-3">
          {opts.why && <p className="text-sm text-gray-700 dark:text-slate-300">{opts.why}</p>}
          {!opts.windowOpen && <label className="text-sm text-gray-700 dark:text-slate-300 flex items-center gap-2"><input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} /> The return window has closed — allow it anyway</label>}
          {opts.lines.map((l) => (
            <label key={l.orderItemId} className="flex items-center gap-3 text-sm text-gray-700 dark:text-slate-300">
              <input type="number" className="input w-20" min={0} max={l.left} value={qty[l.orderItemId] ?? 0} disabled={l.left === 0} onChange={(e) => setQty({ ...qty, [l.orderItemId]: Math.min(l.left, Math.max(0, Number(e.target.value) || 0)) })} />
              <span>{l.productName}{l.variantName && l.variantName !== 'Default' ? ` — ${l.variantName}` : ''} <span className="text-gray-500 dark:text-slate-400">({l.left} of {l.quantity} can still go back{l.note ? `; ${l.note}` : ''})</span></span>
            </label>
          ))}
          <div className="flex flex-wrap gap-3">
            <label className="text-sm text-gray-700 dark:text-slate-300">Why<select className="input ml-1" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="text-sm text-gray-700 dark:text-slate-300">They want<select className="input ml-1" value={resolution} onChange={(e) => setResolution(e.target.value as 'refund' | 'exchange')}><option value="refund">Their money back</option><option value="exchange">An exchange</option></select></label>
            <input className="input" aria-label="A note" placeholder="A note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" disabled={!Object.values(qty).some((q) => q > 0) || (!!opts.why) || (!opts.windowOpen && !late)} onClick={() => void start()}>Start the return</button>
        </div>
      )}
    </details>
  )
}

export default function ReturnsPage() {
  const [tab, setTab] = useState('')
  const [rows, setRows] = useState<Ret[] | null>(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const load = useCallback(() => {
    api.get('/api/admin/store-returns', tab ? { status: tab } : {})
      .then((r) => { setRows((r as { data: Ret[] }).data); setLoadError('') })
      .catch((e) => setLoadError(errorText(e, "Couldn't load the returns")))
  }, [tab])
  useEffect(() => { load() }, [load])
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Undo2 className="h-6 w-6" aria-hidden="true" />Returns</h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">Customers ask to send things back; you decide, and give the money back or send an exchange. Stock goes back on the shelf when the parcel arrives.</p>
      </div>
      <RulePanel onError={setError} />
      <StartPanel onDone={load} onError={setError} />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {TABS.map((t) => <button key={t.key} type="button" className={tab === t.key ? 'btn-primary text-sm' : 'btn-secondary text-sm'} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {error && <PageError message={error} />}
      {loadError ? <PageError message={`${loadError} — refresh to try again.`} /> : rows === null ? <p className="text-gray-500 dark:text-slate-400">Loading…</p> : rows.length === 0 ? (
        <p className="text-gray-500 dark:text-slate-400">No returns here yet.</p>
      ) : rows.map((r) => <Card key={`${r.id}-${r.status}-${r.refund?.status ?? ''}`} ret={r} onChange={load} onError={setError} />)}
    </div>
  )
}
