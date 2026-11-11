// The materials list on a saved roof report (GET /api/roof-reports/:id/materials — server reportMaterials.ts): what to
// order for the roof as measured. The roofer sets the waste, the rows of ice and water, and what nothing can measure: how
// many pipe boots and box vents there are and how many feet of ridge vent; the list is worked again on the server each time, and the same settings go to the print page.
import { useEffect, useState } from 'react'
import { api } from '../../../../api'

export interface MaterialSettings { wastePercent: number; bundleSqFt: number; pipeBoots: number; boxVents: number; ridgeVentFt: number; iceWaterEaveRows: number; iceWaterValleyRows: number }
interface Line { code: string; description: string; qty: number; unit: string; basis: string }
interface Built { lines: Line[]; warnings: string[]; settings: MaterialSettings; squares: number; orderedSquares: number }

const plural = (unit: string, qty: number) => (qty === 1 || unit === 'each' ? unit : unit === 'box' ? 'boxes' : `${unit}s`)

export default function ReportMaterials({ reportId, onSettings }: { reportId: string; onSettings: (s: MaterialSettings) => void }) {
  const [built, setBuilt] = useState<Built | null>(null)
  const [failed, setFailed] = useState(false)
  /** What the roofer has changed; anything not changed is the server's own starting figure. */
  const [changed, setChanged] = useState<Partial<Record<keyof MaterialSettings, string>>>({})

  useEffect(() => {
    let live = true
    const params: Record<string, string> = {}
    for (const [k, v] of Object.entries(changed)) if (v !== undefined && v !== '') params[k] = v
    const timer = setTimeout(() => {
      api.get(`/api/roof-reports/${reportId}/materials`, params)
        .then((r: any) => { if (live) { setBuilt(r as Built); setFailed(false); onSettings((r as Built).settings) } })
        .catch(() => { if (live) setFailed(true) })
    }, 250)
    return () => { live = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, changed])

  const shown = (k: keyof MaterialSettings) => changed[k] ?? (built ? String(built.settings[k]) : '')
  const set = (k: keyof MaterialSettings, v: string) => setChanged((c) => ({ ...c, [k]: v }))
  const field = 'w-20 px-2 py-1.5 text-sm border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700'
  const label = 'flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300'

  return (
    <div className="bg-white rounded-xl shadow-sm border overflow-x-auto dark:bg-slate-900">
      <div className="px-4 py-3 border-b bg-gray-50 dark:bg-slate-900">
        <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider dark:text-slate-100">Materials list</h2>
        <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">What to order for this roof. Every quantity is rounded up to a whole bundle, roll or piece.</p>
      </div>
      <div className="px-4 py-3 border-b flex flex-wrap items-center gap-x-6 gap-y-3 dark:border-slate-800">
        <label className={label}>Waste %
          <input type="number" min={0} max={50} value={shown('wastePercent')} onChange={(e) => set('wastePercent', e.target.value)} className={field} />
        </label>
        <label className={label} title="33.3 sq ft is a true bundle: three to a full square. Many shingles cover a little less; check the wrapper.">A bundle covers, sq ft
          <input type="number" min={10} max={40} step={0.1} value={shown('bundleSqFt')} onChange={(e) => set('bundleSqFt', e.target.value)} className={field} />
        </label>
        <label className={label}>Ice and water rows at eaves
          <input type="number" min={0} max={6} value={shown('iceWaterEaveRows')} onChange={(e) => set('iceWaterEaveRows', e.target.value)} className={field} />
        </label>
        <label className={label}>Rows in valleys
          <input type="number" min={0} max={6} value={shown('iceWaterValleyRows')} onChange={(e) => set('iceWaterValleyRows', e.target.value)} className={field} />
        </label>
        <label className={label}>Pipe boots
          <input type="number" min={0} max={200} value={shown('pipeBoots')} onChange={(e) => set('pipeBoots', e.target.value)} className={field} />
        </label>
        <label className={label}>Box vents
          <input type="number" min={0} max={200} value={shown('boxVents')} onChange={(e) => set('boxVents', e.target.value)} className={field} />
        </label>
        <label className={label}>Ridge vent, ft
          <input type="number" min={0} max={2000} value={shown('ridgeVentFt')} onChange={(e) => set('ridgeVentFt', e.target.value)} className={field} />
        </label>
      </div>
      {failed && <p className="px-4 py-3 text-sm text-red-700 dark:text-red-400" role="alert">The materials list could not be loaded. Reload the page to try again.</p>}
      {built && built.lines.length === 0 && !failed && <p className="px-4 py-3 text-sm text-gray-500 dark:text-slate-400">This report has no roof area, so there is nothing to order yet.</p>}
      {built && built.lines.length > 0 && (
        <table className="w-full">
          <thead className="bg-gray-50 border-b dark:bg-slate-900">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Material</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Order</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">How it was worked out</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {built.lines.map((l) => (
              <tr key={l.code}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100">{l.description}</td>
                <td className="px-4 py-3 text-sm text-gray-900 text-right whitespace-nowrap dark:text-slate-100"><span className="font-bold">{l.qty.toLocaleString()}</span> {plural(l.unit, l.qty)}</td>
                <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">{l.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {built && built.warnings.map((w) => (
        <p key={w} className="mx-4 my-3 px-3 py-2 bg-amber-50 text-amber-900 text-xs rounded-lg dark:text-amber-200 dark:bg-amber-950/40">{w}</p>
      ))}
    </div>
  )
}
