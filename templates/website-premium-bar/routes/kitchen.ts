/**
 * routes/kitchen.ts — THE GRILL SCREEN. A wall tablet by the charbroiler that
 * shows every food order from the bar, the booths and the website, paced so
 * the plate comes together hot. Same PIN login as the console.
 *
 *   GET  /kitchen               the screen (server-rendered; bump works without JS)
 *   GET  /kitchen/pacing.js     lib/kitchen/pacing.ts bundled for the browser (one source of truth)
 *   POST /kitchen/bump/:id      no-JS bump → back to the screen
 *   GET  /api/kitchen/state     the current state as JSON
 *   GET  /api/kitchen/stream    server-sent events: a fresh state on every change + a heartbeat
 *   POST /api/kitchen/bump      { id }
 *   POST /api/kitchen/recall    { id }
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import ejs from 'ejs'
import path from 'path'
import { db } from '../db'
import { settings as settingsTbl } from '../db/schema'
import { bumpTicket, kitchenBus, kitchenState, recallTicket } from '../lib/kitchen/tickets'
import { allDay, ageState, cueFor, paceTicket, startNow } from '../lib/kitchen/pacing'
import { requireStaff, type Vars } from './console'

const viewsDir = path.join(import.meta.dir, '..', 'views', 'console')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── Pages ──────────────────────────────────────────────────────────────────
export const kitchenPages = new Hono<{ Variables: Vars }>()

let pacingBundle: string | null = null
kitchenPages.get('/pacing.js', async (c) => {
  if (!pacingBundle) {
    const out = await Bun.build({ entrypoints: [path.join(import.meta.dir, '..', 'lib', 'kitchen', 'pacing.ts')], target: 'browser', format: 'esm', minify: true })
    if (!out.success) return c.text('build failed', 500)
    pacingBundle = await out.outputs[0].text()
  }
  c.header('Content-Type', 'application/javascript; charset=utf-8')
  c.header('Cache-Control', 'no-cache')
  return c.body(pacingBundle)
})

kitchenPages.use('*', requireStaff)

kitchenPages.get('/', async (c) => {
  const [s] = await db.select({ name: settingsTbl.companyName }).from(settingsTbl).limit(1)
  const state = await kitchenState(db)
  const now = state.serverNow
  // Server-rendered with the same arithmetic the browser uses, so the first paint (and a screen with JS off) is right.
  const paced = state.open.map(t => ({ t, p: paceTicket(t.firedAt, t.items) }))
  const html = await ejs.renderFile(path.join(viewsDir, 'kitchen.ejs'), {
    companyName: s?.name || 'Bar', staff: c.get('staff'), state,
    view: paced.map(({ t, p }) => ({ ...t, cue: cueFor(p, now), age: ageState(t.firedAt, now, state.warnSeconds, state.lateSeconds), ageMin: Math.floor((now - t.firedAt) / 60000) })),
    startNow: startNow(paced.map(x => x.p), now), allDay: allDay(state.open),
  })
  c.header('Cache-Control', 'no-store'); c.header('X-Robots-Tag', 'noindex')
  return c.html(html)
})

kitchenPages.post('/bump/:id', async (c) => {
  const id = c.req.param('id')
  if (UUID.test(id)) await bumpTicket(db, id, c.get('staff').label)
  return c.redirect('/kitchen', 303)
})

// ─── API ────────────────────────────────────────────────────────────────────
export const kitchenApi = new Hono<{ Variables: Vars }>()
kitchenApi.use('*', requireStaff)

kitchenApi.get('/state', async (c) => {
  c.header('Cache-Control', 'no-store')
  return c.json(await kitchenState(db))
})

kitchenApi.get('/stream', (c) => {
  c.header('Cache-Control', 'no-cache, no-transform')   // never buffered by compression or a proxy
  c.header('X-Accel-Buffering', 'no')
  return streamSSE(c, async (stream) => {
    let dirty = true
    let closed = false
    const onChange = () => { dirty = true; wake?.() }
    let wake: (() => void) | null = null
    kitchenBus.on('changed', onChange)
    stream.onAbort(() => { closed = true; kitchenBus.off('changed', onChange); wake?.() })
    try {
      while (!closed) {
        if (dirty) {
          dirty = false
          await stream.writeSSE({ event: 'state', data: JSON.stringify(await kitchenState(db)) })
        }
        // Wait for a change, or 20 s for a heartbeat that keeps proxies from closing the connection.
        const timedOut = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => { wake = null; resolve(true) }, 20_000)
          wake = () => { clearTimeout(timer); wake = null; resolve(false) }
        })
        if (timedOut && !closed && !dirty) await stream.writeSSE({ event: 'ping', data: String(Date.now()) })
      }
    } finally {
      kitchenBus.off('changed', onChange)
    }
  })
})

kitchenApi.post('/bump', async (c) => {
  const b = await c.req.json().catch(() => ({})) as { id?: string }
  if (!b.id || !UUID.test(b.id)) return c.json({ error: 'Which ticket?' }, 400)
  const ok = await bumpTicket(db, b.id, c.get('staff').label)
  return ok ? c.json({ ok: true }) : c.json({ error: 'Already bumped.' }, 409)
})

kitchenApi.post('/recall', async (c) => {
  const b = await c.req.json().catch(() => ({})) as { id?: string }
  if (!b.id || !UUID.test(b.id)) return c.json({ error: 'Which ticket?' }, 400)
  const ok = await recallTicket(db, b.id)
  return ok ? c.json({ ok: true }) : c.json({ error: 'That ticket is already up.' }, 409)
})
