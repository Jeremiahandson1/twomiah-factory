// Optional (registry-defined, non-core) modules the owner can turn on/off in
// Settings -> Features. Source of truth: the Factory feature registry marks these
// as core:false for crm-homecare. Each entry maps a dashboard nav item id -> its
// feature flag; any nav item NOT listed here is always-on core (Clients, Caregivers,
// Scheduling, EVV, Billing, Claims, Payroll, Compliance, etc.).
export const NAV_FEATURE: Record<string, string> = {
  'lead-inbox': 'lead_inbox',
  'lead-sources': 'lead_inbox',
  'reports': 'reports',
  'documents': 'documents',
  'ai-receptionist': 'ai_receptionist',
  'sms': 'two_way_texting',
};

// The toggle list rendered by the Features page: one row per unique feature.
export const OPTIONAL_FEATURES: { id: string; label: string }[] = [
  { id: 'lead_inbox', label: 'Lead Inbox & Sources' },
  { id: 'reports', label: 'Reports & Analytics' },
  { id: 'documents', label: 'Documents' },
  { id: 'ai_receptionist', label: 'AI Receptionist' },
  { id: 'two_way_texting', label: 'SMS / Texting' },
];
