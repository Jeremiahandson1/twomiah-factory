// Pluggable registrar interface.
// Namecheap is the V1 implementation; OpenSRS is planned for later volume
// (see project_renewal_and_offboard.md memory). Keep the interface minimal
// and provider-neutral — nothing Namecheap-specific leaks here.

export interface DomainAvailability {
  domain: string
  available: boolean
  premium?: boolean
  priceUsd?: number      // Per-year price, already including any markup the provider applies at our account level
  renewalPriceUsd?: number
  transferPriceUsd?: number
  currency?: string
  errorMessage?: string
}

export interface RegisterOptions {
  years?: number         // Default 1
  whoisPrivacy?: boolean // Default true — never surface customer's personal info
  autoRenew?: boolean    // Default true
  registrantContact: RegistrantContact
}

export interface RegistrantContact {
  firstName: string
  lastName: string
  email: string
  phone: string          // E.164 preferred; provider may require specific format
  address1: string
  address2?: string
  city: string
  stateProvince: string
  postalCode: string
  country: string        // ISO 3166-1 alpha-2 (e.g. "US")
  organization?: string
}

export interface RegisterResult {
  success: boolean
  domain: string
  expiresAt?: Date
  registrarDomainId?: string    // Provider's internal identifier
  totalChargedUsd?: number
  error?: string
}

export interface DomainInfo {
  domain: string
  expiresAt?: Date
  autoRenew: boolean
  locked: boolean
  registrarStatusCodes?: string[]
}

export interface RegistrarProvider {
  name: string

  // Cheapest possible call — used by signup rate-limited availability endpoint
  checkAvailability(domain: string): Promise<DomainAvailability>

  register(domain: string, opts: RegisterOptions): Promise<RegisterResult>

  renew(domain: string, years: number): Promise<{ success: boolean; expiresAt?: Date; error?: string }>

  getDomain(domain: string): Promise<DomainInfo | null>

  // Transfer-out prep: remove the registrar lock
  unlock(domain: string): Promise<{ success: boolean; error?: string }>

  // Transfer-out prep: email the EPP (auth) code to the tenant so they can
  // paste it at their new registrar. Provider triggers the email directly.
  getEppCode(domain: string): Promise<{ success: boolean; eppCode?: string; error?: string }>
}

// Lazily constructed so env vars are only validated when actually called.
let providerInstance: RegistrarProvider | null = null

export async function getRegistrar(): Promise<RegistrarProvider> {
  if (providerInstance) return providerInstance
  // Only Namecheap for V1 — OpenSRS is gated on volume.
  const { createNamecheapProvider } = await import('./namecheap')
  providerInstance = createNamecheapProvider()
  return providerInstance
}

export function isRegistrarConfigured(): boolean {
  return !!(process.env.NAMECHEAP_API_USER && process.env.NAMECHEAP_API_KEY && process.env.NAMECHEAP_USERNAME && process.env.NAMECHEAP_CLIENT_IP)
}
