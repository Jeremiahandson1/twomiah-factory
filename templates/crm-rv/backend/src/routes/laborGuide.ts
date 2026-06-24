import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'

// ── Labor Guide (flat-rate) ─────────────────────────────────────────────────
// Standard service operations with flat-rate hours → labor price at the shop rate.
// Warranty-eligible ops are flagged for claim submission. Provider-agnostic: mock
// flat-rate data today; swap to Mitchell1 / MOTOR / OEM flat-rate feeds later. This
// is the service-side equivalent of the parts catalog — own the UX, license the data.
const app = new Hono()
app.use('*', authenticate)

const LABOR_RATE = 135 // shop labor rate $/hr (dealer-configurable later)

type Op = { code: string; name: string; category: string; hours: number; warranty: boolean; applies: string }
const OPS: Op[] = [
  { code: 'LOF-PS', name: 'Oil & filter change (4-stroke)', category: 'Maintenance', hours: 0.6, warranty: false, applies: 'ATV / UTV / motorcycle' },
  { code: 'LOF-PWC', name: 'Oil & filter change (PWC)', category: 'Maintenance', hours: 0.8, warranty: false, applies: 'Sea-Doo / personal watercraft' },
  { code: 'WIN-MAR', name: 'Winterization (marine)', category: 'Seasonal', hours: 1.5, warranty: false, applies: 'boats / outboards' },
  { code: 'SUM-MAR', name: 'Summerization / spring prep', category: 'Seasonal', hours: 1.2, warranty: false, applies: 'boats / PWC' },
  { code: 'BRK-FR', name: 'Front brake pad replacement', category: 'Brakes', hours: 0.9, warranty: false, applies: 'motorcycle / ATV' },
  { code: 'TIR-MNT', name: 'Tire mount & balance (per wheel)', category: 'Tires', hours: 0.5, warranty: false, applies: 'all' },
  { code: 'BELT-CVT', name: 'CVT drive belt replacement', category: 'Drivetrain', hours: 1.1, warranty: true, applies: 'UTV / snowmobile' },
  { code: 'IMP-PWC', name: 'Impeller / wear ring service', category: 'Jet Pump', hours: 2.2, warranty: true, applies: 'PWC' },
  { code: 'DIAG-EFI', name: 'EFI / electrical diagnostic', category: 'Diagnostics', hours: 1.0, warranty: true, applies: 'all 4-stroke' },
  { code: 'VALVE-ADJ', name: 'Valve clearance adjustment', category: 'Engine', hours: 2.5, warranty: false, applies: 'motorcycle / ATV' },
  { code: 'COOL-FLU', name: 'Coolant flush & refill', category: 'Maintenance', hours: 0.8, warranty: false, applies: 'liquid-cooled' },
  { code: 'RECALL', name: 'Recall / campaign repair', category: 'Warranty', hours: 1.0, warranty: true, applies: 'per OEM bulletin' },
  { code: 'TUNE-SLED', name: 'Pre-season snowmobile tune', category: 'Seasonal', hours: 1.4, warranty: false, applies: 'snowmobile' },
  { code: 'PROP-MAR', name: 'Propeller R&R', category: 'Marine', hours: 0.7, warranty: false, applies: 'outboard / sterndrive' },
  { code: 'BATT-SVC', name: 'Battery test & replacement', category: 'Electrical', hours: 0.4, warranty: false, applies: 'all' },
]

app.get('/search', (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase()
  const category = c.req.query('category') || ''
  const ops = OPS
    .filter((o) => (!category || o.category === category) && (!q || [o.code, o.name, o.category, o.applies].join(' ').toLowerCase().includes(q)))
    .map((o) => ({ ...o, laborRate: LABOR_RATE, price: Math.round(o.hours * LABOR_RATE) }))
  return c.json({ ops, laborRate: LABOR_RATE, categories: [...new Set(OPS.map((o) => o.category))].sort(), live: false })
})

export default app
