// Code review 12-2, 2026-11-13: signing out of the phone app removes the copies it kept for working offline, and
// keeps what the person has not yet been able to send (apps/mobile/src/auth/signOutWipe.ts).
import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { wipeReadCopies } from '../../mobile/src/auth/signOutWipe.ts'

test('the read copies go; unsent work, the device\'s settings and other apps\' keys stay', async () => {
  const kept = new Map<string, string>([
    ['twomiah_care_cache_v2_u1', '{"clients":[{"name":"Alma Able"}]}'],
    ['twomiah_care_downloaded_v1_u1', '2026-11-13'],
    ['twomiah_read_cache_v1:u1:index', '["/api/jobs"]'],
    ['twomiah_read_cache_v1:u1:/api/jobs', '{"data":[]}'],
    ['twomiah_read_cache_v1:u2:/api/jobs', '{"data":[]}'],
    ['twomiah_offline_queue_v2:u1', '[{"id":"q1"}]'],
    ['twomiah_care_note_v1_v9', 'half-written note'],
    ['twomiah_care_visit_signature_v9_v1', 'data:image/png;base64,AAAA'],
    ['twomiah_push_token_v1', 'ExponentPushToken[x]'],
    ['twomiah_maps_app_v1', 'google'],
  ])
  const store = { getAllKeys: async () => [...kept.keys()], multiRemove: async (keys: string[]) => { for (const k of keys) kept.delete(k) } }
  expect(await wipeReadCopies(store)).toBe(5)
  expect([...kept.keys()].sort()).toEqual(['twomiah_care_note_v1_v9', 'twomiah_care_visit_signature_v9_v1', 'twomiah_maps_app_v1', 'twomiah_offline_queue_v2:u1', 'twomiah_push_token_v1'])
  // A store that fails does not stop the sign-out.
  expect(await wipeReadCopies({ getAllKeys: async () => { throw new Error('no storage') }, multiRemove: async () => {} })).toBe(0)
})

test('sign-out calls it, and its prefixes are the ones the app writes', () => {
  const src = (p: string) => fs.readFileSync(path.resolve(import.meta.dir, '../../mobile/src', p), 'utf8')
  expect(src('auth/AuthContext.tsx')).toMatch(/await wipeReadCopies\(AsyncStorage\)/)
  expect(src('care/CareContext.tsx')).toContain('`twomiah_care_cache_v2_${u}`')
  expect(src('care/CareContext.tsx')).toContain('`twomiah_care_downloaded_v1_${u}`')
  expect(src('offline/readCache.ts')).toContain('`twomiah_read_cache_v1:${user}:')
})
