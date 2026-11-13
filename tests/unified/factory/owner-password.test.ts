// The owner's signup password is stored as a hash, never as typed (security review S5-1, 2026-11-13).
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { isBcryptHash } from '../../../apps/api/src/unified/factory.ts'

describe('the owner’s signup password', () => {
  test('a bcrypt hash is told from a password as typed', async () => {
    const hash = await Bun.password.hash('Correct-horse-1', { algorithm: 'bcrypt', cost: 10 })
    expect(isBcryptHash(hash)).toBe(true)
    for (const typed of ['Correct-horse-1', '$2b$10$short', '', null, undefined, 12345]) expect(isBcryptHash(typed)).toBe(false)
  })

  test('a unified signup writes the hash to the tenant row and hands the build no password', () => {
    const intake = readFileSync(new URL('../../../apps/api/src/routes/factory/intake.ts', import.meta.url), 'utf8')
    expect(intake).toContain("admin_password: engine === 'unified' ? ownerPasswordHash : (body.admin_password || null),")
    expect(intake).toContain('defaultPassword: builtUnified ? undefined : (body.admin_password || undefined),')
    // …and the build uses a stored hash as it is.
    const build = readFileSync(new URL('../../../apps/api/src/unified/factory.ts', import.meta.url), 'utf8')
    expect(build).toMatch(/const passwordHash = isBcryptHash\(kept\)\s*\? kept/)
  })
})
