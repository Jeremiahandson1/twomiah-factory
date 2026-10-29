// A Web presence customer's domain: the existing buy-a-domain and bring-your-own flows (routes/factory/lifecycle.ts attach /
// billing.ts handleDomainRegistration), pointed at the customer's Netlify site instead of a Render service. Cloudflare keeps the
// DNS as for every Twomiah domain; Netlify gets the custom domain and its certificate. The status stays honest: "live" only when
// the address opens (siteOpens), and a bought domain still waits on the registrar's verify email.
import { supabase } from '../middleware/auth'
import { Netlify } from './netlify'
import { webPresenceOn } from './switch'

/** For a tenant on the Web presence plan: where its domain points. Null for every other tenant (and while the switch is off). */
export async function webPresenceDomainTarget(tenantId: string): Promise<{ target: string; attach: (domain: string) => Promise<{ ok: boolean; detail?: string }> } | null> {
  if (!webPresenceOn()) return null
  const { data: row } = await supabase.from('web_presence_sites').select('*').eq('tenant_id', tenantId).maybeSingle()
  if (!row || !row.netlify_site_id || !row.netlify_site_name || row.status === 'removed') return null
  return {
    target: row.netlify_site_name + '.netlify.app',
    attach: async (domain: string) => {
      const nl = new Netlify({ token: process.env.NETLIFY_AUTH_TOKEN || '', team: process.env.NETLIFY_TEAM || '' })
      await nl.setCustomDomain(row.netlify_site_id, domain, ['www.' + domain])
      await supabase.from('web_presence_sites').update({ custom_domain: domain, ssl_ok: false, updated_at: new Date().toISOString() }).eq('id', row.id)
      // The certificate can only be issued once the domain's DNS points at Netlify; until then the hourly pass asks again.
      const cert = await nl.provisionCertificate(row.netlify_site_id, [domain, 'www.' + domain])
      if (cert.ok) await supabase.from('web_presence_sites').update({ ssl_ok: true }).eq('id', row.id)
      return { ok: true, detail: cert.ok ? undefined : 'Certificate pending until the domain points at us' }
    },
  }
}
