// Vertical vocabulary for the shared Settings → Integrations / Import / Migrate and Reviews pages
// (packages/tenant-ui/src/settings, vendored into this tenant as ./shared). Behaviour lives there; only the words live here.
import type { IntegrationsConfig, ImportConfig, MigrationConfig, ReviewsConfig } from './shared'

export const integrationsConfig: IntegrationsConfig = {
  copy: { quickbooks: 'Sync invoices, payments and clients with your books.', sms: 'Send appointment reminders and updates to clients and stylists.', email: 'Send invoices, receipts and reminders by email.' },
  leadSources: [
    { id: 'google_business', title: 'Google Business Profile', description: 'Turn Google messages and booking requests into leads in your Lead Inbox.', tone: 'emerald', steps: [
      'Google emails the profile owner for every new message or booking request', 'Forward those notification emails to your CRM inbound address (Lead Sources page)',
      'Gmail: Settings › Filters › from:google.com "Business Profile" › Forward', "Each forwarded message becomes a lead with the sender's name and note" ] },
    { id: 'instagram', title: 'Instagram / Facebook', description: 'Bring DMs and lead-form submissions from Meta into your CRM.', tone: 'pink', steps: [
      'Meta emails you when someone messages your page or fills in a lead form', 'Forward those emails to your CRM inbound address',
      'Or connect a Zapier / Make zap from Meta Lead Ads to the CRM webhook URL', 'Leads appear in your Lead Inbox automatically' ] },
    { id: 'booking_app', title: 'Booksy / StyleSeat / Vagaro', description: 'Keep every client who books through an app in one place.', tone: 'indigo', steps: [
      'In the booking app, turn on "new client" and "new booking" email notifications', 'Forward those emails to your CRM inbound address',
      'Existing clients are matched by phone or email; new ones are created as leads' ] },
  ],
}

export const importConfig: ImportConfig = {
    intro: 'Import clients, services and invoices from CSV files',
    types: [
      { id: 'contacts', label: 'Clients', description: 'Import clients, leads and suppliers' },
      { id: 'products', label: 'Products/Services', description: 'Import your service menu and retail products' },
      { id: 'invoices', label: 'Invoices', description: 'Import invoices and open balances from your previous booking app or QuickBooks' },
    ],
    contactTypes: [{ value: 'client', label: 'Client' }, { value: 'lead', label: 'Lead' }, { value: 'vendor', label: 'Supplier' }],
  }

export const migrationConfig: MigrationConfig = { entityLabels: { contacts: 'Clients', products: 'Services & Products' } }

export const reviewsConfig: ReviewsConfig = { subtitle: 'Automatically ask clients for a Google review after their visit', subjectLabel: 'Visit', autoRequestHelp: 'Automatically request a review after each completed visit (one per client per month)', emptyHelp: 'Requests are created automatically after completed visits' }
