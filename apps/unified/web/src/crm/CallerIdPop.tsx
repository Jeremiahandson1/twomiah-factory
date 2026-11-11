// Caller ID — the screen pop (parity tier 3, field service; server crm/comms/callerId.ts; feature caller_id, not ready). When a call to
// the business's tracking number comes in ('call:incoming', the call's id only), a seat that reads contacts sees who it is — their
// open jobs, the next one, what they owe (with invoices:read) — and opens their record; a new caller goes to the Lead Inbox.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PhoneIncoming, X } from 'lucide-react'
import { money } from '@twomiah/tenant-ui/src/money'
import { api } from '../api'
import { useAuth } from '../shared'
import { useLiveEvent } from '../live'

interface Caller {
  callId: string; number: string | null; callerName: string | null; place: string | null; source: string | null
  customer: { id: string; name: string; phone: string | null; address: string | null } | null
  openJobs?: number; nextJob?: { id: string; number: string; title: string; date: string } | null; owed?: number | null
}

export function CallerIdPop() {
  const { hasFeature, can } = useAuth()
  const on = hasFeature('caller_id') && can('contacts:read')
  const [caller, setCaller] = useState<Caller | null>(null)
  useLiveEvent('call:incoming', (d: any) => {
    if (!on || !d?.callId) return
    api.get(`/api/caller-id/${encodeURIComponent(d.callId)}`).then((r: Caller) => setCaller(r)).catch(() => { /* a pop that cannot load stays away */ })
  })
  if (!on || !caller) return null
  const who = caller.customer?.name || caller.callerName || 'A new caller'
  return (
    <div role="status" aria-live="polite" className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-100"><PhoneIncoming className="h-5 w-5 text-green-700 dark:text-green-300" aria-hidden="true" />{who}</p>
        <button type="button" aria-label="Close" onClick={() => setCaller(null)} className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-1 text-sm text-gray-700 dark:text-slate-300">{caller.number || 'Number withheld'}{caller.place ? ` · ${caller.place}` : ''}{caller.source ? ` · ${caller.source}` : ''}</p>
      {caller.customer ? (
        <>
          {caller.customer.address && <p className="text-xs text-gray-600 dark:text-slate-400">{caller.customer.address}</p>}
          <p className="mt-2 text-sm text-gray-900 dark:text-slate-100">{caller.openJobs ? `${caller.openJobs} open job${caller.openJobs === 1 ? '' : 's'}` : 'No open jobs'}{caller.nextJob ? ` · next: ${caller.nextJob.title} on ${caller.nextJob.date}` : ''}</p>
          {caller.owed != null && caller.owed > 0 && <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Owes {money(caller.owed)}</p>}
          <Link to={`/crm/contacts/${caller.customer.id}`} onClick={() => setCaller(null)} className="mt-3 inline-block rounded-lg bg-orange-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-800 dark:hover:bg-orange-600">Open their record</Link>
        </>
      ) : (
        <Link to="/crm/leads" onClick={() => setCaller(null)} className="mt-3 inline-block text-sm font-medium text-orange-700 underline dark:text-orange-300">Not a customer yet — see the Lead Inbox</Link>
      )}
    </div>
  )
}
