// Namecheap API implementation of RegistrarProvider.
// API docs: https://www.namecheap.com/support/api/methods/
//
// Namecheap uses XML over HTTPS GET/POST with query-string auth. Requests
// MUST come from an IP allowlisted on the Namecheap account — NAMECHEAP_CLIENT_IP
// is what we tell Namecheap the request is from (they verify the inbound IP
// matches). Sandbox and production are separate hosts AND separate
// credentials — SANDBOX credentials will not work against production and
// vice versa.

import type {
  RegistrarProvider,
  DomainAvailability,
  RegisterOptions,
  RegisterResult,
  DomainInfo,
} from './index'

const PROD_HOST = 'https://api.namecheap.com/xml.response'
const SANDBOX_HOST = 'https://api.sandbox.namecheap.com/xml.response'

function host(): string {
  return process.env.NAMECHEAP_SANDBOX === 'true' ? SANDBOX_HOST : PROD_HOST
}

function authParams(): URLSearchParams {
  const params = new URLSearchParams()
  params.set('ApiUser', process.env.NAMECHEAP_API_USER || '')
  params.set('ApiKey', process.env.NAMECHEAP_API_KEY || '')
  params.set('UserName', process.env.NAMECHEAP_USERNAME || '')
  params.set('ClientIp', process.env.NAMECHEAP_CLIENT_IP || '')
  return params
}

async function callApi(command: string, extra: Record<string, string>): Promise<string> {
  const params = authParams()
  params.set('Command', command)
  for (const [k, v] of Object.entries(extra)) params.set(k, v)
  const url = host() + '?' + params.toString()
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error('Namecheap HTTP ' + res.status + ': ' + await res.text())
  const xml = await res.text()
  // Surface Namecheap's own error channel rather than returning a misleading success.
  if (xml.includes('Status="ERROR"')) {
    const match = xml.match(/<Error[^>]*Number="(\d+)"[^>]*>([^<]+)<\/Error>/)
    if (match) throw new Error('Namecheap API error ' + match[1] + ': ' + match[2])
    throw new Error('Namecheap API error (unparsed): ' + xml.substring(0, 500))
  }
  return xml
}

// Minimal XML attr extractor — Namecheap responses are flat enough that a
// regex scan beats pulling in a full XML parser dep. If structure gets
// nested we'll swap to fast-xml-parser or similar.
/**
 * Namecheap requires phones in the format `+CountryCode.NumberOnly` —
 * e.g. `+1.6085550142`. Spaces, dashes, parens, even contiguous digits
 * after a leading `+` all get rejected with "Parameter RegistrantPhone
 * is Invalid". This normalizer takes whatever the customer entered and
 * converts to the strict format. Country fallback: 'US' → +1.
 */
function normalizeNamecheapPhone(raw: string, country: string): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (!digits) return raw
  // Country dial codes — extend as we add countries beyond US/CA.
  const dialCodes: Record<string, string> = {
    US: '1', CA: '1', GB: '44', AU: '61', NZ: '64', IE: '353',
    MX: '52', DE: '49', FR: '33', NL: '31', BR: '55', IN: '91',
  }
  const cc = dialCodes[(country || 'US').toUpperCase()] || '1'
  // If the customer typed the country code prefix, strip it before reformatting.
  let local = digits
  if (local.startsWith(cc) && local.length > cc.length + 6) local = local.slice(cc.length)
  // 10-digit guard for US/CA — Namecheap accepts 7-15 digit subscriber numbers.
  if (local.length < 7) return raw  // leave alone; let Namecheap surface the real error
  return '+' + cc + '.' + local
}

function attr(xml: string, tag: string, attr: string): string | undefined {
  const re = new RegExp('<' + tag + '[^>]*\\b' + attr + '="([^"]*)"', 'i')
  const m = xml.match(re)
  return m ? m[1] : undefined
}

