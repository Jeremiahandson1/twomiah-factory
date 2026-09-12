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
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', features: ['invoices'] },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', features: ['documents'] },
  { to: '/crm/team', icon: Users, label: 'Team' },
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'] },
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Online Booking', features: ['online_booking'] },
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['google_reviews', 'email_marketing', 'referral_program'] },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'] },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'] },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'] },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'] },
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
  },
};
