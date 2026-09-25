// Square — card payments only. The menu, the orders and the prices live here;
// Square charges the card. This card shows whether Square is connected, checks
// the connection, connects the payments/refunds webhook, and lists recent web
// orders. Credentials are set on the Render service, never here.
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { Hint } from './Field'

interface SquareStatus {
  configured: boolean; environment: 'sandbox' | 'production' | null; locationId: string | null; hasApplicationId: boolean
  orderingSwitch: boolean; orderingEnabled: boolean
  webhookUrl: string | null; webhookConnected: boolean; lastWebhookAt: string | null
  recentOrders: Array<{ id: string; status: string; customerName: string; totalCents: number | null; createdAt: string; error: string | null }>
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never')
const money = (c: number | null) => (c === null ? '' : '$' + (c / 100).toFixed(2))

function Step({ done, label, children }: { done: boolean; label: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 py-2">
      <span aria-hidden className={'mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-xs ' + (done ? 'bg-emerald-600 text-white' : 'border border-line text-muted')}>{done ? '✓' : ''}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">{label}<span className="sr-only">{done ? ' (done)' : ' (not done)'}</span></div>
        {children}
      </div>
    </li>
  )
}

export function SquareCard() {
  const [s, setS] = useState<SquareStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => api.get<SquareStatus>('/api/admin/square').then(setS).catch((e) => setNote({ ok: false, text: e.message }))
  useEffect(() => { load() }, [])

  const run = async (key: string, path: string, done: (r: any) => string) => {
    setBusy(key); setNote(null)
    try { const r = await api.post<any>(path); setNote({ ok: true, text: done(r) }) } catch (e: any) { setNote({ ok: false, text: e.message }) } finally { setBusy(null); load() }
  }

  if (!s) return <section className="card card-padding mb-6"><h2 className="text-lg text-ink">Square</h2><p className="text-sm text-muted">Loading…</p></section>

  return (
    <section className="card card-padding mb-6">
      <h2 className="text-lg text-ink mb-1">Square (card payments)</h2>
      <p className="text-muted text-sm mb-4">
        Square charges the cards. The menu, prices, orders and sales tax all live in this system.
        {s.environment && <> Connected to Square <strong>{s.environment === 'production' ? 'production (real money)' : 'sandbox (test cards only)'}</strong>.</>}
      </p>
      {note && <div className={'text-sm rounded-lg px-3 py-2 mb-4 border ' + (note.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')} role="status">{note.text}</div>}

      <ol className="divide-y divide-line border border-line rounded-lg px-3 mb-4">
        <Step done={s.configured && s.hasApplicationId} label="1. Credentials on the Render service">
          {!s.configured && <Hint>Set SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_APPLICATION_ID and SQUARE_ENVIRONMENT in Render → amber-inn-site → Environment.</Hint>}
          {s.configured && <div className="mt-1 flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted">Location {s.locationId}{s.hasApplicationId ? '' : ' · no application id yet (needed for the card form)'}</span>
            <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => run('check', '/api/admin/square/check', (r) => `Connected: ${r.location.name}${r.location.address ? ', ' + r.location.address : ''} (${r.location.status}).`)}>{busy === 'check' ? 'Checking…' : 'Check connection'}</button>
          </div>}
        </Step>
        <Step done={s.webhookConnected} label="2. Webhooks (refunds made in Square show up here)">
          <Hint>{s.webhookConnected ? `Square calls ${s.webhookUrl}. Last call: ${when(s.lastWebhookAt)}.` : 'Needs the site on its final https address. Run it again after moving to the custom domain.'}</Hint>
          <div className="mt-1"><button type="button" className="btn-secondary btn-sm" disabled={!s.configured || !!busy} onClick={() => run('hooks', '/api/admin/square/webhooks', (r) => `Webhooks connected at ${r.url}.`)}>{busy === 'hooks' ? 'Connecting…' : s.webhookConnected ? 'Reconnect webhooks' : 'Connect webhooks'}</button></div>
        </Step>
        <Step done={s.orderingEnabled} label="3. Online pickup ordering">
          <Hint>{s.orderingEnabled ? 'Live at /order. Pause it any night from the bar console.' : s.orderingSwitch ? 'ONLINE_ORDERING is on but Square is not fully configured (credentials + application id).' : 'Off. Set ONLINE_ORDERING=on on the Render service after a test order goes through in sandbox.'}</Hint>
        </Step>
      </ol>

      {s.recentOrders.length > 0 && (
        <>
          <h3 className="text-sm font-semibold text-ink mb-2">Recent online orders</h3>
          <ul className="divide-y divide-line border border-line rounded-lg text-sm">
            {s.recentOrders.map((o) => (
              <li key={o.id} className="flex justify-between gap-3 px-3 py-2">
                <span>{o.customerName} · <span className="text-muted">{new Date(o.createdAt).toLocaleString()}</span>{o.error && o.status === 'failed' ? <span className="text-red-700"> · {o.error}</span> : null}</span>
                <span className="whitespace-nowrap">{money(o.totalCents)} · {o.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
