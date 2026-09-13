// Vocabulary for the shared Marketing + Messages pages (packages/tenant-ui/src/marketing, vendored into this tenant as ./shared).
// Behaviour lives there; only the words live here.
import type { MarketingConfig, MessagesConfig } from './shared'
import { CONTACTS } from './contactsConfig'

export const marketingConfig: MarketingConfig = {
  contactTypes: CONTACTS.types,
  sequencesLabel: 'Follow-Ups',
}
export const messagesConfig: MessagesConfig = {}
