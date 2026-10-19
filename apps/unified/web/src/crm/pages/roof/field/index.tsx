// Roofing's field screens (docs/UNIFIED_ROOF_SCREENS.md): their routes under /crm, their menu items and the permission each
// page's main API asks. Moved from templates/crm-roof/frontend/src/pages/roofing/{CrewsPage, MaterialsPage,
// CanvassingDashboard, CanvassingView, StormLeadsPage, StormRadarPage}.tsx.
//
// The order and the gates are the template's menu (components/layout/AppLayout.tsx): Crews (no feature), Materials
// (materials), Canvassing (canvassing_tool), Storm Leads (storm_lead_gen), Storm Radar (storm_radar_overlay). A typed URL
// is gated by the same feature through the shell (AppShell's route gate reads each menu item's `features`), as the
// template's FeatureRoute gated it; the server's mounts carry the same features (server/crm/roof/field/index.ts).
//
// Permissions: none of these pages' reads asks one beyond signing in — GET /api/crews, /api/materials,
// /api/canvassing/sessions (scoped to the seat on the server), /api/storms/events and /api/storm-radar/status all take
// any signed-in seat of a company with the feature — so no menu item and no route carries a permission, and
// routePermissions is empty. The writes are gated on each page by the permission each route asks (crews:*,
// marketing:update for scripts, canvassing:create / :update, storms:create).
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { HardHat, MapPin, Package, Radio, Zap } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const CrewsPage = page(() => import('./CrewsPage'))
const MaterialsPage = page(() => import('./MaterialsPage'))
const CanvassingDashboard = page(() => import('./CanvassingDashboard'))
const StormLeadsPage = page(() => import('./StormLeadsPage'))
const StormRadarPage = page(() => import('./StormRadarPage'))

/** Routes inside /crm, each <Route key path element />. */
export const routes: ReactElement[] = [
  <Route key="roof-crews" path="crews" element={<CrewsPage />} />,
  <Route key="roof-materials" path="materials" element={<MaterialsPage />} />,
  <Route key="roof-canvassing" path="canvassing" element={<CanvassingDashboard />} />,
  <Route key="roof-storm-leads" path="storm-leads" element={<StormLeadsPage />} />,
  <Route key="roof-storm-radar" path="storm-radar" element={<StormRadarPage />} />,
]

/** Menu items, each gated by the feature the template's menu used. */
export const nav: NavItem[] = [
  { to: '/crm/crews', icon: HardHat, label: 'Crews' },
  { to: '/crm/materials', icon: Package, label: 'Materials', features: ['materials'] },
  { to: '/crm/canvassing', icon: MapPin, label: 'Canvassing', features: ['canvassing_tool'] },
  { to: '/crm/storm-leads', icon: Zap, label: 'Storm Leads', features: ['storm_lead_gen'] },
  { to: '/crm/storm-radar', icon: Radio, label: 'Storm Radar', features: ['storm_radar_overlay'] },
]

/** '/crm/<path>' → the permission its page's main API asks: none of this group's reads asks one (above). */
export const routePermissions: Record<string, string> = {}

/**
 * The canvasser's full-screen field tool (the template's /canvass, outside the layout: no menu, no sidebar). Not a route
 * here — it must mount OUTSIDE the shell, beside /crm/onboarding in App.tsx, at /crm/canvass, behind ProtectedRoute and
 * for a roofer only. It holds its own canvassing_tool gate (the shell's route gate does not reach outside the shell).
 */
export const canvassView = page(() => import('./CanvassingView'))
