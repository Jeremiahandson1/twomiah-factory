// The New appointment form's End for a several-service visit is the server's (crm/salon/appointments.ts resolveItems): each service starts
// where the ones before end, unless it runs with the first; the visit ends with the last (salon live test 11/07: End kept the first's end).
import { describe, test, expect } from 'bun:test'
import { visitMinutes } from '../web/src/crm/pages/salon/visitLength.ts'
describe('how long a several-service visit runs', () => {
  test('one after another', () => { expect(visitMinutes(90, [{ minutes: 30 }])).toBe(120) })
  test('a service with the first runs alongside it', () => { expect(visitMinutes(90, [{ minutes: 30, withFirst: true }])).toBe(90) })
  test('with the first, longer than it', () => { expect(visitMinutes(30, [{ minutes: 60, withFirst: true }])).toBe(60) })
  test('mixed: colour 90, a cut alongside, then a blow dry after', () => { expect(visitMinutes(90, [{ minutes: 30, withFirst: true }, { minutes: 30 }])).toBe(120) })
  test('no services added: the first alone', () => { expect(visitMinutes(45, [])).toBe(45) })
})
