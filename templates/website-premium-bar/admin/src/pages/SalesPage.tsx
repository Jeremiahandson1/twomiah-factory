// Sales — the owner's view of any night from a laptop: the same numbers as the
// bar's close-out (checks totalled as they closed), the cash count if the
// night was closed, and the last 14 nights at a glance.
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import { api } from '../api/client'

interface Summary {
  day: string; checksPaid: number; checksVoided: number; subtotalCents: number; taxCents: number; totalCents: number; tipsCents: number; averageCheckCents: number
  byTender: Array<{ tender: string; label: string; count: number; amountCents: number; tipsCents: number }>
  byChannel: Array<{ channel: string; count: number; totalCents: number }>
  tipsByStaff: Array<{ who: string; count: number; tipsCents: number; cashTipsCents: number; cardTipsCents: number }>
  items: Array<{ name: string; qty: number; salesCents: number }>
  byHour: Array<{ hour: number; label: string; totalCents: number; checks: number }>
  voids: Array<{ kind: string; what: string; amountCents: number; reason: string; by: string | null; checkNumber: number }>
  cash: { salesCents: number; tipsCents: number; inCents: number }
  giftCardsSold?: { count: number; cents: number }
}
interface Close { id: string; closedAt: string; closedBy: string | null; cashExpectedCents: number; cashCountedCents: number | null; overShortCents: number | null; note: string | null; emailedAt: string | null }
interface SalesResp { day: string; today: string; summary: Summary; open: Array<{ id: string; number: number; label: string; balanceCents: number }>; closes: Close[]; trend: Array<{ day: string; totalCents: number; checks: number; tipsCents: number }> }

const money = (c: number) => (c < 0 ? '−' : '') + '$' + Math.floor(Math.abs(c) / 100).toLocaleString('en-US') + '.' + String(Math.abs(c) % 100).padStart(2, '0')
const shift = (day: string, n: number) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const nice = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const short = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })

