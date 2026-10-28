// zmsg (packages/tenant-backend/src/zodMessage.ts): the one plain-English message form that both zods the shared code runs under
// honour. The unified app is zod 4; the CRM templates (zod 3) run the same file in their own suites (expense-repayment,
// rr4-approvals, staff-balance say these exact messages). Here: under zod 4 the message replaces only what a person's typing
// causes, and a rule's own message is kept.
import { test, expect } from 'bun:test'
import { z } from 'zod'
import { zmsg } from '../../../packages/tenant-backend/src/zodMessage'

const first = (s: z.ZodType, v: unknown) => { const r = s.safeParse(v); return r.success ? 'ok' : r.error.issues[0].message }

test('a missing or mistyped number says the plain message; its own rules keep theirs', () => {
  const amount = z.coerce.number(zmsg('Amount must be a number, for example 24.50')).positive('Amount must be greater than 0').max(100)
  expect(first(amount, 'abc')).toBe('Amount must be a number, for example 24.50')
  expect(first(amount, undefined)).toBe('Amount must be a number, for example 24.50')
  expect(first(amount, -1)).toBe('Amount must be greater than 0')
  expect(first(amount, 5000)).not.toBe('Amount must be a number, for example 24.50') // an unlabelled rule is zod's own, as under zod 3
  expect(first(amount, 24.5)).toBe('ok')
})

test('a string, a literal and an enum say it too', () => {
  expect(first(z.string(zmsg('Say why')).trim().min(1, 'Say why'), undefined)).toBe('Say why')
  expect(first(z.literal(true, zmsg('Send confirmSpend: true')), false)).toBe('Send confirmSpend: true')
  expect(first(z.literal(true, zmsg('Send confirmSpend: true')), undefined)).toBe('Send confirmSpend: true')
  expect(first(z.enum(['a', 'b'], zmsg('One of a, b')), 'c')).toBe('One of a, b')
})
