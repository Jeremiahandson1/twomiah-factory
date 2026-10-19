// Home care, the people group's screens: their routes inside /crm (each element a page() import, so this index stays
// light), their menu items (paths and order: crm/verticals/homecare.tsx MENU), and the permission each page's API asks.
//
// Moved from templates/crm-homecare/frontend/src (AdminDashboard.tsx renderPage): caregivers, performance,
// performance-reviews (to performance), applications, job-postings, onboarding-packets, payroll, expenses, background-checks, and the
// caregiver-profile / caregiver-history sections as /crm/caregivers/:id and /crm/caregivers/:id/history.
//
// Permissions (the routes' own; packages/tenant-backend auth/permissions.ts, verticals/homecare/settings.ts):
//   · care-hr:read — caregivers, performance, performance reviews, applications, job postings, onboarding packets,
//     background checks. GET /api/caregivers also answers care-schedule:read (the schedule's pickers), which a caregiver
//     holds; the page's work (the record, adding, editing, hiring) is care-hr's, which a caregiver does not hold, so the
//     menu item stays the office's (rule 7).
//   · care-payroll:update — payroll and expenses (/api/payroll*, /api/payroll-shift-reviews and /api/expenses ask it for
//     every action).
// The detail and history addresses sit under /crm/caregivers, so its permission covers them (the shell matches by prefix).
import type { ReactElement } from 'react'
import { Navigate, Route } from 'react-router-dom'
import { Banknote, ClipboardList, CreditCard, FileText, Inbox, SearchCheck, Star, Users } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const CaregiverManagement = page(() => import('./CaregiverManagement'))
const CaregiverProfile = page(() => import('./CaregiverProfile'))
const CaregiverHistory = page(() => import('./CaregiverHistory'))
const PerformanceRatings = page(() => import('./PerformanceRatings'))
const ApplicationsDashboard = page(() => import('./ApplicationsDashboard'))
const JobPostingsAdmin = page(() => import('./JobPostingsAdmin'))
const OnboardingPacketsAdmin = page(() => import('./OnboardingPacketsAdmin'))
const BackgroundChecks = page(() => import('./BackgroundChecks'))
const PayrollProcessing = page(() => import('./PayrollProcessing'))
const ExpenseManagement = page(() => import('./ExpenseManagement'))

const HR = 'care-hr:read'
const PAYROLL = 'care-payroll:update'

export const routes: ReactElement[] = [
  <Route key="hc-people-caregivers" path="caregivers" element={<CaregiverManagement />} />,
  <Route key="hc-people-caregiver" path="caregivers/:id" element={<CaregiverProfile />} />,
  <Route key="hc-people-caregiver-history" path="caregivers/:id/history" element={<CaregiverHistory />} />,
  <Route key="hc-people-performance" path="performance" element={<PerformanceRatings />} />,
  // The template's second review page (pages/PerformanceReviewsPage.tsx) could never save — it asked for a caregiver id
  // typed by hand and no client, which every review needs — and /crm/performance writes the same reviews properly.
  // Its address opens that page.
  <Route key="hc-people-performance-reviews" path="performance-reviews" element={<Navigate to="/crm/performance" replace />} />,
  <Route key="hc-people-applications" path="applications" element={<ApplicationsDashboard />} />,
  <Route key="hc-people-job-postings" path="job-postings" element={<JobPostingsAdmin />} />,
  <Route key="hc-people-onboarding-packets" path="onboarding-packets" element={<OnboardingPacketsAdmin />} />,
  <Route key="hc-people-background-checks" path="background-checks" element={<BackgroundChecks />} />,
  <Route key="hc-people-payroll" path="payroll" element={<PayrollProcessing />} />,
  <Route key="hc-people-expenses" path="expenses" element={<ExpenseManagement />} />,
]

/** One item per MENU path this group owns, with the template's label (AdminDashboard.tsx NAV_SECTIONS). */
export const nav: NavItem[] = [
  { to: '/crm/caregivers', icon: Users, label: 'Caregivers', permission: HR },
  { to: '/crm/performance', icon: Star, label: 'Performance', permission: HR },
  { to: '/crm/applications', icon: FileText, label: 'Job Applications', permission: HR },
  { to: '/crm/job-postings', icon: ClipboardList, label: 'Job Postings', permission: HR },
  { to: '/crm/onboarding-packets', icon: Inbox, label: 'Onboarding Queue', permission: HR },
  { to: '/crm/payroll', icon: Banknote, label: 'Payroll', permission: PAYROLL },
  { to: '/crm/expenses', icon: CreditCard, label: 'Expenses', permission: PAYROLL },
  { to: '/crm/background-checks', icon: SearchCheck, label: 'Background Checks', permission: HR },
]

/** Every route's permission, menu or not (a typed-in address). */
export const routePermissions: Record<string, string> = {
  '/crm/caregivers': HR,
  '/crm/performance': HR,
  '/crm/performance-reviews': HR,
  '/crm/applications': HR,
  '/crm/job-postings': HR,
  '/crm/onboarding-packets': HR,
  '/crm/background-checks': HR,
  '/crm/payroll': PAYROLL,
  '/crm/expenses': PAYROLL,
}
