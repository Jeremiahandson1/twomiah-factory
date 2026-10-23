// Conversations: call tracking, the AI receptionist, comments, search, support tickets and contacting Twomiah.
//
// The template's /api/webhooks (POST /leads, the separate website's contact form posting to its CRM with a shared
// secret) is not moved: in the one app the website's enquiry goes straight into the CRM (core/enquiry.ts via
// site/enquiryHandler.ts), and only the Factory-built website was ever given that secret.
import { Hono } from 'hono'
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createCalltrackingRoutes } from './calltracking.ts'
import { createAiReceptionistRoutes } from './aiReceptionist.ts'
import { createCommentsRoutes } from './comments.ts'
import { createSearchRoutes } from './search.ts'
import { createSupportRoutes } from './support.ts'
import { createPlatformSupportRoutes } from './platformSupport.ts'

export function commsMounts(d: CrmDeps): Mount[] {
  return [
    // Public doors inside (the providers' signed webhooks); each router signs people in and checks its feature
    // (call_tracking, ai_receptionist) itself after them, so calls are still logged with the module switched off.
    { path: '/api/calltracking', access: 'public', router: createCalltrackingRoutes(d) },
    { path: '/api/ai-receptionist', access: 'public', router: createAiReceptionistRoutes(d) },
    // Ungated, as in the template: no screen gates comments or search; /api/support also serves the ungated Help
    // page's knowledge base and AI chat (the Support screen itself is gated by support_tickets); Contact Twomiah is
    // on every tenant's menu.
    { path: '/api/comments', access: 'user', router: createCommentsRoutes(d) },
    { path: '/api/search', access: 'user', router: createSearchRoutes(d) },
    // The ticket desk (/tickets…) is the Support Tickets switch's, on the server as in the menu (2026-10-22); the Help page's
    // knowledge base and AI chat stay everyone's.
    { path: '/api/support', access: 'user', router: new Hono().use('/tickets', d.features.requireEnabledFeature('support_tickets')).use('/tickets/*', d.features.requireEnabledFeature('support_tickets')).route('/', createSupportRoutes(d)) },
    { path: '/api/platform-support', access: 'user', router: createPlatformSupportRoutes(d) },
  ]
}
