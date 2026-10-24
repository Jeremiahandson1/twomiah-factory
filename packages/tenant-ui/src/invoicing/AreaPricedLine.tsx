// "Add area-priced line" on a quote: price a property by its measured area with the business's area rates — the same
// answer the Area Pricing page gives (GET /api/area-pricing/quote: max(min charge, area ÷ 1,000 × rate)), put on the
// quote as a line. The quote form had no area option, so the price was typed by hand (landscaping live retest,
// 2026-10-24). Offered where the quote names a property (quoteSites) and Area Pricing is switched on (area_pricing).
import { useEffect, useState } from 'react'
import { Ruler } from 'lucide-react'
import type { LineItemInput } from './types'
import { codeLabel } from '../labels/codes'
import { money } from '../money'

interface Api { get: (path: string, params?: any) => Promise<any> }
interface Toast { success: (m: string) => void; error: (m: string) => void }
interface Rate { id: string; serviceType: string; ratePer1000Sqft: string | number; minCharge: string | number; active?: boolean }

export function AreaPricedLine({ api, toast, siteId, siteLabel, onAdd }: {
  api: Api; toast: Toast; siteId: string; siteLabel: string; onAdd: (line: LineItemInput) => void
}) {
  const [rates, setRates] = useState<Rate[] | null>(null)
  const [serviceType, setServiceType] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api.get('/api/area-pricing/rates')
      .then((r: any) => { const list: Rate[] = (Array.isArray(r) ? r : r?.data || []).filter((x: Rate) => x.active !== false); setRates(list); if (list[0]) setServiceType(list[0].serviceType) })
      .catch(() => setRates([]))
  }, [])
  if (rates === null) return null
  if (rates.length === 0) return <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">Add a rate on the Area Pricing page to price a {siteLabel.toLowerCase()} by its area here.</p>

  const add = async () => {
    if (!siteId) { toast.error(`Pick the ${siteLabel.toLowerCase()} first — the price comes from its measured area`); return }
    setBusy(true)
    try {
      const q = await api.get('/api/area-pricing/quote', { siteId, serviceType })
      const price = Number(q?.price)
      if (!Number.isFinite(price)) throw new Error('No price came back for that service')
      onAdd({ description: String(q?.lineItem?.description || codeLabel(serviceType)), quantity: 1, unitPrice: price, type: 'service' })
      toast.success(`${codeLabel(serviceType)} added at ${money(price)}${q?.minChargeApplied ? ' (the minimum charge)' : ''}`)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'That property could not be priced by its area')
    } finally { setBusy(false) }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label htmlFor="area-priced-service" className="text-sm text-gray-700 dark:text-slate-300">Price by area:</label>
      <select id="area-priced-service" value={serviceType} onChange={(e) => setServiceType(e.target.value)} className="px-2 py-1.5 border rounded-lg text-sm bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700">
        {rates.map((r) => <option key={r.id} value={r.serviceType}>{codeLabel(r.serviceType)} — {money(Number(r.ratePer1000Sqft))} / 1,000 sq ft</option>)}
      </select>
      <button type="button" onClick={add} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
        <Ruler className="w-4 h-4" />{busy ? 'Pricing…' : 'Add area-priced line'}
      </button>
      {!siteId && <span className="text-xs text-gray-500 dark:text-slate-400">Pick the {siteLabel.toLowerCase()} above first.</span>}
    </div>
  )
}

export default AreaPricedLine
