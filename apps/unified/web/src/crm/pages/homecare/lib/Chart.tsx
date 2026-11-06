// The one small chart kit the home care reports draw with (rows 11–13): a line chart over time buckets and a horizontal bar chart,
// inline SVG, no library. Follows the data-viz method: 2px lines, 8px markers with a surface ring, bars at most 24px with rounded
// data-ends, hairline gridlines, a legend whenever there are two or more series, a hover tooltip on every mark, and a table view
// of the same numbers (so a figure is never colour-alone). Series colours are the validated categorical slots 1–3 (blue, orange,
// aqua) in their light and dark steps; text wears text tokens, never the series colour.
import { useId, useState } from 'react'

export interface Series { name: string; values: (number | null)[] }
export interface LineChartProps { labels: string[]; series: Series[]; format?: (v: number) => string; height?: number; title: string; emptyText?: string }

const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a']
const DARK = ['#3987e5', '#d95926', '#199e70']
const isDark = () => typeof document !== 'undefined' && (document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches))
export const seriesColor = (i: number) => (isDark() ? DARK : LIGHT)[i % 3]
const fmtDefault = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })

/** Clean axis ticks: 0, a round step, up to the top of the data (negatives allowed). */
function ticksFor(min: number, max: number): number[] {
  const lo = Math.min(0, min), hi = Math.max(0, max)
  const span = hi - lo || 1
  const raw = span / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag
  const out: number[] = []
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

export function LineChart({ labels, series, format = fmtDefault, height = 220, title, emptyText = 'Nothing to chart yet.' }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const id = useId()
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null)
  if (!labels.length || !all.length) return <div className="rounded-lg p-4 text-sm text-center bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">{emptyText}</div>
  const W = 720, H = height, L = 56, R = 16, T = 16, B = 36
  const ticks = ticksFor(Math.min(...all), Math.max(...all))
  const yMin = ticks[0], yMax = ticks[ticks.length - 1]
  const x = (i: number) => (labels.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (labels.length - 1))
  const y = (v: number) => T + (H - T - B) * (1 - (v - yMin) / (yMax - yMin || 1))
  const path = (vals: (number | null)[]) => vals.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).reduce<string>((acc, p, i) => (p === null ? acc : acc + (i === 0 || vals[i - 1] === null ? ` M ${p}` : ` L ${p}`)), '').trim()
  const nearest = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W
    let best = 0
    for (let i = 1; i < labels.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    setHover(best)
  }
  const every = Math.max(1, Math.ceil(labels.length / 8))
  return (
    <div className="text-gray-900 dark:text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="text-sm font-semibold">{title}</div>
        <div className="flex items-center gap-3">
          {series.length > 1 && (
            <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend">
              {series.map((s, i) => <li key={s.name} className="flex items-center gap-1"><span aria-hidden className="inline-block w-3 h-3 rounded-sm" style={{ background: seriesColor(i) }} />{s.name}</li>)}
            </ul>
          )}
          <button type="button" className="text-xs underline text-gray-600 dark:text-slate-400" onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show table'}</button>
        </div>
      </div>
      {table ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm"><thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-2 py-1">Period</th>{series.map((s) => <th key={s.name} className="px-2 py-1">{s.name}</th>)}</tr></thead>
            <tbody>{labels.map((l, i) => <tr key={l} className="border-t border-gray-100 dark:border-slate-700"><td className="px-2 py-1">{l}</td>{series.map((s) => <td key={s.name} className="px-2 py-1">{s.values[i] === null ? '—' : format(s.values[i] as number)}</td>)}</tr>)}</tbody></table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-t`} onMouseMove={(e) => nearest(e.clientX, e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setHover(null)}>
            <title id={`${id}-t`}>{title}</title>
            {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity={0.12} strokeWidth={1} /><text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.7}>{format(t)}</text></g>)}
            {labels.map((l, i) => (i % every === 0 || i === labels.length - 1) && <text key={l} x={x(i)} y={H - B + 16} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.7}>{l}</text>)}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1} />}
            {series.map((s, si) => (
              <g key={s.name}>
                <path d={path(s.values)} fill="none" stroke={seriesColor(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {s.values.map((v, i) => v !== null && (i === hover || i === s.values.length - 1 || labels.length <= 12) && (
                  <circle key={i} cx={x(i)} cy={y(v)} r={4} fill={seriesColor(si)} stroke="var(--hc-surface, #fff)" strokeWidth={2} className="dark:[stroke:#0f172a]" />
                ))}
              </g>
            ))}
            {labels.map((_, i) => <rect key={i} x={x(i) - (W - L - R) / Math.max(1, labels.length - 1) / 2} y={T} width={(W - L - R) / Math.max(1, labels.length - 1) || W} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />)}
          </svg>
          {hover !== null && (
            <div className="absolute top-1 right-1 rounded-md border px-2 py-1 text-xs shadow bg-white border-gray-200 dark:bg-slate-900 dark:border-slate-600" role="status">
              <div className="font-semibold">{labels[hover]}</div>
              {series.map((s, i) => <div key={s.name} className="flex items-center gap-1"><span aria-hidden className="inline-block w-2 h-2 rounded-sm" style={{ background: seriesColor(i) }} />{s.name}: {s.values[hover] === null ? '—' : format(s.values[hover] as number)}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export interface BarChartProps { rows: { label: string; value: number | null; detail?: string }[]; format?: (v: number) => string; title: string; emptyText?: string; max?: number }

/** Horizontal bars, one series, value at the tip; a negative bar grows left of the baseline. */
export function BarChart({ rows, format = fmtDefault, title, emptyText = 'Nothing to chart yet.', max }: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const vals = rows.map((r) => r.value).filter((v): v is number => v !== null)
  if (!rows.length || !vals.length) return <div className="rounded-lg p-4 text-sm text-center bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">{emptyText}</div>
  const lo = Math.min(0, ...vals), hi = Math.max(max ?? 0, ...vals) || 1
  const W = 720, LABEL = 180, R = 70, rowH = 30, H = rows.length * rowH + 8
  const x = (v: number) => LABEL + ((v - lo) / (hi - lo || 1)) * (W - LABEL - R)
  return (
    <div className="text-gray-900 dark:text-slate-100">
      <div className="text-sm font-semibold mb-1">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        <line x1={x(0)} x2={x(0)} y1={0} y2={H} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
        {rows.map((r, i) => {
          const v = r.value ?? 0, y = 4 + i * rowH
          const x0 = Math.min(x(0), x(v)), w = Math.abs(x(v) - x(0))
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={0} y={y} width={W} height={rowH - 4} fill="transparent" />
              <text x={LABEL - 8} y={y + 17} textAnchor="end" fontSize={12} fill="currentColor">{r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label}</text>
              {r.value !== null && <rect x={x0} y={y + 2} width={Math.max(w, 1)} height={22} rx={v >= 0 ? 4 : 4} fill={seriesColor(0)} opacity={hover === null || hover === i ? 1 : 0.6} />}
              <text x={v >= 0 ? x(v) + 6 : x(v) - 6} y={y + 17} textAnchor={v >= 0 ? 'start' : 'end'} fontSize={12} fill="currentColor" fillOpacity={0.85}>{r.value === null ? '—' : format(r.value)}{hover === i && r.detail ? ` · ${r.detail}` : ''}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
