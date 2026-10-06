// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
import { BarChart3, BookOpen, Bot, Briefcase, Calendar, CalendarCheck, CheckSquare, ClipboardCheck, ClipboardList, Clock, CreditCard, DollarSign, ExternalLink, FileQuestion, FileText, FolderKanban, FolderOpen, Home, Inbox, LifeBuoy, ListTodo, Mail, Megaphone, MessageSquare, Phone, Receipt, Repeat, Scissors, ShieldCheck, ShoppingCart, Star, Target, Truck, Users, Wallet, Warehouse, Wrench, Calculator } from 'lucide-react';
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/contacts', icon: Users, label: 'Contacts' },
  { to: '/crm/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/crm/quotes', icon: FileText, label: 'Quotes', permission: 'quotes:read' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', permission: 'invoices:read' },
  { to: '/crm/schedule', icon: Calendar, label: 'Schedule', features: ['scheduling'] },
  { to: '/crm/time', icon: Clock, label: 'Time', features: ['time_tracking'] },
  { to: '/crm/expenses', icon: DollarSign, label: 'Expenses', features: ['expense_tracking'] },
  { to: '/crm/purchase-orders', icon: ShoppingCart, label: 'Purchase Orders', features: ['purchase_orders'], permission: 'purchase-orders:read' },
  { to: '/crm/bills', icon: Wallet, label: 'Bills', features: ['vendor_bills'], permission: 'bills:read' },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents' },
  { to: '/crm/team', icon: Users, label: 'Team', permission: 'team:read' },
  { to: '/crm/projects', icon: FolderKanban, label: 'Projects', features: ['projects'] },
  { to: '/crm/rfis', icon: FileQuestion, label: 'RFIs', features: ['rfis'] },
  { to: '/crm/submittals', icon: FileText, label: 'Submittals', features: ['submittals'] },
  { to: '/crm/lien-waivers', icon: ShieldCheck, label: 'Lien Waivers', features: ['lien_waivers'], permission: 'lien-waivers:read' },
  { to: '/crm/draw-schedules', icon: DollarSign, label: 'Draw Schedules', features: ['draw_schedules'], permission: 'draw-schedules:read' },
  { to: '/crm/aia-forms', icon: FileText, label: 'AIA G702/G703', features: ['aia_forms'], permission: 'aia-forms:read' },
  { to: '/crm/gantt', icon: BarChart3, label: 'Gantt Chart', features: ['gantt_charts'] },
  { to: '/crm/change-orders', icon: ClipboardList, label: 'Change Orders', features: ['change_orders'], permission: 'change-orders:read' },
  { to: '/crm/punch-lists', icon: CheckSquare, label: 'Punch Lists', features: ['punch_lists'] },
  { to: '/crm/daily-logs', icon: BookOpen, label: 'Daily Logs', features: ['daily_logs'] },
  { to: '/crm/inspections', icon: ClipboardCheck, label: 'Inspections', features: ['inspections'] },
  { to: '/crm/bids', icon: Target, label: 'Bids', features: ['bid_management'], permission: 'bids:read' },
  { to: '/crm/fleet', icon: Truck, label: 'Fleet', features: ['fleet'] },
  { to: '/crm/inventory', icon: Warehouse, label: 'Inventory', features: ['inventory'] },
  { to: '/crm/equipment', icon: Wrench, label: 'Equipment', features: ['equipment_tracking'] },
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'] },
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Online Booking', features: ['online_booking'] },
  // The Marketing page is email marketing (campaigns, templates, drips); Reviews has its own item above. (T15 M5)
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing'], permission: 'marketing:read' },
  { to: '/crm/ads', icon: Target, label: 'Ads', features: ['paid_ads'], permission: 'ads:read' },
  { to: '/crm/pricebook', icon: CreditCard, label: 'Pricebook', features: ['pricebook'] },
  { to: '/crm/agreements', icon: ShieldCheck, label: 'Agreements', features: ['service_agreements'] },
  { to: '/crm/warranties', icon: Star, label: 'Warranties', features: ['warranties'] },
  { to: '/crm/call-tracking', icon: Phone, label: 'Call Tracking', features: ['call_tracking'] },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'], minRole: 'admin' },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'], minRole: 'admin' },
  { to: '/crm/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: ['ai_receptionist'] },
  { to: '/crm/recurring', icon: Repeat, label: 'Recurring', features: ['recurring_jobs'], permission: 'invoices:read' },
  { to: '/crm/takeoffs', icon: Scissors, label: 'Takeoffs', features: ['takeoff_tools'], permission: 'takeoffs:read' },
  { to: '/crm/tasks', icon: ListTodo, label: 'Tasks', features: ['projects'] },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'], permission: 'sms:send' },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], permission: 'reports:read' },
  // The audit trail. Behind reports:read, the same permission the /api/audit route requires, so the
  // entry never offers a seat a page it would be refused. (T51)
  { to: '/crm/audit', icon: FileText, label: 'Audit Log', permission: 'reports:read' },
  { to: '/crm/job-costing', icon: Calculator, label: 'Job Costing', features: ['job_costing'], permission: 'reports:read' },
  { to: '/crm/selections', icon: CheckSquare, label: 'Selections', features: ['selections'], permission: 'selections:read' },
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'] },
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'] },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'] },
  { to: '/crm/help', icon: BookOpen, label: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  routeGates: {
  '/crm/pricebook-trial': ['pricebook'],
  },
};
