// Public media proxy for job photos — shared implementation (packages/tenant-backend/src/jobs/jobs.ts),
// streaming from the same private bucket the shared file storage writes to.
import { createMediaRoutes } from '../shared/index.ts'
import storage from '../services/fileUpload.ts'

export default createMediaRoutes(storage)
