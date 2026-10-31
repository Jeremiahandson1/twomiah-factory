// "Notify client?" — asked after the office moves a visit (job edit, Schedule drag, Dispatch Board, route re-time). The
// server says when a visit's day or time really changed (PUT /api/jobs/:id → scheduleMoved, POST /api/jobs/retime → moved);
// this asks whether to tell the customer, by text, email or both, and POST /api/job-reminders/moved/:jobId sends it. It
// shows nothing when Job Reminders is off, the job has no customer, or the customer can be reached neither way.
import { useEffect, useState } from 'react'
import { Modal, Button, errMsg } from '../invoicing/ui'

interface Api { get: (p: string, q?: any) => Promise<any>; post: (p: string, b?: any) => Promise<any> }
interface Toast { success: (m: string) => void; error: (m: string) => void }
interface Reach { hasCustomer: boolean; canText: boolean; canEmail: boolean }

/** Ask about each moved job in turn. `jobIds` empty/undefined → nothing is asked. Calls `onDone` when the queue is empty. */
export function NotifyMovedDialog({ api, toast, jobIds, onDone }: { api: Api; toast: Toast; jobIds: string[]; onDone: () => void }) {
  const [queue, setQueue] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [reach, setReach] = useState<Reach | null>(null)
  const [text, setText] = useState(true)
  const [mail, setMail] = useState(true)
  const [busy, setBusy] = useState(false)
  const key = jobIds.join(',')
  useEffect(() => { setQueue(jobIds) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = queue[0]
  const next = () => setQueue((q) => { const rest = q.slice(1); if (!rest.length) setTimeout(onDone, 0); return rest })
  useEffect(() => {
    setReach(null)
    if (!current) return
    let gone = false
    Promise.all([api.get(`/api/job-reminders/job/${current}`), api.get(`/api/jobs/${current}`).catch(() => null)]).then(([r, j]) => {
      if (gone) return
      const data = (r?.data ?? r) as Reach
      const job = j?.data ?? j
      setTitle(job?.title ? `${job.title}` : 'this visit')
      if (!data?.hasCustomer || (!data.canText && !data.canEmail)) { next(); return }
      setText(!!data.canText); setMail(!!data.canEmail); setReach(data)
    }).catch(() => { if (!gone) next() }) // Job Reminders off (or not allowed): nothing to ask
    return () => { gone = true }
  }, [current]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    const channels = [...(text && reach?.canText ? ['sms'] : []), ...(mail && reach?.canEmail ? ['email'] : [])]
    if (!channels.length) { toast.error('Choose text, email or both.'); return }
    setBusy(true)
    try {
      const r = await api.post(`/api/job-reminders/moved/${current}`, { channels })
      const out: Array<{ channel: string; status: string; detail?: string }> = (r?.data ?? r)?.outcomes ?? []
      const bad = out.filter((o) => o.status !== 'sent')
      if (bad.length) toast.error(bad.map((o) => `${o.channel === 'sms' ? 'Text' : 'Email'} not sent: ${o.detail || o.status}`).join(' '))
      else toast.success('Customer notified')
      next()
    } catch (e) { toast.error(errMsg(e, 'The customer could not be notified')) } finally { setBusy(false) }
  }
  return (
    <Modal isOpen={!!current && !!reach} onClose={next} title="Notify client?" size="sm">
      <p className="text-sm text-gray-700 dark:text-slate-300">The visit for <strong>{title}</strong> was moved. Tell the customer the new time?</p>
      <div className="mt-4 space-y-2">
        <label className={`flex items-center gap-2 text-sm ${reach?.canText ? 'text-gray-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}>
          <input type="checkbox" className="h-4 w-4" checked={text && !!reach?.canText} disabled={!reach?.canText} onChange={(e) => setText(e.target.checked)} />
          Text message{reach && !reach.canText ? ' (no mobile number, or they asked not to be texted)' : ''}
        </label>
        <label className={`flex items-center gap-2 text-sm ${reach?.canEmail ? 'text-gray-900 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}>
          <input type="checkbox" className="h-4 w-4" checked={mail && !!reach?.canEmail} disabled={!reach?.canEmail} onChange={(e) => setMail(e.target.checked)} />
          Email{reach && !reach.canEmail ? ' (no email address, or they unsubscribed)' : ''}
        </label>
      </div>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={next} disabled={busy}>Don&rsquo;t notify</Button>
        <Button onClick={send} disabled={busy}>{busy ? 'Sending…' : 'Notify client'}</Button>
      </div>
    </Modal>
  )
}
