import { Hono } from 'hono'

// POST /complete — sets company.onboarding_completed_at = now(). Called by
// the onboarding wizard's Done step. The consumer's route wrapper must
// apply authenticate middleware so we can read user.companyId (or
// agencyId for crm-homecare) from context.

export interface OnboardingDeps {
  db: any
  companyTable: any
  // Extract the id used to look up the company row from the Hono context's
  // user object. Default 'companyId' covers all verticals except homecare
  // which uses 'agencyId'. Pass a custom resolver for that.
  getCompanyId?: (user: any) => string | undefined
}

export function createOnboardingRoutes(deps: OnboardingDeps): Hono {
  const app = new Hono()
  const { db, companyTable } = deps
  const getId = deps.getCompanyId || ((u: any) => u?.companyId || u?.agencyId)

  app.post('/complete', async (c) => {
    try {
      const user = c.get('user') as any
      const companyId = getId(user)
      if (!companyId) return c.json({ error: 'No company id on user context' }, 400)
      const { eq } = await import('drizzle-orm')
      const [row] = await db.update(companyTable)
        .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
        .where(eq(companyTable.id, companyId))
        .returning()
      if (!row) return c.json({ error: 'Company not found' }, 404)
      return c.json({ success: true, onboardingCompletedAt: row.onboardingCompletedAt })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  return app
}
