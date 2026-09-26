// Ads routes — shared implementation (packages/tenant-backend/src/ads/ads.ts), vendored into this tenant as ../shared.
// Gated on paid_ads + ads:* permissions inside the router; campaign data comes from the Twomiah Ads service (ADS_URL, ADS_API_KEY).
// adsConnector registers this tenant with Twomiah Ads through the Factory when Ads is switched on after deploy.
import { createAdsRoutes, createAdsConnector, createFactoryApiClient } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

const factory = createFactoryApiClient()
export const adsConnector = createAdsConnector({ registerWithFactory: () => factory.registerAds() })

export default createAdsRoutes({ db, tables: { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion }, authenticate, requirePermission, connector: adsConnector })
