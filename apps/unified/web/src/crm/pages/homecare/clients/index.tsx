// Home care, the clients group's screens: their routes inside /crm (each element a page() import, so this index stays
// light), their menu items (paths and order: crm/verticals/homecare.tsx MENU), and the permission each page's API asks.
//
// Every page's main API reads with care-clients:read, which a caregiver also holds (their own clients); these are the
// office's screens, so each asks the office's verb, care-clients:update (/api/documents' list asks it outright), and a
// caregiver's menu stays their own app, as in the template (AdminDashboard was the office's).
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { Users, ClipboardList, FileSignature, Building2, HeartHandshake, Stethoscope, Pill, FilePen, FolderOpen } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const ClientsManagement = page(() => import('./ClientsManagement'))
const ClientOnboarding = page(() => import('./ClientOnboarding'))
const ClientDocuments = page(() => import('./ClientDocuments'))
const ReferralSources = page(() => import('./ReferralSources'))
const CarePlans = page(() => import('./CarePlans'))
const ADLTracking = page(() => import('./ADLTracking'))
const MedicationsManagement = page(() => import('./MedicationsManagement'))
const FormBuilder = page(() => import('./FormBuilder'))
const DocumentsManagement = page(() => import('./DocumentsManagement'))

const OFFICE = 'care-clients:update'

export const routes: ReactElement[] = [
  <Route key="hc-clients" path="clients" element={<ClientsManagement />} />,
  <Route key="hc-client-onboarding" path="client-onboarding" element={<ClientOnboarding />} />,
  <Route key="hc-client-documents" path="client-documents" element={<ClientDocuments />} />,
  <Route key="hc-referral-sources" path="referral-sources" element={<ReferralSources />} />,
  <Route key="hc-care-plans" path="care-plans" element={<CarePlans />} />,
  <Route key="hc-adl" path="adl" element={<ADLTracking />} />,
  <Route key="hc-medications" path="medications" element={<MedicationsManagement />} />,
  <Route key="hc-form-builder" path="form-builder" element={<FormBuilder />} />,
  <Route key="hc-documents" path="documents" element={<DocumentsManagement />} />,
]

/** The template's labels (AdminDashboard.tsx NAV_SECTIONS); MENU orders them and sets the headings. */
export const nav: NavItem[] = [
  { to: '/crm/clients', icon: Users, label: 'Clients', permission: OFFICE },
  { to: '/crm/client-onboarding', icon: ClipboardList, label: 'Onboarding', permission: OFFICE },
  { to: '/crm/client-documents', icon: FileSignature, label: 'Client Documents', permission: OFFICE },
  { to: '/crm/referral-sources', icon: Building2, label: 'Referral Sources', permission: OFFICE },
  { to: '/crm/care-plans', icon: HeartHandshake, label: 'Care Plans', permission: OFFICE },
  { to: '/crm/adl', icon: Stethoscope, label: 'ADL Tracking', permission: OFFICE },
  { to: '/crm/medications', icon: Pill, label: 'Medications', permission: OFFICE },
  { to: '/crm/form-builder', icon: FilePen, label: 'Form Builder', permission: OFFICE },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', permission: OFFICE },
]

export const routePermissions: Record<string, string> = Object.fromEntries(nav.map((item) => [item.to, OFFICE]))
