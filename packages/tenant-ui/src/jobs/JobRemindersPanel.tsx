// The job page's "Customer reminders" card (server crm/field/jobReminders.ts, jobConfirm.ts): whether the customer confirmed
// the visit, a Text reminder / Email reminder button that sends one now, and what the customer has been sent about it.
import { useCallback, useEffect, useState } from 'react'
import { BellRing, Check, Mail, MessageSquare } from 'lucide-react'
import { Button, errMsg } from '../invoicing/ui'
import { whenTime } from '../time/companyClock'
import { codeLabel } from '../labels/codes'
import { useMayWrite } from '../auth/PermissionsContext'

interface Api { get: (p: string, q?: any) => Promise<any>; post: (p: string, b?: any) => Promise<any> }
interface Toast { success: (m: string) => void; error: (m: string) => void }
interface Notice { id: string; what: string; channel: string; status: string; detail: string | null; at: string; manual: boolean }
interface Panel {
  confirmedAt: string | null; confirmedBy: string | null
  customer: { remindersOff: boolean; textsOff: boolean; emailsOff: boolean }
  hasCustomer: boolean; canText: boolean; canEmail: boolean
  notices: Notice[]
}

export function JobRemindersPanel({ api, toast, jobId, mayUpdate: mayUpdateProp, open }: { api: Api; toast: Toast; jobId: string; mayUpdate: boolean; open: boolean }) {
  // POST /api/job-reminders/send/:jobId asks jobs:update.
  const mayUpdate = mayUpdateProp && useMayWrite('jobs:update')
  const [panel, setPanel] = useState<Panel | null>(null)
  const [busy, setBusy] = useState('')
  const load = useCallback(() => api.get(`/api/job-reminders/job/${jobId}`).then((r) => setPanel((r?.data ?? r) as Panel)).catch(() => setPanel(null)), [api, jobId])
  useEffect(() => { void load() }, [load])
  if (!panel || !panel.hasCustomer) return null
  const send = async (channel: 'sms' | 'email') => {
    setBusy(channel)
    try {
      const r = await api.post(`/api/job-reminders/send/${jobId}`, { channels: [channel] })
      const o = ((r?.data ?? r)?.outcomes ?? [])[0]
      if (o && o.status !== 'sent') toast.error(`${channel === 'sms' ? 'Text' : 'Email'} not sent: ${o.detail || o.status}`)
      else toast.success(channel === 'sms' ? 'Text reminder sent' : 'Email reminder sent')
      await load()
    } catch (e) { toast.error(errMsg(e, 'The reminder could not be sent')) } finally { setBusy('') }
  }
  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow-sm p-6" data-testid="job-reminders-panel">
      <h2 className="font-semibold mb-3 flex items-center gap-2 text-gray-900 dark:text-slate-100"><BellRing className="w-4 h-4" aria-hidden /> Customer reminders</h2>
      {panel.confirmedAt
        ? <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800 dark:bg-green-950/40 dark:text-green-300"><Check className="w-4 h-4" aria-hidden />Confirmed {panel.confirmedBy || ''} {whenTime(panel.confirmedAt)}</p>
        : <p className="mb-3 text-sm text-gray-600 dark:text-slate-400">The customer has not confirmed this visit.</p>}
      {panel.customer.remindersOff && <p className="mb-3 text-xs text-gray-600 dark:text-slate-400">Automatic reminders are turned off for this customer. You can still send one yourself.</p>}
      {open && mayUpdate && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => send('sms')} disabled={!panel.canText || !!busy} title={panel.canText ? undefined : 'No mobile number, or the customer asked not to be texted'}><MessageSquare className="w-4 h-4" aria-hidden />{busy === 'sms' ? 'Sending…' : 'Text reminder'}</Button>
          <Button variant="secondary" onClick={() => send('email')} disabled={!panel.canEmail || !!busy} title={panel.canEmail ? undefined : 'No email address, or the customer unsubscribed'}><Mail className="w-4 h-4" aria-hidden />{busy === 'email' ? 'Sending…' : 'Email reminder'}</Button>
        </div>
      )}
      {panel.notices.length > 0 && (
        <ul className="space-y-1 text-sm text-gray-700 dark:text-slate-300">
          {panel.notices.map((n) => (
            <li key={n.id}>{n.what} by {n.channel.toLowerCase()} — <span className={n.status === 'Sent' ? '' : 'text-amber-700 dark:text-amber-300'}>{codeLabel(n.status)}</span>{n.detail ? ` (${n.detail})` : ''} <span className="text-xs text-gray-500 dark:text-slate-400">{whenTime(n.at)}{n.manual ? ' · by a team member' : ''}</span></li>
          ))}
        </ul>
      )}
    </div>
  )
}
