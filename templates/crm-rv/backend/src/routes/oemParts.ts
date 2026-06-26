import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { db } from '../../db/index.ts'
import { catalogPart } from '../../db/schema.ts'
import { and, eq, or, ilike, sql } from 'drizzle-orm'

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

// Demo fallback search — used only until the dealer imports a real catalog.
function mockSearch(q: string, f: { oem?: string; category?: string }): OemPart[] {
  const t = (q || '').trim().toLowerCase()
  return MOCK.filter(p =>
    (!f.oem || p.oem.toLowerCase() === f.oem.toLowerCase()) &&
    (!f.category || p.category.toLowerCase() === f.category.toLowerCase()) &&
    (!t || [p.partNumber, p.name, p.oem, p.fitment].filter(Boolean).some(s => String(s).toLowerCase().includes(t)))
  ).slice(0, 50)
}

// ── DB-backed catalog (the bootstrap) ───────────────────────────────────────
// The dealer imports their OWN data — OEM price files they download from their
// dealer portal, or their parts export migrated off the old DMS — and the catalog
// runs on it instantly with ZERO OEM/vendor pre-approval. A licensed feed
// (Snap-on EPC / ARI) can layer on later; the imported data and UI don't change.
function rowToPart(r: any): OemPart {
  return {
    partNumber: r.partNumber, name: r.name, oem: r.oem || '', category: r.category || '',
    price: Number(r.price) || 0, msrp: r.msrp != null ? Number(r.msrp) : undefined,
    availability: r.availability || 'Order from OEM',
    supersededBy: r.supersededBy || undefined, fitment: r.fitment || undefined, diagram: r.diagram || undefined,
  }
}

async function importedCount(companyId: string): Promise<number> {
  try {
    const r = await db.select({ n: sql<number>`count(*)` }).from(catalogPart).where(eq(catalogPart.companyId, companyId))
    return Number(r[0]?.n || 0)
  } catch { return 0 }
}

app.get('/search', async (c) => {
  const companyId = (c.get('user') as any).companyId
  const q = c.req.query('q') || ''
  const oem = c.req.query('oem') || undefined
  const category = c.req.query('category') || undefined

  const count = await importedCount(companyId)

  if (count > 0) {
    const conds: any[] = [eq(catalogPart.companyId, companyId)]
    if (oem) conds.push(eq(catalogPart.oem, oem))
    if (category) conds.push(eq(catalogPart.category, category))
    const t = q.trim()
    if (t) {
      const like = '%' + t + '%'
      conds.push(or(ilike(catalogPart.partNumber, like), ilike(catalogPart.name, like), ilike(catalogPart.oem, like), ilike(catalogPart.fitment, like)))
    }
    let parts: OemPart[] = []
    try {
      const rows = await db.select().from(catalogPart).where(and(...conds)).limit(100)
      parts = rows.map(rowToPart)
    } catch { parts = [] }
    let oems: string[] = [], categories: string[] = []
    try {
      const od = await db.selectDistinct({ v: catalogPart.oem }).from(catalogPart).where(eq(catalogPart.companyId, companyId))
      const cd = await db.selectDistinct({ v: catalogPart.category }).from(catalogPart).where(eq(catalogPart.companyId, companyId))
      oems = od.map((x: any) => x.v).filter(Boolean).sort()
      categories = cd.map((x: any) => x.v).filter(Boolean).sort()
    } catch { /* ignore */ }
    return c.json({ parts, provider: 'imported', live: true, imported: count, oems, categories })
  }

  // demo fallback — no catalog imported yet
  return c.json({
    parts: mockSearch(q, { oem, category }), provider: 'mock', live: false, imported: 0,
    oems: [...new Set(MOCK.map(p => p.oem))].sort(),
    categories: [...new Set(MOCK.map(p => p.category))].sort(),
  })
})

// ── CSV import: dealer uploads OEM price files / their old-DMS parts export ──
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (ch === '\r') { /* skip */ }
    else field += ch
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

