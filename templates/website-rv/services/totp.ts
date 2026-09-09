/**
 * TOTP (RFC 6238) — no external dependency, verified against the RFC test vectors.
 *
 * Used by admin 2FA. Secrets are base32 (authenticator-app compatible). verifyTOTP
 * checks a ±1 step window (±30s) to tolerate clock skew.
 */
import crypto from 'crypto'

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = B32.indexOf(ch)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(out)
}

function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  return (bin % 10 ** digits).toString().padStart(digits, '0')
}

/** Generate a new base32 TOTP secret (default 20 random bytes → 32 chars). */
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes))
}

/**
 * Verify a user-supplied 6-digit code against a base32 secret, allowing ±`window`
 * time steps. Constant-time compare per candidate. Returns false on any bad input.
 */
export function verifyTOTP(secretBase32: string, token: string, window = 1, step = 30): boolean {
  if (!secretBase32 || !token) return false
  const clean = String(token).replace(/\D/g, '')
  if (clean.length !== 6) return false
  const secret = base32Decode(secretBase32)
  if (secret.length === 0) return false
  const counter = Math.floor(Date.now() / 1000 / step)
  for (let w = -window; w <= window; w++) {
    const candidate = hotp(secret, counter + w, 6)
    if (candidate.length === clean.length &&
        crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(clean))) {
      return true
    }
  }
  return false
}
