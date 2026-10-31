// Roofing's insurance screens (docs/UNIFIED_ROOF_SCREENS.md): their routes under /crm, their menu items and the permission each
// page's main API asks. Moved from templates/crm-roof/frontend/src (App.tsx's two insurance routes, AppLayout.tsx's
// Adjusters item).
//
// Both pages are behind insurance_workflow, as the template's FeatureRoute held them and as the server mounts
// /api/insurance (server/crm/roof/insurance/index.ts). /crm/adjusters is gated by its menu item: the shell blocks a URL
// under a nav item whose features are off (packages/tenant-ui/src/shell/AppShell.tsx). /crm/jobs/:id/insurance has no
// menu item and a path the shell's gates can't name (they match fixed prefixes, and its prefix /crm/jobs is the jobs
// page's), so it carries its own gate below — the same rule: wait for the company, then say the module is off.
import type { ReactElement, ReactNode } from 'react'
import { Route } from 'react-router-dom'
import { ClipboardCheck, Shield } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { useAuth, ModuleNotEnabled } from '../../../../shared'
import { page } from '../../../lazy'

const FEATURE = 'insurance_workflow'

const InsuranceClaimPage = page(() => import('./InsuranceClaimPage'))
const AdjusterDirectoryPage = page(() => import('./AdjusterDirectoryPage'))
const InsuranceFollowUpsPage = page(() => import('./InsuranceExtras'))

/**
 * A page behind a feature, where the shell's URL gate can't reach it. Renders nothing until the company has loaded —
 * hasFeature() answers false for everything before /api/auth/me lands, which is how roof M7 turned owned modules away on
 * a hard load — then the page, or the shell's "isn't switched on" screen (the template sent the person to /crm instead).
 */
function RequireFeature({ feature, title, children }: { feature: string; title: string; children: ReactNode }) {
  const { company, hasFeature } = useAuth()
  if (!company) return null
  if (!hasFeature(feature)) return <ModuleNotEnabled title={title} what="Insurance claims, supplements and the adjuster directory are part of your product but are not enabled on this account." />
  return <>{children}</>
}

/** Routes inside /crm, each <Route key path element />. */
export const routes: ReactElement[] = [
  <Route
    key="roof-insurance-claim"
    path="jobs/:id/insurance"
    element={<RequireFeature feature={FEATURE} title="Insurance claims"><InsuranceClaimPage /></RequireFeature>}
  />,
  <Route key="roof-adjusters" path="adjusters" element={<AdjusterDirectoryPage />} />,
  <Route key="roof-insurance-follow-ups" path="insurance-follow-ups" element={<InsuranceFollowUpsPage />} />,
]

/**
 * Menu items, each gated by the feature and permission the template's menu used. Adjusters: insurance_workflow, and no
 * permission — GET /api/insurance/adjusters asks only for a session (a crew seat needs the adjuster's phone number).
 * In the template's menu it sits after Invoices and before Lead Inbox.
 */
export const nav: NavItem[] = [
  { to: '/crm/adjusters', icon: Shield, label: 'Adjusters', features: [FEATURE] },
  // Not ready (insurance_extras): the depreciation to get back and the mortgage-company checks, across every claim. The office's (insurance:read).
  { to: '/crm/insurance-follow-ups', icon: ClipboardCheck, label: 'Insurance follow-ups', features: ['insurance_extras'], permission: 'insurance:read' },
]

/**
 * '/crm/<path>' → the permission its page's main API asks, for every route (menu or not). Neither page's main read asks
 * one: GET /api/insurance/claims/:jobId and GET /api/insurance/adjusters are sign-in and the feature only (the crew reads
 * the claim, T63; the server withholds its figures instead). So there is nothing to list.
 */
export const routePermissions: Record<string, string> = {
  '/crm/insurance-follow-ups': 'insurance:read',
}
