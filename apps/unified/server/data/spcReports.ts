// NOAA's storm reports, as the Storm Prediction Center publishes them each day (roofing parity row 25). Checked 11/06:
//   · the address the storm check used (www.ncdc.noaa.gov/stormevents/csv) now redirects to NCEI's web app and answers an HTML page,
//     never a CSV — the check could not have worked;
//   · the SPC's daily reports are free, public CSVs, one per kind and day:
//       https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_hail.csv   Time,Size,Location,County,State,Lat,Lon,Comments
//       https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_wind.csv   Time,Speed,Location,County,State,Lat,Lon,Comments
//       https://www.spc.noaa.gov/climo/reports/YYMMDD_rpts_torn.csv   Time,F_Scale,Location,County,State,Lat,Lon,Comments
//     Size is hail in hundredths of an inch (200 = 2.00 in); Speed is mph or "UNK"; F_Scale is a rating or "UNK". Every report has
//     its own latitude and longitude. Recorded samples: tests/fixtures/spc-250520-{hail,wind,torn}.csv.
// Pure parsing and the distance; the check itself is crm/roof/field/stormData.ts.

export const SPC_BASE = 'https://www.spc.noaa.gov/climo/reports'
export const KINDS = { hail: 'hail', wind: 'wind', torn: 'tornado' } as const
export type SpcKind = keyof typeof KINDS

export interface SpcReport {
  kind: 'hail' | 'wind' | 'tornado'
  time: string
  hailInches: number | null
  windMph: number | null
  rating: string | null
  location: string
  county: string
  state: string
  lat: number
  lng: number
  comments: string
}

/** The day's file name: YYMMDD for a calendar day (the SPC's report day). */
export const spcDay = (d: Date) => `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
export const spcUrl = (day: string, kind: SpcKind) => `${SPC_BASE}/${day}_rpts_${kind}.csv`

/** One file's reports. The comment is the last column and may hold commas, so everything after the seventh comma is the comment. */
export function parseSpc(kind: SpcKind, text: string): SpcReport[] {
  const out: SpcReport[] = []
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim() || /^Time,/i.test(line)) continue
    const p = line.split(',')
    if (p.length < 7) continue
    const lat = Number(p[5]), lng = Number(p[6])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    const mag = p[1].trim()
    const n = Number(mag)
    out.push({
      kind: KINDS[kind], time: p[0].trim(),
      hailInches: kind === 'hail' && Number.isFinite(n) && n > 0 ? Math.round(n) / 100 : null,
      windMph: kind === 'wind' && Number.isFinite(n) && n > 0 ? Math.round(n) : null,
      rating: kind === 'torn' && mag && mag.toUpperCase() !== 'UNK' ? mag : null,
      location: p[2].trim(), county: p[3].trim(), state: p[4].trim().toUpperCase(), lat, lng,
      comments: p.slice(7).join(',').trim(),
    })
  }
  return out
}

/** Miles between two points (haversine). */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8, r = (x: number) => (x * Math.PI) / 180
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
