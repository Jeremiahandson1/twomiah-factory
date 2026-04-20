// Pre-checked email-alias defaults per CRM vertical.
// Decisions locked in the V1 plan — changing these alters the default
// onboarding experience for new tenants in that vertical.

export const EMAIL_ALIAS_DEFAULTS: Record<string, string[]> = {
  'crm':              ['support', 'admin'],
  'crm-roof':         ['support', 'admin', 'sales', 'estimates'],
  'crm-homecare':     ['support', 'admin', 'care'],
  'crm-fieldservice': ['support', 'admin', 'dispatch'],
  'crm-dispensary':   ['support', 'admin'],
}

export function getAliasDefaultsForProduct(product: string): string[] {
  return EMAIL_ALIAS_DEFAULTS[product] || EMAIL_ALIAS_DEFAULTS['crm']
}
