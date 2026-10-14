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
  /** The registrar's OWN auto-renew. null = could not be read. A domain we bill must have it OFF; a comped one ON. */
  autoRenew: boolean | null
  locked: boolean
  registrarStatusCodes?: string[]
  /** WHOIS privacy: 'none' when the domain has none allotted. */
  privacy?: { state: 'on' | 'off' | 'none'; id: string | null; expiresAt: Date | null }
}

export interface RegistrarProvider {
  name: string

  // Cheapest possible call — used by signup rate-limited availability endpoint
  checkAvailability(domain: string): Promise<DomainAvailability>

  // Batched availability — used when we want to show alternative suggestions
  // alongside the customer's first pick. Provider may cap internally.
  checkBatch(domains: string[]): Promise<DomainAvailability[]>

  register(domain: string, opts: RegisterOptions): Promise<RegisterResult>

  renew(domain: string, years: number): Promise<{ success: boolean; expiresAt?: Date; error?: string }>

  // What the registrar charges US for one year of this TLD right now — to REGISTER (the first year) or to RENEW —
  // in US cents, ICANN fee included. Every domain charge is this plus the Stripe fee (config/domainPricing.ts), so it
  // is read live: a .site is $2.99 to register and ~$30 to renew. null when it cannot be read with confidence —
  // the caller then charges nothing rather than a guess.
  getCostCents(tld: string, action: 'REGISTER' | 'RENEW'): Promise<number | null>

  // Point a domain WE registered at someone else's nameservers — in practice
  // Cloudflare's, once the zone exists. Without this a domain we sold keeps
  // resolving through the registrar's own DNS and never sees the zone the
  // factory built for it.
  setNameservers(domain: string, nameservers: string[]): Promise<{ success: boolean; error?: string }>

  // Where the registrar says the domain currently points. The registrar is the
  // source of truth here — our own tables cannot confirm a repoint took — so
  // this is how setNameservers gets verified.
  getNameservers(domain: string): Promise<{ success: boolean; nameservers?: string[]; usingRegistrarDns?: boolean; error?: string }>

  getDomain(domain: string): Promise<DomainInfo | null>

  // Transfer-out prep: remove the registrar lock
  unlock(domain: string): Promise<{ success: boolean; error?: string }>

  // Put the registrar lock back — a company that restarts its subscription after cancelling (the offboard unlocked
  // the domain for a transfer it no longer needs).
  lock(domain: string): Promise<{ success: boolean; error?: string }>

  // Keep the domain's free WHOIS privacy running at least to `until` — renewed beside a paid domain renewal, because
  // the registrar ties privacy's auto-renew to the domain's, which stays OFF for a domain we bill. (10/14)
  keepPrivacyThrough(domain: string, until: Date): Promise<{ ok: boolean; renewed: boolean; detail: string }>

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
