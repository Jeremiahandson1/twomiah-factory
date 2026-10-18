// Multi-provider financing: one interface over the lending partners (Wisetack, GreenSky, Mosaic, Service Finance,
// Synchrony, Hearth, Enhancify). The company's integrations config (company.integrations.financing) says which are on.
// Moved from templates/crm/backend/src/services/financing.ts. Only Wisetack and GreenSky call a lender; the rest answer
// "coming soon".
import { eq, and, desc } from 'drizzle-orm'
import { financingApplication, company } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import { createWisetackService, getFinancingOptions } from './wisetackService.ts'

export type ProviderName = 'wisetack' | 'greensky' | 'mosaic' | 'service_finance' | 'synchrony' | 'hearth' | 'enhancify'

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

function calcPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return Math.round((principal / months) * 100) / 100
  const r = annualRate / 100 / 12
  const payment = principal * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
  return Math.round(payment * 100) / 100
}

export function createFinancingService(d: Pick<CrmDeps, 'db' | 'logger'>) {
  const { db } = d
  const wisetack = createWisetackService(d)

  const wisetackProvider: FinancingProvider = {
    name: 'wisetack',
    displayName: 'Wisetack',
    logo: '💳',
    description: 'Consumer lending for contractors — fast approval, no hard credit pull to check rates',
    supportedTerms: [12, 24, 36, 60],
    getOptions(amount) {
      return getFinancingOptions(amount)
    },
    async createApplication(req) {
      try {
        // The template passed customerName / customerEmail / customerPhone / purpose, which createLoanApplication
        // doesn't read (it takes customerInfo), and read back `externalId`, which it doesn't return: the person's
        // details never reached the lender from here, and the saved row had no external id. Named as the service
        // names them.
        const [firstName, ...rest] = (req.contactName || '').split(' ')
        const result = await wisetack.createLoanApplication({
          companyId: req.companyId,
          contactId: req.contactId,
          invoiceId: req.invoiceId,
          amount: req.amount,
          customerInfo: { firstName: firstName || undefined, lastName: rest.join(' ') || undefined, email: req.contactEmail || undefined, phone: req.contactPhone || undefined },
        })
        return { success: true, applicationId: result.id, applicationUrl: result.applicationUrl, externalId: result.applicationId }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
    async getStatus(externalId) {
      const result = await wisetack.getApplicationStatus(externalId)
      return result.status || 'unknown'
    },
  }

  const greenskyProvider: FinancingProvider = {
    name: 'greensky',
    displayName: 'GreenSky',
    logo: '🌿',
    description: 'Home improvement financing by Goldman Sachs — promotional rates, large project support',
    supportedTerms: [12, 24, 36, 60, 84, 120, 144],
    getOptions(amount, config) {
      const promoApr = config.promoApr ?? 0
      const standardApr = config.standardApr ?? 9.99
      return [
        { termMonths: 12, apr: promoApr, monthlyPayment: calcPayment(amount, promoApr, 12), totalCost: amount, label: `12 months @ ${promoApr}% APR` },
        { termMonths: 36, apr: promoApr, monthlyPayment: calcPayment(amount, promoApr, 36), totalCost: calcPayment(amount, promoApr, 36) * 36, label: `36 months @ ${promoApr}% APR` },
        { termMonths: 60, apr: standardApr, monthlyPayment: calcPayment(amount, standardApr, 60), totalCost: calcPayment(amount, standardApr, 60) * 60, label: `60 months @ ${standardApr}% APR` },
        { termMonths: 120, apr: standardApr, monthlyPayment: calcPayment(amount, standardApr, 120), totalCost: calcPayment(amount, standardApr, 120) * 120, label: `120 months @ ${standardApr}% APR` },
      ]
    },
    async createApplication(req, config) {
      if (!config.apiKey || !config.merchantId) {
        return { success: false, error: 'GreenSky not configured — add API key and Merchant ID in Settings → Integrations' }
      }
      const baseUrl = config.sandbox ? 'https://sandbox-api.greensky.com/v1' : 'https://api.greensky.com/v1'
      try {
        const response = await fetch(`${baseUrl}/applications`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
            'X-Merchant-Id': config.merchantId!,
          },
          body: JSON.stringify({
            merchantId: config.merchantId,
            loanAmount: req.amount,
            borrower: {
              firstName: req.contactName.split(' ')[0] || req.contactName,
              lastName: req.contactName.split(' ').slice(1).join(' ') || '',
              email: req.contactEmail,
              phone: req.contactPhone,
            },
            purpose: req.purpose || 'Home improvement',
          }),
        })
        if (!response.ok) {
          const err: any = await response.json().catch(() => ({ message: 'GreenSky API error' }))
          return { success: false, error: err.message || `GreenSky returned ${response.status}` }
        }
        const data: any = await response.json()
        return {
          success: true,
          applicationId: data.applicationId || data.id,
          applicationUrl: data.applicationUrl || data.url,
          externalId: data.applicationId || data.id,
        }
      } catch (err) {
        return { success: false, error: `GreenSky API error: ${(err as Error).message}` }
      }
    },
    async getStatus() { return 'pending' },
  }

  const mosaicProvider: FinancingProvider = {
    name: 'mosaic',
    displayName: 'Mosaic',
    logo: '🔆',
    description: 'Solar and roofing financing — long terms, competitive rates for energy improvements',
    supportedTerms: [60, 120, 180, 240, 300],
    getOptions(amount, config) {
      const apr = config.apr ?? 4.99
      return [
        { termMonths: 120, apr, monthlyPayment: calcPayment(amount, apr, 120), totalCost: calcPayment(amount, apr, 120) * 120, label: `10 years @ ${apr}% APR` },
        { termMonths: 180, apr, monthlyPayment: calcPayment(amount, apr, 180), totalCost: calcPayment(amount, apr, 180) * 180, label: `15 years @ ${apr}% APR` },
        { termMonths: 240, apr, monthlyPayment: calcPayment(amount, apr, 240), totalCost: calcPayment(amount, apr, 240) * 240, label: `20 years @ ${apr}% APR` },
        { termMonths: 300, apr, monthlyPayment: calcPayment(amount, apr, 300), totalCost: calcPayment(amount, apr, 300) * 300, label: `25 years @ ${apr}% APR` },
      ]
    },
    async createApplication(_req, config) {
      if (!config.apiKey) return { success: false, error: 'Mosaic not configured — add API key in Settings → Integrations' }
      return { success: false, error: 'Mosaic integration coming soon' }
    },
    async getStatus() { return 'pending' },
  }

  const serviceFinanceProvider: FinancingProvider = {
    name: 'service_finance',
    displayName: 'Service Finance',
    logo: '🔧',
    description: 'HVAC, plumbing, and electrical specialty financing — same-as-cash options',
    supportedTerms: [12, 18, 24, 36, 48, 60],
    getOptions(amount, config) {
      const promoApr = config.promoApr ?? 0
      const standardApr = config.standardApr ?? 8.99
      return [
        { termMonths: 18, apr: promoApr, monthlyPayment: calcPayment(amount, promoApr, 18), totalCost: amount, label: `18 months same-as-cash` },
        { termMonths: 36, apr: standardApr, monthlyPayment: calcPayment(amount, standardApr, 36), totalCost: calcPayment(amount, standardApr, 36) * 36, label: `36 months @ ${standardApr}% APR` },
        { termMonths: 60, apr: standardApr, monthlyPayment: calcPayment(amount, standardApr, 60), totalCost: calcPayment(amount, standardApr, 60) * 60, label: `60 months @ ${standardApr}% APR` },
      ]
    },
    async createApplication(_req, config) {
      if (!config.apiKey || !config.dealerId) return { success: false, error: 'Service Finance not configured — add API key and Dealer ID in Settings → Integrations' }
      return { success: false, error: 'Service Finance integration coming soon' }
    },
    async getStatus() { return 'pending' },
  }

  const synchronyProvider: FinancingProvider = {
    name: 'synchrony',
    displayName: 'Synchrony',
    logo: '🏦',
    description: 'Major consumer lender — high approval rates, promotional 0% offers',
    supportedTerms: [6, 12, 18, 24, 36, 48, 60],
    getOptions(amount, config) {
      const promoApr = config.promoApr ?? 0
      const standardApr = config.standardApr ?? 9.99
      return [
        { termMonths: 6, apr: promoApr, monthlyPayment: calcPayment(amount, promoApr, 6), totalCost: amount, label: `6 months @ ${promoApr}% APR` },
        { termMonths: 12, apr: promoApr, monthlyPayment: calcPayment(amount, promoApr, 12), totalCost: amount, label: `12 months @ ${promoApr}% APR` },
        { termMonths: 24, apr: standardApr, monthlyPayment: calcPayment(amount, standardApr, 24), totalCost: calcPayment(amount, standardApr, 24) * 24, label: `24 months @ ${standardApr}% APR` },
        { termMonths: 60, apr: standardApr, monthlyPayment: calcPayment(amount, standardApr, 60), totalCost: calcPayment(amount, standardApr, 60) * 60, label: `60 months @ ${standardApr}% APR` },
      ]
    },
    async createApplication(_req, config) {
      if (!config.apiKey || !config.merchantId) return { success: false, error: 'Synchrony not configured — add API key and Merchant ID in Settings → Integrations' }
      return { success: false, error: 'Synchrony integration coming soon' }
    },
    async getStatus() { return 'pending' },
  }

  const hearthProvider: FinancingProvider = {
    name: 'hearth',
    displayName: 'Hearth',
    logo: '🏠',
    description: 'Built for contractors — multi-lender marketplace, customers see rates from multiple lenders',
    supportedTerms: [12, 24, 36, 48, 60, 84, 120],
    getOptions(amount) {
      return [
        { termMonths: 12, apr: 0, monthlyPayment: calcPayment(amount, 0, 12), totalCost: amount, label: '12 months @ 0% APR' },
        { termMonths: 36, apr: 5.99, monthlyPayment: calcPayment(amount, 5.99, 36), totalCost: calcPayment(amount, 5.99, 36) * 36, label: '36 months @ 5.99% APR' },
        { termMonths: 60, apr: 7.99, monthlyPayment: calcPayment(amount, 7.99, 60), totalCost: calcPayment(amount, 7.99, 60) * 60, label: '60 months @ 7.99% APR' },
        { termMonths: 120, apr: 9.99, monthlyPayment: calcPayment(amount, 9.99, 120), totalCost: calcPayment(amount, 9.99, 120) * 120, label: '120 months @ 9.99% APR' },
      ]
    },
    async createApplication(_req, config) {
      if (!config.apiKey || !config.partnerId) return { success: false, error: 'Hearth not configured — add API key and Partner ID in Settings → Integrations' }
      return { success: false, error: 'Hearth integration coming soon' }
    },
    async getStatus() { return 'pending' },
  }

  const enhancifyProvider: FinancingProvider = {
    name: 'enhancify',
    displayName: 'Enhancify',
    logo: '✨',
    description: 'Multi-lender marketplace — one application, multiple offers, highest approval rates',
    supportedTerms: [12, 24, 36, 48, 60, 84, 120, 144, 180],
    getOptions(amount) {
      return [
        { termMonths: 12, apr: 0, monthlyPayment: calcPayment(amount, 0, 12), totalCost: amount, label: '12 months @ 0% APR' },
        { termMonths: 36, apr: 4.99, monthlyPayment: calcPayment(amount, 4.99, 36), totalCost: calcPayment(amount, 4.99, 36) * 36, label: '36 months @ 4.99% APR' },
        { termMonths: 60, apr: 6.99, monthlyPayment: calcPayment(amount, 6.99, 60), totalCost: calcPayment(amount, 6.99, 60) * 60, label: '60 months @ 6.99% APR' },
        { termMonths: 120, apr: 9.99, monthlyPayment: calcPayment(amount, 9.99, 120), totalCost: calcPayment(amount, 9.99, 120) * 120, label: '120 months @ 9.99% APR' },
      ]
    },
    async createApplication(_req, config) {
      if (!config.apiKey) return { success: false, error: 'Enhancify not configured — add API key in Settings → Integrations' }
      return { success: false, error: 'Enhancify integration coming soon' }
    },
    async getStatus() { return 'pending' },
  }

  const PROVIDERS: Record<ProviderName, FinancingProvider> = {
    wisetack: wisetackProvider,
    greensky: greenskyProvider,
    mosaic: mosaicProvider,
    service_finance: serviceFinanceProvider,
    synchrony: synchronyProvider,
    hearth: hearthProvider,
    enhancify: enhancifyProvider,
  }

  function getProvider(name: ProviderName): FinancingProvider | null {
    return PROVIDERS[name] || null
  }

  function getAllProviders(): FinancingProvider[] {
    return Object.values(PROVIDERS)
  }

  async function getEnabledProviders(companyId: string): Promise<{ provider: FinancingProvider; config: ProviderConfig }[]> {
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

  async function getFinancingOptionsForCompany(companyId: string, amount: number): Promise<{ provider: string; displayName: string; logo: string; options: FinancingOption[] }[]> {
    const enabled = await getEnabledProviders(companyId)
    return enabled.map(({ provider, config }) => ({
      provider: provider.name,
      displayName: provider.displayName,
      logo: provider.logo,
      options: provider.getOptions(amount, config),
    }))
  }

  async function createFinancingApplication(providerName: ProviderName, req: LoanApplicationRequest): Promise<LoanApplicationResult> {
    const enabled = await getEnabledProviders(req.companyId)
    const match = enabled.find((e) => e.provider.name === providerName)
    if (!match) return { success: false, error: `${providerName} is not enabled for this company` }

    const result = await match.provider.createApplication(req, match.config)

    // Saved whatever the result
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

  async function getApplicationsForContact(companyId: string, contactId: string) {
    return db.select().from(financingApplication)
      .where(and(eq(financingApplication.companyId, companyId), eq(financingApplication.contactId, contactId)))
      .orderBy(desc(financingApplication.createdAt))
  }

  return {
    getProvider,
    getAllProviders,
    getEnabledProviders,
    getFinancingOptionsForCompany,
    createFinancingApplication,
    getApplicationsForContact,
  }
}

export type FinancingService = ReturnType<typeof createFinancingService>
