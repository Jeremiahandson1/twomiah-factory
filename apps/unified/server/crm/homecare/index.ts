// Home care: the add-on (docs/UNIFIED_HOMECARE_PLAN.md) — its route groups register here, each behind the registry's
// home-care features; ./core holds the helpers and services they share.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'

export function homecareMounts(_d: CrmDeps): Mount[] { return [] }
