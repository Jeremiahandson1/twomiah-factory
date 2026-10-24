// What a request carries once the app's middleware has run: the signed-in person (set by the shared authenticate), and
// inside a View As the real user behind it (core/viewAs.ts).
import type { AuthUserContext } from '@twomiah/tenant-backend'
import type { ViewAsContext } from '../core/viewAs.ts'

export type AppEnv = { Variables: { user: AuthUserContext; viewAs?: ViewAsContext } }
