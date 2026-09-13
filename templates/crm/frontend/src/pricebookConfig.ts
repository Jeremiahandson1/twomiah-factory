// Vocabulary for the shared Pricebook page (packages/tenant-ui/src/pricebook, vendored as ./shared). Behaviour lives there.
import type { PricebookConfig } from './shared'

export const pricebookConfig: PricebookConfig = {
  tiersTitle: 'Pricing tiers',
  tiersButton: 'Tiers',
  // Proposal pricing: the customer presentation (routes/pricebookPresent.ts) shows the recommended tier, else "best".
  tierPresets: [
    { tier: 'best', name: 'Sign Today', description: 'Best price — available today only', recommended: true },
    { tier: 'better', name: 'Within 30 Days', description: 'Valid for 30 days from proposal date', recommended: false },
    { tier: 'good', name: 'Valid 1 Year', description: 'Price valid for up to 12 months', recommended: false },
  ],
}
