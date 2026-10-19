// Home care — the client and family portals, messages and notifications: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{portal,portalVisits,familyPortal,messages,communication,communicationLog,notifications,notificationSettings,push,sms}.ts.
//
// Two of the template's paths are also the CRM's: /api/portal (the CRM's customer portal, /p/:token/…) and /api/sms
// (the CRM's texting module and Twilio's webhooks). A path is mounted once (RULEBOOK §6), so home care's routers for
// those two are not mounts of their own: portalsInFront hands them to server/modules/crm.ts, which composes each in
// front of the CRM's router on that path for the home-care vertical. Every other router here is a mount.
import { Hono } from 'hono'
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { createClientPortalRoutes, type ClientPortal } from './clientPortal.ts'
import { createPortalVisitRoutes } from './portalVisits.ts'
import { createFamilyPortalRoutes } from './familyPortal.ts'
import { createMessageRoutes } from './messages.ts'
import { createCommunicationRoutes, createCommunicationLogRoutes } from './communication.ts'
import { createNotificationRoutes, createNotificationSettingsRoutes, createPushRoutes } from './notifications.ts'
import { createHomecareSmsRoutes } from './sms.ts'

// One client portal per core (the family portal shares its background-check summary), built once.
const portals = new WeakMap<HomecareCore, ClientPortal>()
const clientPortalOf = (core: HomecareCore, d: CrmDeps) => {
  let p = portals.get(core)
  if (!p) { p = createClientPortalRoutes(core, d); portals.set(core, p) }
  return p
}

export function portalsMounts(core: HomecareCore, d: CrmDeps): Mount[] {
  return [
    // The family portal: its sign-in and its pages are public (its own tokens); the office's paths sign in per route.
    { path: '/api/family-portal', access: 'public', router: createFamilyPortalRoutes(core, d, clientPortalOf(core, d)) },
    { path: '/api/messages', access: 'user', router: createMessageRoutes(core, d) },
    { path: '/api/communication', access: 'user', router: createCommunicationRoutes(core, d) },
    { path: '/api/communication-log', access: 'user', router: createCommunicationLogRoutes(core, d) },
    { path: '/api/notifications', access: 'user', router: createNotificationRoutes(core, d) },
    { path: '/api/notification-settings', access: 'user', router: createNotificationSettingsRoutes(core, d) },
    { path: '/api/push', access: 'user', router: createPushRoutes(core, d) },
  ]
}

/**
 * Home care's routers on the CRM's own paths, keyed by path, for server/modules/crm.ts to put in front of the CRM's:
 *   /api/portal — the client portal (its office switches, its sign-in and the client's pages) and the family's visits
 *                 and visit actions (the template's portal.ts and portalVisits.ts, both on /api/portal);
 *   /api/sms    — the texting screen's templates, single and bulk texts.
 * Both are public mounts: their routes sign people in themselves (staff per route, the portal by its own tokens).
 */
export function portalsInFront(core: HomecareCore, d: CrmDeps): Record<string, Hono<any>> {
  const client = clientPortalOf(core, d)
  return {
    '/api/portal': new Hono().route('/', client.router).route('/', createPortalVisitRoutes(core, d, client)),
    '/api/sms': createHomecareSmsRoutes(core, d),
  }
}
