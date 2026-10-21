// The portal panel on a contact (packages/tenant-ui ContactDetailPage) shows by its portalGate, default 'client_portal'.
// The server's switches (tenant-backend portal.ts: enable / regenerate / send) refuse with FEATURE_NOT_ENABLED when the
// company does not have client_portal. So the screen's gate must be that feature: portalGate: false showed the bar —
// which is not offered the portal at all — a switch that refused its owner (live sweep, 2026-10-21), and would do the
// same to any trade whose owner switched the portal off.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dir, '..')
const verticals = fs.readdirSync(path.join(ROOT, 'verticals')).filter((v) => fs.existsSync(path.join(ROOT, 'verticals', v, 'settings.ts')))

describe("a contact's portal panel follows the feature the server asks", () => {
  for (const v of verticals) {
    test(v, async () => {
      const s: any = (await import(path.join(ROOT, 'verticals', v, 'settings.ts'))).default
      const gate = s.screens?.contacts?.portalGate
      expect(gate === undefined || gate === 'client_portal').toBe(true)
    })
  }
})
