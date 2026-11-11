/**
 * Stock on the phone (parity tier 2 #10, with barcode scanning — feature barcode_scanning, not ready): the shared inventory's parts
 * (packages/tenant-backend inventory, GET /api/inventory/items — the desktop's Inventory page, which asks no permission beyond a
 * session), found by name, SKU, barcode or the supplier's part number, or by scanning the barcode on the box. "Use on a job" puts the part on a
 * job that is under way, off the location it was taken from (POST /api/inventory/use — inventory:use, the technician's; ServiceTitan's
 * materials from the truck). Receiving, moving and counting stay on the desktop. What a part cost is the server's to hide (margin:read), never this screen's.
 *
 * Equipment on the phone (the same barcode scanning — ServiceTitan's equipment serial scan): the customers' units (packages/
 * tenant-backend equipment, GET /api/equipment — the desktop's Equipment page, which asks no permission beyond a session), found by
 * name, model or serial number, or by scanning the serial-number barcode on the unit's data plate; each opens with whose it is, its
 * warranty and its service history. Read only, like Stock; what a service visit cost is the server's to hide (margin:read).
 */
import { type ScreenSpec, dayOnly, join, money } from './kit'

const STATUS: Record<string, string> = { active: 'In service', needs_repair: 'Needs repair', replaced: 'Replaced' }
/** A unit's install and warranty dates are calendar days (kept at midnight UTC): read in UTC, never the phone's zone. */
const onDay = (v: unknown) => { const d = new Date(String(v ?? '')); return Number.isNaN(d.getTime()) ? undefined : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) }
const statusWord = (s: unknown) => (s ? STATUS[String(s)] ?? String(s).replace(/_/g, ' ') : undefined)
const onHand = (n: unknown) => (n == null ? undefined : `${Number(n)} on hand`)

export const STOCK: ScreenSpec[] = [
  {
    // jobs:read — every seat that works jobs looks parts up (the desktop Inventory page asks no more than a session).
    id: 'stock-parts', title: 'Stock', any: ['jobs:read'], feature: 'inventory',
    list: { path: '/api/inventory/items', query: { limit: '50' } },
    search: { param: 'search', placeholder: 'Name, SKU or barcode', scan: { feature: 'barcode_scanning' } },
    rows: (i) => ({ id: i.id, key: i.id, title: i.name || 'Part', subtitle: join(i.sku, i.barcode && i.barcode !== i.sku ? i.barcode : undefined),
      badge: onHand(i.totalStock), tone: i.isLowStock ? 'warning' : Number(i.totalStock) > 0 ? 'success' : 'danger' }),
    empty: { title: 'Nothing found', body: 'Try the name, the SKU, or scan the barcode on the box.' },
    detail: {
      path: () => null, title: (d) => d.name || 'Part', subtitle: (d) => join(d.sku, d.category), badge: (d) => onHand(d.totalStock),
      sections: [
        { fields: [
          { label: 'On hand', get: (d) => (d.totalStock == null ? undefined : String(d.totalStock)) }, { label: 'Reorder at', get: (d) => (d.reorderPoint ? String(d.reorderPoint) : undefined) },
          { label: 'SKU', get: (d) => d.sku }, { label: 'Barcode', get: (d) => d.barcode }, { label: 'Supplier', get: (d) => d.vendor }, { label: 'Supplier part #', get: (d) => d.vendorPartNumber },
          { label: 'Price', get: (d) => money(d.unitPrice) }, { label: 'Unit', get: (d) => d.unit },
        ] },
        { title: 'Where it is', rows: (d) => (d.stockLevels || []).map((l: any) => ({ key: l.id, title: l.location?.name || 'A location', meta: String(l.quantity ?? 0) })), empty: 'Not stocked anywhere yet.' },
      ],
      actions: [{
        id: 'use-on-job', label: 'Use on a job', icon: 'add-circle', any: ['inventory:use'], when: (d) => Number(d.totalStock) > 0,
        inputs: [
          { id: 'job', label: 'Which job', required: true, options: { path: () => '/api/jobs?status=in_progress&limit=50', label: (j: any) => (join(j.number, j.title, j.contact?.name) || 'Job').slice(0, 70), value: (j: any) => j.id, none: 'No job is under way. Start the job first, then add the part.', loading: 'Getting the jobs under way…' } },
          { id: 'from', label: 'Taken from', required: true, options: { path: () => '/api/inventory/locations', pick: (_b: any, row: any) => (row.stockLevels || []).filter((l: any) => Number(l.quantity) > 0), label: (l: any) => `${l.location?.name || 'A location'} (${l.quantity} there)`, value: (l: any) => l.locationId, none: 'None of it is on hand anywhere.', loading: 'Getting where it is…' } },
          { id: 'qty', label: 'How many', kind: 'number', required: true, initial: () => '1' },
        ],
        request: (d, v) => ({ method: 'POST', path: '/api/inventory/use', body: { jobId: v.job, itemId: d.id, locationId: v.from, quantity: Math.max(1, Math.floor(Number(v.qty) || 1)) } }),
        done: 'Added to the job',
      }],
    },
  },
  {
    // jobs:read — the tech at the unit looks it up (the desktop Equipment page asks no more than a session).
    id: 'equipment-units', title: 'Equipment', any: ['jobs:read'], feature: 'equipment_tracking',
    list: { path: '/api/equipment', query: { limit: '50' } },
    search: { param: 'search', placeholder: 'Name, model or serial number', scan: { feature: 'barcode_scanning' } },
    rows: (e) => ({ id: e.id, key: e.id, title: e.name || 'Unit', subtitle: join(e.contact?.name, e.serialNumber ? `S/N ${e.serialNumber}` : undefined),
      badge: statusWord(e.status), tone: e.status === 'needs_repair' ? 'warning' : e.status === 'active' ? 'success' : undefined }),
    empty: { title: 'Nothing found', body: 'Try the name, the model, or scan the serial number on the data plate.' },
    detail: {
      path: (id) => `/api/equipment/${encodeURIComponent(id)}`, title: (d) => d.name || 'Unit', subtitle: (d) => join(d.manufacturer, d.model), badge: (d) => statusWord(d.status),
      sections: [
        { fields: [
          { label: 'Serial number', get: (d) => d.serialNumber }, { label: 'Customer', get: (d) => d.contact?.name }, { label: 'Where', get: (d) => d.location },
          { label: 'Installed', get: (d) => onDay(d.purchaseDate) }, { label: 'Warranty until', get: (d) => onDay(d.warrantyExpiry) }, { label: 'Kind', get: (d) => d.category?.name },
          { label: 'Notes', get: (d) => d.notes },
        ] },
        { title: 'Service history', rows: (d) => (d.maintenanceHistory || []).map((m: any) => ({ key: m.id, title: m.type || 'Service', subtitle: m.description || undefined, meta: dayOnly(m.performedAt) })), empty: 'No service recorded yet.' },
        { title: 'Jobs on it', rows: (d) => (d.linkedJobs || []).map((j: any) => ({ key: j.id, title: j.title || j.number || 'Job', subtitle: join(j.number, j.status), meta: dayOnly(j.scheduledDate) })), empty: 'No jobs on it yet.' },
      ],
    },
  },
]
