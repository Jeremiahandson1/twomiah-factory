/**
 * Where staff open a unified business's CRM. The business is one service: its Render address serves the website at "/"
 * and the CRM at /crm (signed out, that shows the sign-in). Once the website runs on the business's own domain, the CRM
 * lives at app.<domain> (apps/unified/server/http/adminHost.ts). The domain is used only when the website address IS
 * that domain — a domain saved but not yet pointed at us would give a dead link.
 */
export function crmSignInUrl(renderUrl: string, websiteUrl?: string | null): string {
  const host = (u?: string | null) => {
    if (!u) return ''
    try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
  }
  const site = host(websiteUrl)
  const ownDomain = site && !site.endsWith('.onrender.com') && site !== 'localhost'
  const base = ownDomain ? 'https://app.' + site : 'https://' + host(renderUrl)
  return base + '/crm'
}
