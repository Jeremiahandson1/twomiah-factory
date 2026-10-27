// A ?returnTo= is followed only when it is a path inside the app (packages/tenant-ui/src/shell/safeReturnPath.ts): the
// open redirect behind react-router's advisory (a backslash after the slash reads as a host).
import { test, expect } from 'bun:test'
import { safeReturnPath } from '../../../packages/tenant-ui/src/shell/safeReturnPath.ts'

test('app paths pass, with their query and hash', () => {
  for (const ok of ['/crm/contacts/abc', '/crm/jobs?tab=open#top', '/crm']) expect(safeReturnPath(ok)).toBe(ok)
})

test('anything that could leave the app is refused', () => {
  for (const bad of ['//evil.example', '/\\evil.example', '/\\/evil.example', 'https://evil.example', 'javascript:alert(1)', 'evil.example', '', '/%5Cevil.example', '/%2Fevil.example', '/\t/evil.example', '/a\\b', null, undefined, 42, {}]) {
    expect([bad, safeReturnPath(bad)]).toEqual([bad, null])
  }
})
