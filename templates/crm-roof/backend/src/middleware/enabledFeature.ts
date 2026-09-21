// Enabled-feature API gate — shared implementation (packages/tenant-backend/src/enabledFeature.ts),
// vendored into this tenant as ../shared. This file only wires the template's db + company table in.
//
// M7: roof was the one template that never used it. Switching a feature off in Settings hid the nav
// and left the API serving — the tester removed lead_inbox and the endpoints answered exactly as
// before. A switch that only hides the button is not a switch.
import { createEnabledFeatureGate } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'

export const { requireEnabledFeature, isFeatureEnabled, enabledFeaturesFor, forgetFeatures } = createEnabledFeatureGate({ db, tables: { company } })
