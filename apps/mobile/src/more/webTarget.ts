/**
 * What the in-app browser may open: ONLY the business's own address, over HTTPS. Anything else goes to the phone's own browser.
 * Pure (no URL class — React Native's is partial), so tests/mobile/web-target.test.ts holds it to the tricks that fool a loose
 * check: a look-alike host, user-info in front of the host, another port, a different scheme.
 */
const authorityOf = (url: string): { scheme: string; authority: string } | null => {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/.exec(url.trim())
  return m ? { scheme: m[1].toLowerCase(), authority: m[2].toLowerCase() } : null
}

/** Plain http is allowed only for a developer's own machine. */
const isLocal = (authority: string) => /^(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/.test(authority)

export function isOwnAddress(url: string, ownApiUrl: string): boolean {
  const u = authorityOf(url)
  const own = authorityOf(ownApiUrl)
  if (!u || !own || u.authority.includes('@') || u.authority !== own.authority) return false
  return u.scheme === 'https' || (u.scheme === 'http' && isLocal(u.authority))
}

/** The page address on the business's own server for a desktop path (`/crm/billing`), or null when the path is not a plain page. */
export function pageAddress(ownApiUrl: string, path: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  const base = ownApiUrl.replace(/\/+$/, '')
  return isOwnAddress(base + path, ownApiUrl) ? base + path : null
}
