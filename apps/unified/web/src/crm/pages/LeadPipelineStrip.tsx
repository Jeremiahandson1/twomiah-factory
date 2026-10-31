// The pipeline strip and the quotes still waiting on a customer (server crm/leads/leadPipeline.ts, /api/lead-pipeline; feature
// lead_pipeline, not ready). The strip runs New → Contacted → Site visit booked → Quotes out → Won, with Lost beside it; a seat
// that cannot read quotes sees the first three steps and Lost (the server sends no quote figures to it). The list names every
// quote sent and not answered, the longest-waiting first, each a link to the quote.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { useAuth, money } from '../../shared'

interface Stage { id: string; label: string; count: number; value?: number }
interface Waiting { id: string; number: string; name: string; status: string; total: number; contactName: string | null; daysWaiting: number; viewed: boolean; followUpsSent: number; expired: boolean }

const STAGE_LINK: Record<string, string> = { new: '/crm/leads', contacted: '/crm/leads', site_visit: '/crm/leads', lost: '/crm/leads', quotes_out: '/crm/quotes', won: '/crm/quotes' }
const card = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900'

/** The strip, where Pipeline Strip is on and the seat reads leads. Nothing (not an empty box) where it is not. */
export function LeadPipelineStrip() {
  const { hasFeature, can } = useAuth()
  const on = hasFeature('lead_pipeline') && can('leads:read')
  const [stages, setStages] = useState<Stage[] | null>(null)
  const [days, setDays] = useState(30)
  useEffect(() => {
    if (!on) return
    let live = true
    api.get('/api/lead-pipeline').then((r: { stages: Stage[]; days: number }) => { if (live) { setStages(r?.stages || []); setDays(r?.days || 30) } }).catch(() => { if (live) setStages(null) })
    return () => { live = false }
  }, [on])
  if (!on || !stages) return null
  return (
    <section aria-label="Pipeline" className={card} data-testid="lead-pipeline-strip">
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stages.map((s) => (
          <li key={s.id} data-stage={s.id}>
            <Link to={STAGE_LINK[s.id] || '/crm/leads'} className="block rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-slate-800">
              <span className="block text-xs font-medium text-gray-600 dark:text-slate-300">{s.label}</span>
              <span className="block text-2xl font-semibold text-gray-900 dark:text-slate-100">{s.count}</span>
              {s.value !== undefined && <span className="block text-xs text-gray-600 dark:text-slate-300">{money(s.value, 0)}</span>}
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">Won and Lost are the last {days} days.</p>
    </section>
  )
}

/** The quotes waiting on a customer, longest first. Where Pipeline Strip is on and the seat reads quotes. */
export function QuotesAwaitingReply({ limit = 8 }: { limit?: number }) {
  const { hasFeature, can } = useAuth()
  const on = hasFeature('lead_pipeline') && can('quotes:read')
  const [rows, setRows] = useState<Waiting[] | null>(null)
  useEffect(() => {
    if (!on) return
    let live = true
    api.get('/api/lead-pipeline/awaiting-reply', { limit: 500 }).then((r: { data: Waiting[] }) => { if (live) setRows(r?.data || []) }).catch(() => { if (live) setRows(null) })
    return () => { live = false }
  }, [on])
  if (!on || rows === null) return null
  const total = Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100
  return (
    <section aria-label="Quotes awaiting reply" className={card} data-testid="quotes-awaiting-reply">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Quotes awaiting a reply{rows.length ? ` — ${rows.length}, ${money(total, 0)}` : ''}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Every quote you sent has an answer.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-slate-800">
          {rows.slice(0, limit).map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link to={`/crm/quotes/${q.id}`} className="font-medium text-orange-700 hover:underline dark:text-orange-200">{q.number} · {q.contactName || q.name}</Link>
              <span className="text-gray-700 dark:text-slate-200">
                {money(q.total, 0)} · {q.daysWaiting === 0 ? 'sent today' : `waiting ${q.daysWaiting} ${q.daysWaiting === 1 ? 'day' : 'days'}`}
                {q.viewed ? ', opened' : ', not opened'}
                {q.followUpsSent > 0 ? `, nudged ${q.followUpsSent}×` : ''}
                {q.expired ? ', expired' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit && <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">and {rows.length - limit} more, on the Quotes page.</p>}
    </section>
  )
}
