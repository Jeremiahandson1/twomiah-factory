// Under a route's stops: how the last 30 days went (earned against cost, worst property first) and a shorter order for the stops.
// The profit bar is money — the seat that reads reports (the server asks the same); the order is shown to anyone who reads jobs
// and moved only by a seat that may edit them.
import { useEffect, useState } from 'react'
import { Loader2, MapPin, Route as RouteIcon } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useMayWrite } from '../../../shared'
import { money } from '@twomiah/tenant-ui/src/money'

interface Totals {
  visits: number; completed: number; open: number; earned: number; billed?: number; unbilled?: number
  labourHours: number; labourCost: number; materialCost: number; expenseCost: number; cost: number; profit: number
  marginPercent: number | null; earnedPerLabourHour: number | null; unratedLabourHours: number
}
interface Profit { from: string; to: string; totals: Totals; properties: Array<Totals & { siteId: string; name: string }> }
interface Optimize {
  current: string[]; proposed: string[]; changes: boolean; message?: string
  stops: Array<{ stopId: string; siteName: string }>
  unplaced?: Array<{ stopId: string; siteName: string; canLocate: boolean }>
  savings?: { miles: number; minutes: number } | null
}

const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback

export default function RouteInsights({ routeId, onChanged }: { routeId: string; onChanged: () => void }) {
  const toast = useToast()
  const mayProfit = useMayWrite('reports:read')
  const mayMove = useMayWrite('jobs:update')
  const [profit, setProfit] = useState<Profit | null>(null)
  const [best, setBest] = useState<Optimize | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setProfit(null); setBest(null)
    if (mayProfit) api.get(`/api/recurring-routes/${routeId}/profit`).then((r: any) => setProfit(r?.data ?? r)).catch(() => setProfit(null))
  }, [routeId, mayProfit])

  const look = async () => {
    setBusy(true)
    try { const r = await api.get(`/api/recurring-routes/${routeId}/optimize`) as any; setBest(r?.data ?? r) }
    catch (e) { toast.error(errorText(e, 'Could not check the order')) }
    finally { setBusy(false) }
  }
  const locate = async () => {
    setBusy(true)
    try {
      const r = await api.post(`/api/recurring-routes/${routeId}/locate`) as any
      const out = r?.data ?? r
      toast.success(out?.message || `${out?.located?.length ?? 0} placed on the map`)
      await look()
    } catch (e) { toast.error(errorText(e, 'Could not put the properties on the map')) }
    finally { setBusy(false) }
  }
  const apply = async () => {
    if (!best) return
    setBusy(true)
    try {
      await api.put(`/api/recurring-routes/${routeId}/stops/reorder`, { stopIds: best.proposed })
      toast.success('Stops moved and the coming visits re-timed')
      setBest(null); onChanged()
    } catch (e) { toast.error(errorText(e, 'Could not move the stops')) }
    finally { setBusy(false) }
  }

  const t = profit?.totals
  const nameOf = (id: string) => best?.stops.find((s) => s.stopId === id)?.siteName || 'Stop'
  return (
    <div className="mt-4 space-y-4">
      {mayProfit && t && (
        <div className="border-t dark:border-slate-700 pt-3">
          <h3 className="text-sm font-semibold">Last 30 days</h3>
          {t.completed === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">No finished visits in the last 30 days yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-sm">
                <div><div className="text-xs text-gray-500 dark:text-slate-400">Earned</div><div className="font-semibold">{money(t.earned)}</div></div>
                <div><div className="text-xs text-gray-500 dark:text-slate-400">Cost</div><div className="font-semibold">{money(t.cost)}</div></div>
                <div><div className="text-xs text-gray-500 dark:text-slate-400">Profit</div><div className={`font-semibold ${t.profit < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{money(t.profit)}{t.marginPercent != null ? ` · ${t.marginPercent}%` : ''}</div></div>
                <div><div className="text-xs text-gray-500 dark:text-slate-400">Crew hours</div><div className="font-semibold">{t.labourHours}{t.earnedPerLabourHour != null ? ` · ${money(t.earnedPerLabourHour)}/hr` : ''}</div></div>
              </div>
              {t.unbilled != null && t.unbilled > 0 && <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">{money(t.unbilled)} of finished work is not billed yet.</p>}
              {t.unratedLabourHours > 0 && <p className="text-xs text-amber-700 mt-1 dark:text-amber-400">{t.unratedLabourHours} crew hours have no pay rate, so they cost nothing here. Set the rates to see the true profit.</p>}
              <ul className="mt-2 divide-y dark:divide-slate-700 text-sm">
                {profit!.properties.map((p) => (
                  <li key={p.siteId} className="flex justify-between py-1"><span>{p.name}</span><span className={p.profit < 0 ? 'text-red-600 dark:text-red-400' : ''}>{money(p.profit)}</span></li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="border-t dark:border-slate-700 pt-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold flex items-center gap-1"><RouteIcon className="w-4 h-4" /> Shortest order</h3>
          <button onClick={look} disabled={busy} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Check the order
          </button>
        </div>
        {best && (
          <div className="mt-2 text-sm">
            {best.message && <p className="text-gray-600 dark:text-slate-300">{best.message}</p>}
            {best.unplaced && best.unplaced.length > 0 && (
              <>
                <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Not on the map: {best.unplaced.map((u) => u.siteName).join(', ')}.</p>
                {mayMove && <button onClick={locate} disabled={busy} className="btn-secondary text-sm mt-2 flex items-center gap-1 disabled:opacity-50"><MapPin className="w-4 h-4" /> Put them on the map</button>}
              </>
            )}
            {best.changes && (
              <>
                <ol className="list-decimal ml-5 mt-2">{best.proposed.map((id) => <li key={id}>{nameOf(id)}</li>)}</ol>
                {best.savings && <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">Saves about {best.savings.miles} miles and {best.savings.minutes} minutes a day.</p>}
                {mayMove && <button onClick={apply} disabled={busy} className="btn-primary text-sm mt-2 disabled:opacity-50">Use this order</button>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
