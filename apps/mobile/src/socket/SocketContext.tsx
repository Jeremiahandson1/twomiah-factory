/**
 * Live updates from the business's server, so a screen refreshes when a record changes.
 *
 * The unified server sends them over a plain WebSocket (apps/unified/server/http/live.ts — Bun's own; the CRMs used
 * socket.io, which the unified server does not run). To connect: ask POST /api/live/ticket with the normal signed-in
 * client (so an expired access token is refreshed first), then open ws(s)://…/api/live-socket?ticket=… — a one-time
 * ticket good for 30 seconds. Each message is { event, data }. The server closes a socket after 15 minutes (4001);
 * this reconnects with a new ticket, and again whenever the app comes back to the foreground.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { AppState } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { getApiUrl, post } from '../api/client'

interface SocketState {
  connected: boolean
  subscribe: (event: string, callback: (...args: any[]) => void) => () => void
}

const SocketContext = createContext<SocketState>({
  connected: false,
  subscribe: () => () => {},
})

// The server's names (apps/unified/server/core/realtime.ts EVENTS).
export const EVENTS = {
  CONTACT_CREATED: 'contact:created',
  CONTACT_UPDATED: 'contact:updated',
  CONTACT_DELETED: 'contact:deleted',
  JOB_CREATED: 'job:created',
  JOB_UPDATED: 'job:updated',
  JOB_DELETED: 'job:deleted',
  JOB_STATUS_CHANGED: 'job:statusChanged',
  QUOTE_CREATED: 'quote:created',
  QUOTE_UPDATED: 'quote:updated',
  QUOTE_SENT: 'quote:sent',
  QUOTE_APPROVED: 'quote:approved',
  INVOICE_CREATED: 'invoice:created',
  INVOICE_UPDATED: 'invoice:updated',
  INVOICE_SENT: 'invoice:sent',
  INVOICE_PAID: 'invoice:paid',
  PAYMENT_RECEIVED: 'payment:received',
  LEAD_CREATED: 'lead:created',
  LEAD_UPDATED: 'lead:updated',
  REFRESH: 'data:refresh',
  ALERT_CREATED: 'alert:created',
} as const

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [connected, setConnected] = useState(false)
  const listeners = useRef(new Map<string, Set<(...args: any[]) => void>>())

  useEffect(() => {
    if (!isAuthenticated) { setConnected(false); return }
    let ws: WebSocket | null = null
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const later = () => {
      if (stopped || retry) return
      const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5))
      retry = setTimeout(() => { retry = null; void connect() }, wait)
    }

    async function connect() {
      if (stopped || ws) return
      const base = getApiUrl()
      if (!base) return
      const r = await post<{ ticket: string; path: string }>('/api/live/ticket')
      if (stopped) return
      if (!r.ok || !r.data?.ticket) { later(); return }
      const url = base.replace(/^http/, 'ws') + (r.data.path || '/api/live-socket') + '?ticket=' + encodeURIComponent(r.data.ticket)
      const sock = new WebSocket(url)
      ws = sock
      sock.onopen = () => { attempt = 0; setConnected(true) }
      sock.onmessage = (m) => {
        let msg: any
        try { msg = JSON.parse(String(m.data)) } catch { return }
        for (const cb of listeners.current.get(msg?.event) || []) { try { cb(msg.data) } catch { /* a screen's handler is its own */ } }
      }
      sock.onclose = (e) => {
        if (ws === sock) ws = null
        setConnected(false)
        if (stopped) return
        // 4001: the server's time limit — straight back with a new ticket; anything else: back off.
        if (e.code === 4001) void connect(); else later()
      }
      sock.onerror = () => { /* onclose follows */ }
    }

    void connect()
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active' && !ws) { attempt = 0; void connect() } })
    return () => {
      stopped = true
      sub.remove()
      if (retry) clearTimeout(retry)
      ws?.close()
      ws = null
      setConnected(false)
    }
  }, [isAuthenticated])

  const subscribe = useCallback((event: string, callback: (...args: any[]) => void) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set())
    listeners.current.get(event)!.add(callback)
    return () => { listeners.current.get(event)?.delete(callback) }
  }, [])

  return (
    <SocketContext.Provider value={{ connected, subscribe }}>
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => useContext(SocketContext)

/** Runs `callback` whenever the server announces `event` while this screen is mounted. */
export function useRealTimeEvent(event: string, callback: (...args: any[]) => void, deps: any[] = []) {
  const { subscribe } = useSocket()
  useEffect(() => subscribe(event, callback), [subscribe, event, ...deps])
}
