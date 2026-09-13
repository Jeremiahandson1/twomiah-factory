// Ads routes — shared implementation (packages/tenant-backend/src/ads/ads.ts), vendored into this tenant as ../shared.
// Gated on paid_ads + ads:* permissions inside the router; campaign data comes from the Twomiah Ads service (ADS_URL, ADS_API_KEY).
import { createAdsRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

export default createAdsRoutes({ db, tables: { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion }, authenticate, requirePermission })
