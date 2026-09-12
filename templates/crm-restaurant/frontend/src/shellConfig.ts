// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
import { BarChart3, BookOpen, Bot, CalendarCheck, CheckSquare, ClipboardCheck, ClipboardList, CreditCard, DollarSign, DoorOpen, ExternalLink, FileQuestion, FileText, FolderKanban, FolderOpen, Home, Inbox, LifeBuoy, ListTodo, Mail, Megaphone, MessageSquare, Phone, Receipt, Repeat, Scissors, ShieldCheck, Star, Target, Truck, Users, UtensilsCrossed, Warehouse, Wrench } from 'lucide-react';
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/events', icon: CalendarCheck, label: 'Events', features: ['event_bookings'] },
  { to: '/crm/spaces', icon: DoorOpen, label: 'Spaces', features: ['event_spaces'] },
  { to: '/crm/menus', icon: UtensilsCrossed, label: 'Catering Menus', features: ['catering_menus'] },
  { to: '/crm/contacts', icon: Users, label: 'Contacts' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', features: ['invoices'] },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', features: ['documents'] },
  { to: '/crm/team', icon: Users, label: 'Team' },
  { to: '/crm/projects', icon: FolderKanban, label: 'Projects', features: ['projects'] },
  { to: '/crm/rfis', icon: FileQuestion, label: 'RFIs', features: ['rfis'] },
  { to: '/crm/submittals', icon: FileText, label: 'Submittals', features: ['submittals'] },
  { to: '/crm/lien-waivers', icon: ShieldCheck, label: 'Lien Waivers', features: ['lien_waivers'] },
  { to: '/crm/draw-schedules', icon: DollarSign, label: 'Draw Schedules', features: ['draw_schedules'] },
  { to: '/crm/aia-forms', icon: FileText, label: 'AIA G702/G703', features: ['aia_forms'] },
  { to: '/crm/gantt', icon: BarChart3, label: 'Gantt Chart', features: ['gantt_charts'] },
  { to: '/crm/change-orders', icon: ClipboardList, label: 'Change Orders', features: ['change_orders'] },
  { to: '/crm/punch-lists', icon: CheckSquare, label: 'Punch Lists', features: ['punch_lists'] },
  { to: '/crm/daily-logs', icon: BookOpen, label: 'Daily Logs', features: ['daily_logs'] },
  { to: '/crm/inspections', icon: ClipboardCheck, label: 'Inspections', features: ['inspections'] },
  { to: '/crm/bids', icon: Target, label: 'Bids', features: ['bid_management'] },
  { to: '/crm/fleet', icon: Truck, label: 'Fleet', features: ['fleet'] },
  { to: '/crm/inventory', icon: Warehouse, label: 'Inventory', features: ['inventory'] },
  { to: '/crm/equipment', icon: Wrench, label: 'Equipment', features: ['equipment_tracking'] },
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'] },
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Online Booking', features: ['online_booking'] },
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['google_reviews', 'email_marketing', 'referral_program'] },
  { to: '/crm/ads', icon: Target, label: 'Ads', features: ['paid_ads'] },
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
  { to: '/crm/help', icon: BookOpen, label: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  routeGates: {
  '/crm/jobs': ['jobs'],
  '/crm/quotes': ['quotes'],
  '/crm/schedule': ['scheduling'],
  '/crm/time': ['time_tracking'],
  '/crm/expenses': ['expense_tracking'],
  '/crm/pricebook-trial': ['pricebook'],
  },
};
