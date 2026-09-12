// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
import { BarChart3, BellRing, BookOpen, Bot, Briefcase, Calculator, Calendar, CalendarCheck, Caravan, ClipboardCheck, ClipboardList, Clock, CreditCard, DollarSign, ExternalLink, FileText, FolderOpen, GitBranch, Home, Inbox, LifeBuoy, Mail, Megaphone, MessageSquare, Package, Phone, Receipt, Repeat, Send, Star, Target, Users, Wrench } from 'lucide-react';
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },

  // AI Tools
  { to: '/crm/ai-reports', icon: Bot, label: 'AI Reports', section: 'AI Tools' },
  { to: '/crm/ai-leads', icon: MessageSquare, label: 'AI Lead Responder', section: 'AI Tools' },
  { to: '/crm/ai-trade', icon: Calculator, label: 'AI Trade Appraisal', section: 'AI Tools' },

  // Sales
  { to: '/crm/units', icon: Caravan, label: 'Inventory', features: ['unit_inventory'], section: 'Sales' },
  { to: '/crm/sales-pipeline', icon: GitBranch, label: 'Sales Pipeline', features: ['deal_pipeline'], section: 'Sales' },
  { to: '/crm/desking', icon: ClipboardList, label: 'Desking', section: 'Sales' },
  { to: '/crm/fi', icon: CreditCard, label: 'F&I / Deal Jacket', section: 'Sales' },
  { to: '/crm/title-reg', icon: ClipboardCheck, label: 'Title & Registration', section: 'Sales' },

  // Parts & Service
  { to: '/crm/parts-catalog', icon: Package, label: 'Parts Catalog', section: 'Parts & Service' },
  { to: '/crm/service', icon: Wrench, label: 'Service', features: ['service_dept'], section: 'Parts & Service' },
  { to: '/crm/labor-guide', icon: Clock, label: 'Labor Guide', section: 'Parts & Service' },
  { to: '/crm/inventory', icon: Package, label: 'Parts & Inventory', features: ['inventory', 'parts_tracking'], section: 'Parts & Service' },
  { to: '/crm/warranties', icon: Star, label: 'Warranties', features: ['warranties'], section: 'Parts & Service' },

  // Operations
  { to: '/crm/floorplan', icon: DollarSign, label: 'Floorplan', section: 'Operations' },
  { to: '/crm/rentals', icon: Repeat, label: 'Rentals', section: 'Operations' },
  { to: '/crm/schedule', icon: Calendar, label: 'Schedule', section: 'Operations' },
  { to: '/crm/time', icon: Clock, label: 'Time', section: 'Operations' },
  { to: '/crm/alerts', icon: BellRing, label: 'Alerts', features: ['deal_pipeline', 'service_dept'], section: 'Operations' },

  // Back Office
  { to: '/crm/accounting', icon: Receipt, label: 'Accounting', section: 'Back Office' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', section: 'Back Office' },
  { to: '/crm/quotes', icon: FileText, label: 'Quotes', section: 'Back Office' },
  { to: '/crm/expenses', icon: DollarSign, label: 'Expenses', section: 'Back Office' },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', section: 'Back Office' },
  { to: '/crm/jobs', icon: Briefcase, label: 'Jobs', section: 'Back Office' },

  // Customers & Marketing
  { to: '/crm/contacts', icon: Users, label: 'Contacts', section: 'Customers & Marketing' },
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'], section: 'Customers & Marketing' },
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Online Booking', features: ['online_booking'] },
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['google_reviews', 'email_marketing', 'referral_program'], section: 'Customers & Marketing' },
  { to: '/crm/marketing', icon: Send, label: 'Follow-Up', features: ['follow_up_sequences'], section: 'Customers & Marketing' },
  { to: '/crm/ads', icon: Target, label: 'Ads', features: ['paid_ads'], section: 'Customers & Marketing' },
  { to: '/crm/call-tracking', icon: Phone, label: 'Call Tracking', features: ['call_tracking'], section: 'Customers & Marketing' },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'] },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'] },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'], section: 'Customers & Marketing' },

  // Leads
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'], section: 'Leads' },
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'], section: 'Leads' },

  // Insights & Team
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], section: 'Insights & Team' },
  { to: '/crm/team', icon: Users, label: 'Team', section: 'Insights & Team' },

  // Help
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'], section: 'Help' },
  { to: '/crm/help', icon: BookOpen, label: 'Help', section: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  routeGates: {
  '/crm/agreements': ['service_agreements'],
  '/crm/ai-receptionist': ['ai_receptionist'],
  '/crm/equipment': ['equipment_tracking'],
  '/crm/fleet': ['fleet'],
  '/crm/recurring': ['recurring_jobs'],
  '/crm/tasks': ['projects'],
  },
  brand: { icon: Caravan, fallbackName: 'Roam' },
};
