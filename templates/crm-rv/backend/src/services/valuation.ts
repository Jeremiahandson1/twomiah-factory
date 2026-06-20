/**
 * Trade-In Valuation Service — RV / Powersports / Marine
 *
 * Provider adapters return a book-value estimate for a trade unit. Plugs into
 * the deal desk (salesLead.tradeInInfo) and the website "Value My Trade" flow.
 *
 * Providers (each needs a dealer/data account + API credentials to go live):
 * - J.D. Power (formerly NADA Guides) — the standard RV/powersports/marine book
 * - Black Book — RV/powersports/marine values
 *
 * The request paths/shapes below follow each vendor's API PATTERN and must be
 * confirmed against their docs once credentials are issued. Until a provider is
 * configured (Settings → Integrations → Valuation), calls return a clear
 * "not configured" message — no fabricated numbers.
 */

import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

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

export function getAllValuationProviders(): ValuationProvider[] {
  return Object.values(PROVIDERS)
}

export async function getEnabledValuationProvider(companyId: string): Promise<{ provider: ValuationProvider; config: ValuationConfig } | null> {
  const [comp] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, companyId)).limit(1)
  if (!comp) return null
  const integrations = (comp.integrations || {}) as Record<string, any>
  const valuationConfig = integrations.valuation || {}
  for (const [name, config] of Object.entries(valuationConfig)) {
    if (config && (config as any).enabled) {
      const provider = PROVIDERS[name as ValuationProviderName]
      if (provider) return { provider, config: config as ValuationConfig }
    }
  }
  return null
}

export async function getTradeValuation(companyId: string, trade: TradeDetails): Promise<ValuationResult> {
  const match = await getEnabledValuationProvider(companyId)
  if (!match) {
    return { success: false, error: 'No valuation provider enabled — add J.D. Power or Black Book in Settings → Integrations → Valuation' }
  }
  return match.provider.getValuation(trade, match.config)
}

function num(v: any): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(String(v).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

export default {
  getAllValuationProviders,
  getEnabledValuationProvider,
  getTradeValuation,
}
