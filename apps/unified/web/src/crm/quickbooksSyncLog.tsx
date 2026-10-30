// QuickBooks' sync log, inside the connected card on Settings › Integrations (server crm/office/quickbooksAutoSync.ts,
// /api/qb-sync): every sync — automatic every 15 minutes with the switch on, or Sync Now — with what went across, and
// each record QuickBooks refused, in QuickBooks' own words, with when it will be tried again and a Retry.
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { api } from '../api'
import { useMayWrite, useToast } from '../shared'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'

interface Run { id: string; trigger: 'auto' | 'manual'; status: 'running' | 'ok' | 'partial' | 'failed'; customers: number; invoices: number; payments: number; orders?: number; refunds?: number; payouts?: number; failed: number; error: string | null; startedAt: string }
interface Failure { id: string; entity: 'customer' | 'invoice' | 'payment' | 'order' | 'refund' | 'payout'; label: string | null; attempts: number; lastError: string | null; nextAttemptAt: string | null; gaveUp: boolean }
interface Log { connected: boolean; autoSync: boolean; everyMinutes: number; runs: Run[]; failures: Failure[] }

const when = (v: string) => whenDateTime(v, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const ENTITY: Record<Failure['entity'], string> = { customer: 'Customer', invoice: 'Invoice', payment: 'Payment', order: 'Order', refund: 'Refund', payout: 'Payout' }
const sentWords = (r: Run) => {
  const parts = [[r.customers, 'customer'], [r.invoices, 'invoice'], [r.payments, 'payment'], [r.orders ?? 0, 'order'], [r.refunds ?? 0, 'refund'], [r.payouts ?? 0, 'payout']].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`)
  return parts.length ? `sent ${parts.join(', ')}` : 'nothing new to send'
}

interface Books { bankAccount: { id: string; name: string | null } | null; payouts: Array<{ id: string; amountCents: number; feeCents: number; arrivedAt: string; booked: boolean }> }
const money = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

/** A store's: which bank account Stripe's payouts are deposited to in QuickBooks, and the last payouts it booked. */
function StorePayouts() {
  const toast = useToast()
  const mayChoose = useMayWrite('settings:update')
  const [books, setBooks] = useState<Books | null>(null)
  const [banks, setBanks] = useState<Array<{ id: string; name: string }> | null>(null)
  useEffect(() => { api.get('/api/admin/store-books').then(setBooks).catch(() => setBooks(null)) }, [])
  if (!books) return null
  const loadBanks = () => api.get('/api/admin/store-books/bank-accounts').then((r: { accounts: Array<{ id: string; name: string }> }) => setBanks(r.accounts)).catch((e: Error) => toast.error(e.message || 'Could not read your QuickBooks accounts'))
  const choose = async (id: string) => {
    try { const r = await api.put('/api/admin/store-books', { bankAccountId: id }); setBooks((b) => (b ? { ...b, bankAccount: r.bankAccount } : b)); toast.success('Saved') } catch (e) { toast.error((e as Error).message || 'Not saved') }
  }
  return (
    <div data-testid="qb-store-payouts">
      <p className="font-medium text-gray-800 dark:text-slate-200">Stripe payouts</p>
      <p className="text-gray-600 dark:text-slate-300">Each payout from Stripe goes into QuickBooks as one deposit — your sales, less Stripe’s fees — so it matches the line on your bank statement.</p>
      <p className="mt-1 text-gray-700 dark:text-slate-200">Deposited to: {books.bankAccount?.name || (books.bankAccount ? 'your chosen account' : 'your only bank account in QuickBooks, unless you choose one')}</p>
      {mayChoose && (
        <div className="mt-1">
          {banks ? (
            <select aria-label="Bank account for Stripe payouts" className="rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800" value={books.bankAccount?.id ?? ''} onChange={(e) => e.target.value && choose(e.target.value)}>
              <option value="">Choose a bank account…</option>
              {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : <button type="button" onClick={loadBanks} className="text-xs font-medium underline">Choose the bank account</button>}
        </div>
      )}
      {books.payouts.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-gray-700 dark:text-slate-200">
          {books.payouts.slice(0, 5).map((p) => <li key={p.id}>{whenDateTime(p.arrivedAt, { month: 'short', day: 'numeric' })} · {money(p.amountCents)} paid out · {money(p.feeCents)} in fees · {p.booked ? 'in QuickBooks' : 'waiting'}</li>)}
        </ul>
      )}
    </div>
  )
}

export function QuickBooksSyncLog() {
  const toast = useToast()
  // Retry asks settings:update, the /api/qb-sync routes' own line (server crm/office/quickbooksSyncRoutes.ts).
  const mayRetry = useMayWrite('settings:update')
  const [log, setLog] = useState<Log | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = () => api.get('/api/qb-sync/log').then(setLog).catch(() => setLog(null))
  useEffect(() => { load() }, [])
  if (!log) return null

  const retry = async (f: Failure) => {
    setBusy(f.id)
    try {
      const r: { log: Log; run: Run } = await api.post(`/api/qb-sync/failures/${f.id}/retry`)
      setLog(r.log)
      toast.success(r.log.failures.some((x) => x.id === f.id) ? 'QuickBooks refused it again — see why below' : 'Sent to QuickBooks')
    } catch (e) { toast.error((e as Error).message || 'The retry did not run') } finally { setBusy(null) }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-gray-200 pt-3 dark:border-slate-700" data-testid="qb-sync-log">
      <p className="text-gray-600 dark:text-slate-300">
        {log.autoSync
          ? `Auto-sync is on: every ${log.everyMinutes} minutes, new and changed customers, invoices and payments go to QuickBooks. Drafts are never sent.`
          : 'Auto-sync is off: nothing goes to QuickBooks until you press Sync Now.'}
      </p>
      {log.failures.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40" role="status">
          <p className="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-100"><AlertTriangle className="h-4 w-4" aria-hidden="true" />QuickBooks refused {log.failures.length === 1 ? 'one record' : `${log.failures.length} records`}</p>
          <ul className="mt-2 space-y-2">
            {log.failures.map((f) => (
              <li key={f.id} className="text-amber-950 dark:text-amber-50">
                <span className="font-medium">{ENTITY[f.entity]} {f.label || ''}</span>: {f.lastError || 'no reason given'}
                <span className="block text-xs text-amber-900 dark:text-amber-200">
                  {f.gaveUp ? `Tried ${f.attempts} times — fix it, then press Retry.` : `Tried ${f.attempts} time${f.attempts === 1 ? '' : 's'}; tried again ${f.nextAttemptAt ? `after ${when(f.nextAttemptAt)}` : 'on the next sync'}.`}
                </span>
                {mayRetry && (
                  <button type="button" onClick={() => retry(f)} disabled={busy === f.id} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-amber-900 underline dark:text-amber-100">
                    {busy === f.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}Retry now
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <StorePayouts />
      <div>
        <p className="font-medium text-gray-800 dark:text-slate-200">Recent syncs</p>
        {log.runs.length === 0 ? <p className="text-gray-600 dark:text-slate-300">None yet.</p> : (
          <ul className="mt-1 space-y-1">
            {log.runs.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-start gap-1.5 text-gray-700 dark:text-slate-200">
                {r.status === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />}
                <span>{when(r.startedAt)} · {r.trigger === 'auto' ? 'automatic' : 'Sync Now'} · {r.status === 'failed' ? (r.error || 'stopped') : r.status === 'running' ? 'running…' : `${sentWords(r)}${r.failed ? `, ${r.failed} refused` : ''}`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