export function createNamecheapProvider(): RegistrarProvider {
  return {
    name: 'namecheap',

    async checkAvailability(domain: string): Promise<DomainAvailability> {
      try {
        const xml = await callApi('namecheap.domains.check', { DomainList: domain })
        const available = attr(xml, 'DomainCheckResult', 'Available') === 'true'
        const isPremium = attr(xml, 'DomainCheckResult', 'IsPremiumName') === 'true'
        const premiumPrice = attr(xml, 'DomainCheckResult', 'PremiumRegistrationPrice')
        return {
          domain,
          available,
          premium: isPremium,
          priceUsd: premiumPrice ? parseFloat(premiumPrice) : undefined,
          currency: 'USD',
        }
      } catch (err: any) {
        return { domain, available: false, errorMessage: err.message }
      }
    },

    async checkBatch(domains: string[]): Promise<DomainAvailability[]> {
      if (domains.length === 0) return []
      try {
        // Namecheap's domains.check accepts up to 50 comma-separated domains
        // per call. We cap at 20 to be polite + stay well inside the URL
        // length limit (each variant is ~25 chars).
        const list = domains.slice(0, 20).join(',')
        const xml = await callApi('namecheap.domains.check', { DomainList: list })
        // Extract one <DomainCheckResult ... /> per requested domain.
        const matches = xml.match(/<DomainCheckResult\b[^/]*\/>/g) || []
        const byDomain = new Map<string, DomainAvailability>()
        for (const m of matches) {
          const d = (m.match(/Domain="([^"]+)"/) || [])[1]
          if (!d) continue
          const avail = (m.match(/Available="([^"]+)"/) || [])[1] === 'true'
          const isPrem = (m.match(/IsPremiumName="([^"]+)"/) || [])[1] === 'true'
          const price = (m.match(/PremiumRegistrationPrice="([^"]+)"/) || [])[1]
          byDomain.set(d.toLowerCase(), {
            domain: d.toLowerCase(),
            available: avail,
            premium: isPrem,
            priceUsd: price ? parseFloat(price) : undefined,
            currency: 'USD',
          })
        }
        // Preserve requested order; missing entries → unknown availability
        return domains.map(d => byDomain.get(d.toLowerCase()) || {
          domain: d.toLowerCase(),
          available: false,
          errorMessage: 'No response from registrar',
        })
      } catch (err: any) {
        return domains.map(d => ({ domain: d.toLowerCase(), available: false, errorMessage: err.message }))
      }
    },

    async register(domain: string, opts: RegisterOptions): Promise<RegisterResult> {
      const c = opts.registrantContact
      const contactFields = {
        'RegistrantFirstName': c.firstName,
        'RegistrantLastName':  c.lastName,
        'RegistrantAddress1':  c.address1,
        'RegistrantCity':      c.city,
        'RegistrantStateProvince': c.stateProvince,
        'RegistrantPostalCode': c.postalCode,
        'RegistrantCountry':   c.country,
        'RegistrantPhone':     normalizeNamecheapPhone(c.phone, c.country),
        'RegistrantEmailAddress': c.email,
      } as Record<string, string>
      if (c.address2)      contactFields['RegistrantAddress2'] = c.address2
      if (c.organization)  contactFields['RegistrantOrganizationName'] = c.organization

      // Namecheap requires all four contact roles. For a solo-owner business
      // signup we use the registrant for all four — the tenant can change it
      // later via Namecheap's portal if they want legally distinct contacts.
      const roles = ['Tech', 'Admin', 'AuxBilling']
      for (const role of roles) {
        for (const [key, val] of Object.entries(contactFields)) {
          contactFields[key.replace('Registrant', role)] = val
        }
      }

      const params: Record<string, string> = {
        DomainName: domain,
        Years: String(opts.years ?? 1),
        AddFreeWhoisguard: opts.whoisPrivacy === false ? 'no' : 'yes',
        WGEnabled: opts.whoisPrivacy === false ? 'no' : 'yes',
        ...contactFields,
      }

      try {
        const xml = await callApi('namecheap.domains.create', params)
        const registered = attr(xml, 'DomainCreateResult', 'Registered') === 'true'
        const chargedAmount = attr(xml, 'DomainCreateResult', 'ChargedAmount')
        const domainId = attr(xml, 'DomainCreateResult', 'DomainID')
        // Namecheap returns domain + duration but not explicit expiry — derive it.
        const expiresAt = new Date()
        expiresAt.setFullYear(expiresAt.getFullYear() + (opts.years ?? 1))
        return {
          success: registered,
          domain,
          expiresAt: registered ? expiresAt : undefined,
          registrarDomainId: domainId,
          totalChargedUsd: chargedAmount ? parseFloat(chargedAmount) : undefined,
          error: registered ? undefined : 'Registration did not complete',
        }
      } catch (err: any) {
        return { success: false, domain, error: err.message }
      }
    },

    async renew(domain: string, years: number) {
      try {
        const xml = await callApi('namecheap.domains.renew', { DomainName: domain, Years: String(years) })
        const renewed = attr(xml, 'DomainRenewResult', 'Renew') === 'true'
        const expiryRaw = attr(xml, 'DomainRenewResult', 'DomainDetails')
        // Namecheap returns expiredate under nested element — conservative fallback: today + N years
        const fallback = new Date()
        fallback.setFullYear(fallback.getFullYear() + years)
        return { success: renewed, expiresAt: expiryRaw ? new Date(expiryRaw) : fallback, error: renewed ? undefined : 'Renew call did not confirm success' }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },

    async getDomain(domain: string): Promise<DomainInfo | null> {
      try {
        const xml = await callApi('namecheap.domains.getInfo', { DomainName: domain })
        const expires = xml.match(/<DomainDetails>[\s\S]*?<ExpiredDate>([^<]+)<\/ExpiredDate>/i)
        const locked = xml.match(/<LockDetails>[\s\S]*?<RegistrarLockStatus>([^<]+)<\/RegistrarLockStatus>/i)
        const autoRenew = attr(xml, 'DomainGetInfoResult', 'IsOwner') // not perfect — Namecheap doesn't expose autoRenew on getInfo consistently
        return {
          domain,
          expiresAt: expires ? new Date(expires[1]) : undefined,
          autoRenew: autoRenew !== undefined,
          locked: locked ? locked[1].toLowerCase() === 'true' : false,
        }
      } catch {
        return null
      }
    },

    async unlock(domain: string) {
      try {
        await callApi('namecheap.domains.setRegistrarLock', { DomainName: domain, LockAction: 'UNLOCK' })
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },

    async getEppCode(domain: string) {
      // Namecheap: the EPP code is obtained via domains.getInfo; there's no
      // separate "email me the code" call. We return it and let the caller
      // deliver it (the notifyEppCode template handles that in Phase 4).
      try {
        const xml = await callApi('namecheap.domains.getInfo', { DomainName: domain })
        const match = xml.match(/<EppCode>([^<]+)<\/EppCode>/i)
        if (!match) return { success: false, error: 'EPP code not returned (domain may not be eligible for transfer yet — usually requires >60 days since registration)' }
        return { success: true, eppCode: match[1] }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    },
  }
}
