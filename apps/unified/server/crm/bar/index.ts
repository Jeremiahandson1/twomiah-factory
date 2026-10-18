// Bar: the modules templates/crm-bar has and the base CRM doesn't, each behind the feature its index.ts
// gated it with (docs/UNIFIED_MOVE_GUIDE.md, step 3e). Served to every vertical; the features decide who sees them.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'

export function barMounts(_d: CrmDeps): Mount[] { return [] }
