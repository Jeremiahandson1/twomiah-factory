// CI guard: configuring online booking is company configuration, and needs company:update.
//
// packages/tenant-backend/src/booking/routes.ts is on check-write-routes-authorise's PUBLIC_BY_DESIGN list,
// because most of it IS public — the widget the customer books through. That exemption covers the admin
// half too, which is how this module went twice round the same loop:
//
//   before Salon T28 H1  every write sat behind `authenticate` alone, and a stylist switched online booking
//                        off for the whole company
//   after  Salon T28 H1  requireRole('manager'), which stopped the stylist and let every manager through
//   after  T30 M-R2      requirePermission('company:update')
//
// Rank and permission are different lattices — `viewer` outranks nobody and still holds invoices:read — so
// "at least manager" can never stand in for "may configure the company". This guard pins the question that
// is actually being asked, and pins it at every route that changes the setup, so the next person to add a
// booking-config endpoint cannot leave it behind.
//
//   bun scripts/check-booking-config-permission.ts
import { readFileSync, existsSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')

let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']

// ---------------------------------------------------------------- the shared module
const routes = read('packages/tenant-backend/src/booking/routes.ts')
const decl = routes.match(/const configuresBooking = (\w+)\('([^']+)'\)/)
if (!decl) {
  fail('booking/routes.ts no longer declares configuresBooking — the config guard has a name so every route can share one answer')
} else {
  if (decl[1] !== 'requirePermission') fail(`booking config is guarded with ${decl[1]}(), not requirePermission — a rank cannot express "may configure the company" (a viewer outranks nobody and still reads invoices)`)
  if (decl[2] !== 'company:update') fail(`booking config is guarded on '${decl[2]}' — it is company setup, so it is company:update, the same right that opens Settings`)
}

/**
 * Every route that changes the SETUP: whether booking is on, the hours, the notice, the window, and which
 * services are offered. Day-to-day work on the bookings themselves (taking one, moving it, cancelling it)
 * is deliberately not here — that is a manager's job and must stay open to them.
 */
const CONFIG_ROUTES = [
  /app\.put\('\/settings',\s*configuresBooking/,
  /app\.post\('\/services',\s*configuresBooking/,
  /app\.put\('\/services\/:id',\s*configuresBooking/,
  /app\.delete\('\/services\/:id',\s*configuresBooking/,
]
for (const re of CONFIG_ROUTES) {
  if (!re.test(routes)) fail(`a booking-config route is missing its guard: nothing matches ${re}`)
}

// …and nothing new slipped in beside them. Any write under /settings or /services must carry it.
for (const line of routes.split('\n')) {
  const m = line.match(/^\s*app\.(post|put|patch|delete)\('(\/(settings|services)[^']*)'/)
  if (m && !line.includes('configuresBooking')) {
    fail(`booking ${m[1].toUpperCase()} ${m[2]} changes the setup but does not carry configuresBooking`)
  }
}

// Reading the setup stays open — a manager and a technician both need to see the hours they are working to.
for (const path of ["'/settings'", "'/services'"]) {
  const get = routes.split('\n').find((l) => l.includes(`app.get(${path}`))
  if (!get) { fail(`booking has no GET ${path} to read the setup`); continue }
  if (/configuresBooking|requirePermission|requireRole/.test(get)) {
    fail(`GET ${path} is guarded — reading the hours is not configuring them, and a technician needs to see them`)
  }
}

// ---------------------------------------------------------------- every template's wiring
const deps = read('packages/tenant-backend/src/booking/types.ts')
if (!/\n\s*requirePermission: \(permission: string\) => any/.test(deps)) {
  fail('BookingDeps must REQUIRE requirePermission — optional would let a template ship the hole again in silence')
}
if (/\n\s*requireRole: \(minRole: string\) => any/.test(deps)) {
  fail('BookingDeps still declares requireRole — a required dep nothing uses is the next person\'s wrong guard')
}

for (const t of TEMPLATES) {
  const rel = `templates/${t}/backend/src/routes/booking.ts`
  if (!existsSync(ROOT + rel)) { fail(`${t} has no ${rel} to wire booking`); continue }
  const src = read(rel)
  if (!/requirePermission,/.test(src)) fail(`${t} does not hand requirePermission to createBookingRoutes`)
  if (!/import \{ requirePermission \} from '\.\.\/middleware\/permissions\.ts'/.test(src)) {
    fail(`${t} booking.ts must import requirePermission from the template's own permission matrix`)
  }
  if (/\brequireRole\b/.test(src.replace(/\/\/[^\n]*/g, ''))) fail(`${t} booking.ts still passes requireRole`)
}

if (failed) { console.error(`\nbooking config permission: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`booking config permission: hours, notice, window, on/off and the bookable services all need company:update in the shared module, and all ${TEMPLATES.length} CRMs wire it; reading the setup stays open`)
