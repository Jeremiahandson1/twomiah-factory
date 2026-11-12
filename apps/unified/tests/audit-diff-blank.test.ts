// The audit diff (server/core/audit.ts diff): an empty box and no value are the same nothing (store live test 11/12 — a contact
// edit saving '' over null listed every untouched empty field, "Company: - to -, Phone: - to -…", and cut off the real change).
import { test, expect } from 'bun:test'
import { diff } from '../server/core/audit.ts'

test("'' over null is no change; a real change still is; a cleared value still is", () => {
  expect(diff({ company: null, phone: null, address: null }, { company: '', phone: '', address: '2101 Bell St' })).toEqual({ address: { old: null, new: '2101 Bell St' } })
  expect(diff({ phone: '715' }, { phone: '' })).toEqual({ phone: { old: '715', new: '' } })
  expect(diff({ a: '' }, { a: null })).toBeNull()
})
