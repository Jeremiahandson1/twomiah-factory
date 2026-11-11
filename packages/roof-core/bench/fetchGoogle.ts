// Downloads Google's Solar data for every answer-key house ONCE and keeps it in the private test-data folder, so every
// later scoring run is offline and costs nothing. A house already cached is skipped.
//
// Per house: buildingInsights (JSON) and the data layers (height map, roof mask, aerial) at two pixel sizes — 0.25 m,
// which is what the engine asks for today, and 0.1 m, the finest the API offers. A squares-only job that has no
// coordinates yet is geocoded first (one Geocoding call) and its coordinates are written back.
//
//   ROOF_TRUTH_DIR=<private folder> GOOGLE_SOLAR_API_KEY=<key> bun packages/roof-core/bench/fetchGoogle.ts
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadHoverTruth, truthDir } from './hoverTruth.ts'
import { loadSquaresJobs, saveSquaresJobs } from './squaresTruth.ts'

const key = process.env.GOOGLE_SOLAR_API_KEY
if (!key) throw new Error('GOOGLE_SOLAR_API_KEY is not set')

const RADIUS_M = 50
const QUALITIES = ['HIGH', 'MEDIUM', 'LOW']

async function getJson(url: string, params: Record<string, string>): Promise<any> {
  for (const q of QUALITIES) {
    const res = await fetch(`${url}?${new URLSearchParams({ ...params, requiredQuality: q, key: key! })}`)
    if (res.ok) return res.json()
    if (res.status !== 404) throw new Error(`${url} ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  throw new Error(`${url}: no imagery at any quality`)
}

async function download(url: string, to: string) {
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}key=${key}`)
  if (!res.ok) throw new Error(`GeoTIFF ${res.status}`)
  writeFileSync(to, Buffer.from(await res.arrayBuffer()))
}

async function geocode(address: string): Promise<{ lat: number; lon: number; kind: string }> {
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address, key: key! })}`)
  const data: any = await res.json()
  if (data.status !== 'OK' || !data.results?.length) throw new Error(`Geocoding ${data.status}: ${data.error_message || 'no result'}`)
  const g = data.results[0].geometry
  return { lat: g.location.lat, lon: g.location.lng, kind: g.location_type }
}

let calls = 0
async function fetchSite(id: string, lat: number, lon: number) {
  const dir = join(truthDir(), 'google', id)
  mkdirSync(dir, { recursive: true })
  const loc = { 'location.latitude': String(lat), 'location.longitude': String(lon) }

  if (!existsSync(join(dir, 'buildingInsights.json'))) {
    const bi = await getJson('https://solar.googleapis.com/v1/buildingInsights:findClosest', loc)
    calls++
    writeFileSync(join(dir, 'buildingInsights.json'), JSON.stringify(bi, null, 1))
  }
  for (const px of ['0.25', '0.1']) {
    const tag = px === '0.25' ? 'px25' : 'px10'
    if (existsSync(join(dir, `${tag}.json`))) continue
    const dl = await getJson('https://solar.googleapis.com/v1/dataLayers:get', {
      ...loc, radiusMeters: String(RADIUS_M), view: 'IMAGERY_LAYERS', pixelSizeMeters: px,
    })
    calls++
    await download(dl.dsmUrl, join(dir, `${tag}-dsm.tif`))
    await download(dl.maskUrl, join(dir, `${tag}-mask.tif`))
    await download(dl.rgbUrl, join(dir, `${tag}-rgb.tif`))
    // Written last: its presence means the three files beside it are complete.
    writeFileSync(join(dir, `${tag}.json`), JSON.stringify({ imageryDate: dl.imageryDate, imageryQuality: dl.imageryQuality, pixelSizeMeters: px, radiusMeters: RADIUS_M }, null, 1))
    console.log(`${id}  ${tag}  quality=${dl.imageryQuality}  imagery=${dl.imageryDate?.year}-${dl.imageryDate?.month}`)
  }
}

for (const t of loadHoverTruth()) await fetchSite(t.id, t.lat, t.lon)

const jobs = loadSquaresJobs()
for (const j of jobs) {
  if (j.lat == null || j.lon == null) {
    const g = await geocode(j.address)
    j.lat = g.lat; j.lon = g.lon
    saveSquaresJobs(jobs)
    console.log(`${j.id}  geocoded (${g.kind})`)
  }
  try { await fetchSite(j.id, j.lat, j.lon) } catch (e: any) { console.log(`${j.id}  FAILED: ${e.message}`) }
}
console.log(`done — ${calls} billable Solar calls this run`)
