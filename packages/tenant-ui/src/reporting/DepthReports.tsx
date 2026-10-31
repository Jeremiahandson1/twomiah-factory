// Three cards a builder buys on, under the Reports page (brief item 8). Each shows only where the business has its feature
// (receivables aging: ar_aging; work in progress and the job-profit list: wip_report) and the seat may read reports; each
// fetches its own numbers, so a business without them never asks. Server: apps/unified crm/field/reportsDepth.ts.
import React, { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { money } from '../invoicing/ui'
import type { ReportingApi } from './types'
import { downloadCsv, csvName, type CsvCell } from './csv'

const card = 'bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6'
const muted = 'text-gray-500 dark:text-slate-400'
const th = 'py-2 pr-3 text-right text-xs uppercase text-gray-600 dark:text-slate-400'
const td = 'py-2 pr-3 text-right text-gray-700 dark:text-slate-300 whitespace-nowrap'
const amount = (n: unknown) => (Number(n) || 0).toFixed(2)

function Head({ title, note, onCsv }: { title: string; note?: string; onCsv?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-slate-100">{title}</h3>
        {note && <p className={`text-xs ${muted} mt-1`}>{note}</p>}
      </div>
      {onCsv && (
        <button type="button" onClick={onCsv} aria-label={`Download ${title} as CSV`}
          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
          <Download className="w-3.5 h-3.5" />CSV
        </button>
      )}
    </div>
  )
}

/** What a card says while its numbers come, and if they do not: words, never an empty box. */
function useCard<T>(api: ReportingApi, path: string, params?: Record<string, unknown>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setData(null); setError('')
    Promise.resolve(api.get(path, params)).then((r: any) => { if (live) setData(r as T) }).catch((e: Error) => { if (live) setError(e?.message || 'Could not load this report') })
    return () => { live = false }
  }, [api, path])
  return { data, error }
}
const Waiting = ({ what, error }: { what: string; error: string }) =>
  error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>
    : <p role="status" className={`text-sm ${muted}`}>Loading {what}…</p>

interface Aging { asOf: string; totals: Record<string, number>; invoiceCount: number; customers: Array<{ contactId: string | null; name: string; invoiceCount: number; current: number; days1to30: number; days31to60: number; days61to90: number; over90: number; total: number }> }
const AGING_COLS: Array<[keyof Aging['totals'], string]> = [['current', 'Current'], ['days1to30', '1–30'], ['days31to60', '31–60'], ['days61to90', '61–90'], ['over90', '90+']]

