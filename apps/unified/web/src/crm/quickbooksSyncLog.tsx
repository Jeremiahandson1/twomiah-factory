// QuickBooks' sync log, inside the connected card on Settings › Integrations (server crm/office/quickbooksAutoSync.ts,
// /api/qb-sync): every sync — automatic every 15 minutes with the switch on, or Sync Now — with what went across, and
// each record QuickBooks refused, in QuickBooks' own words, with when it will be tried again and a Retry.
import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react'
import { api } from '../api'
import { useMayWrite, useToast } from '../shared'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'

interface Run { id: string; trigger: 'auto' | 'manual'; status: 'running' | 'ok' | 'partial' | 'failed'; customers: number; invoices: number; payments: number; failed: number; error: string | null; startedAt: string }
interface Failure { id: string; entity: 'customer' | 'invoice' | 'payment'; label: string | null; attempts: number; lastError: string | null; nextAttemptAt: string | null; gaveUp: boolean }
interface Log { connected: boolean; autoSync: boolean; everyMinutes: number; runs: Run[]; failures: Failure[] }

const when = (v: string) => whenDateTime(v, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const ENTITY: Record<Failure['entity'], string> = { customer: 'Customer', invoice: 'Invoice', payment: 'Payment' }
const sentWords = (r: Run) => {
  const parts = [[r.customers, 'customer'], [r.invoices, 'invoice'], [r.payments, 'payment']].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`)
  return parts.length ? `sent ${parts.join(', ')}` : 'nothing new to send'
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
