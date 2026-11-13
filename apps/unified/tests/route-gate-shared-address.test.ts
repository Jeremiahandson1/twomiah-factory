// Two trades' pages at one address (launch 11/12): the bar's Gift Cards needs bar:manage, the salon's invoices:read. The route
// gate read only the first menu entry at the address — the bar's — so a salon's front desk saw Gift cards in the menu and was
// refused on opening it. The entries whose switch the business has on are the ones that apply; any of them allowing the
// person opens the page; an explicit route rule still decides alone.
import { test, expect } from 'bun:test'
import { maySeeRoute, entriesAt } from '../../../packages/tenant-ui/src/shell/types.ts'

const nav: any[] = [
  { to: '/crm/gift-cards', label: 'Gift Cards', permission: 'bar:manage', features: ['gift_cards'] },
  { to: '/crm/gift-cards', label: 'Gift cards', permission: 'invoices:read', features: ['salon_gift_cards'] },
]
const salonDesk = (p: string) => p === 'invoices:read'
const salonOn = (f: string) => f === 'salon_gift_cards'
const barOn = (f: string) => f === 'gift_cards'

test("a salon's front desk opens the salon's Gift cards; a bar seat without bar:manage does not open the bar's", () => {
  expect(entriesAt(nav, '/crm/gift-cards', salonOn).map((i) => i.permission)).toEqual(['invoices:read'])
  expect(maySeeRoute({ nav }, '/crm/gift-cards', 'viewer', salonDesk, salonOn)).toBe(true)
  expect(maySeeRoute({ nav }, '/crm/gift-cards', 'viewer', salonDesk, barOn)).toBe(false)
  expect(maySeeRoute({ nav }, '/crm/gift-cards', 'manager', (p) => p === 'bar:manage', barOn)).toBe(true)
})

test('an explicit route rule decides alone; no switches given, any entry allowing the person opens it', () => {
  expect(maySeeRoute({ nav, routePermissions: { '/crm/gift-cards': 'orders:refund' } }, '/crm/gift-cards', 'viewer', salonDesk, salonOn)).toBe(false)
  expect(maySeeRoute({ nav }, '/crm/gift-cards', 'viewer', salonDesk)).toBe(true)
  expect(maySeeRoute({ nav }, '/crm/gift-cards', 'viewer', () => false)).toBe(false)
})
