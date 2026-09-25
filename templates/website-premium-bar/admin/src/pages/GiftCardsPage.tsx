// Gift cards — every card the bar has sold, what's still owed on them, and
// each card's history (sold, spent, refunded, adjusted). Void or adjust with
// a reason; both are logged. Cards never expire and carry no fees.
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../api/client'
import { Label, Hint } from '../components/Field'

interface Card {
  id: string; code: string; initialCents: number; balanceCents: number; status: string; soldVia: string; soldBy: string | null
  purchaserName: string | null; purchaserEmail: string | null; recipientName: string | null; recipientEmail: string | null; message: string | null
  createdAt: string; voidedAt: string | null; voidReason: string | null
}
interface Entry { id: string; amountCents: number; kind: string; by: string | null; note: string | null; at: string; check: { number: number; label: string } | null }
interface ListResp { cards: Card[]; totals: { count: number; owedCents: number; soldCents: number } }

const money = (c: number) => (c < 0 ? '−' : '') + '$' + (Math.abs(c) / 100).toFixed(2)
const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const KIND: Record<string, string> = { issue: 'Sold', redeem: 'Spent', refund: 'Put back (payment voided)', adjust: 'Adjusted', void: 'Voided' }
const STATUSES = [['active', 'Active'], ['void', 'Voided'], ['all', 'All']] as const

function CardPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<{ card: Card; history: Entry[] } | null>(null)
  const [adj, setAdj] = useState({ dollars: '', reason: '' })
  const [voidWhy, setVoidWhy] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const load = () => api.get<{ card: Card; history: Entry[] }>(`/api/admin/giftcards/${id}`).then(setD).catch((e) => setMsg({ ok: false, text: e.message }))
  useEffect(() => { setMsg(null); load() }, [id])
  if (!d) return <aside className="card card-padding">Loading…</aside>
  const c = d.card
  const adjust = async () => {
    setMsg(null)
    const cents = Math.round(Number(adj.dollars.replace(/[^\d.-]/g, '')) * 100)
    try { await api.post(`/api/admin/giftcards/${id}/adjust`, { cents, reason: adj.reason }); setAdj({ dollars: '', reason: '' }); setMsg({ ok: true, text: 'Balance adjusted.' }); load(); onChanged() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const doVoid = async () => {
    setMsg(null)
    try { await api.post(`/api/admin/giftcards/${id}/void`, { reason: voidWhy }); setVoidWhy(''); setMsg({ ok: true, text: 'Card voided. It can no longer be used.' }); load(); onChanged() } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  return (
    <aside className="card card-padding" aria-labelledby="gc-code">
      <div className="flex justify-between items-start gap-3 mb-3">
        <div>
          <h2 id="gc-code" className="text-xl text-ink font-mono">{c.code}</h2>
          <p className="text-sm text-muted">{money(c.balanceCents)} left of {money(c.initialCents)} · {c.status === 'void' ? 'voided' : 'active'}</p>
          <p className="text-xs text-muted">Sold {date(c.createdAt)} {c.soldVia === 'online' ? 'on the website' : `at the bar${c.soldBy ? ' by ' + c.soldBy : ''}`}</p>
        </div>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm inline-flex items-center gap-1" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      {msg && <div className={'text-sm rounded-lg px-3 py-2 mb-3 border ' + (msg.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')} role="status">{msg.text}</div>}
      {(c.purchaserName || c.recipientName) && (
        <p className="text-sm text-ink mb-3">
          {c.purchaserName && <>From {c.purchaserName}{c.purchaserEmail ? ` (${c.purchaserEmail})` : ''}. </>}
          {c.recipientName && <>For {c.recipientName}{c.recipientEmail ? ` (${c.recipientEmail})` : ''}.</>}
          {c.message && <span className="block text-muted italic mt-1">"{c.message}"</span>}
        </p>
      )}
      {c.voidReason && <p className="text-sm text-red-700 mb-3">Voided: {c.voidReason}</p>}

      <h3 className="text-sm font-semibold text-ink mt-4 mb-2">History</h3>
      <ul className="divide-y divide-line text-sm">
        {d.history.map((h) => (
          <li key={h.id} className="py-2 flex justify-between gap-3">
            <span>
              <span className="text-ink">{KIND[h.kind] || h.kind}</span>
              {h.check && <span className="text-muted"> · check #{h.check.number} {h.check.label}</span>}
              {h.note && <span className="block text-xs text-muted">{h.note}</span>}
              <span className="block text-xs text-muted">{when(h.at)}{h.by ? ' · ' + h.by : ''}</span>
            </span>
            <span className={'tabular-nums whitespace-nowrap ' + (h.amountCents < 0 ? 'text-ink-soft' : 'text-ink')}>{h.amountCents > 0 ? '+' : ''}{money(h.amountCents)}</span>
          </li>
        ))}
      </ul>

      {c.status === 'active' && (
        <>
          <h3 className="text-sm font-semibold text-ink mt-5 mb-2">Adjust the balance</h3>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <div><Label htmlFor="gc-adj">Amount ($)</Label><input id="gc-adj" className="input" inputMode="decimal" placeholder="-5.00" value={adj.dollars} onChange={(e) => setAdj({ ...adj, dollars: e.target.value })} /></div>
            <div><Label htmlFor="gc-adj-why">Why</Label><input id="gc-adj-why" className="input" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></div>
          </div>
          <Hint>A plus number adds to the card, a minus number takes off.</Hint>
          <button type="button" className="btn-secondary btn-md inline-flex items-center mt-2" onClick={adjust}>Adjust</button>

          <h3 className="text-sm font-semibold text-ink mt-5 mb-2">Void the card</h3>
          <div className="flex gap-3 items-end">
            <div className="flex-1"><Label htmlFor="gc-void-why">Why</Label><input id="gc-void-why" className="input" placeholder="Reported stolen" value={voidWhy} onChange={(e) => setVoidWhy(e.target.value)} /></div>
            <button type="button" className="btn-secondary btn-md inline-flex items-center text-red-700" onClick={doVoid}>Void</button>
          </div>
          <Hint>Zeroes the balance so the number stops working. If someone lost their card, void it and sell them a new one for what was left.</Hint>
        </>
      )}
    </aside>
  )
}

export function GiftCardsPage() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('active')
  const [data, setData] = useState<ListResp | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () => api.get<ListResp>(`/api/admin/giftcards?status=${status}&q=${encodeURIComponent(q)}`).then(setData).catch((e) => setError(e.message))
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [q, status])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl text-ink">Gift cards</h1>
        <p className="text-muted text-sm mt-1">
          {data ? `${money(data.totals.owedCents)} still owed on ${data.totals.count} card${data.totals.count === 1 ? '' : 's'}. ${money(data.totals.soldCents)} sold in all.` : 'Loading…'}
        </p>
        <p className="text-muted text-xs mt-1">What's still owed is money the bar has taken but not yet earned. Ask the accountant how to carry it; Wisconsin's rules on unused gift card balances are theirs to call.</p>
      </div>
      {error && <p className="text-red-700 text-sm mb-3">{error}</p>}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <label className="sr-only" htmlFor="gc-search">Search gift cards</label>
        <input id="gc-search" className="input max-w-xs" placeholder="Card number, or a name or email" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-2" role="group" aria-label="Show">
          {STATUSES.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)} className={'px-3 py-1.5 rounded-full text-sm border ' + (status === k ? 'bg-ink text-white border-ink' : 'border-line text-ink-soft hover:bg-paper')}>{label}</button>
          ))}
        </div>
      </div>
      <div className={open ? 'grid lg:grid-cols-[1fr_420px] gap-4 items-start' : ''}>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b border-line"><th className="p-3">Card</th><th className="p-3">For</th><th className="p-3 text-right">Left</th><th className="p-3 text-right">Sold for</th><th className="p-3">Sold</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data?.cards.map((c) => (
                <tr key={c.id} className={'hover:bg-paper cursor-pointer ' + (open === c.id ? 'bg-paper' : '')} onClick={() => setOpen(c.id)}>
                  <td className="p-3"><button type="button" className="font-mono text-ink underline-offset-2 hover:underline text-left" onClick={(e) => { e.stopPropagation(); setOpen(c.id) }}>{c.code}</button>{c.status === 'void' && <span className="ml-2 text-xs text-red-700">void</span>}</td>
                  <td className="p-3 text-ink-soft">{c.recipientName || c.purchaserName || '—'}</td>
                  <td className="p-3 text-right tabular-nums">{money(c.balanceCents)}</td>
                  <td className="p-3 text-right tabular-nums text-muted">{money(c.initialCents)}</td>
                  <td className="p-3 text-muted">{date(c.createdAt)} · {c.soldVia === 'online' ? 'website' : 'bar'}</td>
                </tr>
              ))}
              {data && data.cards.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-muted">{q ? 'No card matches that.' : 'No gift cards yet. Sell one from the register, or turn on online sales.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {open && <CardPanel id={open} onClose={() => setOpen(null)} onChanged={load} />}
      </div>
    </div>
  )
}
