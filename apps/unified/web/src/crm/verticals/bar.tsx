// Bar: the screens templates/crm-bar has and the base CRM doesn't (crm/pages/bar/), their routes under /crm and
// their menu items, each gated by the template's features so no other vertical sees them (docs/UNIFIED_MOVE_GUIDE.md).
//
// Private parties (Parties, Spaces, Party Packages) are the restaurant's screens and menu items (crm/verticals/restaurant),
// by the same features; the bar's settings rename them (screens.nav).
import type { ReactElement } from 'react'
import { Navigate, Route, useLocation } from 'react-router-dom'
import { Beer, CalendarDays, CreditCard, Flame, Gift, Package, Settings, Star, Tablet, Utensils } from 'lucide-react'
import { kioskLocked } from '../pages/bar/kioskLock'
import { useAuth, type NavItem } from '../../shared'
import { page } from '../lazy'

const TonightPage = page(() => import('../pages/bar/TonightPage'))
const MenuPage = page(() => import('../pages/bar/MenuPage'))
const TapsPage = page(() => import('../pages/bar/TapsPage'))
const HappeningsPage = page(() => import('../pages/bar/HappeningsPage'))
const BarSettingsPage = page(() => import('../pages/bar/BarSettingsPage'))
const RegisterPage = page(() => import('../pages/bar/RegisterPage'))
const GrillPage = page(() => import('../pages/bar/GrillPage'))
const CloseoutPage = page(() => import('../pages/bar/CloseoutPage'))
const GiftCardsPage = page(() => import('../pages/bar/GiftCardsPage'))
const RegularsPage = page(() => import('../pages/bar/RegularsPage'))
const FloorPage = page(() => import('../pages/bar/FloorPage'))
const StockPage = page(() => import('../pages/bar/StockPage'))
const CountPage = page(() => import('../pages/bar/CountPage'))
const ClockPage = page(() => import('../pages/bar/ClockPage'))
const BarSchedulePage = page(() => import('../pages/bar/BarSchedulePage'))
const SalesReport = page(() => import('../pages/bar/SalesReport'))
const FoodSettingsPage = page(() => import('../pages/bar/FoodSettingsPage'))
/** The order kiosk: full screen, outside the shell (App.tsx), behind the order_kiosk feature (the page and its API). */
export const KioskPage = page(() => import('../pages/bar/KioskPage'))

/**
 * Kiosk mode is on in this browser: every other address of the app goes back to the kiosk, until a manager's till PIN
 * stops it (KioskPage). Drawn once beside the routes (App.tsx).
 */
export function KioskLock() {
  const { pathname } = useLocation()
  return kioskLocked() && pathname !== '/crm/kiosk' && (pathname.startsWith('/crm') || pathname === '/login') ? <Navigate to="/crm/kiosk" replace /> : null
}

/**
 * The bar's home (Tonight at a glance above the party book), shown at /crm/dashboard in place of the jobs dashboard when
 * the vertical's screens say home: 'bar' (crm/screens.tsx Dashboard), as its /api/dashboard is the events one.
 */
export const dashboard = page(() => import('../pages/bar/HomePage'))

/**
 * Above the shared Reports page: the register's nights added up (sales, tips, voids), where the register is on — the
 * template's ReportsDashboard.tsx (screens.reportsAbove 'bar', crm/screens.tsx Reports).
 */
export function reportsAbove() {
  const { hasFeature } = useAuth()
  return hasFeature('bar_register') ? <SalesReport /> : null
}

