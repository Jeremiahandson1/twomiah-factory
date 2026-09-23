// Enabled-feature API gate — shared implementation (packages/tenant-backend/src/enabledFeature.ts), vendored into
// this tenant as ../shared. This file only wires the template's db + company table in. (SALON-M1, shared in #165)
//
// The dispensary was the one CRM never wired to this. The kiosk is what made that matter: its routes are
// public by design — a customer is standing at the tablet, there is no user to authenticate — so they were
// mounted for every dispensary whether or not that shop has a kiosk at all. (Dispensary B1)
import { createEnabledFeatureGate } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'

// forgetFeatures is exported and CALLED on every write to enabled_features. The list is cached for 15 s
// per company; without invalidation that TTL is also a 15-second lie — the owner switches a module on,
// the sidebar shows it, and the API keeps refusing for another quarter minute. It did not matter while
// nothing was gated here. It matters now that everything is. (Dispensary T29 M5)
export const { requireEnabledFeature, isFeatureEnabled, enabledFeaturesFor, forgetFeatures } = createEnabledFeatureGate({ db, tables: { company } })
