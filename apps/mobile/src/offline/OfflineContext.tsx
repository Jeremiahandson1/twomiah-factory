/**
 * Offline context — the queue's state for screens (the banner, the "waiting to send" list). The queue is the signed-in
 * person's: it is started with their id and switched off when they sign out (./OfflineQueue.ts).
 */

import React, { createContext, useContext, useState, useEffect } from 'react'
import { OfflineQueue, type QueueStatus, type ItemView } from './OfflineQueue'
import { useAuth } from '../auth/AuthContext'

interface OfflineContextValue {
  /** Saves waiting for signal or a retry. */
  pendingCount: number
  /** Saves the server refused: they stay until someone fixes or discards them. */
  failedCount: number
  isSyncing: boolean
  queue: ItemView[]
  syncNow: () => Promise<void>
  retry: (id: string, patch?: { body?: unknown }) => Promise<boolean>
  retryAll: () => Promise<number>
  discard: (id: string) => Promise<boolean>
}

const EMPTY: QueueStatus = { online: true, sending: false, waiting: 0, failed: 0, items: [] }

const OfflineCtx = createContext<OfflineContextValue>({
  pendingCount: 0, failedCount: 0, isSyncing: false, queue: [],
  syncNow: async () => {}, retry: async () => false, retryAll: async () => 0, discard: async () => false,
})

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const userId = (user as { id?: string } | null)?.id ?? null
  const [status, setStatus] = useState<QueueStatus>(EMPTY)

  useEffect(() => {
    const off = OfflineQueue.subscribe(setStatus)
    void OfflineQueue.start(userId).then(() => setStatus(OfflineQueue.status()))
    return off
  }, [userId])

  return (
    <OfflineCtx.Provider value={{
      pendingCount: status.waiting,
      failedCount: status.failed,
      isSyncing: status.sending,
      queue: status.items,
      syncNow: () => OfflineQueue.syncNow(),
      retry: OfflineQueue.retry,
      retryAll: OfflineQueue.retryAll,
      discard: OfflineQueue.discard,
    }}>
      {children}
    </OfflineCtx.Provider>
  )
}

export const useOfflineQueue = () => useContext(OfflineCtx)
