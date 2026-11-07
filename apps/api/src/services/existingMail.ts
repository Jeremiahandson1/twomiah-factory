// A domain the customer already owns may already have EMAIL on it (Google Workspace, Microsoft 365, the registrar's mailbox). When
// the Factory moves the domain's DNS to Cloudflare (wireDomainInfrastructure), the new zone starts EMPTY (createZone jump_start:
// false), so the moment the owner switches name servers, every mail record is gone and their email stops arriving. Found 11/06 on
// a customer's domain with Google Workspace mail, before it was attached.
//
// So before anything is written, the mail records are read from PUBLIC DNS — at attach time the domain still answers from its old
// DNS host — and copied into the new zone. What is read (a DNS zone cannot be listed, so these are the names mail uses):
//   @            MX (all) and TXT (all: SPF, and the verification strings Google / Microsoft / others ask for)
//   _dmarc       TXT
//   SPF includes that live UNDER this domain (GoDaddy publishes "include:dc-xxxx._spfm.<domain>"): their TXT
//   DKIM         the selectors the big providers use (google, selector1/2, k1, default, s1/s2, mail, dkim): TXT or CNAME
//   autodiscover CNAME (Microsoft 365 / Outlook set-up)
// Anything else the old DNS had (a subdomain the owner made) cannot be discovered; the result says so, so staff can ask.
// The lookups are injected so a test reads no live DNS.
import { Resolver } from 'node:dns/promises'

export interface MailLookups {
  mx: (name: string) => Promise<Array<{ exchange: string; priority: number }>>
  txt: (name: string) => Promise<string[][]>
  cname: (name: string) => Promise<string[]>
}

export type MailRecord =
  | { type: 'MX'; name: string; content: string; priority: number }
  | { type: 'TXT'; name: string; content: string }
  | { type: 'CNAME'; name: string; content: string }

export interface ExistingMail {
  /** The domain already receives mail somewhere (it has MX records). */
  hasMail: boolean
  /** Where its mail goes, for the step's note (e.g. "smtp.google.com"). */
  mailHosts: string[]
  /** The records to write into the new zone, relative names ('@', '_dmarc', 'google._domainkey'). */
  records: MailRecord[]
  /** The apex SPF as published, if any (merged, not replaced, by a full site's own SPF). */
  spf: string | null
  /** A DMARC record already published (kept as is). */
  dmarc: string | null
}

export const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'k1', 'k2', 'default', 's1', 's2', 'mail', 'dkim'] as const

/** Public resolvers, never the server's own (which may cache or be split-horizon). */
export function liveMailLookups(): MailLookups {
  const r = new Resolver({ timeout: 4000, tries: 2 })
  r.setServers(['1.1.1.1', '8.8.8.8'])
  return { mx: (n) => r.resolveMx(n), txt: (n) => r.resolveTxt(n), cname: (n) => r.resolveCname(n) }
}

const none = async <T>(p: Promise<T>, empty: T): Promise<T> => { try { return await p } catch { return empty } }
const host = (s: string) => String(s || '').trim().replace(/\.$/, '').toLowerCase()

/** Read what mail the domain has now. Never throws: a name that does not answer simply has nothing to copy. */
export async function readExistingMail(domain: string, look: MailLookups): Promise<ExistingMail> {
  const d = host(domain)
  const records: MailRecord[] = []
  const rel = (fqdn: string) => (host(fqdn) === d ? '@' : host(fqdn).slice(0, -(d.length + 1)))
  const under = (fqdn: string) => host(fqdn).endsWith('.' + d)

  // Cloudflare Email Routing's own MX (route1/2/3.mx.cloudflare.net) is ours, not the owner's: a retry after the name servers moved
  // reads it back, and it must not count as "already has mail" (Routing writes it itself).
  const mx = (await none(look.mx(d), [])).filter((m) => m && m.exchange && !/(^|\.)mx\.cloudflare\.net\.?$/i.test(m.exchange))
  for (const m of mx) records.push({ type: 'MX', name: '@', content: host(m.exchange), priority: Number(m.priority) || 0 })

  const apexTxt = (await none(look.txt(d), [])).map((chunks) => chunks.join(''))
  for (const t of apexTxt) records.push({ type: 'TXT', name: '@', content: t })
  const spf = apexTxt.find((t) => /^v=spf1\b/i.test(t)) || null

  // SPF includes hosted under this very domain (GoDaddy's "_spfm"), one level deep: without them the copied SPF points at nothing.
  for (const inc of spf ? [...spf.matchAll(/\binclude:([^\s]+)/gi)].map((m) => host(m[1])) : []) {
    if (!under(inc)) continue
    for (const chunks of await none(look.txt(inc), [])) records.push({ type: 'TXT', name: rel(inc), content: chunks.join('') })
  }

  const dmarcTxt = (await none(look.txt('_dmarc.' + d), [])).map((c) => c.join('')).filter((t) => /^v=DMARC1\b/i.test(t))
  for (const t of dmarcTxt) records.push({ type: 'TXT', name: '_dmarc', content: t })

  for (const sel of DKIM_SELECTORS) {
    const name = sel + '._domainkey'
    const cn = await none(look.cname(name + '.' + d), [])
    if (cn.length) { records.push({ type: 'CNAME', name, content: host(cn[0]) }); continue }
    for (const chunks of await none(look.txt(name + '.' + d), [])) {
      const t = chunks.join('')
      if (/v=DKIM1|k=rsa|p=/i.test(t)) records.push({ type: 'TXT', name, content: t })
    }
  }
  const auto = await none(look.cname('autodiscover.' + d), [])
  if (auto.length) records.push({ type: 'CNAME', name: 'autodiscover', content: host(auto[0]) })

  return { hasMail: mx.length > 0, mailHosts: [...new Set(mx.map((m) => host(m.exchange)))], records, spf, dmarc: dmarcTxt[0] || null }
}

/**
 * A full site's SPF when the domain already sends mail elsewhere: the owner's own SPF with the Factory's sender added before its
 * "all" — ONE record (two SPF records is a permerror). Their qualifier (~all / -all) is kept. Already included: unchanged.
 */
export function mergeSpf(existing: string, include: string): string {
  const parts = existing.trim().split(/\s+/)
  if (parts.some((p) => p.toLowerCase() === include.toLowerCase())) return parts.join(' ')
  const allAt = parts.findIndex((p) => /^[~?+-]?all$/i.test(p))
  if (allAt === -1) return [...parts, include].join(' ')
  return [...parts.slice(0, allAt), include, ...parts.slice(allAt)].join(' ')
}
