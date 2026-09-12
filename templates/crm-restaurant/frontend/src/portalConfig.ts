// What this vertical's customer portal shows (see ./shared — PortalConfig). Sections are intersected with what
// the backend mounts (backend/src/routes/portal.ts), so a section listed here but not mounted never appears.
import type { PortalConfig } from './shared';

export const PORTAL: PortalConfig = {};
