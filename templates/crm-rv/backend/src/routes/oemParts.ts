import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// ── OEM Parts Catalog ───────────────────────────────────────────────────────
// Provider-agnostic. Today returns realistic MOCK data so the UI is fully working
// and demoable with ZERO vendor dependency. When the catalog data deal closes
// (Snap-on EPC data-feed or ARI DataSmart), implement that provider's `search()`
// and point `provider` at it — the routes, the UI, and the rest of the app do not
// change. That swappable interface is the whole "no lock-in / not a Frankenstein"
// design: we own the parts UX natively; the data source is a pluggable rail.
const app = new Hono()
app.use('*', authenticate)

export type OemPart = {
  partNumber: string
  name: string
  oem: string
  category: string
  price: number          // dealer/retail price
  msrp?: number
  availability: string   // 'In stock' | 'Order from OEM' | 'Backordered'
  supersededBy?: string  // newer part number if superseded
  fitment?: string       // which units it fits
  diagram?: string       // fiche / assembly reference
}

interface PartsProvider {
  name: string
  live: boolean
  search(q: string, filters: { oem?: string; category?: string }): Promise<OemPart[]>
}

// Realistic stand-in catalog across the brands a powersports/marine dealer carries.
const MOCK: OemPart[] = [
  { partNumber: '2540086', name: 'Oil Filter', oem: 'Polaris', category: 'Filters', price: 12.99, msrp: 15.99, availability: 'In stock', fitment: 'RANGER / RZR / Sportsman 4-stroke', diagram: 'Engine / Lubrication' },
  { partNumber: '7081231', name: 'Air Filter', oem: 'Polaris', category: 'Filters', price: 34.99, msrp: 42.99, availability: 'In stock', fitment: 'RANGER XP 1000', diagram: 'Air Intake' },
  { partNumber: '3211202', name: 'Drive Belt', oem: 'Polaris', category: 'Drivetrain', price: 149.99, msrp: 179.99, availability: 'In stock', fitment: 'RANGER XP 1000 (2017+)', diagram: 'Clutch / Belt' },
  { partNumber: '2877473', name: 'PS-4 Full Synthetic Oil 5W-50 (qt)', oem: 'Polaris', category: 'Oil & Chemicals', price: 13.49, availability: 'In stock', fitment: 'All 4-stroke', diagram: 'Service' },
  { partNumber: '3022087', name: 'Spark Plug', oem: 'Polaris', category: 'Ignition', price: 8.49, availability: 'In stock', fitment: 'RZR / RANGER 1000', diagram: 'Ignition' },
  { partNumber: '420956123', name: 'Oil Filter', oem: 'Sea-Doo / BRP', category: 'Filters', price: 14.99, msrp: 18.99, availability: 'In stock', fitment: 'GTI / GTX / RXP (1630 ACE)', diagram: 'Lubrication' },
  { partNumber: '267000617', name: 'Impeller', oem: 'Sea-Doo / BRP', category: 'Jet Pump', price: 289.99, msrp: 339.99, availability: 'Order from OEM', fitment: 'GTI 130 / 170', diagram: 'Propulsion' },
  { partNumber: '267000924', name: 'Wear Ring', oem: 'Sea-Doo / BRP', category: 'Jet Pump', price: 89.99, availability: 'In stock', fitment: 'GTI / GTR', diagram: 'Propulsion' },
  { partNumber: '420876191', name: 'XPS Synthetic Oil 4-Stroke (qt)', oem: 'Sea-Doo / BRP', category: 'Oil & Chemicals', price: 16.49, availability: 'In stock', fitment: 'Rotax 4-TEC / ACE', diagram: 'Service' },
  { partNumber: '15410-MFJ-D01', name: 'Oil Filter', oem: 'Honda', category: 'Filters', price: 11.49, msrp: 13.99, availability: 'In stock', fitment: 'CBR / Gold Wing / FourTrax', diagram: 'Lubrication', supersededBy: '15410-MFJ-D02' },
  { partNumber: '17210-HR0-F00', name: 'Air Filter', oem: 'Honda', category: 'Filters', price: 28.99, availability: 'In stock', fitment: 'Pioneer / Talon', diagram: 'Air Intake' },
  { partNumber: '06455-MGS-D31', name: 'Front Brake Pad Set', oem: 'Honda', category: 'Brakes', price: 46.99, msrp: 56.99, availability: 'In stock', fitment: 'Gold Wing Tour', diagram: 'Front Brake' },
  { partNumber: '31500-HR3-A01', name: 'Battery (YTX14-BS)', oem: 'Honda', category: 'Electrical', price: 109.99, availability: 'In stock', fitment: 'Pioneer 1000 / Gold Wing', diagram: 'Electrical' },
  { partNumber: '5GH-13440-50', name: 'Oil Filter Element', oem: 'Yamaha', category: 'Filters', price: 9.99, msrp: 12.49, availability: 'In stock', fitment: 'MT-09 / R1 / Grizzly', diagram: 'Lubrication' },
  { partNumber: '1WS-15410-00', name: 'Oil Filter', oem: 'Yamaha', category: 'Filters', price: 12.49, availability: 'In stock', fitment: 'MT-09 (2021+)', diagram: 'Lubrication' },
  { partNumber: 'B74-E5408-00', name: 'Air Filter Element', oem: 'Yamaha', category: 'Filters', price: 33.49, availability: 'Order from OEM', fitment: 'MT-09', diagram: 'Air Intake' },
  { partNumber: 'GYTR-90793', name: 'Yamalube 10W-40 Full Synthetic (qt)', oem: 'Yamaha', category: 'Oil & Chemicals', price: 14.99, availability: 'In stock', fitment: '4-stroke motorcycle / ATV', diagram: 'Service' },
  { partNumber: '49065-0721', name: 'Oil Filter', oem: 'Kawasaki', category: 'Filters', price: 10.99, availability: 'In stock', fitment: 'Ninja / Mule / Brute Force', diagram: 'Lubrication' },
  { partNumber: '11013-0763', name: 'Air Filter', oem: 'Kawasaki', category: 'Filters', price: 31.99, availability: 'In stock', fitment: 'Mule Pro-FXT', diagram: 'Air Intake' },
  { partNumber: '16510-07J00', name: 'Oil Filter', oem: 'Suzuki', category: 'Filters', price: 11.99, availability: 'In stock', fitment: 'KingQuad / V-Strom', diagram: 'Lubrication' },
  { partNumber: 'SBA-31-SYN1', name: 'Indian Full Synthetic 20W-40 (qt)', oem: 'Indian / Polaris', category: 'Oil & Chemicals', price: 17.99, availability: 'In stock', fitment: 'Scout / Chief', diagram: 'Service' },
  { partNumber: '5015-0710', name: 'Oil Filter — Scout', oem: 'Indian / Polaris', category: 'Filters', price: 13.99, availability: 'In stock', fitment: 'Scout / Scout Bobber', diagram: 'Lubrication' },
  { partNumber: 'MERC-35-8M0162830', name: 'Oil Filter — Outboard', oem: 'Mercury Marine', category: 'Filters', price: 19.99, availability: 'In stock', fitment: '4-stroke 75–115 HP', diagram: 'Lubrication' },
  { partNumber: 'MERC-8M0078630', name: '25W-40 Marine Oil (qt)', oem: 'Mercury Marine', category: 'Oil & Chemicals', price: 12.99, availability: 'In stock', fitment: 'Verado / FourStroke', diagram: 'Service' },
  { partNumber: 'YAM-6AW-13440-01', name: 'Outboard Oil Filter', oem: 'Yamaha Marine', category: 'Filters', price: 18.49, availability: 'Order from OEM', fitment: 'F150 / F200', diagram: 'Lubrication' },
  { partNumber: 'BENN-PT-LED-DK', name: 'Deck LED Courtesy Light', oem: 'Bennington', category: 'Accessories', price: 39.99, availability: 'Order from OEM', fitment: 'S/L/Q Series pontoons', diagram: 'Electrical' },
  { partNumber: 'CF-0800-011000', name: 'Oil Filter', oem: 'CFMoto', category: 'Filters', price: 9.49, availability: 'In stock', fitment: 'ZForce / UForce 950', diagram: 'Lubrication' },
  { partNumber: '0SI3-061000', name: 'Air Filter', oem: 'Ski-Doo / BRP', category: 'Filters', price: 26.99, availability: 'In stock', fitment: 'MXZ 600R', diagram: 'Air Intake' },
]

