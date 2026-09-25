// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
import { BarChart3, BellRing, BookOpen, Bot, Calendar, CalendarCheck, CheckSquare, ClipboardCheck, ClipboardList, CreditCard, DollarSign, ExternalLink, FileQuestion, FileText, FolderKanban, FolderOpen, Home, Inbox, LifeBuoy, ListTodo, Mail, Megaphone, MessageSquare, Phone, Receipt, Repeat, Scissors, ShieldCheck, Star, Target, Truck, Users, Warehouse, Wrench } from 'lucide-react';
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/clients', icon: Users, label: 'Clients', features: ['client_profiles'] },
  { to: '/crm/appointments', icon: Calendar, label: 'The Book', features: ['salon_booking'] },
  { to: '/crm/reminders', icon: BellRing, label: 'Rebooking', features: ['rebooking_reminders'] },
  { to: '/crm/service-menu', icon: Scissors, label: 'Service Menu', features: ['service_menu'] },
  { to: '/crm/memberships', icon: CreditCard, label: 'Memberships', features: ['salon_memberships'] },
  { to: '/crm/contacts', icon: Users, label: 'Contacts' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', features: ['invoices'], permission: 'invoices:read' },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', features: ['documents'] },
  { to: '/crm/team', icon: Users, label: 'Team', permission: 'team:read' },
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'], minRole: 'manager' },
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Online Booking', features: ['online_booking'] },
  // The Marketing page is email marketing (campaigns, templates, drips); Reviews has its own item above. (T15 M5)
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing'], permission: 'marketing:read' },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'], minRole: 'admin' },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'], minRole: 'admin' },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'], permission: 'sms:send' },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], permission: 'reports:read' },
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'] },
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'] },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'] },
  { to: '/crm/help', icon: BookOpen, label: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  searchPlaceholder: 'Search clients, services, invoices...',
  routeGates: {
  '/crm/jobs': ['jobs'],
  '/crm/quotes': ['quotes'],
  '/crm/schedule': ['scheduling'],
  },
  // Pages with no sidebar entry of their own, or reached from inside Settings. A manager who typed one of
  // these URLs got the API's raw refusal — "Failed to load: 403", "Status check failed", "Insufficient
  // permissions" above "Nothing is wrong with your account", and a Company form that would not save.
  // (Salon T28 M5)
  routeRoles: {
    '/crm/settings': 'admin',
    '/crm/billing': 'owner',
    '/crm/email-domain': 'admin',
    '/crm/email-aliases': 'admin',
    '/crm/import': 'admin',
    '/crm/migration': 'admin',
    '/crm/users': 'admin',
  },
};
