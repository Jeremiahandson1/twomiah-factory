// Tasks routes — shared implementation (packages/tenant-backend/src/tasks/tasks.ts), vendored into this tenant as ../shared.
import { createTasksService, createTasksRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { authenticate } from '../middleware/auth.ts'

const service = createTasksService({ db })
export default createTasksRoutes({ service, authenticate })
