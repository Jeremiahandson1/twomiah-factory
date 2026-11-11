// Part of the vendor portal page (VendorPortalPage.tsx — public, by the vendor's private link). The sub's bid requests in their portal (parity tier 3, bid packages; server crm/projects/bidPackages.ts vendorBids, routes
// in crm/office/vendorPortal.ts; feature bid_packages, not ready): each package asked of them — price every item and send, or
// decline. Shown only when the portal's answer carries bidRequests (the switch on).
import { useState } from 'react'

interface Line { id: string; description: string; quantity: number; unit: string | null }
interface Req { id: string; status: string; title: string; scope: string | null; dueDate: string | null; open: boolean; lines: Line[]; prices: Array<{ lineId: string; unitPrice: number }>; total: number | null; notes: string | null }

const WORD: Record<string, string> = { invited: 'New', viewed: 'Not answered', submitted: 'Bid sent', declined: 'Declined', awarded: 'Awarded to you', lost: 'Not chosen' }

export function VendorBidRequests({ requests, call, reload, money }: { requests: Req[]; call: (path: string, init?: RequestInit) => Promise<any>; reload: () => Promise<void>; money: (v: unknown) => string }) {
  const [prices, setPrices] = useState<Record<string, Record<string, string>>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')

  const priceOf = (r: Req, l: Line) => prices[r.id]?.[l.id] ?? (() => { const p = r.prices.find((x) => x.lineId === l.id); return p ? String(p.unitPrice) : '' })()
  const totalOf = (r: Req) => r.lines.reduce((s, l) => s + (Number(priceOf(r, l)) || 0) * l.quantity, 0)
  const post = async (r: Req, path: string, body: unknown, ok: string) => {
    setBusy(r.id); setMsg({ ...msg, [r.id]: '' })
    try { await call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); setMsg({ ...msg, [r.id]: ok }); await reload() }
    catch (e) { setMsg({ ...msg, [r.id]: (e as Error).message }) } finally { setBusy('') }
  }

  return (
    <section>
      <h2 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">Bid requests</h2>
      {requests.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">Nothing yet — requests to price work show up here.</p>}
      <div className="space-y-4">
        {requests.map((r) => (
          <div key={r.id} className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-medium text-gray-900 dark:text-slate-100">{r.title}</p>
              <span className="text-xs text-gray-600 dark:text-slate-400">{WORD[r.status] || r.status}{r.dueDate ? ` · due ${r.dueDate}` : ''}</span>
            </div>
            {r.scope && <p className="mt-1 whitespace-pre-line text-sm text-gray-700 dark:text-slate-300">{r.scope}</p>}
            <table className="mt-3 w-full text-left text-sm">
              <thead><tr className="text-xs text-gray-600 dark:text-slate-400"><th className="py-1 pr-3 font-medium">Item</th><th className="py-1 pr-3 font-medium">Qty</th><th className="py-1 pr-3 font-medium">Your price each</th><th className="py-1 font-medium">Line</th></tr></thead>
              <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                {r.lines.map((l) => (
                  <tr key={l.id} className="text-gray-900 dark:text-slate-100">
                    <td className="py-1 pr-3">{l.description}</td>
                    <td className="py-1 pr-3">{l.quantity}{l.unit ? ` ${l.unit}` : ''}</td>
                    <td className="py-1 pr-3">{r.open && r.status !== 'declined'
                      ? <input aria-label={`Your price each for ${l.description}`} inputMode="decimal" className="w-28 rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={priceOf(r, l)} onChange={(e) => setPrices({ ...prices, [r.id]: { ...(prices[r.id] || {}), [l.id]: e.target.value } })} />
                      : (priceOf(r, l) ? money(priceOf(r, l)) : '—')}</td>
                    <td className="py-1">{priceOf(r, l) ? money((Number(priceOf(r, l)) || 0) * l.quantity) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm font-semibold text-gray-900 dark:text-slate-100">Total {money(totalOf(r))}</p>
            {r.open && r.status !== 'declined' && (
              <div className="mt-2 space-y-2">
                <textarea aria-label="Notes with your bid" rows={2} placeholder="Notes (what's included, start date…)" className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" value={notes[r.id] ?? r.notes ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <div className="flex gap-3">
                  <button type="button" disabled={busy === r.id} className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60 dark:hover:bg-teal-600"
                    onClick={() => post(r, `/bids/${r.id}`, { prices: r.lines.map((l) => ({ lineId: l.id, unitPrice: Number(priceOf(r, l)) })), notes: notes[r.id] ?? r.notes ?? null }, 'Your bid was sent.')}>{r.status === 'submitted' ? 'Update my bid' : 'Send my bid'}</button>
                  <button type="button" disabled={busy === r.id} className="text-sm text-gray-700 hover:underline dark:text-slate-300" onClick={() => post(r, `/bids/${r.id}/decline`, {}, 'Declined.')}>Decline</button>
                </div>
              </div>
            )}
            {msg[r.id] && <p role="status" className="mt-2 text-sm text-gray-700 dark:text-slate-300">{msg[r.id]}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}
