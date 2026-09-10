// Feature-flag vocabulary bridge. Three id sets exist and never fully agreed: the Factory writes
// enabledFeatures (e.g. online_payments, client_portal, team), the plan tiers use others (payments,
// customer_portal, team_management) and the settings catalog has 100+ marketing-level ids
// (professional_quotes, user_permissions, …). hasFeature() and the Features page consult this map so a
// module that is on shows as on under every name (Wrench QA W-9).
export const FEATURE_ALIASES: Record<string, string[]> = {
  payments: ['online_payments'], online_payments: ['payments'],
  customer_portal: ['client_portal'], client_portal: ['customer_portal'],
  team_management: ['team'], team: ['team_management'],
  expenses: ['expense_tracking'], expense_tracking: ['expenses'],
  time_tracking: ['timesheets'], timesheets: ['time_tracking'],
  // catalog children → the module that provides them
  professional_quotes: ['quotes'], quote_templates: ['quotes'], optional_addons: ['quotes'], online_approval: ['quotes'], quote_followups: ['quotes'], deposit_collection: ['quotes', 'payments', 'online_payments'],
  invoicing: ['invoices'], online_invoicing: ['invoices'], recurring_invoices: ['invoices'], payment_reminders: ['invoices'],
  job_scheduling: ['scheduling', 'jobs'], calendar: ['scheduling'], drag_drop_scheduling: ['scheduling'],
  customer_management: ['contacts'], contact_management: ['contacts'], customer_history: ['contacts'],
  document_storage: ['documents'], file_attachments: ['documents'],
  // built-in, never a flag: role-based access is always enforced
  user_permissions: ['*'], roles: ['*'], rbac: ['*'], dashboard: ['*'],
}
export function featureEnabled(featureId: string, enabled: Iterable<string> | null | undefined): boolean {
  const set = new Set(enabled || [])
  if (set.has(featureId)) return true
  for (const alt of FEATURE_ALIASES[featureId] || []) { if (alt === '*' || set.has(alt)) return true }
  return false
}