function Table({ title, rows, empty }: { title: string; rows: Array<[string, string, string?]>; empty: string }) {
  return (
    <section className="card card-padding">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {rows.map(([a, b, cc], i) => (
              <tr key={i}><td className="py-1.5 pr-3 text-ink">{a}{cc && <div className="text-xs text-muted">{cc}</div>}</td><td className="py-1.5 text-right tabular-nums whitespace-nowrap">{b}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export function SalesPage() {
  const [day, setDay] = useState<string | null>(null)
  const [data, setData] = useState<SalesResp | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    api.get<SalesResp>('/api/admin/sales' + (day ? '?day=' + day : '')).then((d) => { setData(d); if (!day) setDay(d.day) }).catch((e) => setError(e.message))
  }, [day])

  if (error) return <div className="p-8"><p className="text-red-700">{error}</p></div>
  if (!data) return <div className="p-8 text-muted">Loading…</div>
  const s = data.summary
  const maxTrend = Math.max(1, ...data.trend.map((t) => t.totalCents))
  const maxHour = Math.max(1, ...s.byHour.map((h) => h.totalCents))
  const close = data.closes[0]

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl text-ink">Sales</h1>
          <p className="text-muted text-sm mt-1">{nice(data.day)} · 6 AM to 6 AM · totals as each check closed</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary btn-sm inline-flex items-center gap-1" onClick={() => setDay(shift(data.day, -1))}><ChevronLeft className="w-4 h-4" />Previous</button>
          <input type="date" aria-label="Pick a night" className="input" value={data.day} max={data.today} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <button type="button" className="btn-secondary btn-sm inline-flex items-center gap-1" disabled={data.day >= data.today} onClick={() => setDay(shift(data.day, 1))}>Next<ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {data.day === data.today && data.open.length > 0 && (
        <div className="mb-6 flex gap-2 items-start text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-none" />
          <span>{data.open.length} check{data.open.length === 1 ? ' is' : 's are'} still open: {data.open.map((o) => `#${o.number} ${o.label} (${money(o.balanceCents)})`).join(', ')}.</span>
        </div>
      )}

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[['Total', money(s.totalCents)], ['Checks', String(s.checksPaid)], ['Average check', money(s.averageCheckCents)], ['Tips', money(s.tipsCents)]].map(([k, v]) => (
          <div key={k} className="card card-padding"><dt className="text-xs uppercase tracking-wide text-muted">{k}</dt><dd className="text-2xl text-ink tabular-nums mt-1">{v}</dd></div>
        ))}
      </dl>

      <section className="card card-padding mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">Last 14 nights</h2>
        <div className="flex items-end gap-1.5 h-40" role="list" aria-label="Sales by night">
          {data.trend.map((t) => (
            <button key={t.day} type="button" role="listitem" onClick={() => setDay(t.day)} title={`${short(t.day)}: ${money(t.totalCents)}, ${t.checks} checks`}
              aria-label={`${short(t.day)}: ${money(t.totalCents)}`}
              className={'flex-1 flex flex-col items-center justify-end h-full group'}>
              <span className={'w-full rounded-t ' + (t.day === data.day ? 'bg-amber-600' : 'bg-amber-300 group-hover:bg-amber-400')} style={{ height: `${Math.max(2, Math.round((t.totalCents / maxTrend) * 100))}%` }} />
              <span className="text-[10px] text-muted mt-1 whitespace-nowrap">{short(t.day).replace(/,.*/, '')}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <Table title="Sales" empty="No sales." rows={[
          ['Food & drink', money(s.subtotalCents)], ['Sales tax', money(s.taxCents)],
          ...(s.giftCardsSold?.count ? [[`Gift cards sold (${s.giftCardsSold.count})`, money(s.giftCardsSold.cents), 'Owed back later; not a sale'] as [string, string, string]] : []),
          ['Total', money(s.totalCents)],
          ...s.byChannel.map((c) => [`${c.channel} (${c.count})`, money(c.totalCents)] as [string, string]),
        ]} />
        <Table title="By payment" empty="No payments." rows={s.byTender.map((t) => [`${t.label} (${t.count})`, money(t.amountCents) + (t.tipsCents ? ' + ' + money(t.tipsCents) : '')])} />
        <Table title="Tips by person" empty="No tips." rows={s.tipsByStaff.map((t) => [t.who, money(t.tipsCents), `${money(t.cashTipsCents)} cash · ${money(t.cardTipsCents)} card`])} />
        <Table title="What sold" empty="Nothing yet." rows={s.items.slice(0, 20).map((i) => [`${i.qty} × ${i.name}`, money(i.salesCents)])} />
        <section className="card card-padding">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">By hour</h2>
          {s.byHour.length === 0 ? <p className="text-sm text-muted">No sales yet.</p> : s.byHour.map((h) => (
            <div key={h.hour} className="grid grid-cols-[52px_1fr_80px] gap-2 items-center text-sm py-0.5">
              <span className="text-muted">{h.label}</span>
              <span className="h-3 bg-line rounded overflow-hidden"><span className="block h-full bg-amber-500" style={{ width: `${Math.round((h.totalCents / maxHour) * 100)}%` }} /></span>
              <span className="text-right tabular-nums">{money(h.totalCents)}</span>
            </div>
          ))}
        </section>
        <Table title={`Voids (${s.voids.length})`} empty="None." rows={s.voids.map((v) => [`#${v.checkNumber} ${v.what}`, v.amountCents ? money(v.amountCents) : '', `${v.reason}${v.by ? ' · ' + v.by : ''}`])} />
      </div>

      <section className="card card-padding">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">Cash drawer</h2>
        <p className="text-sm text-ink">Cash sales {money(s.cash.salesCents)} + cash tips {money(s.cash.tipsCents)} = {money(s.cash.inCents)} came in.</p>
        {close ? (
          <p className="text-sm text-ink mt-2">
            Closed {new Date(close.closedAt).toLocaleString()} by {close.closedBy}. Should have {money(close.cashExpectedCents)}, counted {close.cashCountedCents === null ? '—' : money(close.cashCountedCents)}
            {' '}(<strong className={close.overShortCents && close.overShortCents < 0 ? 'text-red-700' : 'text-emerald-700'}>{close.overShortCents === null ? 'not counted' : close.overShortCents === 0 ? 'even' : (close.overShortCents > 0 ? 'over ' : 'short ') + money(Math.abs(close.overShortCents))}</strong>).
            {close.note ? ` "${close.note}"` : ''}
          </p>
        ) : <p className="text-sm text-muted mt-2">Not closed out yet. The bar closes the night from the register's Close out screen.</p>}
      </section>
    </div>
  )
}
