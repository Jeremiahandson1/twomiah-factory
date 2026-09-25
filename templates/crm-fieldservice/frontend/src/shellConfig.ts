// This vertical's sidebar + URL gates for the shared app shell (see ./shared). Items without `features`
// are core; items with `features` show when ANY listed feature is enabled. routeGates cover routes
// that exist without a sidebar entry, so a module the tenant doesn't have is not reachable by URL.
import { BarChart3, BookMarked, BookOpen, Bot, Box, Briefcase, Calendar, CalendarCheck, CheckSquare, ClipboardCheck, ClipboardList, Clock, CreditCard, DollarSign, ExternalLink, FileQuestion, FileSignature, FileText, FolderKanban, FolderOpen, Home, Inbox, LifeBuoy, ListTodo, Mail, MapPin, Megaphone, MessageSquare, Phone, Radio, Receipt, Repeat, Scissors, ShieldCheck, Star, Target, Truck, Users, Warehouse, Wrench } from 'lucide-react';
import type { NavItem, ShellConfig } from './shared';

const NAV: NavItem[] = [
  { to: '/crm', icon: Home, label: 'Dashboard', exact: true },
  { to: '/crm/contacts', icon: Users, label: 'Contacts' },
  { to: '/crm/jobs', icon: Briefcase, label: 'Service Calls' },
  { to: '/crm/quotes', icon: FileText, label: 'Quotes', permission: 'quotes:read' },
  { to: '/crm/invoices', icon: Receipt, label: 'Invoices', permission: 'invoices:read' },
  { to: '/crm/schedule', icon: Calendar, label: 'Schedule', features: ['scheduling'] },
  { to: '/crm/time', icon: Clock, label: 'Time' },
  { to: '/crm/expenses', icon: DollarSign, label: 'Expenses' },
  { to: '/crm/documents', icon: FolderOpen, label: 'Documents', features: ['documents'] },
  { to: '/crm/team', icon: Users, label: 'Team', permission: 'team:read' },
  { to: '/crm/fleet', icon: Truck, label: 'Fleet', features: ['fleet'] },
  { to: '/crm/locations', icon: MapPin, label: 'Locations', features: ['multi_location'] },
  { to: '/crm/commissions', icon: DollarSign, label: 'Commissions', features: ['commission_tracking'] },
  { to: '/crm/inventory', icon: Warehouse, label: 'Inventory', features: ['inventory'] },
  { to: '/crm/equipment', icon: Wrench, label: 'Equipment', features: ['equipment_tracking'] },
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Online Booking', features: ['online_booking'] },
  // The Marketing page is email marketing (campaigns, templates, drips); Reviews has its own route gate below. (T15 M5)
  { to: '/crm/marketing', icon: Megaphone, label: 'Marketing', features: ['email_marketing'], permission: 'marketing:read' },
  { to: '/crm/pricebook', icon: CreditCard, label: 'Pricebook', features: ['pricebook'] },
  { to: '/crm/agreements', icon: ShieldCheck, label: 'Agreements', features: ['service_agreements'] },
  { to: '/crm/warranties', icon: Star, label: 'Warranties', features: ['warranties'] },
  { to: '/crm/call-tracking', icon: Phone, label: 'Call Tracking', features: ['call_tracking'] },
  { to: '/crm/email', icon: Mail, label: 'Email', features: ['branded_email'] },
  { to: '/crm/google-reviews', icon: Star, label: 'Google Reviews', features: ['google_business'] },
  { to: '/crm/ai-receptionist', icon: Bot, label: 'AI Receptionist', features: ['ai_receptionist'] },
  { to: '/crm/recurring', icon: Repeat, label: 'Recurring', features: ['recurring_jobs'], permission: 'invoices:read' },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', features: ['two_way_texting'] },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports', features: ['reports'], permission: 'reports:read' },
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', features: ['lead_inbox'] },
  { to: '/crm/lead-sources', icon: ExternalLink, label: 'Lead Sources', features: ['lead_inbox'] },
  { to: '/crm/support', icon: LifeBuoy, label: 'Support', features: ['support_tickets'] },
  { to: '/crm/ads', icon: Megaphone, label: 'Ads', features: ['paid_ads'], permission: 'ads:read' },
  // Field Service
  { to: '/crm/tech', icon: Wrench, label: 'Tech View', section: 'Field Service', features: ['tech_mobile_view'] },
  { to: '/crm/dispatch', icon: Radio, label: 'Dispatch Board', section: 'Field Service', features: ['dispatch_board'] },
  { to: '/crm/maintenance', icon: FileSignature, label: 'Maintenance Contracts', section: 'Field Service', features: ['maintenance_contracts'] },
  { to: '/crm/parts', icon: Box, label: 'Parts Inventory', section: 'Field Service', features: ['parts_tracking'] },
  { to: '/crm/pricebook-rates', icon: BookMarked, label: 'Flat Rate Pricebook', section: 'Field Service', features: ['flat_rate_pricebook'] },
  { to: '/crm/help', icon: BookOpen, label: 'Help' },

  { to: '/crm/contact-support', icon: LifeBuoy, label: 'Contact Twomiah' },
];

export const SHELL: ShellConfig = {
  nav: NAV,
  searchPlaceholder: 'Search contacts, service calls, invoices...',
  routeGates: {
    '/crm/reviews': ['google_reviews'],
    // Reachable by typing the URL, with no sidebar entry to gate them. /crm/geofences rendered and then
    // logged "Failed to load geofences" against its own 403; the rest are CONSTRUCTION modules the
    // registry does not offer this vertical at all, so gating on the real feature removes them here
    // without hardcoding "never" — if one is ever offered to field service, it opens by itself.
    // (Field Service T28 M1)
    '/crm/geofences': ['gps_tracking'],
    '/crm/projects': ['projects'],
    '/crm/change-orders': ['change_orders'],
    '/crm/selections': ['selections'],
    '/crm/lien-waivers': ['lien_waivers'],
    '/crm/submittal-review': ['submittals'],
    '/crm/rfis-assigned': ['rfis'],
    '/crm/shared-documents': ['documents'],
    '/crm/payment-methods': ['online_payments'],
    // NOT '/crm/pricebook-trial': ['pricebook'].
    //
    // That page exists to sell Pricebook to a tenant who does not have it — the home tile only appears
    // when hasFeature('pricebook') is false — so gating it behind `pricebook` made the offer refuse
    // everyone it was written for: click FREE TRIAL, land on "Pricebook Trial isn't part of this CRM".
    // The page itself raises a support ticket and reads no pricebook data, so there is nothing to gate.
    // (Field Service T28 H2)
  },
  // Reachable by URL with no sidebar entry to gate them, and every one is requireAdmin (or
  // requireRole('admin','owner')) on the server: emailAliases.ts, emailDomain.ts, billing.ts,
  // integrations.ts, migration.ts, import.ts. Rank here, not a permission, because rank is what the
  // server itself asks. Settings ITSELF stays open — Profile and Security live there, and the Company
  // form is read-only for anyone without company:update. (Field Service T30 M-R1)
  routeRoles: {
    '/crm/settings/billing': 'admin',
    '/crm/settings/email': 'admin',
    '/crm/settings/email-domain': 'admin',
    '/crm/settings/email-inbox': 'admin',
    '/crm/settings/integrations': 'admin',
    '/crm/settings/migration': 'admin',
    '/crm/settings/import': 'admin',
    '/crm/settings/features': 'admin',
    '/crm/email': 'admin',
  },
};
