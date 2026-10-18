// What a request carries once the app's middleware has run: the signed-in person (set by the shared authenticate).
import type { AuthUserContext } from '@twomiah/tenant-backend'

export type AppEnv = { Variables: { user: AuthUserContext } }
