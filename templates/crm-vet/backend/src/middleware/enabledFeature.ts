// Enabled-feature API gate — shared implementation (packages/tenant-backend/src/enabledFeature.ts), vendored into
// this tenant as ../shared. This file only wires the template's db + company table in. (SALON-M1, shared in #165)
import { createEnabledFeatureGate } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'

export const { requireEnabledFeature, isFeatureEnabled, enabledFeaturesFor } = createEnabledFeatureGate({ db, tables: { company } })
