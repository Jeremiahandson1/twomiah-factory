// What each seeded help article is ABOUT, so Help cannot describe a module this tenant does not have.
//
// Salon T27 N15 — the Help centre offered "Marketing campaigns — reach your clients from the Marketing
// page" to a tenant with Email Marketing switched off: no Marketing page, no sidebar entry, no way to do
// what the article describes. Help is the first place someone goes when a screen is missing, so it is the
// worst place to be told the screen exists.
//
// Keyed on the article TITLE because that is what the seed writes (db/seed.template.ts) and what survives
// a tenant editing the body. An article not listed here — anything the salon wrote themselves — is always
// shown: they know what they have. The ids are the same ones the sidebar gates on (frontend/src/shellConfig.ts).
export const ARTICLE_FEATURE: Record<string, string> = {
  'Client Profiles': 'client_profiles',
  'Building your Service Menu': 'service_menu',
  'Taking bookings in The Book': 'salon_booking',
  'Rebooking & Recall': 'rebooking_reminders',
  Memberships: 'salon_memberships',
  'Invoices & Payments': 'invoices',
  'Marketing campaigns': 'email_marketing',
}

/** The modules the AI assistant may mention, in the words it should use for them. Same gate, same ids. */
export const FEATURE_TOPICS: Array<[string, string]> = [
  ['client_profiles', 'Client Profiles (hair type, allergies, colour formula history)'],
  ['service_menu', 'the Service Menu'],
  ['salon_booking', 'The Book (appointment calendar)'],
  ['online_booking', 'online Booking'],
  ['rebooking_reminders', 'Rebooking & Recall'],
  ['salon_memberships', 'Memberships'],
  ['invoices', 'Invoices & Payments'],
  ['email_marketing', 'Marketing campaigns'],
  ['reports', 'Reports'],
]

/**
 * Keeps the articles this company can actually act on.
 *
 * An EMPTY feature list hides nothing. enabledFeaturesFor() answers [] for a tenant the factory has not
 * synced yet, and reading that as "has nothing" would empty the Help centre on exactly the tenant most
 * likely to need it. An article too many costs a wasted click; none costs the person their way out.
 */
export const visibleArticles = <T extends { title: string }>(rows: T[], features: string[]): T[] =>
  features.length === 0 ? rows : rows.filter((r) => { const f = ARTICLE_FEATURE[r.title]; return !f || features.includes(f) })

/** The feature sentence for the assistant's system prompt, built from what is switched on. */
export const enabledTopics = (features: string[]): string =>
  (features.length === 0 ? FEATURE_TOPICS : FEATURE_TOPICS.filter(([id]) => features.includes(id))).map(([, label]) => label).join(', ')
