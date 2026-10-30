// Team Revenue (server crm/field/teamReportRoutes.ts, /api/team-revenue): what each tech's jobs brought in, and how many of
// each rep's and tech's quotes turned into work. Same money rules as Reports; the rows always add up to the total.
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { PeriodPicker, periodQuery, money, card, th, td, tdNum, Loading, Problem, Empty, type PeriodId } from './reportBits'

interface Person { id: string; name: string }
interface RevenueRow { person: Person | null; bucket: 'person' | 'unassigned' | 'no_job'; invoiced: number; invoiceCount: number; collected: number }
interface ConversionRow { person: Person | null; bucket: 'person' | 'not_recorded'; sent: number; approved: number; declined: number; open: number; approvedValue: number; conversionRate: number }

const rowName = (b: RevenueRow['bucket'], p: Person | null) => (p ? p.name : b === 'no_job' ? 'Not on a job (office sales)' : 'No one on the job')
const quoteName = (by: 'writer' | 'tech', b: ConversionRow['bucket'], p: Person | null) =>
  p ? p.name : by === 'writer' ? 'Written before we kept track' : 'Never became a job'

export default function TeamRevenuePage() {
  const [period, setPeriod] = useState<PeriodId>('month')
  const [by, setBy] = useState<'writer' | 'tech'>('writer')
  const [rev, setRev] = useState<{ rows: RevenueRow[]; totals: { invoiced: number; invoiceCount: number; collected: number } } | null>(null)
  const [conv, setConv] = useState<ConversionRow[] | null>(null)
  const [error, setError] = useState('')
  const q = periodQuery(period)

  useEffect(() => {
    setRev(null); setError('')
    api.get(`/api/team-revenue/by-tech?${q}`).then(setRev).catch((e: Error) => setError(e.message || 'Revenue could not be loaded.'))
  }, [q])
  useEffect(() => {
    setConv(null)
    api.get(`/api/team-revenue/quote-conversion?by=${by}&${q}`).then((r: { rows: ConversionRow[] }) => setConv(r.rows)).catch((e: Error) => setError(e.message || 'Quotes could not be loaded.'))
  }, [q, by])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Team Revenue</h1>
          <p className="text-sm text-gray-600 dark:text-slate-300">What each tech’s jobs brought in, and how many quotes each person turns into work.</p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {error && <Problem text={error} />}

      <section className={card} aria-labelledby="rev-h">
        <h2 id="rev-h" className="px-4 pt-4 text-lg font-semibold text-gray-900 dark:text-slate-100">Revenue by tech</h2>
        <p className="px-4 pb-2 text-xs text-gray-600 dark:text-slate-300">Invoiced is every invoice that is not a draft or void, by the day it was made. Collected is the money taken that period, after refunds. An invoice belongs to the job it bills.</p>
        {!rev ? <Loading /> : rev.rows.length === 0 ? <Empty text="No invoices in this period." /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead><tr><th className={th}>Tech</th><th className={`${th} text-right`}>Invoices</th><th className={`${th} text-right`}>Invoiced</th><th className={`${th} text-right`}>Collected</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {rev.rows.map((r, i) => (
                  <tr key={r.person?.id ?? `${r.bucket}-${i}`}><td className={td}>{rowName(r.bucket, r.person)}</td><td className={tdNum}>{r.invoiceCount}</td><td className={tdNum}>{money(r.invoiced)}</td><td className={tdNum}>{money(r.collected)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr className="font-semibold"><td className={td}>Total</td><td className={tdNum}>{rev.totals.invoiceCount}</td><td className={tdNum}>{money(rev.totals.invoiced)}</td><td className={tdNum}>{money(rev.totals.collected)}</td></tr></tfoot>
            </table>
          </div>
        )}
      </section>

      <section className={card} aria-labelledby="conv-h">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h2 id="conv-h" className="text-lg font-semibold text-gray-900 dark:text-slate-100">Quotes that became work</h2>
          <div role="group" aria-label="Group quotes by" className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm dark:border-slate-600">
            {([['writer', 'By who wrote it'], ['tech', 'By tech on the job']] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={by === id} onClick={() => setBy(id)}
                className={`px-3 py-1.5 ${by === id ? 'bg-blue-700 text-white' : 'bg-white text-gray-800 dark:bg-slate-800 dark:text-slate-200'}`}>{label}</button>
            ))}
          </div>
        </div>
        <p className="px-4 pb-2 pt-1 text-xs text-gray-600 dark:text-slate-300">Won ÷ decided (won, turned down or expired). Quotes still waiting are not counted as lost.</p>
        {!conv ? <Loading /> : conv.length === 0 ? <Empty text="No quotes in this period." /> : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead><tr><th className={th}>{by === 'writer' ? 'Written by' : 'Tech'}</th><th className={`${th} text-right`}>Quotes</th><th className={`${th} text-right`}>Won</th><th className={`${th} text-right`}>Lost</th><th className={`${th} text-right`}>Waiting</th><th className={`${th} text-right`}>Won value</th><th className={`${th} text-right`}>Win rate</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {conv.map((r, i) => (
                  <tr key={r.person?.id ?? `${r.bucket}-${i}`}><td className={td}>{quoteName(by, r.bucket, r.person)}</td><td className={tdNum}>{r.sent}</td><td className={tdNum}>{r.approved}</td><td className={tdNum}>{r.declined}</td><td className={tdNum}>{r.open}</td><td className={tdNum}>{money(r.approvedValue)}</td><td className={tdNum}>{r.approved + r.declined > 0 ? `${r.conversionRate}%` : '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
