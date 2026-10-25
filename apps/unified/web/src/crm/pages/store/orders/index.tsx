// The store's orders screens (docs/UNIFIED_STORE_PLAN.md step 4): their routes under /crm, their menu items and the
// permission each page's main API asks. Moved from templates/crm-store/frontend/src/pages/{DashboardPage, OrdersPage,
// OrderDetailPage, CustomersPage, PaymentsPage, ShippingPage, SuppliersPage}.tsx.
//
// The order is the template's menu (components/layout/AppLayout.tsx): Dashboard, [Products], Orders, Customers,
// Payments, [Discounts, Loyalty], Suppliers, Shipping — the bracketed ones are the catalogue group's. The template's
// menu had no headings, so no item carries a `section`. The store has no feature switches (everything is core, and the
// server mounts these routes ungated), so no item carries `features`.
//
// Each item asks the permission its page's main API asks (server/crm/store/orders/*.ts, checkout/paymentRoutes.ts):
//   Dashboard  /crm/dashboard   GET /api/admin/orders/stats            orders:read
//   Orders     /crm/orders(/:id) GET /api/admin/orders(/:id)           orders:read
//   Customers  /crm/customers   GET /api/admin/orders/customers        orders:read
//   Payments   /crm/payments    GET /api/admin/payments                payments:update — the owner's, reading as connecting
//                                                                      (the template's GET asked none; closed 2026-10-19)
//   Suppliers  /crm/suppliers   GET /api/admin/suppliers               integrations:update (the template's menu too)
//   Shipping   /crm/shipping    GET /api/admin/shipping/config         shipping:read (the template's item had none; the
//                                                                      server asks it — every store seat holds it)
// The dashboard is not a route here: it is the store's home at /crm/dashboard (crm/screens.tsx HOMES, `dashboard`).
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { CreditCard, Home, Package, ShieldAlert, ShoppingBag, Truck, Users } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const OrdersPage = page(() => import('./OrdersPage'))
const OrderDetailPage = page(() => import('./OrderDetailPage'))
const CustomersPage = page(() => import('./CustomersPage'))
const PaymentsPage = page(() => import('./PaymentsPage'))
const ShippingPage = page(() => import('./ShippingPage'))
const SuppliersPage = page(() => import('./SuppliersPage'))
const NewOrderPage = page(() => import('./NewOrderPage'))
const DisputesPage = page(() => import('./DisputesPage'))

/** Routes inside /crm, each <Route key path element />. */
export const routes: ReactElement[] = [
  <Route key="store-orders" path="orders" element={<OrdersPage />} />,
  // An order made for a customer (orders:create — the page asks it; the prefix /crm/orders is orders:read).
  <Route key="store-order-new" path="orders/new" element={<NewOrderPage />} />,
  <Route key="store-disputes" path="disputes" element={<DisputesPage />} />,
  <Route key="store-order" path="orders/:id" element={<OrderDetailPage />} />,
  <Route key="store-customers" path="customers" element={<CustomersPage />} />,
  <Route key="store-payments" path="payments" element={<PaymentsPage />} />,
  <Route key="store-shipping" path="shipping" element={<ShippingPage />} />,
  <Route key="store-suppliers" path="suppliers" element={<SuppliersPage />} />,
]

/** Menu items, each gated by the permission its page's main API asks. */
export const nav: NavItem[] = [
  { to: '/crm/dashboard', icon: Home, label: 'Dashboard', exact: true, permission: 'orders:read' },
  { to: '/crm/orders', icon: ShoppingBag, label: 'Orders', permission: 'orders:read' },
  { to: '/crm/customers', icon: Users, label: 'Customers', permission: 'orders:read' },
  { to: '/crm/payments', icon: CreditCard, label: 'Payments', permission: 'payments:update' },
  { to: '/crm/suppliers', icon: Truck, label: 'Suppliers', permission: 'integrations:update' },
  { to: '/crm/shipping', icon: Package, label: 'Shipping', permission: 'shipping:read' },
  // Chargebacks (GET /api/admin/disputes asks orders:refund): money leaving the shop, the seats that refund.
  { to: '/crm/disputes', icon: ShieldAlert, label: 'Disputes', permission: 'orders:refund' },
]

/** '/crm/<path>' → the permission its page's main API asks, for a URL typed in (a prefix covers /crm/orders/:id). */
export const routePermissions: Record<string, string> = {
  '/crm/dashboard': 'orders:read',
  '/crm/orders': 'orders:read',
  '/crm/customers': 'orders:read',
  '/crm/payments': 'payments:update',
  '/crm/suppliers': 'integrations:update',
  '/crm/shipping': 'shipping:read',
  '/crm/disputes': 'orders:refund',
}

/** The store's home at /crm/dashboard (its sales, orders to ship, set-up). */
export const dashboard: import('react').ComponentType | null = page(() => import('./DashboardPage'))
