// Lead Inbox + Lead Sources vocabulary for this vertical (the shared pages live in packages/tenant-ui/src/leads,
// vendored into this tenant as ./shared). Behaviour lives there; only the words live here. The platform ids here
// MUST match backend/src/routes/leads.ts options.platforms — the backend refuses anything else.
import type { LeadsConfig } from './shared'

export const leadsConfig: LeadsConfig = {
}
