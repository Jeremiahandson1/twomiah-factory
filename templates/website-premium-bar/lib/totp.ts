/**
 * TOTP (RFC 6238) — second factor for admin login.
 *
 * Compatible with Google Authenticator, 1Password, Authy, etc. Standard
 * SHA-1, 6-digit codes, 30-second steps. We accept ±1 step of clock
 * skew so a code that ticks over during submission still validates.
 *
 * Secret generation uses node:crypto. No npm dep — the algorithm is
 * tiny and battle-tested for 18 years, and adding `otpauth` to seven
 * deploy bundles is more risk than rolling 60 lines of code.
 */
import crypto from 'crypto'

// RFC 4648 §6 Base32 alphabet (no padding, uppercase only)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function generateSecret(): string {
  // 20 bytes = 160 bits, the RFC 4226 recommended secret length
  const bytes = crypto.randomBytes(20)
  let bits = 0, value = 0, output = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) { output += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('Invalid base32 character: ' + ch)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(out)
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  // counter is < 2^53, fits in two 32-bit writes
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter & 0xffffffff, 4)
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin = ((hmac[offset] & 0x7f) << 24) |
              ((hmac[offset + 1] & 0xff) << 16) |
              ((hmac[offset + 2] & 0xff) << 8) |
              (hmac[offset + 3] & 0xff)
  return (bin % 1_000_000).toString().padStart(6, '0')
}

/**
 * Validate a 6-digit code against a base32 secret. Allows ±1 step of
 * skew (i.e. accepts current, previous, and next 30s windows).
 */
export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false
  const decoded = base32Decode(secret)
  const step = Math.floor(Date.now() / 30000)
  for (let drift = -1; drift <= 1; drift++) {
    if (timingSafeEq(hotp(decoded, step + drift), code)) return true
  }
  return false
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * otpauth:// URI for embedding in a QR code. Authenticator apps parse
 * this to set up the entry without manual secret typing.
 */
export function otpauthUri(opts: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(opts.issuer) + ':' + encodeURIComponent(opts.account)
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  return 'otpauth://totp/' + label + '?' + params.toString()
}

/**
 * Generate a fresh set of single-use recovery codes. Each is shown to
 * the user once during setup; we store only bcrypt hashes server-side.
 * Format: 10 codes of XXXX-XXXX (8 hex chars, hyphenated for readability).
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const hex = crypto.randomBytes(4).toString('hex')
    codes.push(hex.slice(0, 4) + '-' + hex.slice(4))
  }
  return codes
}
