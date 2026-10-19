// The ONE set of names for a service type (care plans' service_type, and clients' — the reports fall
// back from the client's to their care plan's). Four screens kept their own lists: the family portal
// printed the stored key ("companionship") and the reports upper-cased it with one underscore replaced
// ("UNSPECIFIED", "PERSONAL CARE") — Run 5.
export const SERVICE_LABELS: Record<string, string> = {
  personal_care: 'Personal Care',
  companionship: 'Companionship',
  medication_management: 'Medication Management',
  respite_care: 'Respite Care',
  mobility_assistance: 'Mobility Assistance',
  meal_prep: 'Meal Preparation',
  transportation: 'Transportation',
  skilled_nursing: 'Skilled Nursing',
  homemaker: 'Homemaker',
  other: 'Other',
  unspecified: 'Not set',
};

/** "personal_care" → "Personal Care"; an unknown key is title-cased, a blank one is "Not set". */
export function serviceLabel(type: unknown): string {
  const key = String(type ?? '').trim();
  if (!key) return SERVICE_LABELS.unspecified;
  return SERVICE_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}
