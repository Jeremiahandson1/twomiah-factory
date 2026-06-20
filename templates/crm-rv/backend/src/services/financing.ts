/**
 * Multi-Provider Financing Service — RV / Powersports / Marine
 *
 * Generic financing layer behind a stable provider interface. The company's
 * integrations config (Settings → Integrations → Financing) determines which
 * provider(s) are active. These are the lenders/platforms RV, powersports, and
 * marine DEALERS actually use — NOT home-improvement/contractor POS lenders.
 *
 * Supported providers:
 * - Octane (Roadrunner Financial) — instant soft-pull PREQUALIFICATION for
 *   powersports/RV/marine/OPE; primary digital-retail prequal. (adapter ready;
 *   endpoints to be confirmed against Octane's dealer API once credentialed)
 * - Sheffield Financial (Truist) — powersports/marine/OPE/trailer financing
 * - Synchrony (Powersports) — POS prequal + promotional offers (e.g. Polaris)
 * - RouteOne — F&I credit-app aggregation + eContracting (indirect lending)
 * - Aqua Finance — marine / RV specialty lender
 */

import { db } from '../../db/index.ts'
import { financingApplication, company } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProviderName = 'octane' | 'sheffield' | 'synchrony' | 'routeone' | 'aqua'

export interface FinancingOption {
  termMonths: number
  apr: number
  monthlyPayment: number
  totalCost: number
  label: string
}

export interface LoanApplicationRequest {
  companyId: string
  contactId: string
  amount: number
  contactName: string
  contactEmail: string
  contactPhone: string
  purpose?: string
  invoiceId?: string
}

export interface LoanApplicationResult {
  success: boolean
  applicationId?: string
  applicationUrl?: string
  externalId?: string
  error?: string
}

export interface ProviderConfig {
  enabled: boolean
  apiKey?: string
  dealerId?: string
  merchantId?: string
  partnerId?: string
  sandbox?: boolean
  [key: string]: any
}

