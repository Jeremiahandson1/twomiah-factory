/**
 * Is the store open to shoppers? — the storefront's "This store is unavailable" page. (10/14)
 *
 * A store whose Twomiah subscription has ended is unavailable to shoppers, as a frozen Shopify store is: crm-store's
 * public API answers 503 STORE_UNAVAILABLE and GET /api/public/status says { open: false }. This asks that once every
 * 30 seconds and, while closed, the storefront shows a plain page instead of a shop with an empty catalogue and a
 * checkout that fails.
 *
 * The one rule: a blip must never take a working shop down. Anything but a clear { open: false } — no crm-store
 * configured, a timeout, a 5xx, a reply that is not JSON — is OPEN. Framework-free, like storeApi.ts, so it is testable.
 */

export interface StoreStatusDeps {
  crmStoreApiUrl: string
  fetchImpl?: typeof fetch
  now?: () => number
  ttlMs?: number
}

export interface StoreStatus { open: boolean; storeName: string | null }

const OPEN: StoreStatus = { open: true, storeName: null }

export function createStoreStatus(deps: StoreStatusDeps) {
  const base = (deps.crmStoreApiUrl || '').replace(/\/+$/, '')
  const now = deps.now || Date.now
  const ttl = deps.ttlMs ?? 30_000
  let cached: { at: number; status: StoreStatus } | null = null

  return async function storeStatus(): Promise<StoreStatus> {
    if (!base) return OPEN
    if (cached && now() - cached.at < ttl) return cached.status
    let status = OPEN
    try {
      const res = await (deps.fetchImpl || fetch)(`${base}/api/public/status`, { signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const j: any = await res.json().catch(() => null)
        if (j && j.open === false) status = { open: false, storeName: typeof j.storeName === 'string' ? j.storeName : null }
      }
    } catch { /* unreachable is open — see above */ }
    cached = { at: now(), status }
    return status
  }
}

/**
 * Pages a closed store still serves: its own health check and content admin, uploads, any file (assets, robots) — and
 * the thank-you page, so a shopper who paid a moment before the store closed still sees their order (crm-store keeps
 * the payment webhook and the order summary open for exactly that).
 */
export function servesWhileClosed(pathname: string): boolean {
  if (pathname === '/checkout/success') return true
  if (pathname.startsWith('/api/') || pathname === '/api') return true
  if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/uploads/')) return true
  return /\.[a-z0-9]+$/i.test(pathname)
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))

/** The page a shopper sees. Self-contained (no stylesheet to fetch), readable in light and dark. */
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
