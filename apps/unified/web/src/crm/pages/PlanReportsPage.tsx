// Plan Reports (server crm/field/teamReportRoutes.ts, /api/plan-reports): service plans sold by person, the renewals coming
// due in 30 or 60 days, and the plans that ended.
import { useEffect, useState } from 'react'
import { api } from '../../api'
import { PeriodPicker, periodQuery, money, card, th, td, tdNum, Loading, Problem, Empty, type PeriodId } from './reportBits'

interface Person { id: string; name: string }
interface SoldRow { person: Person | null; bucket: 'person' | 'not_recorded'; sold: number; yearlyValue: number; stillActive: number }
interface RenewalRow { id: string; number: string; name: string; customer: string; endDate: string; daysLeft: number; renewal: 'auto' | 'manual'; autopay: boolean; yearlyValue: number }
interface ChurnRow { id: string; number: string; name: string; customer: string; how: 'cancelled' | 'expired'; endedOn: string; dateKnown: boolean; reason: string | null; soldBy: Person | null; yearlyValue: number }

const TABS = [['sold', 'Sold'], ['renewals', 'Coming due'], ['ended', 'Ended']] as const
type Tab = typeof TABS[number][0]
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

export default function PlanReportsPage() {
  const [tab, setTab] = useState<Tab>('sold')
  const [period, setPeriod] = useState<PeriodId>('year')
  const [days, setDays] = useState<30 | 60>(30)
  const [sold, setSold] = useState<SoldRow[] | null>(null)
  const [renewals, setRenewals] = useState<{ rows: RenewalRow[]; needsAction: number } | null>(null)
  const [ended, setEnded] = useState<ChurnRow[] | null>(null)
  const [error, setError] = useState('')
  const q = periodQuery(period)
  const fail = (what: string) => (e: Error) => setError(e.message || `${what} could not be loaded.`)

  useEffect(() => { if (tab !== 'sold') return; setSold(null); setError(''); api.get(`/api/plan-reports/sold?${q}`).then((r: { rows: SoldRow[] }) => setSold(r.rows)).catch(fail('Plans sold')) }, [tab, q])
  useEffect(() => { if (tab !== 'renewals') return; setRenewals(null); setError(''); api.get(`/api/plan-reports/renewals?days=${days}`).then(setRenewals).catch(fail('Renewals')) }, [tab, days])
  useEffect(() => { if (tab !== 'ended') return; setEnded(null); setError(''); api.get(`/api/plan-reports/churned?${q}`).then((r: { rows: ChurnRow[] }) => setEnded(r.rows)).catch(fail('Ended plans')) }, [tab, q])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Plan Reports</h1>
          <p className="text-sm text-gray-600 dark:text-slate-300">Who sells your service plans, which ones are coming up for renewal, and which ones ended.</p>
        </div>
        {tab === 'renewals'
          ? <div role="group" aria-label="Look ahead" className="inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm dark:border-slate-600">
              {([30, 60] as const).map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`px-3 py-1.5 ${days === d ? 'bg-blue-700 text-white' : 'bg-white text-gray-800 dark:bg-slate-800 dark:text-slate-200'}`}>Next {d} days</button>)}
            </div>
          : <PeriodPicker value={period} onChange={setPeriod} />}
      </div>

      <div role="tablist" aria-label="Plan reports" className="flex gap-1 border-b border-gray-200 dark:border-slate-700">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === id ? 'border-blue-700 text-blue-800 dark:border-blue-400 dark:text-blue-300' : 'border-transparent text-gray-700 dark:text-slate-300'}`}>{label}</button>
        ))}
      </div>
      {error && <Problem text={error} />}

      {tab === 'sold' && (
        <section className={card}>
          <p className="px-4 pt-4 text-xs text-gray-600 dark:text-slate-300">Plans made in the period, by the person who made them. Yearly value is the price of one bill times the bills in a year.</p>
          {!sold ? <Loading /> : sold.length === 0 ? <Empty text="No plans were sold in this period." /> : (
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead><tr><th className={th}>Sold by</th><th className={`${th} text-right`}>Plans</th><th className={`${th} text-right`}>Yearly value</th><th className={`${th} text-right`}>Still active</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {sold.map((r, i) => <tr key={r.person?.id ?? `n${i}`}><td className={td}>{r.person ? r.person.name : 'Made before we kept track'}</td><td className={tdNum}>{r.sold}</td><td className={tdNum}>{money(r.yearlyValue)}</td><td className={tdNum}>{r.stillActive}</td></tr>)}
              </tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === 'renewals' && (
        <section className={card}>
          {!renewals ? <Loading /> : (
            <>
              <p className="px-4 pt-4 text-sm text-gray-800 dark:text-slate-200">
                {renewals.rows.length === 0 ? `No plans end in the next ${days} days.`
                  : <>{renewals.rows.length} {renewals.rows.length === 1 ? 'plan ends' : 'plans end'} in the next {days} days. {renewals.needsAction > 0 ? <strong>{renewals.needsAction} will lapse unless someone renews {renewals.needsAction === 1 ? 'it' : 'them'}.</strong> : 'All renew on their own.'}</>}
              </p>
              {renewals.rows.length > 0 && (
                <div className="overflow-x-auto"><table className="mt-2 min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                  <thead><tr><th className={th}>Plan</th><th className={th}>Customer</th><th className={th}>Ends</th><th className={th}>Renews</th><th className={`${th} text-right`}>Yearly value</th></tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {renewals.rows.map((r) => (
                      <tr key={r.id}><td className={td}>{r.name} <span className="text-gray-600 dark:text-slate-300">· {r.number}</span></td><td className={td}>{r.customer}</td><td className={td}>{day(r.endDate)} <span className="text-gray-600 dark:text-slate-300">({r.daysLeft === 0 ? 'today' : `${r.daysLeft}d`})</span></td>
                        <td className={td}>{r.renewal === 'auto' ? 'On its own' : <strong>Needs a person</strong>}{r.autopay ? ' · autopay' : ''}</td><td className={tdNum}>{money(r.yearlyValue)}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'ended' && (
        <section className={card}>
          <p className="px-4 pt-4 text-xs text-gray-600 dark:text-slate-300">Plans cancelled, or whose term ran out without a renewal. A date marked “about” is a plan that ended before we recorded the day, so it shows its last change.</p>
          {!ended ? <Loading /> : ended.length === 0 ? <Empty text="No plans ended in this period." /> : (
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
              <thead><tr><th className={th}>Plan</th><th className={th}>Customer</th><th className={th}>How</th><th className={th}>Ended</th><th className={th}>Why</th><th className={th}>Sold by</th><th className={`${th} text-right`}>Yearly value</th></tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {ended.map((r) => (
                  <tr key={r.id}><td className={td}>{r.name} <span className="text-gray-600 dark:text-slate-300">· {r.number}</span></td><td className={td}>{r.customer}</td><td className={td}>{r.how === 'cancelled' ? 'Cancelled' : 'Ran out'}</td>
                    <td className={td}>{r.dateKnown ? '' : 'about '}{day(r.endedOn)}</td><td className={td}>{r.reason || '—'}</td><td className={td}>{r.soldBy?.name || '—'}</td><td className={tdNum}>{money(r.yearlyValue)}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      )}
    </div>
  )
}
