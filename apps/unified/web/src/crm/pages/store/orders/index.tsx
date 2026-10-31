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
//   Segments   /crm/segments    GET /api/admin/segments               marketing:read, with the store_segments feature
//   Post-purchase emails /crm/followups GET /api/admin/followups     marketing:read, with the store_followups feature
//   Audiences  /crm/audiences GET /api/admin/audiences         marketing:update, with the store_audiences feature
//   Reorders   /crm/reorders  GET /api/admin/reorders           margin:read, with the store_reorders feature
//   Returns    /crm/returns     GET /api/admin/store-returns          orders:read, with the store_returns feature
//   Sales      /crm/sales       GET /api/admin/sales-reports           revenue:read, with the store_sales_reports feature
//   Payments   /crm/payments    GET /api/admin/payments                payments:update — the owner's, reading as connecting
//                                                                      (the template's GET asked none; closed 2026-10-19)
//   Suppliers  /crm/suppliers   GET /api/admin/suppliers               integrations:update (the template's menu too)
//   Shipping   /crm/shipping    GET /api/admin/shipping/config         shipping:read (the template's item had none; the
//                                                                      server asks it — every store seat holds it)
// The dashboard is not a route here: it is the store's home at /crm/dashboard (crm/screens.tsx HOMES, `dashboard`).
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { BarChart3, CreditCard, Filter, Home, MailCheck, Megaphone, Package, PackageCheck, ShieldAlert, ShoppingBag, Truck, Undo2, Users } from 'lucide-react'
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
const SalesPage = page(() => import('./SalesPage'))
const ReturnsPage = page(() => import('./ReturnsPage'))
const SegmentsPage = page(() => import('./SegmentsPage'))
const FollowupsPage = page(() => import('./FollowupsPage'))
const ReordersPage = page(() => import('./ReordersPage'))
const AudiencesPage = page(() => import('./AudiencesPage'))

/** Routes inside /crm, each <Route key path element />. */
export const routes: ReactElement[] = [
  <Route key="store-orders" path="orders" element={<OrdersPage />} />,
  // An order made for a customer (orders:create — the page asks it; the prefix /crm/orders is orders:read).
  <Route key="store-order-new" path="orders/new" element={<NewOrderPage />} />,
  <Route key="store-disputes" path="disputes" element={<DisputesPage />} />,
  <Route key="store-order" path="orders/:id" element={<OrderDetailPage />} />,
  // Sales reports (GET /api/admin/sales-reports: store_sales_reports + revenue:read; the route is gated below, in routeGates).
  <Route key="store-sales" path="sales" element={<SalesPage />} />,
  // Returns and exchanges (GET /api/admin/store-returns: store_returns + orders:read; gated below, in routeGates).
  <Route key="store-returns" path="returns" element={<ReturnsPage />} />,
  // Customer segments (GET /api/admin/segments: store_segments + marketing:read; gated below, in routeGates).
  <Route key="store-segments" path="segments" element={<SegmentsPage />} />,
  // Post-purchase emails (GET /api/admin/followups: store_followups + marketing:read; gated below, in routeGates).
  <Route key="store-followups" path="followups" element={<FollowupsPage />} />,
  // Reorders (GET /api/admin/reorders: store_reorders + margin:read; gated below, in routeGates).
  <Route key="store-reorders" path="reorders" element={<ReordersPage />} />,
  // Audiences and purchase tags (GET /api/admin/audiences: store_audiences + marketing:update; gated below, in routeGates).
  <Route key="store-audiences" path="audiences" element={<AudiencesPage />} />,
  <Route key="store-customers" path="customers" element={<CustomersPage />} />,
  <Route key="store-payments" path="payments" element={<PaymentsPage />} />,
  <Route key="store-shipping" path="shipping" element={<ShippingPage />} />,
  <Route key="store-suppliers" path="suppliers" element={<SuppliersPage />} />,
]

