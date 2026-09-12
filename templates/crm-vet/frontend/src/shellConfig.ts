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
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', features: ['invoices'] },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', features: ['documents'] },
  { to: '/crm/team', icon: Users, label: 'Team' },
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'] },
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Online Booking', features: ['online_booking'] },
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['google_reviews', 'email_marketing', 'referral_program'] },
  { to: '/crm/ads', icon: Target, label: 'Ads', features: ['paid_ads'] },
  { to: '/crm/agreements', icon: ShieldCheck, label: 'Agreements', features: ['service_agreements'] },
  { to: '/crm/call-tracking', icon: Phone, label: 'Call Tracking', features: ['call_tracking'] },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'] },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'] },
  { to: '/crm/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: ['ai_receptionist'] },
  { to: '/crm/recurring', icon: Repeat, label: 'Recurring', features: ['recurring_jobs'] },
  { to: '/crm/tasks', icon: ListTodo, label: 'Tasks' },
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

  },
};
