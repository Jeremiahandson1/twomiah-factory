// Barcode scanning on the phone (parity tier 2 #10, feature barcode_scanning, not ready). Held from the code itself — nothing here
// needs a device (the camera's own reading is expo-camera's):
//   · a scan becomes the search text: trimmed, control characters out, nothing past 64 characters;
//   · the scan button is on the store's Stock search and the new Stock list, each only where barcode_scanning is on;
//   · Stock is the shared inventory's list, read only, found by name, SKU, barcode or part number;
//   · Equipment is the customers' units, read only, found by name, model or serial number — the serial scanned off the data plate;
//   · in More, Inventory opens the phone's Stock and Equipment the phone's Equipment only where barcode_scanning is on — off, the
//     desktop pages as before.
//
//   bun run tests/mobile/barcode-scan.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { cleanCode, BARCODE_TYPES } from '../../apps/mobile/src/scan/codes.ts'
import { SPECS } from '../../apps/mobile/src/trades/specs.ts'
import { itemsFor } from '../../apps/mobile/src/more/menu.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600)) }
}
const app = path.resolve(import.meta.dir, '../../apps/mobile')

console.log('a scan, as search text')
check('trimmed, control characters dropped', cleanCode(' 012345678905\n') === '012345678905' && cleanCode('A\u0000B') === 'AB', cleanCode(' 012345678905\n'))
check('nothing usable: empty', cleanCode(null) === '' && cleanCode('   ') === '' && cleanCode('x'.repeat(65)) === '')
check('reads retail and warehouse codes', ['upc_a', 'ean13', 'code128', 'qr'].every((t) => (BARCODE_TYPES as string[]).includes(t)))

console.log('the lists')
const store: any = SPECS.find((s) => s.id === 'store-stock')
const stock: any = SPECS.find((s) => s.id === 'stock-parts')
check("the store's Stock search scans, behind the switch", store?.search?.scan?.feature === 'barcode_scanning', store?.search)
check('Stock is the shared inventory list, behind Inventory', stock?.list?.path === '/api/inventory/items' && stock?.feature === 'inventory' && stock?.any?.[0] === 'jobs:read', stock?.list)
check('Stock searches the server\'s own word and scans behind the switch', stock?.search?.param === 'search' && stock?.search?.scan?.feature === 'barcode_scanning')
check('Stock is read only (no actions, no +)', !stock?.actions && !stock?.create && !(stock?.detail?.actions?.length))
const row = stock?.rows({ id: 'i1', name: 'Capacitor 45/5', sku: 'CAP-455', barcode: '0123', totalStock: 2, isLowStock: true }, {})
check('a row: name, SKU and barcode, how many on hand, low stock warned', row?.title === 'Capacitor 45/5' && row?.subtitle === 'CAP-455 · 0123' && row?.badge === '2 on hand' && row?.tone === 'warning', row)
check('the screen has a file', fs.existsSync(path.join(app, 'app/(details)/stock/index.tsx')))
const units: any = SPECS.find((s) => s.id === 'equipment-units')
check('Equipment is the equipment list, behind Equipment, scanning behind the switch', units?.list?.path === '/api/equipment' && units?.feature === 'equipment_tracking' && units?.any?.[0] === 'jobs:read' && units?.search?.param === 'search' && units?.search?.scan?.feature === 'barcode_scanning', units)
check('Equipment is read only', !units?.actions && !units?.create && !(units?.detail?.actions?.length))
const unit = units?.rows({ id: 'e1', name: 'Furnace', serialNumber: 'SN-778', status: 'needs_repair', contact: { name: 'Hank' } }, {})
check("a unit's row: whose, its serial, its state", unit?.title === 'Furnace' && unit?.subtitle === 'Hank · S/N SN-778' && unit?.badge === 'Needs repair' && unit?.tone === 'warning', unit)
const install = units?.detail?.sections?.[0]?.fields?.find((f: any) => f.label === 'Installed')?.get({ purchaseDate: '2026-03-01T00:00:00.000Z' })
check('its install day is the calendar day, whatever the phone's zone', install === 'Mar 1, 2026', install)
check('the Equipment screen has a file', fs.existsSync(path.join(app, 'app/(details)/equipment/index.tsx')))

console.log('More')
const seat = (features: string[]) => ({ role: 'owner', can: () => true, hasFeature: (f: string) => features.includes(f) })
const inv = (features: string[]) => itemsFor('fieldservice', seat(features), false).find((i) => i.path === '/crm/inventory')
check('switch off: Inventory opens the desktop page', inv(['inventory'])?.open.kind === 'web', inv(['inventory'])?.open)
check('switch on: Inventory opens the phone\'s Stock', JSON.stringify(inv(['inventory', 'barcode_scanning'])?.open) === JSON.stringify({ kind: 'native', route: '/(details)/stock' }), inv(['inventory', 'barcode_scanning'])?.open)

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
