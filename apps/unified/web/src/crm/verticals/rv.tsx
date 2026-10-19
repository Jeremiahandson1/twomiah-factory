// Dealership (RV, powersports): the screens templates/crm-rv has and the base CRM doesn't (crm/pages/rv/), their routes under /crm and
// their menu items, each gated by the template's features so no other vertical sees them (docs/UNIFIED_MOVE_GUIDE.md).
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { BellRing, Bot, Calculator, Caravan, ClipboardCheck, ClipboardList, Clock, CreditCard, DollarSign, GitBranch, MessageSquare, Package, Receipt, Repeat, Send, Wrench } from 'lucide-react'
import type { NavItem } from '../../shared'
import { page } from '../lazy'

const InventoryPage = page(() => import('../pages/rv/InventoryPage'))
const SalesPipelinePage = page(() => import('../pages/rv/SalesPipelinePage'))
const DeskingPage = page(() => import('../pages/rv/DeskingPage'))
const FIPage = page(() => import('../pages/rv/FIPage'))
const TitleRegPage = page(() => import('../pages/rv/TitleRegPage'))
const OEMPartsPage = page(() => import('../pages/rv/OEMPartsPage'))
const ServicePage = page(() => import('../pages/rv/ServicePage'))
const LaborGuidePage = page(() => import('../pages/rv/LaborGuidePage'))
const FloorplanPage = page(() => import('../pages/rv/FloorplanPage'))
const RentalsPage = page(() => import('../pages/rv/RentalsPage'))
const AlertsPage = page(() => import('../pages/rv/AlertsPage'))
const AccountingPage = page(() => import('../pages/rv/AccountingPage'))
const AIReportsPage = page(() => import('../pages/rv/AIReportsPage'))
const AILeadResponderPage = page(() => import('../pages/rv/AILeadResponderPage'))
const AITradeAppraisalPage = page(() => import('../pages/rv/AITradeAppraisalPage'))

/**
 * The dealership's own dashboard (inventory, the pipeline, service), shown at /crm/dashboard in place of the jobs
 * dashboard when the vertical's screens say home: 'rv' (crm/screens.tsx Dashboard).
 */
export const dashboard = page(() => import('../pages/rv/DashboardPage'))

/** Routes inside /crm (behind the CRM's first-run gate), as <Route path="…" element={…} /> with a key. */
export const routes: ReactElement[] = [
  <Route key="rv-units" path="units" element={<InventoryPage />} />,
  <Route key="rv-pipeline" path="sales-pipeline" element={<SalesPipelinePage />} />,
  <Route key="rv-desking" path="desking" element={<DeskingPage />} />,
  <Route key="rv-fi" path="fi" element={<FIPage />} />,
  <Route key="rv-title-reg" path="title-reg" element={<TitleRegPage />} />,
  <Route key="rv-parts-catalog" path="parts-catalog" element={<OEMPartsPage />} />,
  <Route key="rv-service" path="service" element={<ServicePage />} />,
  <Route key="rv-labor-guide" path="labor-guide" element={<LaborGuidePage />} />,
  <Route key="rv-floorplan" path="floorplan" element={<FloorplanPage />} />,
  <Route key="rv-rentals" path="rentals" element={<RentalsPage />} />,
  <Route key="rv-alerts" path="alerts" element={<AlertsPage />} />,
  <Route key="rv-accounting" path="accounting" element={<AccountingPage />} />,
  <Route key="rv-ai-reports" path="ai-reports" element={<AIReportsPage />} />,
  <Route key="rv-ai-leads" path="ai-leads" element={<AILeadResponderPage />} />,
  <Route key="rv-ai-trade" path="ai-trade" element={<AITradeAppraisalPage />} />,
]

/** Any of the dealership's core features (server/crm/rv/index.ts DEALERSHIP): this business is a dealership. */
const DEALERSHIP = ['unit_inventory', 'deal_pipeline', 'service_dept']

/**
 * Menu items, gated by features — templates/crm-rv shellConfig.ts, whose ungated dealership items are gated here on the
 * dealership's own features as their APIs are (server/crm/rv/index.ts) — and by the permission each page's list asks.
 * Desking reads the pipeline (deal_pipeline); the Follow-Up item is the Marketing page's drips (follow_up_sequences).
 */
export const nav: NavItem[] = [
  { to: '/crm/ai-reports', icon: Bot, label: 'AI Reports', section: 'AI Tools', features: DEALERSHIP, permission: 'reports:read' },
  { to: '/crm/ai-leads', icon: MessageSquare, label: 'AI Lead Responder', section: 'AI Tools', features: DEALERSHIP, permission: 'contacts:update' },
  { to: '/crm/ai-trade', icon: Calculator, label: 'AI Trade Appraisal', section: 'AI Tools', features: DEALERSHIP, permission: 'contacts:update' },
  { to: '/crm/units', icon: Caravan, label: 'Inventory', section: 'Sales', features: ['unit_inventory'], permission: 'contacts:read' },
  { to: '/crm/sales-pipeline', icon: GitBranch, label: 'Sales Pipeline', section: 'Sales', features: ['deal_pipeline'], permission: 'contacts:read' },
  { to: '/crm/desking', icon: ClipboardList, label: 'Desking', section: 'Sales', features: ['deal_pipeline'], permission: 'contacts:read' },
  { to: '/crm/fi', icon: CreditCard, label: 'F&I / Deal Jacket', section: 'Sales', features: DEALERSHIP },
  { to: '/crm/title-reg', icon: ClipboardCheck, label: 'Title & Registration', section: 'Sales', features: DEALERSHIP, permission: 'contacts:read' },
  { to: '/crm/parts-catalog', icon: Package, label: 'Parts Catalog', section: 'Parts & Service', features: DEALERSHIP },
  { to: '/crm/service', icon: Wrench, label: 'Service', section: 'Parts & Service', features: ['service_dept'], permission: 'contacts:read' },
  { to: '/crm/labor-guide', icon: Clock, label: 'Labor Guide', section: 'Parts & Service', features: DEALERSHIP },
  { to: '/crm/floorplan', icon: DollarSign, label: 'Floorplan', section: 'Operations', features: DEALERSHIP },
  { to: '/crm/rentals', icon: Repeat, label: 'Rentals', section: 'Operations', features: DEALERSHIP, permission: 'contacts:read' },
  { to: '/crm/alerts', icon: BellRing, label: 'Alerts', section: 'Operations', features: ['deal_pipeline', 'service_dept'], permission: 'contacts:read' },
  // GET /api/accounting/status asks invoices:read — the link asks the same (T62).
  { to: '/crm/accounting', icon: Receipt, label: 'Accounting', section: 'Back Office', features: DEALERSHIP, permission: 'invoices:read' },
  // The Marketing page's drips are the Follow-Up product here; only crm-rv is offered follow_up_sequences (T15 M5 → #167; RV T19 M6).
  { to: '/crm/marketing', icon: Send, label: 'Follow-Up', features: ['follow_up_sequences'], permission: 'marketing:read' },
]
