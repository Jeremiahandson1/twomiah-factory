import { Hono } from 'hono'
import { createOnboardingRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'

const app = new Hono()
// authenticate only — NOT requireAdmin. This router exposes exactly one route,
// POST /complete, and it sets a COMPANY-WIDE flag. Gating it on admin created a
// hard lockout the moment owners could add teammates: OnboardingGate redirects
// anyone whose company.onboardingCompletedAt is falsy to /crm/onboarding, the
// wizard POSTs /complete, a non-admin got 403, the flag stayed falsy, and the
// gate redirected again — forever. Same unreachable-CRM loop as the /me payload
// bug, entered through a different door.
app.use('*', authenticate)
app.route('/', createOnboardingRoutes({ db, companyTable: company }))
export default app
