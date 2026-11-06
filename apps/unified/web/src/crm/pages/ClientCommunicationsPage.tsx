// Client Communications (server crm/field/jobReminderRoutes.ts, GET /api/job-reminders/report): every visit reminder and
// "visit moved" message the business sent — automatic or by a person — with whether it reached the customer and whether the
// visit was confirmed, plus the customers' texts back. Filters by period, kind, channel and result; downloads as CSV.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download } from 'lucide-react'
import { api } from '../../api'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'
import { whenDateTime } from '@twomiah/tenant-ui/src/time/companyClock'
import { PeriodPicker, periodQuery, card, th, td, Loading, Problem, Empty, type PeriodId } from './reportBits'

interface Row { id: string; at: string; what: string; channel: string; status: string; detail: string; to: string; sentBy: string; jobId: string; jobNumber: string; jobTitle: string; contactId: string | null; customer: string; confirmed: boolean }
interface Reply { at: string; customer: string; body: string }
interface Report { summary: { sent: number; notSent: number; failed: number; waiting: number; visitsConfirmed: number; visitsReminded: number; replies: number }; rows: Row[]; replies: Reply[] }

const when = (iso: string) => whenDateTime(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const sel = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'

export default function ClientCommunicationsPage() {
  const [period, setPeriod] = useState<PeriodId>('30')
  const [what, setWhat] = useState('')
  const [channel, setChannel] = useState('')
  const [status, setStatus] = useState('')
  const [data, setData] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const query = [periodQuery(period), what && `what=${what}`, channel && `channel=${channel}`, status && `status=${status}`].filter(Boolean).join('&')

  useEffect(() => {
    setData(null); setError('')
    api.get(`/api/job-reminders/report?${query}`).then((r: any) => setData((r?.data ?? r) as Report)).catch((e: Error) => setError(e.message || 'The report could not be loaded.'))
  }, [query])

  const download = async () => {
    setSaving(true); setError('')
    try {
      const res = await api.raw(`/api/job-reminders/report?${query}${query ? '&' : ''}format=csv`)
      if (!res.ok) throw new Error('The download failed.')
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = 'client-communications.csv'
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
    } catch (e) { setError((e as Error).message || 'The download failed.') } finally { setSaving(false) }
  }

  const s = data?.summary
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Client Communications</h1>
          <p className="text-sm text-gray-600 dark:text-slate-300">The reminders and &ldquo;visit moved&rdquo; messages sent to customers, whether they got through, and which visits were confirmed. Automatic reminders are set up in <Link to="/crm/settings/job-reminders" className="underline">Settings › Job Reminders</Link>.</p>
        </div>
        <button type="button" onClick={download} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"><Download className="h-4 w-4" aria-hidden />{saving ? 'Preparing…' : 'Download CSV'}</button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <PeriodPicker value={period} onChange={setPeriod} />
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Kind
          <select className={sel} value={what} onChange={(e) => setWhat(e.target.value)}><option value="">All</option><option value="reminder">Reminders</option><option value="moved">Visit moved</option></select></label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Sent by
          <select className={sel} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">Text and email</option><option value="sms">Text</option><option value="email">Email</option></select></label>
        <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">Result
          <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="sent">Sent</option><option value="skipped">Not sent</option><option value="failed">Failed</option><option value="held">Waiting to send</option></select></label>
      </div>

      {error && <Problem text={error} />}
      {!data && !error && <Loading />}
      {data && s && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([['Sent', s.sent], ['Not sent', s.notSent + s.failed], ['Visits reminded', s.visitsReminded], ['Visits confirmed', s.visitsConfirmed]] as const).map(([k, v]) => (
              <div key={k} className={`${card} p-4`}><dt className="text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-slate-300">{k}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-slate-100">{v}</dd></div>
            ))}
          </dl>

          <section className={card} aria-label="Messages sent">
            {data.rows.length === 0 ? <Empty text="Nothing was sent in this period." /> : (
              <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                <thead><tr><th className={th}>When</th><th className={th}>Customer</th><th className={th}>Job</th><th className={th}>What</th><th className={th}>Result</th><th className={th}>Sent by</th><th className={th}>Confirmed</th></tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className={td}>{when(r.at)}</td>
                      <td className={td}>{r.contactId ? <Link className="underline" to={`/crm/contacts/${r.contactId}`}>{r.customer || 'Customer'}</Link> : r.customer}</td>
                      <td className={td}><Link className="underline" to={`/crm/jobs/${r.jobId}`}>{r.jobNumber} {r.jobTitle}</Link></td>
                      <td className={td}>{r.what} · {r.channel}</td>
                      <td className={td}>{codeLabel(r.status)}{r.detail ? <span className="block text-xs text-gray-600 dark:text-slate-400">{r.detail}</span> : null}</td>
                      <td className={td}>{r.sentBy}</td>
                      <td className={td}>{r.confirmed ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </section>

          {data.replies.length > 0 && (
            <section className={`${card} p-4`} aria-label="Customer replies">
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">Texts back from these customers</h2>
              <ul className="mt-2 space-y-1 text-sm text-gray-800 dark:text-slate-200">
                {data.replies.map((r, i) => <li key={i}><span className="font-medium">{r.customer || 'Customer'}</span> <span className="text-xs text-gray-600 dark:text-slate-400">{when(r.at)}</span> — {r.body}</li>)}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
