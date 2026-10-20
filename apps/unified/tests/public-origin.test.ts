// This tenant's public address for callbacks and links (packages/tenant-backend publicOrigin.ts). Every text went to
// Twilio with "/api/sms/webhook/status" as its delivery-report address — the texting read API_BASE_URL alone, which
// nothing sets — and Twilio refused it (live, test tenant two). The Factory sets API_URL / BACKEND_URL.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { publicApiBase } from '../../../packages/tenant-backend/src/publicOrigin.ts'

test('the address the Factory sets is the answer; the old name and the front end are fallbacks; none is empty', () => {
  expect(publicApiBase({ API_URL: 'https://acme-app.onrender.com/', FRONTEND_URL: 'https://x' })).toBe('https://acme-app.onrender.com')
  expect(publicApiBase({ BACKEND_URL: 'https://b.example' })).toBe('https://b.example')
  expect(publicApiBase({ API_BASE_URL: 'https://old.example' })).toBe('https://old.example')
  expect(publicApiBase({ FRONTEND_URL: 'https://front.example//' })).toBe('https://front.example')
  expect(publicApiBase({})).toBe('')
})

test('texts, review requests and marketing all read it; a text never carries a relative delivery-report address', () => {
  const src = (p: string) => readFileSync(join(import.meta.dir, '../../../packages/tenant-backend/src', p), 'utf8')
  const sms = src('integrations/sms.ts')
  expect(sms).toContain('publicApiBase()')
  expect(sms).toMatch(/\/\^https\?:\\\/\\\/\/\.test\(base\) \? \{ statusCallback:/)
  expect(sms).not.toContain('process.env.API_BASE_URL')
  expect(src('integrations/reviews.ts')).toContain('publicApiBase()')
  expect(src('marketing/marketing.ts')).toContain('publicApiBase(env')
})