export interface FinancingProvider {
  name: ProviderName
  displayName: string
  logo: string
  description: string
  supportedTerms: number[]
  getOptions(amount: number, config: ProviderConfig): FinancingOption[]
  createApplication(req: LoanApplicationRequest, config: ProviderConfig): Promise<LoanApplicationResult>
  getStatus(externalId: string, config: ProviderConfig): Promise<string>
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

// Octane / Roadrunner Financial — the powersports/RV/marine instant-prequal
// platform. Buyer soft-pulls, Octane returns real offers and routes them to the
// dealer. ⚠️ The request path/shape below follows Octane's dealer/partner API
// PATTERN and must be verified against their API docs once a dealer account +
// API credentials are issued. Until configured it returns a clear message.
const octaneProvider: FinancingProvider = {
  name: 'octane',
  displayName: 'Octane (Roadrunner Financial)',
  logo: '🏍️',
  description: 'Instant prequalification for RV, powersports, and marine — soft credit pull, real offers, routed to the dealer',
  supportedTerms: [24, 36, 48, 60, 72, 84, 120, 180, 240],
  getOptions(amount, config) {
    const apr = config.standardApr ?? 9.99
    const terms = [60, 84, 120, 180]
    return terms.map((t) => ({
      termMonths: t,
      apr,
      monthlyPayment: calcPayment(amount, apr, t),
      totalCost: calcPayment(amount, apr, t) * t,
      label: `${t} mo @ ${apr}% APR (estimate — prequalify for your real rate)`,
    }))
  },
  async createApplication(req, config) {
    if (!config.apiKey || !config.dealerId) {
      return { success: false, error: 'Octane not configured — add API Key and Dealer ID in Settings → Integrations → Financing → Octane' }
    }
    const baseUrl = config.sandbox ? 'https://api.sandbox.octane.co/v1' : 'https://api.octane.co/v1'
    try {
      // NOTE: confirm exact path/payload against Octane's dealer API docs.
      const response = await fetch(`${baseUrl}/prequalifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'X-Dealer-Id': config.dealerId!,
        },
        body: JSON.stringify({
          dealerId: config.dealerId,
          requestedAmount: req.amount,
          applicant: {
            firstName: req.contactName.split(' ')[0] || req.contactName,
            lastName: req.contactName.split(' ').slice(1).join(' ') || '',
            email: req.contactEmail,
            phone: req.contactPhone,
          },
          assetType: req.purpose || 'powersports',
        }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Octane API error' }))
        return { success: false, error: err.message || `Octane returned ${response.status}` }
      }
      const data = await response.json()
      return {
        success: true,
        applicationId: data.prequalificationId || data.id,
        applicationUrl: data.offerUrl || data.applicationUrl || data.url,
        externalId: data.prequalificationId || data.id,
      }
    } catch (err) {
      return { success: false, error: `Octane API error: ${(err as Error).message}` }
    }
  },
  async getStatus(_externalId, _config) {
    return 'pending'
  },
}

const sheffieldProvider: FinancingProvider = {
  name: 'sheffield',
  displayName: 'Sheffield Financial',
  logo: '⚓',
  description: 'Powersports, marine, OPE, and trailer financing (Truist) — online prequal + digital buying',
  supportedTerms: [24, 36, 48, 60, 72, 84],
  getOptions(amount, config) {
    const apr = config.standardApr ?? 8.99
    return [36, 60, 84].map((t) => ({
      termMonths: t,
      apr,
      monthlyPayment: calcPayment(amount, apr, t),
      totalCost: calcPayment(amount, apr, t) * t,
      label: `${t} mo @ ${apr}% APR`,
    }))
  },
  async createApplication(req, config) {
    if (!config.apiKey || !config.dealerId) return { success: false, error: 'Sheffield not configured — add API Key and Dealer ID in Settings → Integrations' }
    return { success: false, error: 'Sheffield integration coming soon' }
  },
  async getStatus() { return 'pending' },
}

const synchronyProvider: FinancingProvider = {
  name: 'synchrony',
  displayName: 'Synchrony (Powersports)',
  logo: '🏦',
  description: 'Powersports POS financing — fast prequal, promotional offers, PRISM underwriting (e.g. Polaris)',
  supportedTerms: [12, 24, 36, 48, 60],
  getOptions(amount, config) {
    const promoApr = config.promoApr ?? 0
    const standardApr = config.standardApr ?? 12.99
    return [
      { termMonths: 12, apr: promoApr, monthlyPayment: calcPayment(amount, promoApr, 12), totalCost: amount, label: `12 mo promo @ ${promoApr}% APR` },
      { termMonths: 36, apr: standardApr, monthlyPayment: calcPayment(amount, standardApr, 36), totalCost: calcPayment(amount, standardApr, 36) * 36, label: `36 mo @ ${standardApr}% APR` },
      { termMonths: 60, apr: standardApr, monthlyPayment: calcPayment(amount, standardApr, 60), totalCost: calcPayment(amount, standardApr, 60) * 60, label: `60 mo @ ${standardApr}% APR` },
    ]
  },
  async createApplication(req, config) {
    if (!config.apiKey || !config.merchantId) return { success: false, error: 'Synchrony not configured — add API Key and Merchant ID in Settings → Integrations' }
    return { success: false, error: 'Synchrony integration coming soon' }
  },
  async getStatus() { return 'pending' },
}

// RouteOne — not a single lender; it aggregates credit apps to many indirect
// lenders + eContracting. Used desk-side in the deal flow.
const routeoneProvider: FinancingProvider = {
  name: 'routeone',
  displayName: 'RouteOne',
  logo: '🔗',
  description: 'F&I credit-app aggregation + eContracting — submit one application to many indirect lenders',
  supportedTerms: [36, 48, 60, 72, 84, 120, 180, 240],
  getOptions() {
    // Offers come back from the lenders RouteOne routes to; nothing to estimate here.
    return []
  },
  async createApplication(req, config) {
    if (!config.apiKey || !config.dealerId) return { success: false, error: 'RouteOne not configured — add API Key and Dealer ID in Settings → Integrations' }
    return { success: false, error: 'RouteOne integration coming soon' }
  },
  async getStatus() { return 'pending' },
}

const aquaProvider: FinancingProvider = {
  name: 'aqua',
  displayName: 'Aqua Finance',
  logo: '🚤',
  description: 'Marine and RV specialty lender — longer terms for larger units',
  supportedTerms: [60, 120, 180, 240],
  getOptions(amount, config) {
    const apr = config.standardApr ?? 9.49
    return [120, 180, 240].map((t) => ({
      termMonths: t,
      apr,
      monthlyPayment: calcPayment(amount, apr, t),
      totalCost: calcPayment(amount, apr, t) * t,
      label: `${t / 12} yr @ ${apr}% APR`,
    }))
  },
  async createApplication(req, config) {
    if (!config.apiKey) return { success: false, error: 'Aqua Finance not configured — add API Key in Settings → Integrations' }
    return { success: false, error: 'Aqua Finance integration coming soon' }
  },
  async getStatus() { return 'pending' },
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS: Record<ProviderName, FinancingProvider> = {
  octane: octaneProvider,
  sheffield: sheffieldProvider,
  synchrony: synchronyProvider,
  routeone: routeoneProvider,
  aqua: aquaProvider,
}

export function getProvider(name: ProviderName): FinancingProvider | null {
  return PROVIDERS[name] || null
}

export function getAllProviders(): FinancingProvider[] {
  return Object.values(PROVIDERS)
}

// ---------------------------------------------------------------------------
// Company-level provider config
// ---------------------------------------------------------------------------

export async function getEnabledProviders(companyId: string): Promise<{ provider: FinancingProvider; config: ProviderConfig }[]> {
  const [comp] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, companyId)).limit(1)
  if (!comp) return []

  const integrations = (comp.integrations || {}) as Record<string, any>
  const financingConfig = integrations.financing || {}
  const enabled: { provider: FinancingProvider; config: ProviderConfig }[] = []

  for (const [name, config] of Object.entries(financingConfig)) {
    if (config && (config as any).enabled) {
      const provider = PROVIDERS[name as ProviderName]
      if (provider) enabled.push({ provider, config: config as ProviderConfig })
    }
  }

  return enabled
}

export async function getFinancingOptionsForCompany(companyId: string, amount: number): Promise<{ provider: string; displayName: string; logo: string; options: FinancingOption[] }[]> {
  const enabled = await getEnabledProviders(companyId)
  return enabled.map(({ provider, config }) => ({
    provider: provider.name,
    displayName: provider.displayName,
    logo: provider.logo,
    options: provider.getOptions(amount, config),
  }))
}

// ---------------------------------------------------------------------------
// Application management
// ---------------------------------------------------------------------------

export async function createFinancingApplication(
  providerName: ProviderName,
  req: LoanApplicationRequest,
): Promise<LoanApplicationResult> {
  const enabled = await getEnabledProviders(req.companyId)
  const match = enabled.find(e => e.provider.name === providerName)
  if (!match) return { success: false, error: `${providerName} is not enabled for this company` }

  const result = await match.provider.createApplication(req, match.config)

  // Save to DB regardless of result
  await db.insert(financingApplication).values({
    provider: providerName,
    status: result.success ? 'submitted' : 'error',
    amount: req.amount.toString(),
    externalId: result.externalId || null,
    applicationUrl: result.applicationUrl || null,
    companyId: req.companyId,
    contactId: req.contactId,
    providerData: result,
  })

  return result
}

export async function getApplicationsForContact(companyId: string, contactId: string) {
  return db.select().from(financingApplication)
    .where(and(eq(financingApplication.companyId, companyId), eq(financingApplication.contactId, contactId)))
    .orderBy(desc(financingApplication.createdAt))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return Math.round((principal / months) * 100) / 100
  const r = annualRate / 100 / 12
  const payment = principal * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
  return Math.round(payment * 100) / 100
}

export default {
  getProvider,
  getAllProviders,
  getEnabledProviders,
  getFinancingOptionsForCompany,
  createFinancingApplication,
  getApplicationsForContact,
}
