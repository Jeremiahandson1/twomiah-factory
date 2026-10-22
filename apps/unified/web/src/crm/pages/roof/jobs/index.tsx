// Roofing's jobs screens (docs/UNIFIED_ROOF_SCREENS.md): their routes under /crm, their menu items and the permission each
// page's main API asks.
//
// Moved from templates/crm-roof/frontend/src/pages/roofing/: PipelineBoard (/crm/pipeline, and the roofer's
// /crm/dashboard — the template's /crm index), JobsPage (/crm/jobs), JobDetailPage (/crm/jobs/:id), ReportsPage
// (/crm/reports). ./model.ts holds the stages (the server's) and the rows the four pages read.
//
// The menu is roofing's (templates/crm-roof components/layout/AppLayout.tsx): Pipeline and Jobs at the top, Reports in
// the bottom group. The template's items carried no feature and no permission; every page here reads GET /api/jobs,
// which the registry gates on the core `jobs` feature and the route on jobs:read (server/crm/roof/jobs.ts), so each
// item asks the same — gate the menu and the API alike.
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { BarChart3, Briefcase, LayoutDashboard } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const PipelineBoard = page(() => import('./PipelineBoard'))
const JobsPage = page(() => import('./JobsPage'))
const JobDetailPage = page(() => import('./JobDetailPage'))
const ReportsPage = page(() => import('./ReportsPage'))

/** Routes inside /crm, each <Route key path element />. */
export const routes: ReactElement[] = [
  <Route key="roof-pipeline" path="pipeline" element={<PipelineBoard />} />,
  <Route key="roof-jobs" path="jobs" element={<JobsPage />} />,
  <Route key="roof-job" path="jobs/:id" element={<JobDetailPage />} />,
  <Route key="roof-reports" path="reports" element={<ReportsPage />} />,
]

/** Menu items, each gated by the feature and permission its page's API asks. */
export const nav: NavItem[] = [
  { to: '/crm/pipeline', icon: LayoutDashboard, label: 'Pipeline', features: ['jobs'], permission: 'jobs:read' },
  { to: '/crm/jobs', icon: Briefcase, label: 'Jobs', features: ['jobs'], permission: 'jobs:read' },
  // Reports is its own switch (the registry offers roofing `reports`); the page reads the jobs, hence jobs:read.
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], permission: 'jobs:read' },
]

/**
 * '/crm/<path>' → the permission its page's main API asks, for every route (menu or not). The shell matches a key and
 * everything under it, so '/crm/jobs' also covers /crm/jobs/:id (GET /api/jobs/:id is jobs:read too).
 */
export const routePermissions: Record<string, string> = {
  '/crm/pipeline': 'jobs:read',
  '/crm/jobs': 'jobs:read',
  '/crm/reports': 'jobs:read',
}

/** The roofer's home at /crm/dashboard: the pipeline board (templates/crm-roof App.tsx: /crm's index). */
export const dashboard: import('react').ComponentType | null = PipelineBoard
