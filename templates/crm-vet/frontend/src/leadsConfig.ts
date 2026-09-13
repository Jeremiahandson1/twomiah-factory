// Lead Inbox + Lead Sources vocabulary for this vertical (the shared pages live in packages/tenant-ui/src/leads,
// vendored into this tenant as ./shared). Behaviour lives there; only the words live here. The platform ids here
// MUST match backend/src/routes/leads.ts options.platforms — the backend refuses anything else.
import type { LeadsConfig, LeadPlatform } from './shared'

export const LEAD_PLATFORMS: LeadPlatform[] = [
  { value: 'google_business', label: 'Google Business Profile', color: '#c62828', tone: 'indigo', description: 'Turn Google messages and booking requests into leads in your Lead Inbox.', instructions: [
    'Google emails the profile owner for every new message or booking request', 'Forward those notification emails to the inbound address below',
    'Gmail: Settings › Filters › from:google.com "Business Profile" › Forward', "Each forwarded message becomes a lead with the sender's name and note" ] },
  { value: 'yelp', label: 'Yelp', color: '#e65100', tone: 'sky', description: 'Forward Yelp quote requests and messages into your Lead Inbox.', instructions: [
    'Yelp for Business → Account Settings → Notifications', 'Turn on email alerts for "Request a quote" / messages', 'Forward those alerts to the inbound address below' ] },
  { value: 'instagram', label: 'Instagram / Facebook', color: '#6a1b9a', tone: 'pink', description: 'Bring DMs and lead-form submissions from Meta into your CRM.', instructions: [
    'Meta emails you when someone messages your page or fills in a lead form', 'Forward those notification emails to the inbound address below',
    'Or connect a Zapier / Make zap from Meta Lead Ads to the webhook URL below' ] },
  { value: 'website', label: 'Website contact form', color: '#2e7d32', tone: 'emerald', description: 'Every form submission on your website becomes a lead.', instructions: [
    "Point your website form's notification email at the inbound address below", 'Or use the webhook URL below with Zapier / Make from any form builder' ] },
]

export const leadsConfig: LeadsConfig = {
  platforms: LEAD_PLATFORMS,
  jobTypeLabel: 'Service',
  sourcesSubtitle: 'Where new-client enquiries arrive: Google, Yelp, Meta and your website',
}
