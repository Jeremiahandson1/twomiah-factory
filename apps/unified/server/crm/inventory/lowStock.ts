// The shared inventory module's daily low-stock email (contractor, field service, basic, landscaping; the dealership's
// parts). It replaces the email that went out on EVERY stock movement. The rules are the store's, from the same code
// (../lowStockDigest.ts); this is only what is inventory-specific: its switches, whom it mails (the people who run the
// business) and which items are low (data/inventoryLowStock.ts).
import { inventoryAlertRecipients, inventoryLowItems, type InventoryLowItem } from '../../data/inventoryLowStock.ts'
import type { CrmDeps } from '../deps.ts'
import { createLowStockDigest } from '../lowStockDigest.ts'

export function createInventoryLowStockDigest(
  d: Pick<CrmDeps, 'db' | 'logger' | 'features'>,
  email: { send: (to: string, template: string, data: any) => Promise<any> },
) {
  return createLowStockDigest<InventoryLowItem>(d, {
    kind: 'inventory_low_stock_digest',
    // Inventory is on with `inventory`, or with the dealership's `parts_tracking` (the same two switches the screen answers to).
    feature: ['inventory', 'parts_tracking'],
    items: (companyId) => inventoryLowItems(d.db, companyId),
    recipients: async (co) => {
      const people = await inventoryAlertRecipients(d.db, co.id)
      return people.length ? people : co.email ? [co.email] : []
    },
    send: (to, items) => email.send(to, 'inventoryLowStockDigest', { items }),
  })
}