/** Routes inside /crm (behind the CRM's first-run gate), as <Route path="…" element={…} /> with a key. */
export const routes: ReactElement[] = [
  <Route key="bar-tonight" path="tonight" element={<TonightPage />} />,
  <Route key="bar-menu" path="menu" element={<MenuPage />} />,
  <Route key="bar-taps" path="taps" element={<TapsPage />} />,
  <Route key="bar-whats-on" path="whats-on" element={<HappeningsPage />} />,
  <Route key="bar-settings" path="bar-settings" element={<BarSettingsPage />} />,
  <Route key="bar-register" path="register" element={<RegisterPage />} />,
  <Route key="bar-grill" path="grill" element={<GrillPage />} />,
  <Route key="bar-closeout" path="closeout" element={<CloseoutPage />} />,
  <Route key="bar-gift-cards" path="gift-cards" element={<GiftCardsPage />} />,
  <Route key="bar-regulars" path="regulars" element={<RegularsPage />} />,
  <Route key="bar-floor" path="floor" element={<FloorPage />} />,
  <Route key="bar-stock" path="stock" element={<StockPage />} />,
  <Route key="bar-count" path="count" element={<CountPage />} />,
  <Route key="bar-clock" path="clock" element={<ClockPage />} />,
  <Route key="bar-shifts" path="shifts" element={<BarSchedulePage />} />,
  <Route key="bar-register-settings" path="register-settings" element={<FoodSettingsPage />} />,
]

/**
 * Menu items, gated by features and the permission each page's API asks (templates/crm-bar shellConfig.ts). The bar's
 * week of shifts is /crm/shifts (/crm/schedule is the job schedule, never offered to a bar).
 */
export const nav: NavItem[] = [
  { to: '/crm/tonight', icon: Flame, label: 'Tonight', section: 'The Bar', features: ['bar_tonight'], permission: 'bar:read' },
  { to: '/crm/register', icon: CreditCard, label: 'Register', features: ['bar_register'], permission: 'bar:register' },
  // The kiosk opens full screen (outside the menu's shell); GET /api/food/kiosk/state asks bar:register.
  { to: '/crm/kiosk', icon: Tablet, label: 'Kiosk', features: ['order_kiosk'], permission: 'bar:register' },
  { to: '/crm/gift-cards', icon: Gift, label: 'Gift Cards', features: ['gift_cards'], permission: 'bar:manage' },
  { to: '/crm/regulars', icon: Star, label: 'Regulars', features: ['loyalty_rewards'], permission: 'loyalty:read' },
  { to: '/crm/stock', icon: Package, label: 'Stock', features: ['bar_stock'], permission: 'bar:update' },
  { to: '/crm/shifts', icon: CalendarDays, label: 'Schedule', features: ['bar_schedule'], permission: 'bar:read' },
  { to: '/crm/menu', icon: Utensils, label: 'Menu', features: ['bar_menu'], permission: 'bar:read' },
  { to: '/crm/taps', icon: Beer, label: 'Taps', features: ['bar_menu'], permission: 'bar:read' },
  { to: '/crm/whats-on', icon: CalendarDays, label: "What's on", features: ['bar_tonight'], permission: 'bar:read' },
  { to: '/crm/bar-settings', icon: Settings, label: 'Bar Settings', features: ['bar_tonight'], permission: 'bar:read' },
  // The card reader, tabs, the kiosk, online ordering and the delivery links (GET /api/food/settings asks bar:register).
  { to: '/crm/register-settings', icon: Settings, label: 'Register Settings', features: ['bar_register', 'card_reader', 'order_kiosk'], permission: 'bar:register' },
]

/** The register's other screens, opened from it with no menu item of their own: the feature each needs (shellConfig.ts routeGates). */
export const routeGates: Record<string, string[]> = {
  '/crm/grill': ['bar_register'],
  '/crm/floor': ['bar_register'],
  '/crm/closeout': ['bar_register'],
  '/crm/count': ['bar_stock'],
  '/crm/clock': ['time_tracking'],
}

/** …and the permission their API asks (bar:register), so a viewer is not shown a page whose every request is refused. */
export const routePermissions: Record<string, string> = {
  '/crm/grill': 'bar:register',
  '/crm/floor': 'bar:register',
  '/crm/count': 'bar:register',
  '/crm/clock': 'bar:register',
  '/crm/closeout': 'bar:register',
}
