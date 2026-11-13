// THE SERVER NEVER RUNS WITH AN EMPTY SIGNING KEY (security review S1-13, 2026-11-12).
//
// The Factory sets JWT_SECRET and JWT_REFRESH_SECRET on every tenant it builds (apps/api/src/unified/build.ts). A service
// made by hand without them still started: sign-in failed closed, but the signed PUBLIC links — a bar receipt, a
// texted photo, a technician's tracking page, a salon's tip link, the weekly update, a visit report's feedback, a
// portal document preview — are signed with `JWT_SECRET || ''`, and a link signed with an empty key is one anybody can
// make.
//
// Refusing to start would take the business's website down with it, so a missing secret is replaced for this run with
// a random one and said loudly: nothing can be forged, and what it costs is that sessions and emailed links stop
// working at the next restart — until the secret is set.
//
// Imported first by index.ts, so it has run before any other module reads the environment. Production only: tests and
// a developer's machine set (or deliberately do not set) their own.
import crypto from 'node:crypto'
import logger from './logger.ts'

export function ensureSigningSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing = ['JWT_SECRET', 'JWT_REFRESH_SECRET'].filter((k) => !env[k])
  for (const k of missing) env[k] = crypto.randomBytes(48).toString('hex')
  return missing
}

if (process.env.NODE_ENV === 'production') {
  const missing = ensureSigningSecrets()
  if (missing.length) logger.error(`${missing.join(' and ')} not set — using a random one for this run. Sessions and emailed links will stop working at the next restart. Set the secret in the service's environment.`)
  if (!process.env.FACTORY_SYNC_KEY) logger.error('FACTORY_SYNC_KEY not set — the Factory cannot reach this tenant (plan, features, billing status).')
}
