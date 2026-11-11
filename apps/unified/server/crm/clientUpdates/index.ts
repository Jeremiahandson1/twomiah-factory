// The weekly client update (./weeklyUpdate.ts; parity tier 2 #9, feature weekly_client_update, not ready): the office's settings
// and sends, the email's read link (public — the signed link is the key), and the hourly pass.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createWeeklyUpdates, WEEKLY_UPDATE } from './weeklyUpdate.ts'

export function clientUpdateMounts(d: CrmDeps): Mount[] {
  const w = createWeeklyUpdates(d)
  // Where a test runs the pass (the timer never starts in tests).
  ;(d.services as any).weeklyUpdates = w
  d.services.addJob(() => w.start())
  return [
    { path: '/api/weekly-update/open', access: 'public', router: w.open },
    { path: '/api/weekly-update', access: 'user', feature: WEEKLY_UPDATE, router: w.office },
  ]
}
