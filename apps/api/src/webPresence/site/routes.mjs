// Every dynamic address of a Web presence site and the route the function serves it as — ONE table, read by the redirect rules
// (publish.ts writes one rule per row) and by the function (handler.mjs routes by the address asked for). Dependency-free: it
// ships inside the site's function.
//
// The function routes by the PATH, not a query the rule adds: Netlify hands a rewritten function the visitor's own query and
// drops the rule's, so `?r=privacy` on the rule never arrived — /privacy and every /api/* address served the home page (live
// test site, 10/30).
export const ROUTES = {
  '/': 'page', '/privacy': 'privacy', '/privacy/': 'privacy', '/media': 'img',
  // The page's stylesheet is the function's too (not a deployed file): an editor save changes the look with no deploy, and the
  // stylesheet must change with it. publish.ts deploys no file at this path, so this rule is never shadowed by one.
  '/styles/main.css': 'css',
  '/api/signin': 'api/signin', '/api/login': 'api/login', '/api/password': 'api/password', '/api/signout': 'api/signout', '/api/link': 'api/link', '/api/model': 'api/model',
  '/api/upload': 'api/upload', '/api/leads': 'api/leads', '/api/apply': 'api/apply', '/api/me': 'api/me', '/api/usage': 'api/usage',
  '/api/export': 'api/export', '/api/adopt': 'api/adopt', '/api/domain/status': 'api/domain/status',
  '/api/domain/attach': 'api/domain/attach', '/api/domain/buy': 'api/domain/buy',
  // Sell a download. Public: the buy button, the page after paying, the buyer's link. The owner's (signed in): the file, the sales,
  // linking Stripe. The Factory's (signed with the site's secret): a sale paid, a sale refunded, Stripe linked or unlinked.
  '/api/buy': 'api/buy', '/thanks': 'thanks', '/download': 'download',
  '/api/download/file': 'api/download/file', '/api/sales': 'api/sales', '/api/sales.csv': 'api/sales.csv', '/api/sales/resend': 'api/sales/resend',
  '/api/stripe': 'api/stripe', '/api/stripe/start': 'api/stripe/start', '/api/stripe/disconnect': 'api/stripe/disconnect',
  '/api/sale': 'api/sale', '/api/refund': 'api/refund', '/api/stripe-link': 'api/stripe-link',
}

/** The route for a request URL: its path from the table; called at the function's own address, the `r` query (or the page). */
export function routeOf(url) {
  const byPath = Object.prototype.hasOwnProperty.call(ROUTES, url.pathname) ? ROUTES[url.pathname] : null
  return byPath || (url.searchParams.get('r') || 'page').replace(/^\/+/, '')
}