/** Menu items, each gated by the permission its page's main API asks. */
export const nav: NavItem[] = [
  { to: '/crm/dashboard', icon: Home, label: 'Dashboard', exact: true, permission: 'orders:read' },
  { to: '/crm/orders', icon: ShoppingBag, label: 'Orders', permission: 'orders:read' },
  // Returns: behind the store_returns switch; reading is orders:read (the buttons that decide are orders:refund, which the server asks).
  { to: '/crm/returns', icon: Undo2, label: 'Returns', features: ['store_returns'], permission: 'orders:read' },
  { to: '/crm/customers', icon: Users, label: 'Customers', permission: 'orders:read' },
  // Saved groups of customers (by spend, orders, what they bought): behind store_segments; the server asks marketing:read too.
  { to: '/crm/segments', icon: Filter, label: 'Segments', features: ['store_segments'], permission: 'marketing:read' },
  // Emails sent after an order arrives (first order, thank-you with products, reorder reminder): behind store_followups; the server asks marketing:read too.
  { to: '/crm/followups', icon: MailCheck, label: 'Post-purchase emails', features: ['store_followups'], permission: 'marketing:read' },
  // A segment sent to Meta and Google Ads as a hashed audience, and the purchase tags: behind store_audiences; the server asks marketing:update too.
  { to: '/crm/audiences', icon: Megaphone, label: 'Audiences', features: ['store_audiences'], permission: 'marketing:update' },
  // Supplier purchase orders drafted from what is low: behind store_reorders; costs are the shop's own, so the server asks margin:read.
  { to: '/crm/reorders', icon: PackageCheck, label: 'Reorders', features: ['store_reorders'], permission: 'margin:read' },
  // Sales reports: behind the store_sales_reports switch and the takings' permission (revenue:read), as the server asks both.
  { to: '/crm/sales', icon: BarChart3, label: 'Sales', features: ['store_sales_reports'], permission: 'revenue:read' },
  { to: '/crm/payments', icon: CreditCard, label: 'Payments', permission: 'payments:update' },
  { to: '/crm/suppliers', icon: Truck, label: 'Suppliers', permission: 'integrations:update' },
  // The carrier account and its labels' defaults: the seats that set shipping (shipping:configure — manager, owner). Staff
  // hold shipping:read only to buy a label from an order (store live test, 2026-10-26: staff reached the API key form).
  { to: '/crm/shipping', icon: Package, label: 'Shipping', permission: 'shipping:configure' },
  // Chargebacks (GET /api/admin/disputes asks orders:refund): money leaving the shop, the seats that refund.
  { to: '/crm/disputes', icon: ShieldAlert, label: 'Disputes', permission: 'orders:refund' },
]

/** '/crm/<path>' → the permission its page's main API asks, for a URL typed in (a prefix covers /crm/orders/:id). */
export const routePermissions: Record<string, string> = {
  '/crm/dashboard': 'orders:read',
  '/crm/orders': 'orders:read',
  '/crm/customers': 'orders:read',
  '/crm/sales': 'revenue:read',
  '/crm/returns': 'orders:read',
  '/crm/segments': 'marketing:read',
  '/crm/followups': 'marketing:read',
  '/crm/reorders': 'margin:read',
  '/crm/audiences': 'marketing:update',
  '/crm/payments': 'payments:update',
  '/crm/suppliers': 'integrations:update',
  '/crm/shipping': 'shipping:configure',
  '/crm/disputes': 'orders:refund',
}

/** Addresses typed in: the feature each needs, as its menu row does (the shell's routeGates). */
export const routeGates: Record<string, string[]> = { '/crm/sales': ['store_sales_reports'], '/crm/returns': ['store_returns'], '/crm/segments': ['store_segments'], '/crm/followups': ['store_followups'], '/crm/reorders': ['store_reorders'], '/crm/audiences': ['store_audiences'] }

/** The store's home at /crm/dashboard (its sales, orders to ship, set-up). */
export const dashboard: import('react').ComponentType | null = page(() => import('./DashboardPage'))
