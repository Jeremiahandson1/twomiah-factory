/**
 * Stock on the phone (parity tier 2 #10, with barcode scanning — feature barcode_scanning, not ready): the shared inventory's parts
 * (packages/tenant-backend inventory, GET /api/inventory/items — the desktop's Inventory page, which asks no permission beyond a
 * session), found by name, SKU, barcode or the supplier's part number, or by scanning the barcode on the box. Read only: receiving,
 * moving and counting stay on the desktop. What a part cost is the server's to hide (margin:read), never this screen's.
 */
import { type ScreenSpec, join, money } from './kit'

const onHand = (n: unknown) => (n == null ? undefined : `${Number(n)} on hand`)

export const STOCK: ScreenSpec[] = [
  {
    id: 'stock-parts', title: 'Stock', any: [], feature: 'inventory',
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
    },
  },
]
