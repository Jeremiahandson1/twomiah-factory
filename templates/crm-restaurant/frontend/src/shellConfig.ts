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
  { to: '/crm/reviews', icon: Star, label: 'Reviews', features: ['google_reviews'] },
  // The Marketing page is email marketing (campaigns, templates, drips); Reviews has its own item above. (T15 M5)
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing'] },
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
  '/crm/marketing': ['email_marketing'],
  },
};
