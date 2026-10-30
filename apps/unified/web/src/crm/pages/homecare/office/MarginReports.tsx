// Margin & turnover (item 10, care_margin_reports): what each client earns the agency after the caregiver's pay, and how
// many caregivers the agency keeps.
//   GET /api/margin-reports/client-margin?startDate&endDate  (care-billing:read AND care-payroll:read)
//   GET /api/margin-reports/turnover?startDate&endDate       (care-hr:read)       server/crm/homecare/planning/marginReports.ts
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, errorMessage } from '../lib/http'
import { formatAgencyDate, agencyToday } from '../lib/agencyClock'
import { money } from '../people/shared'
import { useMay } from '../lib/useMay'

interface MarginRow {
  clientId: string; clientName: string; hours: number; overtimeHours: number; rate: number | null; billed: number | null
  pay: number; overtimePay: number; mileage: number; cost: number; margin: number | null; marginPercent: number | null
}
interface MarginReply {
  clients: MarginRow[]; hoursWithoutClient: number
  totals: { hours: number; billed: number; pay: number; mileage: number; margin: number; clientsWithoutRate: number }
}
interface TurnoverReply {
  headcountStart: number; headcountEnd: number; hires: number; departures: number
  turnoverPercent: number | null; retentionPercent: number | null
  hiresWith90Days: number; hiresKept90Days: number; ninetyDayRetentionPercent: number | null
  averageTenureDaysOfDeparted: number | null
  departed: Array<{ caregiverId: string; name: string; hired: string; lastWorked: string; tenureDays: number }>
}

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const pct = (v: number | null) => (v === null ? '—' : `${v}%`)
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export default function MarginReports() {
  const billing = useMay('care-billing')
  const payroll = useMay('care-payroll')
  const hr = useMay('care-hr')
  const toast = useToast()
  const canMargin = billing.read && payroll.read
  const [tab, setTab] = useState<'margin' | 'turnover'>(canMargin ? 'margin' : 'turnover')
  const [end, setEnd] = useState(agencyToday())
  const [start, setStart] = useState(shift(agencyToday(), -29))
  const [margin, setMargin] = useState<MarginReply | null>(null)
  const [turnover, setTurnover] = useState<TurnoverReply | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const q = `startDate=${start}&endDate=${end}`
    try {
      if (tab === 'margin' && canMargin) setMargin(await api.get(`/api/margin-reports/client-margin?${q}`) as MarginReply)
      if (tab === 'turnover' && hr.read) setTurnover(await api.get(`/api/margin-reports/turnover?${q}`) as TurnoverReply)
    } catch (e) { toast.error(errorMessage(e, 'Could not load the report')) }
    finally { setLoading(false) }
  }, [tab, start, end, canMargin, hr.read, toast])
  useEffect(() => { load() }, [load])

  if (!canMargin && !hr.read) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">You do not have access to these reports.</div>
  const tabBtn = (id: 'margin' | 'turnover', label: string) => (
    <button type="button" className={`hc-btn hc-btn-sm ${tab === id ? 'hc-btn-primary' : 'hc-btn-secondary'}`} onClick={() => setTab(id)}>{label}</button>
  )

  return (
    <div className="p-4 max-w-5xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Margin &amp; turnover</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">What each client brings in after the caregiver&apos;s pay, and how many caregivers stay.</p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        {canMargin && tabBtn('margin', 'Client margin')}
        {hr.read && tabBtn('turnover', 'Caregiver turnover')}
        <label className="text-sm">From<br /><input type="date" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-sm">To<br /><input type="date" className={inp} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>

      {loading && <div className="text-sm text-gray-600 dark:text-slate-400">Loading…</div>}

      {!loading && tab === 'margin' && margin && (
        <>
          <p className="text-sm mb-2">
            <b>{money(margin.totals.billed)}</b> billed · <b>{money(margin.totals.pay + margin.totals.mileage)}</b> caregiver cost · <b>{money(margin.totals.margin)}</b> margin over {margin.totals.hours} hours
          </p>
          {margin.totals.clientsWithoutRate > 0 && <p className="text-sm mb-2 text-amber-800 dark:text-amber-300">{margin.totals.clientsWithoutRate} client(s) have no bill rate, so no margin is shown for them. Set a rate on the client or the payer.</p>}
          {margin.hoursWithoutClient > 0 && <p className="text-sm mb-2 text-gray-600 dark:text-slate-400">{margin.hoursWithoutClient} paid hours are not tied to a client and are left out of the table.</p>}
          {margin.clients.length === 0 ? (
            <div className="rounded-lg p-6 text-center text-sm bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">No paid visits in these dates.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Client</th><th>Hours</th><th>Overtime hrs</th><th>Bill rate</th><th>Billed</th><th>Caregiver pay</th><th>Mileage</th><th>Margin</th><th>%</th></tr></thead>
                <tbody>
                  {margin.clients.map((r) => (
                    <tr key={r.clientId} className="border-t border-gray-100 dark:border-slate-700">
                      <td className="px-3 py-2 font-semibold">{r.clientName}</td>
                      <td>{r.hours}</td><td>{r.overtimeHours}</td>
                      <td>{r.rate === null ? 'None' : money(r.rate)}</td>
                      <td>{r.billed === null ? '—' : money(r.billed)}</td>
                      <td>{money(r.pay)}</td><td>{money(r.mileage)}</td>
                      <td className={r.margin !== null && r.margin < 0 ? 'text-red-700 dark:text-red-300 font-semibold' : ''}>{r.margin === null ? '—' : money(r.margin)}</td>
                      <td>{pct(r.marginPercent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs mt-2 text-gray-600 dark:text-slate-400">Pay is the same figure payroll uses (overtime goes on the visits that went past 40 hours in a week). Travel time between visits is not included yet.</p>
        </>
      )}

      {!loading && tab === 'turnover' && turnover && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              ['Caregivers at start', String(turnover.headcountStart)], ['Caregivers at end', String(turnover.headcountEnd)],
              ['Hired', String(turnover.hires)], ['Left', String(turnover.departures)],
              ['Turnover', pct(turnover.turnoverPercent)], ['Retention', pct(turnover.retentionPercent)],
              ['Kept 90 days', turnover.hiresWith90Days ? `${turnover.hiresKept90Days} of ${turnover.hiresWith90Days} (${pct(turnover.ninetyDayRetentionPercent)})` : '—'],
              ['Average stay of those who left', turnover.averageTenureDaysOfDeparted === null ? '—' : `${turnover.averageTenureDaysOfDeparted} days`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border p-3 border-gray-200 dark:border-slate-700">
                <div className="text-xs text-gray-600 dark:text-slate-400">{label}</div><div className="text-lg font-semibold">{value}</div>
              </div>
            ))}
          </div>
          {turnover.departed.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Caregiver</th><th>Hired</th><th>Last worked</th><th>Stayed</th></tr></thead>
                <tbody>{turnover.departed.map((p) => (
                  <tr key={p.caregiverId} className="border-t border-gray-100 dark:border-slate-700">
                    <td className="px-3 py-2 font-semibold">{p.name}</td><td>{formatAgencyDate(p.hired)}</td><td>{formatAgencyDate(p.lastWorked)}</td><td>{p.tenureDays} days</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          <p className="text-xs mt-2 text-gray-600 dark:text-slate-400">There is no leaving date on a caregiver, so someone who is no longer active is counted as leaving on the day of their last visit.</p>
        </>
      )}
    </div>
  )
}
