// Lead Inbox + Lead Sources — the contract between a template and the shared pages. The vertical owns the vocabulary
// (which platforms it offers, what a lead is "for"); the pages own the behaviour.
import type { LeadSourceGuide } from '../settings/integrationsTypes'

/** The slice of the template's api client these pages use (the shared ApiClient satisfies it). */
export interface LeadsApi {
  get: (path: string, params?: Record<string, any>) => Promise<any>
  post: (path: string, body?: any) => Promise<any>
  put: (path: string, body?: any) => Promise<any>
  delete: (path: string, id?: string) => Promise<any>
}
export interface LeadsToast { success: (msg: string) => void; error: (msg: string) => void }
/** Socket subscription from the template's SocketContext: subscribe(event, cb) → unsubscribe. */
export type LeadsSubscribe = (event: string, cb: (...args: any[]) => void) => () => void

export interface LeadPlatform {
  /** Stable id stored on lead_source.platform and lead.source_platform — must be in the backend's options.platforms. */
  value: string
  label: string
  /** Badge colour (hex) on the inbox + sources cards. */
  color: string
  /** Icon tone for the Integrations page guide card. */
  tone?: LeadSourceGuide['tone']
  /** One line shown on the Integrations page guide card. */
  description?: string
  /** Setup steps shown under the source card and in the guide. */
  instructions: string[]
}

export interface LeadsConfig {
  /** Platforms this vertical offers. Default: the trades set (Angi, HomeAdvisor, Thumbtack, Google LSA, Houzz). */
  platforms?: LeadPlatform[]
  /** What the lead is about — "Job Type" (trades), "Service" (salon/vet), "Interest" (dealership), "Event Type". */
  jobTypeLabel?: string
  inboxSubtitle?: string
  sourcesSubtitle?: string
}

export const TRADES_LEAD_PLATFORMS: LeadPlatform[] = [
  { value: 'angi', label: "Angi (Angie's List)", color: '#2e7d32', tone: 'emerald', description: 'Forward Angi lead notifications into your Lead Inbox.', instructions: [
    'Log in to your Angi for Pros account', 'Go to Settings > Lead Notifications > Email', 'Set your notification email to the inbound address below', 'Angi will forward all new lead emails to your CRM' ] },
  { value: 'homeadvisor', label: 'HomeAdvisor', color: '#e65100', tone: 'sky', description: 'Forward HomeAdvisor lead notifications into your Lead Inbox.', instructions: [
    'Log in to your HomeAdvisor Pro account', 'Go to My Account > Notification Preferences', 'Add the inbound email address below as a notification recipient', 'Enable "New Lead" email notifications' ] },
  { value: 'thumbtack', label: 'Thumbtack', color: '#1565c0', tone: 'blue', description: 'Pull Thumbtack leads directly into your CRM.', instructions: [
    'Log in to your Thumbtack Pro account', 'Go to Settings > Notifications', 'Add the inbound email below to receive lead notifications', 'Or connect a Zapier / Make zap to the webhook URL below' ] },
  { value: 'google_lsa', label: 'Google Local Services', color: '#c62828', tone: 'indigo', description: 'Import Google Local Services Ads leads automatically.', instructions: [
    'Google LSA leads arrive via phone calls and messages', 'Set up email forwarding from your Google LSA notification email', 'Forward all "New lead" emails to the inbound address below', 'You can also use the webhook URL with a third-party integration (Zapier, Make)' ] },
  { value: 'houzz', label: 'Houzz', color: '#6a1b9a', tone: 'pink', description: 'Forward Houzz Pro enquiries into your Lead Inbox.', instructions: [
    'Log in to your Houzz Pro account', 'Go to Settings > Email Notifications', 'Forward lead notification emails to the inbound address below', 'Houzz does not support direct webhooks — email forwarding is recommended' ] },
]

/** The same vocabulary as guide cards for the Integrations page — one list per vertical, not two. */
export function leadSourceGuides(platforms: LeadPlatform[] = TRADES_LEAD_PLATFORMS): LeadSourceGuide[] {
  return platforms.map((p) => ({
    id: p.value,
    title: p.label,
    description: p.description || `Forward ${p.label} lead notifications into your Lead Inbox.`,
    tone: p.tone,
    steps: [...p.instructions, 'Connect it under Lead Sources to get your inbound address and webhook URL'],
  }))
}

export const LEAD_STATUSES = ['new', 'contacted', 'converted', 'dismissed'] as const
export interface LeadRow {
  id: string
  sourcePlatform: string
  homeownerName: string
  email?: string | null
  phone?: string | null
  jobType?: string | null
  location?: string | null
  budget?: string | null
  description?: string | null
  status: string
  receivedAt: string
  contactedAt?: string | null
  convertedContactId?: string | null
}
export interface LeadSourceRow {
  id: string
  platform: string
  label: string
  inboundEmail?: string | null
  webhookUrl?: string | null
  webhookSecret?: string | null
  enabled: boolean
  config: Record<string, any>
  createdAt: string
}
