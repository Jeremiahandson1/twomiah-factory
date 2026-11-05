// The permit board (roofing parity, row 11; GET /api/permits across jobs, behind the not-ready feature roof_permits): every permit of
// every job this seat can see, in a column for each status — needed, applied for, issued, finaled, rejected — with the job, its
// address, the issuing office and, for a seat that reads cost, the fee. Opening a card goes to its job, where the permit is changed
// (./JobPermits). Narrow to one status, or to the issued permits that have run past their expiry day.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../../../api'
import { usePermissions } from '../../../../shared'
import { moneyCents } from '@twomiah/tenant-ui/src/money'
import { PERMIT_STATUSES, PERMIT_STATUS_HINTS, PERMIT_STATUS_WORDS } from './permitModel'
import type { JobPermitRow, PermitStatus } from './permitModel'
import { day, permitDays } from './JobPermits'

export default function PermitsPage() {
  const { known, can } = usePermissions()
  const [rows, setRows] = useState<JobPermitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [only, setOnly] = useState<'' | PermitStatus | 'expired'>('')

  useEffect(() => {
    if (!known) return
    if (!can('jobs:read')) { setLoading(false); return }
    ;(api.get('/api/permits') as Promise<{ data: JobPermitRow[] }>).then((r) => setRows(r.data ?? [])).catch(() => setFailed(true)).finally(() => setLoading(false))
  }, [known, can])

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>
  if (!can('jobs:read')) return <div className="p-6 text-sm text-gray-600">Permits are for people who can see jobs. Ask the owner for access.</div>
  if (failed) return <div className="p-6 text-sm text-red-600">The permits could not be loaded. Try again.</div>
  const shown = rows.filter((r) => (only === 'expired' ? r.expired : only ? r.status === only : true))
  const expired = rows.filter((r) => r.expired).length
  return (
    <div className="p-6 space-y-4" data-testid="permit-board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Permits</h1>
        <select aria-label="Show permits" value={only} onChange={(e) => setOnly(e.target.value as typeof only)} className="text-sm border rounded-lg px-2 py-1.5">
          <option value="">All permits ({rows.length})</option>
          {PERMIT_STATUSES.map((s) => <option key={s} value={s}>{PERMIT_STATUS_WORDS[s]} ({rows.filter((r) => r.status === s).length})</option>)}
          <option value="expired">Expired ({expired})</option>
        </select>
      </div>
      {!rows.length && <p className="text-sm text-gray-500 dark:text-slate-400">No permits yet. Add one from a job’s page and it shows here.</p>}
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {PERMIT_STATUSES.map((s) => {
          const list = shown.filter((r) => r.status === s)
          return (
            <section key={s} data-testid={`column-${s}`} className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{PERMIT_STATUS_WORDS[s]} ({list.length})</h2>
              <p className="text-xs text-gray-400 dark:text-slate-500 mb-2">{PERMIT_STATUS_HINTS[s]}</p>
              <ul className="space-y-2">
                {list.map((p) => (
                  <li key={p.id} className="border rounded-lg p-3 text-sm bg-white dark:bg-slate-900">
                    <Link to={`/crm/jobs/${p.jobId}`} className="font-medium text-orange-700 dark:text-orange-300 break-words">{p.address || p.jobNumber}</Link>
                    <p className="text-xs text-gray-700 dark:text-slate-200">{p.permitType || 'Permit'}{p.permitNumber ? ` · ${p.permitNumber}` : ''}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{[p.jurisdiction, p.homeowner].filter(Boolean).join(' · ')}</p>
                    {!p.moneyWithheld && p.feeCents != null && <p className="text-xs text-gray-700 dark:text-slate-200">Fee {moneyCents(p.feeCents)}{p.feePaidOn ? `, paid ${day(p.feePaidOn)}` : ', not paid yet'}</p>}
                    <p className="text-xs text-gray-500 dark:text-slate-400">{permitDays(p)}</p>
                    {p.expired && <p className="mt-1"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Expired</span></p>}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
