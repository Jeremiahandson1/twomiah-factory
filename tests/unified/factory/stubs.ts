// Stand-ins a Factory test file may install — and that are put back when that file ends, so the next file in the same
// process gets the real thing. CI runs this folder in one process (the order bun picks), so a stand-in left behind
// decides another file's result: crm-addon.test.ts replaced the sign-in module with one whose requireRole lets anyone
// in and never put it back, and web-presence-routes' "staff routes are not open to the public" failed whenever it ran
// after it (a file that spreads `await import(auth)` got the stand-in, not the module). The leak guard
// (no-leaking-stubs.test.ts) refuses a file that installs either stand-in any other way.
import { mock, afterAll } from 'bun:test'
import path from 'node:path'

export const AUTH_PATH = path.resolve(import.meta.dir, '../../../apps/api/src/middleware/auth.ts')

// The real sign-in module, captured the first time this helper loads — before any file has replaced it. A copy, not the
// live namespace: mock.module rewrites the namespace in place, so holding it would hold whatever is installed later.
export const realAuth: Record<string, any> = { ...(await import(AUTH_PATH)) }

/**
 * Replace parts of the sign-in module (the rest stays real) for the rest of this file. `over` is applied on top of the
 * REAL module whatever an earlier file left behind; when the file's tests are done the real module is back.
 */
export function stubAuth(over: Record<string, unknown>): void {
  mock.module(AUTH_PATH, () => ({ ...realAuth, ...over }))
  afterAll(() => { mock.module(AUTH_PATH, () => realAuth) })
}

const realFetch = globalThis.fetch
/** Replace fetch for the rest of this file; the real one is back when the file's tests are done. */
export function stubFetch(fn: (input: any, init?: any) => Promise<Response>): void {
  globalThis.fetch = fn as any
  afterAll(() => { globalThis.fetch = realFetch })
}
/** Put the real fetch back now (inside a test that replaced it for a moment). */
export const restoreFetch = (): void => { globalThis.fetch = realFetch }

/** For a file that must install the stand-in inside a hook (where afterAll cannot be registered): install it there, and
 *  register `afterAll(restoreAuth)` at the file's (or the describe's) top level. */
export function installAuth(over: Record<string, unknown>): void {
  mock.module(AUTH_PATH, () => ({ ...realAuth, ...over }))
}
export function restoreAuth(): void {
  mock.module(AUTH_PATH, () => realAuth)
}
