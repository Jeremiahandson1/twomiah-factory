/**
 * Socket.io WebSocket context — connects to the CRM backend for real-time events.
 * Used for notifications/alerts instead of polling.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth } from '../auth/AuthContext'
import { getAccessToken, getApiUrl } from '../api/client'

interface SocketState {
  connected: boolean
  subscribe: (event: string, callback: (...args: any[]) => void) => () => void
  emit: (event: string, data?: any) => void
}

const SocketContext = createContext<SocketState>({
  connected: false,
  subscribe: () => () => {},
  emit: () => {},
})

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
  ALERT_CREATED: 'alert:created',
  NOTIFICATION: 'notification',
} as const

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const listenersRef = useRef(new Map<string, Set<Function>>())

  useEffect(() => {
    if (!isAuthenticated) {
      if (socket) {
        socket.disconnect()
        setSocket(null)
        setConnected(false)
      }
      return
    }

    const url = getApiUrl()
    const token = getAccessToken()
    if (!url || !token) return

    const s = io(url, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })

    s.on('connect', () => setConnected(true))
    s.on('disconnect', () => setConnected(false))
    s.on('connect_error', (err) => console.warn('[Socket] Error:', err.message))

    setSocket(s)
    return () => { s.disconnect() }
  }, [isAuthenticated])

  const subscribe = useCallback((event: string, callback: (...args: any[]) => void) => {
    if (!socket) return () => {}
    socket.on(event, callback)

    if (!listenersRef.current.has(event)) listenersRef.current.set(event, new Set())
    listenersRef.current.get(event)!.add(callback)

    return () => {
      socket.off(event, callback)
      listenersRef.current.get(event)?.delete(callback)
    }
  }, [socket])

  const emit = useCallback((event: string, data?: any) => {
    if (socket && connected) socket.emit(event, data)
  }, [socket, connected])

  return (
    <SocketContext.Provider value={{ connected, subscribe, emit }}>
      {children}
    </SocketContext.Provider>
  )
}

export const useSocket = () => useContext(SocketContext)

export function useRealTimeEvent(event: string, callback: (...args: any[]) => void, deps: any[] = []) {
  const { subscribe, connected } = useSocket()
  useEffect(() => {
    if (!connected) return
    return subscribe(event, callback)
  }, [connected, subscribe, event, ...deps])
}
