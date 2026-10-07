/**
 * WHAT COUNTS AS A WEB ADDRESS, AND WHAT COUNTS AS A LOGO. Pure — no imports at all. (T58j)
 *
 * Extracted from company.ts for the same reason auditFields.ts and services/deal.ts were: the rules
 * lived beside `z.object(...)`, so nothing could execute them without zod resolving, and a rule that
 * cannot be run is a rule that is only ever read. Both were read, repeatedly, and both were wrong.
 *
 * ── the logo bug this exists because of ─────────────────────────────────────────────────────────
 *
 *   showcase: "the booking logo is https:///logo.svg"
 *
 * `logo` shared the WEBSITE validator, and that corrupted correct data on save. generator.ts seeds
 * company.logo root-relative — '/logo.svg', the file it writes into the CRM's own frontend/public —
 * while the website rule exists to rescue somebody typing a bare "example.com" by prepending a
 * scheme. So 'https://' + '/logo.svg' = 'https:///logo.svg', a URL with an empty authority that
 * resolves to nothing.
 *
 * It got past the "does this look like a domain?" check because `new URL('https:///logo.svg')`
 * PARSES — the parser skips the empty authority and reads the host as `logo.svg` — and '.svg' then
 * satisfies the test for a TLD. A file extension impersonating a top-level domain.
 *
 * The consequence in one line: a tenant's logo broke the first time anybody pressed Save on Settings,
 * without their having touched the logo field, because the form posts every field it holds.
 */

/** A typed scheme, e.g. `https:`, `data:`, `javascript:`. */
export const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * A WEBSITE.
 *
 * Accepting a bare "example.com" means prepending https:// — and `new URL('https://nope')` parses
 * perfectly happily, because "nope" is a valid hostname the way "localhost" is. So the convenience
 * that rescued people typing a bare domain also turned any single word into a website: T30 found
 * "nope" saved as https://nope. A bare host must therefore look like a domain — a dot with letters
 * after it. An explicit scheme is still trusted, since somebody typing http://localhost means it.
 * (Field Service T30, a regression from T28 M2)
 */
export const looksLikeWebAddress = (raw: string): boolean => {
  const v = String(raw ?? '').trim()
  if (!v) return true
  const typedScheme = HAS_SCHEME.test(v)
  let u: URL
  try { u = new URL(typedScheme ? v : `https://${v}`) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol)) return false
  if (!typedScheme && !/\.[a-zA-Z]{2,}$/.test(u.hostname)) return false
  return true
}

/** A path on this origin. `(?!\/)` because `//evil.com/x.svg` is protocol-relative — another origin. */
const ROOT_RELATIVE = /^\/(?!\/)/
/** `data:image/...` only. A `data:text/html` URI in an href is a script sink. */
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+[;,]/i

/**
 * 'https:///logo.svg' → '/logo.svg'. An http(s) URL with an empty authority resolves to nothing, so
 * it can only ever have meant a path.
 */
export const healLogo = (v: string) => String(v ?? '').replace(/^https?:\/\/(?=\/)/i, '')

/** The three forms a logo legitimately takes: a path on this origin, a data:image URI, a web address. */
export const isLogoAddress = (v: string) => !v || ROOT_RELATIVE.test(v) || DATA_IMAGE.test(v) || looksLikeWebAddress(v)

/**
 * The whole logo rule, end to end: heal, judge, then absolutise ONLY a bare domain.
 *
 * The value is healed BEFORE it is judged, so the first save after this ships REPAIRS a row already
 * holding the malformed string rather than carefully preserving it.
 *
 * The `javascript:` sink stays closed: those three forms are the entire list, and looksLikeWebAddress
 * rejects every scheme but http and https.
 */
export const normalizeLogo = (raw: string): { ok: boolean; value: string } => {
  let v = healLogo(String(raw ?? '').trim())
  /**
   * `//cdn.example.com/logo.png` is PROTOCOL-RELATIVE, not a path on this origin, so ROOT_RELATIVE
   * deliberately excludes it — and without this line it fell through to the bare-domain branch and
   * came out as `https:////cdn.example.com/logo.png`, four slashes. It is given its scheme instead.
   * Not refused: an off-origin logo is already allowed as an absolute URL, so refusing the same
   * address written with the scheme left off would be arbitrary. (Found by the test, not by eye.)
   */
  if (/^\/\//.test(v)) v = `https:${v}`
  if (!isLogoAddress(v)) return { ok: false, value: v }
  const absolutise = !(!v || ROOT_RELATIVE.test(v) || DATA_IMAGE.test(v) || HAS_SCHEME.test(v))
  return { ok: true, value: absolutise ? `https://${v}` : v }
}
