// A dealer's live inventory (RV, marine, powersports): site.inventoryFeedUrl is a feed — the CRM's marketplace
// feed (.json or .csv) or any feed with the same columns. When set, /inventory and /inventory/<stock> show the real
// units, and a composed "featured inventory" section shows real ones. Moved from the premium site's server-static.ts.

/** The feed address, only if it is public https: the response is shown publicly, so never an address inside the network. */
export function feedUrlOk(raw: unknown): string | null {
  try {
    const u = new URL(String(raw || '').trim())
    if (u.protocol !== 'https:') return null
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':')) return null
    return u.toString()
  } catch { return null }
}

export function parseCsvRows(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const head = (rows.shift() || []).map((h) => h.trim())
  // The CRM's CSV prefixes cells that start with = + - @ with a quote (its formula-injection guard).
  return rows.filter((r) => r.some((v) => v.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').replace(/^'(?=[=+\-@])/, '')])))
}

const feedNum = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null }

export function unitFromListing(l: any) {
  const s = (v: unknown) => String(v ?? '').trim()
  const stock = s(l.stockNumber || l.stock || l.vin).slice(0, 60)
  const year = s(l.year), make = s(l.make), model = s(l.model), trim = s(l.trim)
  const photos = (Array.isArray(l.photoUrls) ? l.photoUrls : s(l.photoUrls).split('|')).map(s).filter((u: string) => /^https:\/\//i.test(u)).slice(0, 40)
  return {
    stock, slug: stock.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
    title: [year, make, model, trim].filter(Boolean).join(' '),
    year, make, model, trim, vin: s(l.vin), condition: s(l.condition).toLowerCase() || 'used', category: s(l.category),
    rvClass: s(l.rvClass), towableType: s(l.towableType), price: feedNum(l.price), msrp: feedNum(l.msrp),
    lengthFt: s(l.lengthFt), sleeps: s(l.sleeps), slideOuts: s(l.slideOuts), mileage: feedNum(l.mileage), hours: s(l.hours), engineCc: s(l.engineCc),
    beamFt: s(l.beamFt), draftFt: s(l.draftFt), hullMaterial: s(l.hullMaterial), engineType: s(l.engineType), engineHp: s(l.engineHp),
    engineCount: s(l.engineCount), fuelCapacityGal: s(l.fuelCapacityGal), maxPersons: s(l.maxPersons), trailerIncluded: s(l.trailerIncluded),
    exteriorColor: s(l.exteriorColor), photos, description: s(l.description).slice(0, 5000),
  }
}
export type FeedUnit = ReturnType<typeof unitFromListing>

export function unitSpecs(u: FeedUnit) {
  const rows: Array<[string, unknown]> = [
    ['Year', u.year], ['Make', u.make], ['Model', u.model], ['Trim', u.trim], ['Class', u.rvClass], ['Type', u.towableType],
    ['Length', u.lengthFt && u.lengthFt + ' ft'], ['Sleeps', u.sleeps], ['Slide-outs', u.slideOuts],
    ['Mileage', u.mileage && Number(u.mileage).toLocaleString('en-US') + ' mi'], ['Hours', u.hours], ['Engine size', u.engineCc && u.engineCc + ' cc'],
    ['Beam', u.beamFt && u.beamFt + ' ft'], ['Draft', u.draftFt && u.draftFt + ' ft'], ['Hull', u.hullMaterial], ['Engine', u.engineType],
    ['Horsepower', u.engineHp], ['Engines', u.engineCount], ['Fuel', u.fuelCapacityGal && u.fuelCapacityGal + ' gal'],
    ['Capacity', u.maxPersons && u.maxPersons + ' people'], ['Trailer', u.trailerIncluded === 'yes' ? 'Included' : u.trailerIncluded === 'no' ? 'Not included' : ''],
    ['Color', u.exteriorColor],
  ]
  return rows.filter(([, v]) => v && String(v) !== '0').map(([label, value]) => ({ label, value: String(value) }))
}

let feedCache: { url: string; at: number; units: FeedUnit[] } | null = null

/** The feed's units, cached ten minutes; on a failed fetch the last good copy, else null. */
export async function feedUnits(feedUrl: unknown): Promise<FeedUnit[] | null> {
  const url = feedUrlOk(feedUrl)
  if (!url) return null
  if (feedCache && feedCache.url === url && Date.now() - feedCache.at < 10 * 60_000) return feedCache.units
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const text = (await r.text()).slice(0, 8_000_000)
    const head = text.trimStart()
    let listings: any[]
    if (head.startsWith('{') || head.startsWith('[')) {
      const j = JSON.parse(text)
      listings = Array.isArray(j) ? j : Array.isArray(j?.listings) ? j.listings : []
    } else listings = parseCsvRows(text)
    const seen = new Set<string>()
    const units = listings.slice(0, 2000).map(unitFromListing).filter((u) => {
      if (!u.slug || !u.title || seen.has(u.slug)) return false
      seen.add(u.slug)
      return true
    })
    feedCache = { url, at: Date.now(), units }
    return units
  } catch (e: any) {
    console.warn('[Inventory] feed fetch failed:', e.message)
    return feedCache && feedCache.url === url ? feedCache.units : null
  }
}
