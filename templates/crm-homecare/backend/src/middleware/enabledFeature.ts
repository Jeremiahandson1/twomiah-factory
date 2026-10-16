// Enabled-feature API gate — shared implementation (packages/tenant-backend/src/enabledFeature.ts), vendored into this
// tenant as ../shared. Home care's tenant is the agencies row; the token's companyId is the agency id.
//
// readSettingsBlob: an agency's feature list has lived in two fields — the Factory's sync wrote settings.enabledFeatures
// alone until 10/16, Settings › Features wrote both — and the screens (AuthContext.hasFeature) read both. So does the
// gate: the union, so no agency is locked out of what it holds in either. Every writer now goes through
// services/agencyFeatures.ts, which writes both and drops this cache.
import { createEnabledFeatureGate } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'

export const { requireEnabledFeature, isFeatureEnabled, enabledFeaturesFor, forgetFeatures } = createEnabledFeatureGate({ db, tables: { company: agencies }, readSettingsBlob: true })
