// The job's message thread with the homeowner (roofing parity row 22; AccuLynx portal posts; portal_posts_packets, not ready). The
// homeowner writes from their portal's Photos & Documents; the office reads and answers here. Server: crm/roof/portalFiles/office.ts.
import { useCallback, useEffect, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { api } from '../../../../api'
import { useAuth, useMayWrite, useToast } from '../../../../shared'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'

const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback

export default function JobPostsPanel({ jobId, homeowner }: { jobId: string; homeowner: string | null }) {
  const toast = useToast()
  const { hasFeature } = useAuth()
  const on = hasFeature('portal_posts_packets') && hasFeature('portal_job_files')
  const mayWrite = useMayWrite('portal:share')
  const [rows, setRows] = useState<Array<{ id: string; fromHomeowner: boolean; body: string; at: string }> | null>(null)
  const [text, setText] = useState('')
  const load = useCallback(async () => {
    try { const r: any = await api.get(`/api/job-files/posts?jobId=${jobId}`); setRows(Array.isArray(r?.data) ? r.data : []) } catch { setRows(null) }
  }, [jobId])
  useEffect(() => { if (on) load() }, [on, load])
  if (!on || rows === null) return null
  const send = async () => {
    try { await api.post('/api/job-files/posts', { jobId, body: text }); setText(''); await load() } catch (e) { toast.error(errorText(e, 'Could not send it')) }
  }
  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900" data-testid="job-posts">
      <h2 className="text-sm font-semibold flex items-center gap-2 mb-3"><MessagesSquare className="w-4 h-4 text-gray-400" /> Messages with {homeowner || 'the homeowner'}</h2>
      {rows.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No messages yet. They see this thread in their portal’s Photos &amp; Documents.</p>}
      <ul className="space-y-2 mb-3">
        {rows.map((m) => (
          <li key={m.id} className={`rounded-lg p-2 text-sm ${m.fromHomeowner ? 'bg-gray-100 mr-8 dark:bg-slate-800' : 'bg-orange-50 ml-8 dark:bg-orange-950/30'}`}>
            <span className="block text-xs text-gray-500 dark:text-slate-400">{m.fromHomeowner ? homeowner || 'Homeowner' : 'Us'} · {whenDateTime(m.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <span className="whitespace-pre-wrap">{m.body}</span>
          </li>
        ))}
      </ul>
      {mayWrite && (
        <div className="flex gap-2">
          <textarea className="input flex-1" rows={2} maxLength={4000} aria-label="Reply to the homeowner" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn-primary" disabled={!text.trim()} onClick={send}>Send</button>
        </div>
      )}
    </div>
  )
}
