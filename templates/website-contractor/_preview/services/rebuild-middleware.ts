import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Context, Next } from 'hono'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let rebuildTimeout: ReturnType<typeof setTimeout> | null = null

export function triggerRebuild() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Rebuild] Skipping in development mode')
    return
  }

  if (rebuildTimeout) clearTimeout(rebuildTimeout)

  console.log('[Rebuild] Queued, waiting for more changes...')

  rebuildTimeout = setTimeout(() => {
    console.log('[Rebuild] Starting static site rebuild...')
    try {
      const buildScript = path.join(__dirname, '../../build-static.js')
      execSync(`node ${buildScript}`, {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
      })
      console.log('[Rebuild] Static site rebuilt successfully')
    } catch (error: any) {
      console.error('[Rebuild] Build failed:', error.message)
    }
  }, 15000)
}

const TRIGGER_PATHS = [
  '/gallery', '/homepage', '/services-data', '/testimonials',
  '/pages', '/site-settings', '/nav-config'
]

export async function rebuildMiddleware(c: Context, next: Next) {
  if (c.req.method === 'GET') return next()

  await next()

  // After response, check if this was a mutating request to a trigger path
  if (c.res.ok) {
    if (TRIGGER_PATHS.some(p => c.req.path.startsWith(p))) {
      triggerRebuild()
    }
  }
}
