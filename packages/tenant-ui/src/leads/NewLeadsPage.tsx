// NEW LEADS — the one list the dashboard's "New leads" tile opens: exactly the rows it counts (GET /api/dashboard/new-leads,
// tenant-backend reporting/newLeads.ts — the same conditions build the count and this list), the way Jobber opens its
// leads "filtered by New". An enquiry still at New in the Lead Inbox, and a lead on Contacts nothing has been done for
// yet — no quote, job or invoice. Each opens where it is worked: the Lead Inbox, or the contact's page.
import { useEffect, useState } from 'react'
import { Inbox, UserPlus, Loader2 } from 'lucide-react'
import { NavLink, PageHeader, instantDay, errMsg } from '../invoicing/ui'
import { codeLabel } from '../labels/codes'

export interface NewLeadsApi { get: (path: string, params?: Record<string, any>) => Promise<any> }
interface Row { kind: 'enquiry' | 'contact'; id: string; name: string; email: string | null; phone: string | null; source: string | null; receivedAt: string }

export function NewLeadsPage({ api }: { api: NewLeadsApi }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    let gone = false
    api.get('/api/dashboard/new-leads')
      .then((r: any) => { if (!gone) { setRows(Array.isArray(r?.data) ? r.data : []); setTotal(Number(r?.pagination?.total ?? r?.data?.length ?? 0)) } })
      .catch((e: unknown) => { if (!gone) { setRows([]); setError(errMsg(e, 'The new leads could not be loaded')) } })
    return () => { gone = true }
  }, [api])

  return (
    <div className="space-y-4">
      <PageHeader title="New leads" subtitle="Inquiries nobody has answered yet, and leads nothing has been started for" />
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {rows === null ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : rows.length === 0 && !error ? (
        <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">No new leads — every inquiry has an answer.</div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <p className="px-4 py-2 text-sm text-gray-600 border-b border-gray-200 dark:text-slate-400 dark:border-slate-800" data-testid="new-leads-count">{total} new lead{total === 1 ? '' : 's'}{rows.length < total ? ` — the newest ${rows.length} shown` : ''}</p>
          <ul className="divide-y divide-gray-100 dark:divide-slate-800" aria-label="New leads">
            {rows.map((r) => (
              <li key={`${r.kind}:${r.id}`}>
                <NavLink to={r.kind === 'contact' ? `/crm/contacts/${r.id}` : '/crm/leads'} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800">
                  <div className="flex items-center gap-3 min-w-0">
                    {r.kind === 'enquiry' ? <Inbox className="w-5 h-5 text-blue-600 dark:text-blue-300 shrink-0" /> : <UserPlus className="w-5 h-5 text-orange-700 dark:text-orange-200 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate dark:text-slate-100">{r.name}</p>
                      <p className="text-sm text-gray-600 truncate dark:text-slate-400">
                        {r.kind === 'enquiry' ? 'In the Lead Inbox' : 'A lead on Contacts'}
                        {r.source ? ` · ${codeLabel(r.source)}` : ''}
                        {r.email || r.phone ? ` · ${r.email || r.phone}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm text-gray-600 shrink-0 dark:text-slate-400">{instantDay(r.receivedAt)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
