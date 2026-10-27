// An update route keeps a key the caller did not send ABSENT. zod 4's `.partial()` applies a field's default inside the
// optional, so a PUT of `{ notes }` would have reset an invoice's discount and lines (found by contractor-live-1022 when
// zod went 3 → 4). partialOf (packages/tenant-backend/src/partialOf.ts) holds the old behaviour.
import { test, expect } from 'bun:test'
import { z } from 'zod'
import { partialOf } from '@twomiah/tenant-backend'

const schema = z.object({
  notes: z.string().optional(),
  discount: z.number().min(0).default(0),
  lines: z.array(z.string()).default([]),
  total: z.number().optional().default(5),
  name: z.string().min(1),
})

test('a key not sent stays absent — no default is filled in', () => {
  expect(partialOf(schema).parse({ notes: 'x' })).toEqual({ notes: 'x' })
})

test('a key that is sent is still checked by its own rules', () => {
  expect(() => partialOf(schema).parse({ discount: -1 })).toThrow()
  expect(partialOf(schema).parse({ discount: 3, lines: ['a'] })).toEqual({ discount: 3, lines: ['a'] })
  expect(() => partialOf(schema).parse({ name: '' })).toThrow()
})

test('creating (the whole schema) still gets the defaults', () => {
  expect(schema.parse({ name: 'n' })).toEqual({ discount: 0, lines: [], total: 5, name: 'n' })
})

test('a strict schema stays strict', () => {
  const strict = z.object({ a: z.number().default(1) }).strict()
  expect(() => partialOf(strict).parse({ b: 1 })).toThrow()
})
