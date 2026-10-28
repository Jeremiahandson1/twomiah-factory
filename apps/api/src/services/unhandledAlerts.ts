// Errors nothing caught: a request that threw past its route's own try/catch, and a crash. Both go to the owner
// through services/alerts.ts — one email per route + error, not one per request.

import type { Context } from 'hono'
import { raiseAlert } from './alerts'

/** Numbers, ids and quoted values vary per request; the same bug must be the same key. */
function shape(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b\d+\b/g, '#')
    .replace(/(["'`]).*?\1/g, '$1…$1')
    .slice(0, 80)
}

export function reportUnhandled(err: unknown, method: string, routePath: string): void {
  const message = String((err as any)?.message || err)
  void raiseAlert({
    key: `unhandled:${method} ${routePath}:${shape(message)}`,
    what: `The Factory hit an unexpected error on ${method} ${routePath}`,
    detail: message,
  })
}

/** Hono's own default reply for an uncaught error (what a visitor saw before alerts existed), plus the alert. */
export function unhandledErrorHandler(err: Error, c: Context): Response | Promise<Response> {
  // An HTTPException is a deliberate reply, not a bug (Hono's own default handler tests for it the same way).
  if ('getResponse' in err && typeof (err as any).getResponse === 'function') return (err as any).getResponse()
  console.error(err)
  reportUnhandled(err, c.req.method, c.req.routePath)
  return c.text('Internal Server Error', 500)
}

/**
 * Bun exits on an uncaught exception or unhandled rejection; these handlers keep that (exit 1 — Render restarts the
 * service) but tell the owner first, for at most a few seconds.
 */
export function installCrashAlerts(): void {
  let dying = false
  const die = (kind: string) => (err: unknown) => {
    console.error(`[Factory] ${kind}:`, err)
    if (dying) return
    dying = true
    const message = String((err as any)?.message || err)
    const done = new Promise<void>((r) => setTimeout(r, 5000))
    Promise.race([
      raiseAlert({ key: `crash:${kind}:${shape(message)}`, what: `The Factory crashed (${kind}) and is restarting`, detail: message }),
      done,
    ]).finally(() => process.exit(1))
  }
  process.on('uncaughtException', die('uncaught exception'))
  process.on('unhandledRejection', die('unhandled rejection'))
}
