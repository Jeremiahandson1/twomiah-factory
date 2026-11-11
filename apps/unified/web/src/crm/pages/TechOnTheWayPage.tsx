// /on-the-way/<token>: the page behind the link in the "on my way" text (server crm/field/techTrack.ts, /api/tech-track/<token>).
// Where the tech is while they drive there — asked again every 30 seconds — then "arrived", then "over". No sign-in; the link
// opens this one arrival and nothing else of the customer's. The map is the CRM's own (Leaflet on Google's tiles, maps/tiles.ts).
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Check, Loader2, Truck } from 'lucide-react'
import type * as Leaflet from 'leaflet'
import { addMapTiles } from '@twomiah/tenant-ui/src/maps/tiles'

interface View {
  companyName: string
  techName: string
  state: 'on_the_way' | 'arrived' | 'over'
  tech: { lat: number; lng: number; minutesAgo: number } | null
  etaMinutes?: number | null
  destination: { lat: number; lng: number } | null
}
type L = typeof Leaflet

const REFRESH_MS = 30_000

let leafletLoad: Promise<L> | null = null
const ensureLeaflet = (): Promise<L> => {
  if (!leafletLoad) {
    leafletLoad = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([mod]) => ((mod as unknown as { default?: L }).default || (mod as unknown as L)))
      .catch((e) => { leafletLoad = null; throw e })
  }
  return leafletLoad
}

const load = async (token: string): Promise<View> => {
  const r = await fetch(`/api/tech-track/${encodeURIComponent(token)}`)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.error || body?.message || 'This link is not valid any more.')
  return (body?.data ?? body) as View
}

const ago = (m: number) => (m <= 0 ? 'just now' : m === 1 ? '1 minute ago' : `${m} minutes ago`)

/** The tech (and the house, when it is on the map), redrawn as the position moves. */
function TechMap({ tech, destination }: { tech: { lat: number; lng: number }; destination: { lat: number; lng: number } | null }) {
  const box = useRef<HTMLDivElement | null>(null)
  const map = useRef<any>(null)
  const marks = useRef<any[]>([])
  useEffect(() => {
    let live = true
    ensureLeaflet().then((Lf) => {
      if (!live || !box.current) return
      if (!map.current) {
        map.current = Lf.map(box.current, { zoomControl: true, attributionControl: true })
        addMapTiles(Lf, map.current)
      }
      for (const m of marks.current) m.remove()
      const dot = (p: { lat: number; lng: number }, color: string, label: string) =>
        Lf.circleMarker([p.lat, p.lng], { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).bindTooltip(label).addTo(map.current)
      marks.current = [dot(tech, '#ea580c', 'Your technician'), ...(destination ? [dot(destination, '#2563eb', 'Your home')] : [])]
      if (destination) map.current.fitBounds(Lf.latLngBounds([[tech.lat, tech.lng], [destination.lat, destination.lng]]), { padding: [40, 40], maxZoom: 15 })
      else map.current.setView([tech.lat, tech.lng], 14)
    }).catch(() => { /* no map: the words above still say where things stand */ })
    return () => { live = false }
  }, [tech.lat, tech.lng, destination?.lat, destination?.lng])
  useEffect(() => () => { map.current?.remove(); map.current = null }, [])
  return <div ref={box} className="mt-4 h-72 w-full overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700" role="img" aria-label="Map of where your technician is" />
}

export default function TechOnTheWayPage() {
  const { token = '' } = useParams()
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => load(token)
      .then((v) => { if (!live) return; setView(v); setError(''); if (v.state === 'on_the_way') timer = setTimeout(tick, REFRESH_MS) })
      .catch((e) => { if (live) setError((e as Error).message) })
    tick()
    return () => { live = false; if (timer) clearTimeout(timer) }
  }, [token])

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12 dark:bg-slate-950">
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <Truck className="h-8 w-8 text-orange-600 dark:text-orange-300" aria-hidden />
        {!view && !error && <p className="mt-4 flex items-center gap-2 text-gray-700 dark:text-slate-300"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading…</p>}
        {error && !view && <p role="alert" className="mt-4 text-red-700 dark:text-red-300">{error}</p>}
        {view && (
          <>
            {view.companyName && <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">{view.companyName}</p>}
            {view.state === 'on_the_way' && (
              <>
                <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">{view.techName} is on the way</h1>
                {view.tech
                  ? <>
                      {view.etaMinutes != null && <p className="mt-1 text-lg font-medium text-gray-900 dark:text-slate-100">{view.etaMinutes <= 1 ? 'Almost there' : `About ${view.etaMinutes} minutes away`}</p>}
                      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Location updated {ago(view.tech.minutesAgo)}. This page updates by itself.</p>
                      <TechMap tech={view.tech} destination={view.destination} />
                    </>
                  : <p className="mt-2 text-gray-700 dark:text-slate-300">Their location isn&rsquo;t being shared right now. This page will show it if that changes.</p>}
              </>
            )}
            {view.state === 'arrived' && (
              <p className="mt-3 inline-flex items-center gap-2 text-lg font-semibold text-green-700 dark:text-green-400"><Check className="h-5 w-5" aria-hidden />{view.techName} has arrived.</p>
            )}
            {view.state === 'over' && <p className="mt-3 text-gray-700 dark:text-slate-300">This visit is over, so there is nothing to follow any more.</p>}
          </>
        )}
      </div>
    </main>
  )
}
