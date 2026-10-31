// Small pieces the people-and-plans report pages share: the period picker, money, and the table frame.
import { Loader2 } from 'lucide-react'

export const PERIODS = [
  { id: 'month', label: 'This month' },
  { id: '30', label: 'Last 30 days' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
] as const
export type PeriodId = typeof PERIODS[number]['id']

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** The query string for a period. The server reads the days on the business's own calendar. */
export function periodQuery(id: PeriodId, now = new Date()): string {
  if (id === 'all') return ''
  const end = ymd(now)
  const start = id === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
    : id === 'quarter' ? new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
    : id === 'year' ? new Date(now.getFullYear(), 0, 1)
    : new Date(now.getTime() - 29 * 86_400_000)
  return `startDate=${ymd(start)}&endDate=${end}`
}

export const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0)

export const card = 'rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900'
export const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-slate-300'
export const td = 'px-3 py-2 text-sm text-gray-900 dark:text-slate-100'
export const tdNum = `${td} text-right tabular-nums`

export function PeriodPicker({ value, onChange }: { value: PeriodId; onChange: (id: PeriodId) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
      <span>Period</span>
      <select value={value} onChange={(e) => onChange(e.target.value as PeriodId)}
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
        {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
    </label>
  )
}

export function Loading() { return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-500 dark:text-slate-300" /></div> }
export function Problem({ text }: { text: string }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{text}</div>
}
export function Empty({ text }: { text: string }) { return <p className="px-4 py-8 text-center text-sm text-gray-600 dark:text-slate-300">{text}</p> }

// ── A period with a custom range (the plan and team revenue reports) ──────────────────────────────────────────────
export const RANGE_PERIODS = [
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: '30', label: 'Last 30 days' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom range' },
] as const
export interface RangeValue { period: string; startDate: string; endDate: string }
/** The query pieces for a range. A named period is sent by name (the server counts it on the business's own calendar); a custom one as two days. */
export function rangeParams(v: RangeValue): Record<string, string> {
  if (v.period !== 'custom') return { period: v.period }
  return { ...(v.startDate ? { startDate: v.startDate } : {}), ...(v.endDate ? { endDate: v.endDate } : {}) }
}
const dateInput = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
export function RangePicker({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
      <label className="flex items-center gap-2"><span>Period</span>
        <select value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value })} className={dateInput}>
          {RANGE_PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      {value.period === 'custom' && (
        <>
          <label className="flex items-center gap-2"><span>From</span><input type="date" value={value.startDate} onChange={(e) => onChange({ ...value, startDate: e.target.value })} className={dateInput} /></label>
          <label className="flex items-center gap-2"><span>To</span><input type="date" value={value.endDate} onChange={(e) => onChange({ ...value, endDate: e.target.value })} className={dateInput} /></label>
        </>
      )}
    </div>
  )
}
