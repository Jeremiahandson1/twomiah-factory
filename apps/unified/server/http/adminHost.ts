// app.<domain> is the business's admin address, as it was in the templates (services/deploy.ts wireDomainInfrastructure
// attached app.<domain> to the CRM service, whose "/" was the signed-in landing or the sign-in page). The unified app
// answers every name on one service, so on that name the website half hands over: "/" opens the admin, a website page
// goes to the domain itself (one address per page for search engines), and the files the admin screens use still load.
import type { Context, MiddlewareHandler } from 'hono'

/** The business's domain, from SITE_URL (the Factory sets it to https://<domain> when the domain is wired); else null. */
export function siteDomain(siteUrl = process.env.SITE_URL): string | null {
  if (!siteUrl) return null
  try {
    const host = new URL(siteUrl).hostname.toLowerCase()
    return host && !host.endsWith('.onrender.com') && host !== 'localhost' ? host : null
  } catch { return null }
}

/** Whether this request came in on app.<domain>. Exact: the domain the app was given, never a guess from the name. */
export function isAdminHost(c: Context, siteUrl = process.env.SITE_URL): boolean {
  const domain = siteDomain(siteUrl)
  if (!domain) return false
  const host = (c.req.header('Host') || '').toLowerCase().replace(/:\d+$/, '')
  return host === 'app.' + domain
}

/** The API (an unknown path stays its JSON 404), and the files the admin screens load from the website half (photos,
 * fonts, stylesheets, scripts) — served on either name. */
const SHARED = [/^\/api\//, /^\/media\//, /^\/fonts\//, /^\/styles\//, /^\/scripts\//, /^\/\.well-known\//, /^\/estimator\.js$/]

export function adminHostHandover(siteUrl?: () => string | undefined): MiddlewareHandler {
  return async (c, next) => {
    const url = siteUrl ? siteUrl() : process.env.SITE_URL
    if (!isAdminHost(c, url)) return next()
    const method = c.req.method
    if (method !== 'GET' && method !== 'HEAD') return next()
    const path = c.req.path
    if (SHARED.some((re) => re.test(path))) return next()
    if (path === '/robots.txt') return c.text('User-agent: *\nDisallow: /\n', 200, { 'Cache-Control': 'public, max-age=3600' })
    if (path === '/') return c.redirect('/crm', 302)
    const query = new URL(c.req.url).search
    return c.redirect('https://' + siteDomain(url) + path + query, 301)
  }
}
