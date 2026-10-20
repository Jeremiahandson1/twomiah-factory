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
export function ourPremiumSiteOrigin(t: { slug?: string | null; website_url?: string | null; domain?: string | null; engine?: string | null }): string | null {
  // A unified tenant has no premium site: its one service is site and app (ourUnifiedOrigin), and it answers none of
  // the premium site's endpoints the callers of this one use (calendar tokens, the booking crons — it runs its own).
  if (t.engine === 'unified') return null
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

/**
 * The origin of a unified tenant's one service (apps/unified: the website at /, the admin at /login and /crm/*), or
 * null — for a template tenant, or when no https address is recorded. Ours = tenants.render_backend_url, which only the
 * Factory writes, from the service it built (services/resourceOwnership.ts counts it as a record of ownership). Never
 * tenants.website_url: for a template tenant that starts as the business's old website.
 */
export function ourUnifiedOrigin(t: { engine?: string | null; render_backend_url?: string | null }): string | null {
  if (t.engine !== 'unified') return null
  let u: URL
  try { u = new URL(String(t.render_backend_url || '').trim()) } catch { return null }
  return u.protocol === 'https:' ? u.origin : null
}

/**
 * The site we serve, for an endpoint BOTH kinds of site answer (POST /api/internal/seed-photos): the unified service
 * for a unified tenant, the premium site otherwise. Not for an endpoint only one of them has.
 */
export function ourSiteOrigin(t: { slug?: string | null; website_url?: string | null; domain?: string | null; engine?: string | null; render_backend_url?: string | null }): string | null {
  return t.engine === 'unified' ? ourUnifiedOrigin(t) : ourPremiumSiteOrigin(t)
}