const mockProvider: PartsProvider = {
  name: 'mock', live: false,
  async search(q, f) {
    const t = (q || '').trim().toLowerCase()
    return MOCK.filter(p =>
      (!f.oem || p.oem.toLowerCase() === f.oem.toLowerCase()) &&
      (!f.category || p.category.toLowerCase() === f.category.toLowerCase()) &&
      (!t || [p.partNumber, p.name, p.oem, p.fitment].filter(Boolean).some(s => String(s).toLowerCase().includes(t)))
    ).slice(0, 50)
  },
}

// ↓↓ Swap to a real provider when the catalog data feed is licensed:
//    const provider = snapOnProvider  // Snap-on EPC data feed
//    const provider = ariProvider     // ARI DataSmart API
const provider: PartsProvider = mockProvider

app.get('/search', async (c) => {
  const q = c.req.query('q') || ''
  const oem = c.req.query('oem') || undefined
  const category = c.req.query('category') || undefined
  let parts: OemPart[] = []
  try { parts = await provider.search(q, { oem, category }) } catch { parts = [] }
  return c.json({
    parts, provider: provider.name, live: provider.live,
    oems: [...new Set(MOCK.map(p => p.oem))].sort(),
    categories: [...new Set(MOCK.map(p => p.category))].sort(),
  })
})

export default app
