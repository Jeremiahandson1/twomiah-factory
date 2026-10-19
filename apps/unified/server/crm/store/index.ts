// The store: the add-on (docs/UNIFIED_STORE_PLAN.md). Its route groups register here; the shared services they use are
// built once (./core.ts). Its customers are the CRM's contacts, its loyalty the shared programme, its sign-in, team,
// company, audit, email and billing the engine's.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createStoreCore } from './core.ts'

/** The store add-on's mounts, for a vertical that has it (CrmSettings.store), each named as the add-on's. */
export function storeMounts(d: CrmDeps): Mount[] {
  if (!d.settings?.store) return []
  const core = createStoreCore(d)
  void core
  return ([] as Mount[]).map((m) => ({ ...m, addon: 'store' }))
}