// Flexible header detection so a Polaris/Yamaha price file OR a Lightspeed export
// both import without the dealer reformatting anything.
const HEADER_MAP: Record<string, string> = {
  'part number': 'partNumber', 'part #': 'partNumber', 'part no': 'partNumber', 'partno': 'partNumber', 'part': 'partNumber', 'partnumber': 'partNumber', 'sku': 'partNumber', 'item number': 'partNumber', 'item #': 'partNumber', 'item': 'partNumber', 'number': 'partNumber',
  'description': 'name', 'name': 'name', 'desc': 'name', 'item description': 'name', 'product': 'name', 'part description': 'name',
  'oem': 'oem', 'brand': 'oem', 'make': 'oem', 'manufacturer': 'oem', 'mfg': 'oem', 'line': 'oem',
  'category': 'category', 'type': 'category', 'group': 'category', 'class': 'category', 'dept': 'category', 'department': 'category',
  'price': 'price', 'list price': 'price', 'list': 'price', 'retail': 'price', 'sell': 'price', 'sell price': 'price', 'unit price': 'price', 'price each': 'price',
  'cost': 'cost', 'dealer cost': 'cost', 'dealer price': 'cost', 'dealer': 'cost', 'net': 'cost', 'your cost': 'cost', 'unit cost': 'cost',
  'msrp': 'msrp', 'map': 'msrp',
  'qty': 'qty', 'quantity': 'qty', 'on hand': 'qty', 'onhand': 'qty', 'on-hand': 'qty', 'stock': 'qty', 'available': 'qty', 'qoh': 'qty',
  'fitment': 'fitment', 'fits': 'fitment', 'model': 'fitment', 'application': 'fitment', 'models': 'fitment', 'fit': 'fitment', 'vehicle': 'fitment',
}

app.post('/import', async (c) => {
  const companyId = (c.get('user') as any).companyId
  const body = await c.req.json().catch(() => ({} as any))
  const csv: string = body.csv || ''
  const defaultOem = (body.oem || '').trim()
  const defaultCategory = (body.category || '').trim()
  if (!csv.trim()) return c.json({ error: 'No CSV provided.' }, 400)

  const rows = parseCsv(csv)
  if (rows.length < 2) return c.json({ error: 'CSV needs a header row and at least one data row.' }, 400)

  const headers = rows[0].map(h => h.trim().toLowerCase())
  const colIdx: Record<string, number> = {}
  headers.forEach((h, i) => { const f = HEADER_MAP[h]; if (f && colIdx[f] === undefined) colIdx[f] = i })
  if (colIdx.partNumber === undefined)
    return c.json({ error: 'No part-number column found. Add a header like "Part Number", "Part #", or "SKU".', headers }, 400)

  const num = (s: string) => (s || '').replace(/[^0-9.\-]/g, '')
  const records: any[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]
    const get = (f: string) => (colIdx[f] !== undefined ? (cells[colIdx[f]] || '').trim() : '')
    const partNumber = get('partNumber')
    if (!partNumber) { skipped++; continue }
    const oem = get('oem') || defaultOem || 'Unspecified'
    const key = (partNumber + '|' + oem).toLowerCase()
    if (seen.has(key)) { skipped++; continue }  // dedupe within the file (pg upsert can't touch a row twice)
    seen.add(key)
    const priceN = num(get('price')), msrpN = num(get('msrp')), costN = num(get('cost'))
    const qtyStr = num(get('qty'))
    const qty = qtyStr === '' ? null : Number(qtyStr)
    records.push({
      companyId, partNumber, name: get('name') || partNumber, oem,
      category: get('category') || defaultCategory || 'Parts',
      price: priceN || msrpN || '0', cost: costN || null, msrp: msrpN || null,
      availability: qty === null ? 'Order from OEM' : qty > 0 ? 'In stock' : 'Backordered',
      fitment: get('fitment') || null, source: String(body.source || 'import').slice(0, 40),
    })
  }
  if (!records.length) return c.json({ error: 'No valid rows — every row was missing a part number.', skipped }, 400)

  let imported = 0
  try {
    const CHUNK = 500
    for (let i = 0; i < records.length; i += CHUNK) {
      const batch = records.slice(i, i + CHUNK)
      await db.insert(catalogPart).values(batch).onConflictDoUpdate({
        target: [catalogPart.companyId, catalogPart.partNumber, catalogPart.oem],
        set: {
          name: sql`excluded.name`, category: sql`excluded.category`,
          price: sql`excluded.price`, cost: sql`excluded.cost`, msrp: sql`excluded.msrp`,
          availability: sql`excluded.availability`, fitment: sql`excluded.fitment`,
          source: sql`excluded.source`, updatedAt: new Date(),
        },
      })
      imported += batch.length
    }
  } catch (e: any) {
    return c.json({ error: 'Import failed: ' + (e?.message || e) }, 500)
  }
  const total = await importedCount(companyId)
  return c.json({ ok: true, imported, skipped, total, mappedColumns: Object.keys(colIdx) })
})

app.post('/clear', async (c) => {
  const companyId = (c.get('user') as any).companyId
  try { await db.delete(catalogPart).where(eq(catalogPart.companyId, companyId)) } catch (e: any) { return c.json({ error: String(e?.message || e) }, 500) }
  return c.json({ ok: true })
})

export default app
