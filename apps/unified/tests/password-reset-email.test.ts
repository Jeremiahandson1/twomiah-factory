// The password-reset email is the link alone (server/core/email.ts passwordReset, 2026-10-22). It printed a six-digit
// "code" that nothing stores or asks for.
import { test, expect } from 'bun:test'
import { coreTemplates } from '../server/core/email.ts'

test('the reset email carries the link and no code', () => {
  const m = coreTemplates.passwordReset({ firstName: 'Pat', resetToken: 'tok-123', resetCode: '482913' }, { companyName: 'Acme', colourOnWhite: '#c2410c' }, 'https://app.acme.example')
  for (const body of [m.html, m.text]) {
    expect(body).toContain('https://app.acme.example/reset-password?token=tok-123')
    expect(body).not.toContain('482913')
    expect(body).not.toMatch(/\bcode\b/i)
    expect(body).not.toContain('undefined')
  }
})
