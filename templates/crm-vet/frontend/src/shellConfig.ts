// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
import { BarChart3, BellRing, BookOpen, Bot, Calendar, CalendarCheck, ExternalLink, FolderOpen, HeartPulse, Home, Inbox, LifeBuoy, ListTodo, Mail, Megaphone, MessageSquare, PawPrint, Phone, Receipt, Repeat, ShieldCheck, Star, Target, Users } from 'lucide-react';
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/patients', icon: PawPrint, label: 'Patients', features: ['patient_records'] },
  { to: '/crm/appointments', icon: Calendar, label: 'Appointments', features: ['appointment_scheduling'] },
  { to: '/crm/reminders', icon: BellRing, label: 'Reminders', features: ['reminders_recall'] },
  { to: '/crm/wellness-plans', icon: HeartPulse, label: 'Wellness Plans', features: ['wellness_plans'] },
  { to: '/crm/contacts', icon: Users, label: 'Owners' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', features: ['invoices'], permission: 'invoices:read' },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', features: ['documents'] },
  { to: '/crm/team', icon: Users, label: 'Team', permission: 'team:read' },
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'] },
  // The Marketing page is email marketing (campaigns, templates, drips); Reviews has its own item above. (T15 M5)
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing'], permission: 'marketing:read' },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'] },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'] },
  { to: '/crm/tasks', icon: ListTodo, label: 'Tasks' },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'] },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], permission: 'reports:read' },
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'] },
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'] },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'] },
  { to: '/crm/help', icon: BookOpen, label: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  searchPlaceholder: 'Search patients, owners, invoices...',
  routeGates: {

  },
};
