// A store's website while its shop is closed (its subscription ended: the admin is locked and the shop with it, as a
// frozen Shopify store is). From templates/website-store routes/storeStatus.ts, where the storefront asked the store's
// API every 30 seconds whether it was open; here the website and the store are one app, so it asks the store itself.

/**
 * What a closed store still serves: the order-received page (a shopper who paid a moment before it closed still sees
 * their order, as the store keeps the payment notices and the order summary open), the API, the admin and sign-in, and
 * any file (styles, scripts, photos, robots).
 */
export function servesWhileClosed(pathname: string): boolean {
  if (pathname === '/checkout/success') return true
  if (pathname === '/api' || pathname.startsWith('/api/')) return true
  if (pathname === '/crm' || pathname.startsWith('/crm/') || pathname === '/login' || pathname.startsWith('/media/') || pathname.startsWith('/img/')) return true
  return /\.[a-z0-9]+$/i.test(pathname)
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))

/** The page a shopper sees. Self-contained (nothing to fetch), readable in light and dark. */
export function unavailablePage(storeName: string | null): string {
  const name = storeName ? esc(storeName) : 'This store'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${name} — unavailable</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --ink:#111827; --muted:#4b5563; --line:#e5e7eb }
  @media (prefers-color-scheme: dark) { :root { --bg:#0f172a; --card:#1e293b; --ink:#f1f5f9; --muted:#cbd5e1; --line:#334155 } }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); color:var(--ink);
         font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; padding:16px; box-sizing:border-box }
  main { max-width:440px; width:100%; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:32px 28px; text-align:center }
  h1 { font-size:22px; margin:0 0 10px } p { margin:0; color:var(--muted); line-height:1.6 }
</style></head>
<body><main><h1>${name} is unavailable</h1><p>This store isn’t open right now. Please check back soon.</p></main></body></html>`
}
