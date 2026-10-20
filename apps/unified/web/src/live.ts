// Live updates in the browser: one connection for the signed-in tab, shared by every screen (server/http/live.ts).
// Signing in is the API's own: POST /api/live/ticket (the session cookie) gives a one-time ticket, the socket opens
// with it. The server closes a socket after 15 minutes (4001) — straight back with a new ticket; anything else backs
// off; and the tab coming back into view reconnects at once. Each message is { event, data } (core/realtime.ts EVENTS
// and a vertical's own, e.g. the bar's 'bar:register').
import { useEffect, useRef, useState } from 'react'
import { api } from './api'

type Listener = (data: unknown) => void
const listeners = new Map<string, Set<Listener>>()
const watchers = new Set<(connected: boolean) => void>()
let socket: WebSocket | null = null
let wanted = false
let retry: ReturnType<typeof setTimeout> | null = null
let attempt = 0
let connected = false

const setConnected = (v: boolean) => { connected = v; for (const w of watchers) w(v) }

function later() {
  if (!wanted || retry) return
  const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5))
  retry = setTimeout(() => { retry = null; void connect() }, wait)
}

async function connect() {
  if (!wanted || socket) return
  let ticket: { ticket?: string; path?: string } | null = null
  try { ticket = await api.post('/api/live/ticket', {}) } catch { /* signed out, or the server is away */ }
  if (!wanted) return
  if (!ticket?.ticket) { later(); return }
  const base = (api.baseUrl || window.location.origin).replace(/^http/, 'ws')
  const ws = new WebSocket(`${base}${ticket.path || '/api/live-socket'}?ticket=${encodeURIComponent(ticket.ticket)}`)
  socket = ws
  ws.onopen = () => { attempt = 0; setConnected(true) }
  ws.onmessage = (m) => {
    let msg: any
    try { msg = JSON.parse(String(m.data)) } catch { return }
    for (const l of listeners.get(msg?.event) || []) { try { l(msg.data) } catch { /* a screen's handler is its own */ } }
  }
  ws.onclose = (e) => {
    if (socket === ws) socket = null
    setConnected(false)
    if (!wanted) return
    if (e.code === 4001) void connect(); else later()
  }
}

const onVisible = () => { if (document.visibilityState === 'visible' && wanted && !socket) { attempt = 0; void connect() } }

/** Keeps the tab's connection open while `signedIn`; returns whether it is connected (the shell's dot). */
export function useLiveConnection(signedIn: boolean): boolean {
  const [on, setOn] = useState(connected)
  useEffect(() => {
    watchers.add(setOn)
    return () => { watchers.delete(setOn) }
  }, [])
  useEffect(() => {
    wanted = signedIn
    if (signedIn) {
      void connect()
      document.addEventListener('visibilitychange', onVisible)
    } else {
      if (retry) { clearTimeout(retry); retry = null }
      socket?.close()
      socket = null
    }
    return () => { document.removeEventListener('visibilitychange', onVisible) }
  }, [signedIn])
  return on
}

/** Runs `onEvent` whenever the server announces `event` while the screen is mounted. */
export function useLiveEvent(event: string, onEvent: Listener) {
  const ref = useRef(onEvent)
  ref.current = onEvent
  useEffect(() => {
    const l: Listener = (d) => ref.current(d)
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event)!.add(l)
    return () => { listeners.get(event)?.delete(l) }
  }, [event])
}

/** Whether the live connection is up (for a screen that polls only when it is not). */
export function useLiveConnected(): boolean {
  const [on, setOn] = useState(connected)
  useEffect(() => { watchers.add(setOn); return () => { watchers.delete(setOn) } }, [])
  return on
}

/** The same, outside a hook: for a shared screen that takes a `subscribe(event, cb)` (the lead inbox). Returns the stop. */
export function subscribeLive(event: string, onEvent: Listener): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event)!.add(onEvent)
  return () => { listeners.get(event)?.delete(onEvent) }
}
