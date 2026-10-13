/**
 * The origin of the premium site WE deployed for a tenant, or null.
 *
 * Calls to a site's /api/internal/* endpoints carry the tenant's X-Factory-Key, so they must only
 * ever go to an address we serve. tenants.website_url can't be trusted on its own: it starts as the
 * business's EXISTING website (typed into the intake form) and is replaced with our site's URL only
 * when the site deploy succeeds — a tenant whose site step failed is still 'active' with the old
 * URL. And render_frontend_url is the CRM's address, not the site's.
 *
 * Ours = the site's Render host ({slug}-site.onrender.com), its {slug}.twomiah.app subdomain, or the
 * custom domain attached to the tenant.
 */
export function ourPremiumSiteOrigin(t: { slug?: string | null; website_url?: string | null; domain?: string | null }): string | null {
  const slug = String(t.slug || '').toLowerCase()
  if (!slug) return null
  let u: URL
  try { u = new URL(String(t.website_url || '').trim()) } catch { return null }
  if (u.protocol !== 'https:') return null
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, '')
  const host = bare(u.hostname)
  const domain = bare(String(t.domain || '').replace(/^https?:\/\//i, '').replace(/[/:].*$/, ''))
  const ours = host === slug + '-site.onrender.com' || host === slug + '.twomiah.app' || (!!domain && host === domain)
  return ours ? u.origin : null
}
