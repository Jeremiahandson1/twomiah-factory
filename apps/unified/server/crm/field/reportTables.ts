// What the saved and scheduled reports share: a report as a table (columns the person can choose, rows with links to the
// customer, plan or invoice behind them), the CSV of one, and the period a saved report names (rolling, so a scheduled one
// always reports on the latest days). Pure — the reports build the tables, this only shapes and writes them.
import { storeDayStart, storeDateString } from '@twomiah/tenant-backend'

export type ColKind = 'text' | 'money' | 'number' | 'date' | 'datetime' | 'percent'
export interface Col {
  key: string; label: string; kind?: ColKind
  /** The cell opens a record: which kind, and the row key that holds its id. */
  link?: 'contact' | 'agreement' | 'invoice' | 'job'; idKey?: string
  /** Shown unless the person has chosen their own columns. */
  default?: boolean
}
/** A row: its cells by column key, and `drill` — the cells that open another view of the report, with that view's filters. */
export type Row = Record<string, any> & { drill?: Record<string, Record<string, string>> }
export interface ReportTable { tab: string; title: string; columns: Col[]; rows: Row[]; totals?: Row | null; note?: string }

export const PERIOD_IDS = ['month', 'last_month', '30', 'quarter', 'year', 'all'] as const
export type PeriodId = typeof PERIOD_IDS[number]

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** The first and last day of a named period, counted on the business's own calendar (`today` is its today, YYYY-MM-DD). */
export function resolvePeriod(id: string, today: string): { startDate?: string; endDate?: string } {
  const [y, m, d] = today.split('-').map(Number)
  switch (id) {
    case 'month': return { startDate: ymd(y, m, 1), endDate: today }
    case 'last_month': { const ly = m === 1 ? y - 1 : y, lm = m === 1 ? 12 : m - 1; return { startDate: ymd(ly, lm, 1), endDate: ymd(ly, lm, new Date(Date.UTC(ly, lm, 0)).getUTCDate()) } }
    case '30': { const t = new Date(Date.UTC(y, m - 1, d - 29)); return { startDate: ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), endDate: today } }
    case 'quarter': return { startDate: ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1), endDate: today }
    case 'year': return { startDate: ymd(y, 1, 1), endDate: today }
    default: return {}
  }
}

/** The month (YYYY-MM) a day marker sits in, and a month's first instant on the company's clock. */
export const monthOf = (when: Date, tz: string) => storeDateString(when, tz).slice(0, 7)
export const monthStartIn = (tz: string) => (ym: string) => storeDayStart(`${ym}-01`, tz)

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
const cellText = (c: Col, v: unknown): string => {
  if (v == null || v === '') return ''
  if ((c.kind === 'money' || c.kind === 'percent') && typeof v === 'number') return v.toFixed(c.kind === 'money' ? 2 : 0)
  return String(v)
}

/** Keep only the chosen columns (in the report's own order); no choice, or none that exist, is the default set. */
export function chooseColumns(all: Col[], keys?: string[] | null): Col[] {
  const want = new Set((keys ?? []).filter(Boolean))
  const picked = want.size ? all.filter((c) => want.has(c.key)) : []
  if (picked.length) return picked
  const defaults = all.filter((c) => c.default !== false)
  return defaults.length ? defaults : all
}

/** CSV, one line a row and a total line when the report has one; CRLF, every cell quoted, as the other downloads. */
export function csvOf(table: ReportTable, columns: Col[]): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')]
  for (const r of table.rows) lines.push(columns.map((c) => csvCell(cellText(c, r[c.key]))).join(','))
  if (table.totals) lines.push(columns.map((c) => csvCell(cellText(c, table.totals![c.key]))).join(','))
  return lines.join('\r\n')
}
