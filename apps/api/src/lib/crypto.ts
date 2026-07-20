import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto'

// AES-256-GCM encryption for sensitive tenant data at rest in the factory
// Supabase (currently: A2P 10DLC EIN + legal/authorized-rep details).
//
// Same construction as the per-tenant crm-store credential crypto, so the two
// stay auditable together. Key material comes from A2P_ENC_KEY (set as a Render
// secret on the factory API service); we sha256 it to a fixed 32-byte key so the
// caller never has to worry about exact key length/encoding.
//
// Ciphertext format (single string, safe to store in a text/jsonb column):
//   v1.<iv_b64>.<tag_b64>.<ciphertext_b64>

const ALGO = 'aes-256-gcm'

function key(): Buffer {
  const raw = process.env.A2P_ENC_KEY || process.env.ENCRYPTION_KEY
  if (!raw) throw new Error('No factory encryption key set (A2P_ENC_KEY / ENCRYPTION_KEY)')
  return createHash('sha256').update(raw, 'utf8').digest() // 32 bytes
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`
}

export function decrypt(payload: string): string {
  const parts = payload.split('.')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Malformed ciphertext')
  const [, ivB64, tagB64, dataB64] = parts
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

export function encryptJSON(obj: unknown): string {
  return encrypt(JSON.stringify(obj))
}

export function decryptJSON<T = any>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T
}

// Last 4 of an EIN/registration number for display without decrypting the blob
// into logs or the UI. e.g. maskTail('12-3456789') -> '••••6789'
export function maskTail(value: string, keep = 4): string {
  const digits = (value || '').replace(/\D/g, '')
  if (!digits) return ''
  return '••••' + digits.slice(-keep)
}
