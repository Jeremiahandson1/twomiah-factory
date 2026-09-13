// Premium-website A/B endpoints (assign / convert) — shared implementation (packages/tenant-backend/src/ads/ads.ts),
// vendored into this tenant as ../shared. Anonymous by design; mounted with an open CORS policy in index.ts.
import { createAdsPublicRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion } from '../../db/schema.ts'

export default createAdsPublicRoutes({ db, tables: { company, adsExperiment, adsExperimentAssignment, adsExperimentConversion } })