export function ReceivablesAgingCard({ api }: { api: ReportingApi }) {
  const { data, error } = useCard<Aging>(api, '/api/receivables/aging')
  const csv = () => {
    if (!data) return
    const rows: CsvCell[][] = data.customers.map((c) => [c.name, c.invoiceCount, ...AGING_COLS.map(([k]) => amount((c as any)[k])), amount(c.total)])
    rows.push(['All customers', data.invoiceCount, ...AGING_COLS.map(([k]) => amount(data.totals[k])), amount(data.totals.total)])
    downloadCsv(csvName('Receivables aging', data.asOf), ['Customer', 'Invoices', ...AGING_COLS.map(([, l]) => `${l} days past due`.replace('Current days past due', 'Current')), 'Total owed'], rows)
  }
  return (
    <div className={card} data-report="receivables-aging">
      <Head title="Who owes you" note={data ? `Unpaid invoices by how many days past their due date, as of ${data.asOf}. Current means not yet due, or no due date.` : undefined} onCsv={data && data.customers.length ? csv : undefined} />
      {!data ? <Waiting what="what customers owe" error={error} /> : data.customers.length === 0 ? <p className={`text-sm ${muted}`}>Nobody owes you anything right now.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr><th className="py-2 pr-3 text-left text-xs uppercase text-gray-600 dark:text-slate-400">Customer</th>{AGING_COLS.map(([k, l]) => <th key={k} className={th}>{l}</th>)}<th className={`${th} pr-0`}>Total</th></tr></thead>
            <tbody>
              {data.customers.map((c) => (
                <tr key={c.contactId || 'none'} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="py-2 pr-3 text-gray-900 dark:text-slate-100">{c.name}<span className={`block text-xs ${muted}`}>{c.invoiceCount} invoice{c.invoiceCount === 1 ? '' : 's'}</span></td>
                  {AGING_COLS.map(([k]) => <td key={k} className={td}>{(c as any)[k] ? money((c as any)[k]) : '–'}</td>)}
                  <td className="py-2 text-right font-semibold text-gray-900 dark:text-slate-100 whitespace-nowrap">{money(c.total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 dark:border-slate-600 font-semibold">
                <td className="py-2 pr-3 text-gray-900 dark:text-slate-100">All customers</td>
                {AGING_COLS.map(([k]) => <td key={k} className={td}>{data.totals[k] ? money(data.totals[k]) : '–'}</td>)}
                <td className="py-2 text-right text-gray-900 dark:text-slate-100 whitespace-nowrap">{money(data.totals.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

interface WipRow { kind: 'project' | 'job'; id: string; number: string; name: string; contractValue: number; approvedChanges: number; contractSource: 'quotes' | 'estimate' | 'none'; billed: number; costToDate: number; percentComplete: number | null; percentSource: 'cost' | 'progress' | 'none'; costsMissingOnBudget: boolean; earned: number | null; overUnder: number | null }
interface Wip { rows: WipRow[]; totals: { contractValue: number; billed: number; costToDate: number; earned: number; overUnder: number }; truncated?: boolean }

export function WipCard({ api, jobsLabel }: { api: ReportingApi; jobsLabel: string }) {
  const { data, error } = useCard<Wip>(api, '/api/wip')
  const oneJob = jobsLabel.replace(/s$/, '').toLowerCase()
  const csv = () => {
    if (!data) return
    downloadCsv(csvName('Work in progress'), ['Number', 'Name', 'Contract value', 'Billed to date', 'Cost to date', 'Percent complete', 'Earned', 'Over (+) / under (−) billed'],
      data.rows.map((r) => [r.number, r.name, amount(r.contractValue), amount(r.billed), amount(r.costToDate), r.percentComplete ?? '', r.earned === null ? '' : amount(r.earned), r.overUnder === null ? '' : amount(r.overUnder)]))
  }
  const tone = (n: number | null) => n === null || Math.abs(n) < 0.005 ? '' : n > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'
  return (
    <div className={card} data-report="wip">
      <Head title="Work in progress" note="Each open project against what it was sold for. Over billed means you have billed ahead of the work done; under billed means the work is ahead of the billing." onCsv={data && data.rows.length ? csv : undefined} />
      {!data ? <Waiting what="your open projects" error={error} /> : data.rows.length === 0 ? <p className={`text-sm ${muted}`}>Nothing is open right now.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead><tr><th className="py-2 pr-3 text-left text-xs uppercase text-gray-600 dark:text-slate-400">Project</th><th className={th}>Contract</th><th className={th}>Billed</th><th className={th}>Cost so far</th><th className={th}>Done</th><th className={`${th} pr-0`}>Over / under billed</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="py-2 pr-3 text-gray-900 dark:text-slate-100">{r.name}
                    <span className={`block text-xs ${muted}`}>{r.number}{r.kind === 'job' ? ` · ${oneJob}` : ''}{r.approvedChanges ? ` · includes ${money(r.approvedChanges)} of approved changes` : ''}{r.contractSource === 'estimate' ? ' · estimated value, no approved quote yet' : ''}</span></td>
                  <td className={td}>{money(r.contractValue)}</td>
                  <td className={td}>{money(r.billed)}</td>
                  <td className={td}>{money(r.costToDate)}{r.costsMissingOnBudget && <span className={`block text-xs ${muted}`}>some lines have no cost</span>}</td>
                  <td className={td}>{r.percentComplete === null ? <span className={`text-xs ${muted}`}>needs a quote with costs</span> : `${r.percentComplete}%`}{r.percentSource === 'progress' && <span className={`block text-xs ${muted}`}>from the project’s progress</span>}</td>
                  <td className={`py-2 text-right whitespace-nowrap font-medium ${tone(r.overUnder)}`}>{r.overUnder === null ? '–' : r.overUnder > 0.005 ? `${money(r.overUnder)} over` : r.overUnder < -0.005 ? `${money(-r.overUnder)} under` : 'On target'}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300 dark:border-slate-600 font-semibold">
                <td className="py-2 pr-3 text-gray-900 dark:text-slate-100">All open</td>
                <td className={td}>{money(data.totals.contractValue)}</td><td className={td}>{money(data.totals.billed)}</td><td className={td}>{money(data.totals.costToDate)}</td><td />
                <td className={`py-2 text-right whitespace-nowrap ${tone(data.totals.overUnder)}`}>{data.totals.overUnder > 0.005 ? `${money(data.totals.overUnder)} over` : data.totals.overUnder < -0.005 ? `${money(-data.totals.overUnder)} under` : 'On target'}</td>
              </tr>
            </tbody>
          </table>
          {data.truncated && <p className={`text-xs ${muted} mt-2`}>Only the newest {jobsLabel.toLowerCase()} are listed.</p>}
        </div>
      )}
    </div>
  )
}

interface Profit { jobs: Array<{ id: string; number: string; title: string; contact?: string | null; invoicedRevenue: number; totalCost: number; profit: number; margin: number }>; totals: { invoicedRevenue: number; totalCost: number; profit: number; margin: number } }

/** The Job Costing roll-up as a short list on the Reports page: best and worst first, with a way through to the full page. */
export function JobProfitCard({ api, jobsLabel, costingPath }: { api: ReportingApi; jobsLabel: string; costingPath?: string }) {
  const { data, error } = useCard<Profit>(api, '/api/job-costing/summary', { limit: 500 })
  const csv = () => {
    if (!data) return
    downloadCsv(csvName(`${jobsLabel} profit`), ['Number', 'Name', 'Customer', 'Billed', 'Cost', 'Profit', 'Margin %'],
      data.jobs.map((j) => [j.number, j.title, j.contact || '', amount(j.invoicedRevenue), amount(j.totalCost), amount(j.profit), j.invoicedRevenue > 0 ? j.margin : '']))
  }
  const withMoney = (data?.jobs || []).filter((j) => j.invoicedRevenue > 0 || j.totalCost > 0).sort((a, b) => b.profit - a.profit)
  return (
    <div className={card} data-report="job-profit">
      <Head title={`${jobsLabel.replace(/s$/, '')} profit`} note="Billed less what each one has cost so far, most profitable first." onCsv={data && withMoney.length ? csv : undefined} />
      {!data ? <Waiting what={`${jobsLabel.toLowerCase()} profit`} error={error} /> : withMoney.length === 0 ? <p className={`text-sm ${muted}`}>Nothing has been billed or costed yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead><tr><th className="py-2 pr-3 text-left text-xs uppercase text-gray-600 dark:text-slate-400">{jobsLabel.replace(/s$/, '')}</th><th className={th}>Billed</th><th className={th}>Cost</th><th className={th}>Profit</th><th className={`${th} pr-0`}>Margin</th></tr></thead>
            <tbody>
              {withMoney.slice(0, 15).map((j) => (
                <tr key={j.id} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="py-2 pr-3 text-gray-900 dark:text-slate-100">{j.title}<span className={`block text-xs ${muted}`}>{j.number}{j.contact ? ` · ${j.contact}` : ''}</span></td>
                  <td className={td}>{money(j.invoicedRevenue)}</td><td className={td}>{money(j.totalCost)}</td>
                  <td className={`${td} font-medium ${j.profit < 0 ? 'text-red-700 dark:text-red-400' : ''}`}>{money(j.profit)}</td>
                  <td className={`py-2 text-right whitespace-nowrap ${j.profit < 0 ? 'text-red-700 dark:text-red-400' : 'text-gray-700 dark:text-slate-300'}`}>{j.invoicedRevenue > 0 ? `${j.margin.toFixed(1)}%` : 'no revenue'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`text-xs ${muted} mt-2`}>{withMoney.length > 15 ? `The top 15 of ${withMoney.length}; the CSV has all of them. ` : ''}{costingPath && <a href={costingPath} className="underline">Open the full breakdown</a>}</p>
        </div>
      )}
    </div>
  )
}
