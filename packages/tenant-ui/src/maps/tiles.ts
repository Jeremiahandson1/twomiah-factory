// The tiles under every Leaflet map in the CRM (canvassing, storm leads, fleet, caregiver GPS) — one place.
//
// The maps drew OpenStreetMap's own tile servers, which refuse an application's traffic ("Access blocked — tile usage
// policy", the roofing retest 2026-10-24). They now draw Google's, as the roof map editor does
// (apps/unified/web/src/crm/pages/roof/lib/MapProvider.tsx):
//   · with the browser's Maps key served with the page (#vertical-screens mapsBrowserKey, GOOGLE_MAPS_BROWSER_KEY): the
//     Map Tiles API — a session made once per key and kind, then tile.googleapis.com/v1/2dtiles with that session;
//   · with no key, or a key the Map Tiles API refuses: NO tiles and a plain notice. Google's plain tile host
//     (mt*.google.com) is not a licensed API, so it is never used as a fallback (owner rule: best, never cheap).
// A map removed before its session arrived is left alone.

export type TileKind = 'roadmap' | 'hybrid'

const ATTRIBUTION = 'Map data &copy; Google'

// The admin pages send no referrer (Referrer-Policy: no-referrer), but the browser Maps key is restricted to our sites BY
// referrer — Google answers every tile 'Requests from referer <empty> are blocked' (roofing retest, 10/24). The tile
// requests alone send the site's origin, never the page path.
export const REFERRER = 'strict-origin' as const

/** The browser's Maps key, as the server served it with the page; '' when none is set. */
export function browserMapsKey(): string {
  try {
    if (typeof document === 'undefined') return ''
    const k = JSON.parse(document.getElementById('vertical-screens')?.textContent || '{}')?.mapsBrowserKey
    return typeof k === 'string' ? k : ''
  } catch { return '' }
}

const sessions = new Map<string, Promise<string | null>>()

/** A Map Tiles API session for this key and kind, made once per page; null when the API refuses it. */
function tileSession(key: string, kind: TileKind): Promise<string | null> {
  const id = `${kind}:${key}`
  let made = sessions.get(id)
  if (!made) {
    const body = kind === 'hybrid'
      ? { mapType: 'satellite', language: 'en-US', region: 'US', layerTypes: ['layerRoadmap'] }
      : { mapType: 'roadmap', language: 'en-US', region: 'US' }
    made = fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), referrerPolicy: REFERRER,
    }).then(async (r) => (r.ok ? ((await r.json())?.session as string) || null : null)).catch(() => null)
    sessions.set(id, made)
  }
  return made
}

/** The licensed Map Tiles API URL for a session. */
export function tileUrl(key: string, session: string): string {
  return `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`
}

/** Puts Google's tiles under a Leaflet map. `L` is the Leaflet module the caller loaded. */
export function addMapTiles(L: any, map: any, kind: TileKind = 'roadmap'): void {
  const draw = (url: string) => {
    try {
      if (!map || !map.getContainer?.()) return
      L.tileLayer(url, { maxZoom: 20, attribution: ATTRIBUTION, referrerPolicy: REFERRER }).addTo(map)
    } catch { /* the map was removed first */ }
  }
  const notice = () => {
    try {
      if (!map || !map.getContainer?.()) return
      const box = L.control({ position: 'topright' })
      box.onAdd = () => { const d = document.createElement('div'); d.className = 'map-tiles-missing'; d.style.cssText = 'background:#fff;color:#111;padding:6px 10px;border-radius:6px;font:13px system-ui;box-shadow:0 1px 3px rgba(0,0,0,.3)'; d.textContent = 'Map background unavailable — pins and the list still work.'; return d }
      box.addTo(map)
    } catch { /* the map was removed first */ }
  }
  const key = browserMapsKey()
  if (!key) { notice(); return }
  tileSession(key, kind).then((session) => (session ? draw(tileUrl(key, session)) : notice()))
}
