// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
import { BarChart3, BookMarked, BookOpen, Bot, Box, Briefcase, Calendar, CalendarCheck, CheckSquare, ClipboardCheck, ClipboardList, Clock, CreditCard, DollarSign, ExternalLink, FileQuestion, FileSignature, FileText, FolderKanban, FolderOpen, Home, Inbox, LifeBuoy, ListTodo, Mail, MapPin, Megaphone, MessageSquare, Phone, Radio, Receipt, Repeat, Route, Ruler, Scissors, ShieldCheck, Snowflake, Star, Target, Truck, Users, Warehouse, Wrench } from 'lucide-react';
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/contacts', icon: Users, label: 'Contacts' },
  { to: '/crm/jobs', icon: Briefcase, label: 'Service Calls' },
  { to: '/crm/quotes', icon: FileText, label: 'Quotes' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices' },
  { to: '/crm/schedule', icon: Calendar, label: 'Schedule' },
  { to: '/crm/time', icon: Clock, label: 'Time' },
  { to: '/crm/expenses', icon: DollarSign, label: 'Expenses' },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents' },
  { to: '/crm/team', icon: Users, label: 'Team' },
  { to: '/crm/projects', icon: FolderKanban, label: 'Projects', features: ['projects'] },
  { to: '/crm/rfis', icon: FileQuestion, label: 'RFIs', features: ['rfis'] },
  { to: '/crm/change-orders', icon: ClipboardList, label: 'Change Orders', features: ['change_orders'] },
  { to: '/crm/punch-lists', icon: CheckSquare, label: 'Punch Lists', features: ['punch_lists'] },
  { to: '/crm/daily-logs', icon: BookOpen, label: 'Daily Logs', features: ['daily_logs'] },
  { to: '/crm/inspections', icon: ClipboardCheck, label: 'Inspections', features: ['inspections'] },
  { to: '/crm/bids', icon: Target, label: 'Bids', features: ['bid_management'] },
  { to: '/crm/fleet', icon: Truck, label: 'Fleet', features: ['fleet'] },
  { to: '/crm/locations', icon: MapPin, label: 'Locations', features: ['multi_location'] },
  { to: '/crm/commissions', icon: DollarSign, label: 'Commissions', features: ['commission_tracking'] },
  { to: '/crm/inventory', icon: Warehouse, label: 'Inventory', features: ['inventory'] },
  { to: '/crm/equipment', icon: Wrench, label: 'Equipment', features: ['equipment_tracking'] },
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Online Booking', features: ['online_booking'] },
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['google_reviews', 'email_marketing', 'referral_program'] },
  { to: '/crm/pricebook', icon: CreditCard, label: 'Pricebook', features: ['pricebook'] },
  { to: '/crm/agreements', icon: ShieldCheck, label: 'Agreements', features: ['service_agreements'] },
  { to: '/crm/warranties', icon: Star, label: 'Warranties', features: ['warranties'] },
  { to: '/crm/call-tracking', icon: Phone, label: 'Call Tracking', features: ['call_tracking'] },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'] },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'] },
  { to: '/crm/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: ['ai_receptionist'] },
  { to: '/crm/recurring', icon: Repeat, label: 'Recurring', features: ['recurring_jobs'] },
  { to: '/crm/takeoffs', icon: Scissors, label: 'Takeoffs', features: ['takeoff_tools'] },
  { to: '/crm/tasks', icon: ListTodo, label: 'Tasks', features: ['projects'] },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'] },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'] },
  { to: '/crm/selections', icon: CheckSquare, label: 'Selections', features: ['selections'] },
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'] },
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'] },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'] },
  { to: '/crm/ads', icon: Megaphone, label: 'Ads', features: ['paid_ads'] },
  // Operations
  { to: '/crm/tech', icon: Wrench, label: 'Crew View', section: 'Operations', features: ['tech_mobile_view'] },
  { to: '/crm/dispatch', icon: Radio, label: 'Dispatch Board', section: 'Operations', features: ['dispatch_board'] },
  { to: '/crm/maintenance', icon: FileSignature, label: 'Service Agreements', section: 'Operations', features: ['maintenance_contracts'] },
  { to: '/crm/parts', icon: Box, label: 'Materials Inventory', section: 'Operations', features: ['parts_tracking'] },
  { to: '/crm/pricebook-rates', icon: BookMarked, label: 'Service Pricebook', section: 'Operations', features: ['flat_rate_pricebook'] },
  { to: '/crm/recurring-routes', icon: Route, label: 'Route Board', section: 'Operations', features: ['recurring_routes'] },
  { to: '/crm/area-pricing', icon: Ruler, label: 'Area Pricing', section: 'Operations', features: ['area_pricing'] },
  { to: '/crm/snow-billing', icon: Snowflake, label: 'Snow Billing', section: 'Operations', features: ['snow_billing'] },
  { to: '/website-cms', external: true, id: 'website-cms', icon: ExternalLink, label: 'Website CMS', section: 'Operations' },
  { to: '/crm/help', icon: BookOpen, label: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  routeGates: {
  '/crm/reviews': ['google_reviews'],
  '/crm/pricebook-trial': ['pricebook'],
  },
};
