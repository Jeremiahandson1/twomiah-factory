// Trade-in valuation: a book-value estimate from the provider the company switched on (J.D. Power / Black Book, in
// company.integrations.valuation), for the deal desk. Until one is configured it says so — no made-up numbers. Moved
// from templates/crm-rv/backend/src/{routes,services}/valuation.ts.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { one, listAll } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export type ValuationProviderName = 'jdpower' | 'blackbook'

export interface TradeDetails {
  category?: string
  year?: number
  make?: string
  model?: string
  vin?: string
  mileage?: number
  hours?: number
  condition?: string
  zip?: string
}

export interface ValuationResult {
  success: boolean
  /** rough/clean/average trade-in band */
  low?: number
  average?: number
  high?: number
  /** book values when the provider distinguishes them */
  tradeIn?: number
  retail?: number
  source?: string
  asOf?: string
  error?: string
}

export interface ValuationConfig {
  enabled: boolean
  apiKey?: string
  accountId?: string
  period?: string
  sandbox?: boolean
  [key: string]: any
}

export interface ValuationProvider {
  name: ValuationProviderName
  displayName: string
  logo: string
  description: string
  getValuation(trade: TradeDetails, config: ValuationConfig): Promise<ValuationResult>
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const jdpowerProvider: ValuationProvider = {
  name: 'jdpower',
  displayName: 'J.D. Power (NADA Guides)',
  logo: '📕',
  description: 'Standard RV, powersports, and marine book values (formerly NADA Guides)',
  async getValuation(trade, config) {
    if (!config.apiKey) {
      return { success: false, error: 'J.D. Power not configured — add API Key in Settings → Integrations → Valuation → J.D. Power' }
    }
    const base = config.sandbox ? 'https://sandbox.jdpower.ai/valuationservices/v5' : 'https://api.jdpower.ai/valuationservices/v5'
    try {
      // NOTE: confirm endpoint/params against the J.D. Power Valuation API docs.
      const params = new URLSearchParams({
        period: config.period || '0',
        vin: trade.vin || '',
        mileage: trade.mileage != null ? String(trade.mileage) : '',
        region: trade.zip || '',
      })
      const r = await fetch(`${base}/valuation?${params.toString()}`, {
        headers: { 'api-key': config.apiKey, accept: 'application/json' },
      })
      if (!r.ok) return { success: false, error: `J.D. Power returned ${r.status}` }
      const data = await r.json() as any
      const v = data?.result?.[0] || data
      return {
        success: true,
        tradeIn: num(v.averageTradeIn ?? v.tradeIn),
        retail: num(v.retail ?? v.averageRetail),
        low: num(v.roughTradeIn ?? v.low),
        average: num(v.averageTradeIn ?? v.average),
        high: num(v.cleanTradeIn ?? v.high),
        source: 'J.D. Power',
        asOf: new Date().toISOString(),
      }
    } catch (err) {
      return { success: false, error: `J.D. Power API error: ${(err as Error).message}` }
    }
  },
}

const blackbookProvider: ValuationProvider = {
  name: 'blackbook',
  displayName: 'Black Book',
  logo: '📘',
  description: 'RV, powersports, and marine values with condition adjustments',
  async getValuation(trade, config) {
    if (!config.apiKey) {
      return { success: false, error: 'Black Book not configured — add API Key in Settings → Integrations → Valuation → Black Book' }
    }
    // Integration point — confirm endpoint/payload against Black Book's API docs.
    return { success: false, error: 'Black Book integration coming soon' }
  },
}

const PROVIDERS: Record<ValuationProviderName, ValuationProvider> = {
  jdpower: jdpowerProvider,
  blackbook: blackbookProvider,
}


/** The template asked no permission beyond a session on either path. */
export function createValuationRoutes(d: CrmDeps) {
  const { db } = d

  async function enabledProvider(companyId: string): Promise<{ provider: ValuationProvider; config: ValuationConfig } | null> {
    const [comp] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, companyId)).limit(1)
    if (!comp) return null
    const integrations = (comp.integrations || {}) as Record<string, any>
    for (const [name, config] of Object.entries(integrations.valuation || {})) {
      if (config && (config as any).enabled) {
        const provider = PROVIDERS[name as ValuationProviderName]
        if (provider) return { provider, config: config as ValuationConfig }
      }
    }
    return null
  }

  const app = new Hono<AppEnv>()

  // GET /providers — every provider, and which one this company has on. A list reply (the template sent a bare array).
  app.get('/providers', d.permissions.requirePermission('contacts:read'), async (c) => {
    const enabled = await enabledProvider(c.get('user').companyId)
    const rows = Object.values(PROVIDERS).map((p) => ({
      name: p.name, displayName: p.displayName, logo: p.logo, description: p.description, enabled: enabled?.provider.name === p.name,
    }))
    return listAll(c, rows)
  })

  // POST /estimate — the trade's book value from the enabled provider
  // A paid provider call made for a deal.
  app.post('/estimate', d.permissions.requirePermission('contacts:update'), async (c) => {
    const trade = await c.req.json().catch(() => ({}))
    const match = await enabledProvider(c.get('user').companyId)
    if (!match) return one(c, { success: false, error: 'No valuation provider enabled — add J.D. Power or Black Book in Settings → Integrations → Valuation' } as ValuationResult)
    return one(c, await match.provider.getValuation(trade, match.config))
  })

  return app
}

function num(v: any): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(String(v).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : undefined
}
