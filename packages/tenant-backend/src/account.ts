import { Hono } from 'hono'
import type { FactoryApiClient } from './types'

// Account-level routes — offboard, reactivate, offboard status.
// These are thin proxies to the factory. Adds a minimal additional interface
// onto FactoryApiClient that the consumer template implements.

export interface AccountDeps {
  factoryApiClient: FactoryApiClient & {
    getOffboardStatus(): Promise<{ status: string; offboardStartedAt: string | null; offboardGraceEndsAt: string | null; domain?: string | null; domainRegistrar?: string | null }>
    startOffboard(confirm: true): Promise<{ success: boolean; offboardGraceEndsAt?: string; steps?: any[]; error?: string }>
    reactivate(): Promise<{ success: boolean; error?: string }>
  }
}

export function createAccountRoutes(deps: AccountDeps): Hono {
  const app = new Hono()
  const { factoryApiClient } = deps

  app.get('/offboard/status', async (c) => {
    try {
      const result = await factoryApiClient.getOffboardStatus()
      return c.json(result)
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.post('/offboard', async (c) => {
    try {
      // Body.confirm must be true — matches factory contract
      const body = await c.req.json().catch(() => ({}))
      if (body.confirm !== true) return c.json({ error: 'Set body.confirm=true to offboard' }, 400)
      const result = await factoryApiClient.startOffboard(true)
      return c.json(result)
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.post('/reactivate', async (c) => {
    try {
      const result = await factoryApiClient.reactivate()
      return c.json(result)
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  return app
}
