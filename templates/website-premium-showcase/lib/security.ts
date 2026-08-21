/**
 * Security hardening for the premium template.
 *
 * Five concerns, kept together so they're easy to audit:
 *   1. secureHeaders  — CSP + X-Frame + HSTS + X-Content-Type + Referrer
 *   2. adminCors      — locks /api/admin/* to same-origin (or explicit allowlist)
 *   3. loginRateLimit — in-memory token bucket per IP for /api/admin/login
 *   4. isSafeUrl      — rejects javascript:/data:/vbscript: in markdown link hrefs
 *   5. validatePasswordStrength — minimum length + variety check
 */
import type { Context, MiddlewareHandler } from 'hono'

// ─── 1. Secure response headers ─────────────────────────────────────────
// CSP is intentionally permissive on img/font (we proxy R2 uploads and load
// Google Fonts) but locks scripts to self + inline (EJS rendered templates
// embed small bootstrap scripts). We don't run any third-party JS.
export function secureHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const h = c.res.headers
    if (!h.has('Content-Security-Policy')) {
      // When the /book page embeds the CRM's booking widget (salon tenants,
      // CRM_BOOKING_WIDGET=1), the widget script loads from the CRM origin and
      // its slot/booking calls XHR back to it — both blocked by a 'self'-only
      // policy. Allow exactly that one origin, and only when embed mode is on.
      const crmOrigin = process.env.CRM_BOOKING_WIDGET === '1' && process.env.CRM_API_URL
        ? ' ' + process.env.CRM_API_URL.replace(/\/+$/, '')
        : ''
      h.set('Content-Security-Policy', [
        "default-src 'self'",
        "img-src 'self' data: https:",
        "font-src 'self' https://fonts.gstatic.com data:",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "script-src 'self' 'unsafe-inline'" + crmOrigin,
        "connect-src 'self'" + crmOrigin,
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '))
    }
    h.set('X-Frame-Options', 'DENY')
    h.set('X-Content-Type-Options', 'nosniff')
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()')
    h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
}

// ─── 2. Same-origin gate for /api/admin/* ───────────────────────────────
// Public marketing pages stay CORS-open; the admin JSON API does not.
// A request from a browser carries an Origin header — we accept it only
// if it matches the site's own host or appears in CORS_ALLOWED_ORIGINS.
// No-Origin requests (curl, server-to-server) pass through; the JWT is
// the real authorization gate.
export function adminCors(): MiddlewareHandler {
  const extra = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
  return async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin) {
      const host = c.req.header('Host') || ''
      const proto = c.req.header('X-Forwarded-Proto') || 'https'
      const sameOrigin = origin === proto + '://' + host || origin === 'http://' + host
      if (!sameOrigin && !extra.includes(origin)) {
        return c.json({ error: 'Origin not allowed' }, 403)
      }
      c.res.headers.set('Access-Control-Allow-Origin', origin)
      c.res.headers.set('Vary', 'Origin')
      c.res.headers.set('Access-Control-Allow-Credentials', 'true')
      c.res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204)
    await next()
  }
}

// ─── 3. Login rate-limit ────────────────────────────────────────────────
// In-memory sliding window keyed by client IP. Single-process: a tenant
// site runs one Render web service, so this is sufficient. Tuned to stop
// credential stuffing without blocking a typo-prone owner.
//
//   - 10 attempts per IP per 10 minutes
//   - On exceeded: 429 with Retry-After
//   - Successful logins still count (it's IP-based, not per-user) but the
//     window is short enough not to annoy a real human.
interface Bucket { times: number[] }
const loginBuckets = new Map<string, Bucket>()
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const LOGIN_MAX = 10

function clientIp(c: Context): string {
  const xff = c.req.header('X-Forwarded-For') || ''
  if (xff) return xff.split(',')[0].trim()
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown'
}

export function loginRateLimit(): MiddlewareHandler {
  return async (c, next) => {
    const ip = clientIp(c)
    const now = Date.now()
    const bucket = loginBuckets.get(ip) || { times: [] }
    bucket.times = bucket.times.filter(t => now - t < LOGIN_WINDOW_MS)
    if (bucket.times.length >= LOGIN_MAX) {
      const oldest = bucket.times[0]
      const retryAfterSec = Math.ceil((LOGIN_WINDOW_MS - (now - oldest)) / 1000)
      c.res.headers.set('Retry-After', String(retryAfterSec))
      return c.json({ error: 'Too many login attempts. Try again in a few minutes.' }, 429)
    }
    bucket.times.push(now)
    loginBuckets.set(ip, bucket)
    // Opportunistic GC so the map doesn't grow without bound
    if (loginBuckets.size > 5000) {
      for (const [k, v] of loginBuckets) {
        if (v.times.every(t => now - t >= LOGIN_WINDOW_MS)) loginBuckets.delete(k)
      }
    }
    await next()
  }
}

// ─── 4. URL scheme validation for user-supplied hrefs ───────────────────
// Used by the blog markdown renderer to reject `javascript:`, `data:`,
// `vbscript:`, etc. Anything we can't classify as safe gets stripped to '#'.
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

export function isSafeUrl(href: string): boolean {
  if (!href) return false
  const trimmed = href.trim()
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true
  if (trimmed.startsWith('?')) return true
  // Try to parse as absolute URL
  try {
    const u = new URL(trimmed)
    return SAFE_SCHEMES.has(u.protocol)
  } catch {
    // Relative path without leading slash — accept
    return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  }
}

// ─── 5. Password strength ───────────────────────────────────────────────
// Minimum bar, not maximum. Length is the strongest signal; character
// variety catches the worst "Password1" defaults without forcing users
// into bad password-manager patterns.
export function validatePasswordStrength(pw: string): { ok: true } | { ok: false; reason: string } {
  if (pw.length < 10) return { ok: false, reason: 'Password must be at least 10 characters' }
  if (pw.length > 200) return { ok: false, reason: 'Password is too long (max 200 characters)' }
  const hasLetter = /[A-Za-z]/.test(pw)
  const hasNumberOrSymbol = /[\d\W_]/.test(pw)
  if (!hasLetter || !hasNumberOrSymbol) {
    return { ok: false, reason: 'Password must contain both letters and at least one number or symbol' }
  }
  // Common-password short-circuit
  const lower = pw.toLowerCase()
  if (/^(password|qwerty|letmein|welcome|admin|changeme)\d*!?$/.test(lower)) {
    return { ok: false, reason: 'That password is too common. Please choose another.' }
  }
  return { ok: true }
}
