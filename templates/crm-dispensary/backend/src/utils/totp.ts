/**
 * TOTP — the six digits an authenticator app shows.
 *
 * Lifted out of routes/security.ts, where it was a private function, because sign-in now has to
 * verify a code too (T49 H4) and a route module is not a place to import a helper from: importing
 * it would pull in a whole Hono app and its middleware for the sake of one HMAC.
 *
 * One implementation, used by enrolment and by sign-in. Two copies of a code verifier is two
 * verifiers that can disagree about whether a code is valid, and the one nobody updated is the one
 * that lets the wrong code through.
 */
import crypto from 'crypto'

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let result = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += BASE32_CHARS[(value >>> bits) & 0x1f]
    }
  }
  if (bits > 0) {
    result += BASE32_CHARS[(value << (5 - bits)) & 0x1f]
  }
  return result
}

export function base32Decode(encoded: string): Buffer {
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const char of encoded.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(char)
    if (idx === -1) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bits -= 8
      output.push((value >>> bits) & 0xff)
    }
  }
  return Buffer.from(output)
}

export function generateTOTPCode(secret: string, timeStep: number): string {
  const key = base32Decode(secret)
  const timeBuffer = Buffer.alloc(8)
  timeBuffer.writeUInt32BE(0, 0)
  timeBuffer.writeUInt32BE(timeStep, 4)

  const hmac = crypto.createHmac('sha1', key)
  hmac.update(timeBuffer)
  const hash = hmac.digest()

  const offset = hash[hash.length - 1] & 0x0f
  const code =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff)

  return String(code % 1000000).padStart(6, '0')
}

/** The current window and one either side, so a clock a few seconds out still works. */
export function verifyTOTP(secret: string, code: string): boolean {
  const given = String(code || '').trim()
  if (!/^\d{6}$/.test(given)) return false
  const timeStep = Math.floor(Math.floor(Date.now() / 1000) / 30)
  for (let i = -1; i <= 1; i++) {
    if (generateTOTPCode(secret, timeStep + i) === given) return true
  }
  return false
}
