// The one list of paths a website page can't take, read by the public pages (site/routes.ts /:slug) and by the admin
// that creates pages (site/admin.ts). The site template kept two lists that disagreed.

/**
 * Every first path segment the app serves itself, and the files for search engines. Not here on purpose: 'projects'
 * and 'inventory' — the owner may compose a page by those names, and /projects and /inventory build on it.
 */
export const RESERVED_SLUGS = new Set([
  'api', 'admin', 'crm', 'login', 'logout', 'auth', 'reset-password', 'forgot-password', 'uploads', 'media', 'images',
  'styles', 'scripts', 'static', 'assets', 'build', 'public', 'health', 'sitemap.xml', 'robots.txt', 'llms.txt',
  'blog', 'book', 'booking', 'customize', 'service-areas', 'visualize', 'portal', 'vendor', 'crm-assets',
])

/** A single path segment: lowercase letters, numbers and hyphens. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
