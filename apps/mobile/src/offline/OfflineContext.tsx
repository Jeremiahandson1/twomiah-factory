/**
 * Offline context — provides queue state and mutation helpers to the app.
 */

import React, { createContext, useContext, useState, useEffect } from 'react'
import { OfflineQueue, QueuedMutation } from './OfflineQueue'

interface OfflineContextValue {
  pendingCount: number
  isSyncing: boolean
  queue: QueuedMutation[]
  syncNow: () => Promise<void>
  clearQueue: () => Promise<void>
}

const OfflineCtx = createContext<OfflineContextValue>({
  pendingCount: 0,
  isSyncing: false,
  queue: [],
  syncNow: async () => {},
  clearQueue: async () => {},
})

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<QueuedMutation[]>([])
  const [isSyncing, setSyncing] = useState(false)

  useEffect(() => {
    OfflineQueue.init()
    setQueue(OfflineQueue.getQueue())

    return OfflineQueue.subscribe(q => {
      setQueue(q)
      setSyncing(OfflineQueue.isSyncing)
    })
  }, [])

  return (
    <OfflineCtx.Provider value={{
      pendingCount: queue.length,
      isSyncing,
      queue,
      syncNow: () => OfflineQueue.sync(),
      clearQueue: () => OfflineQueue.clear(),
    }}>
      {children}
    </OfflineCtx.Provider>
  )
}

export const useOfflineQueue = () => useContext(OfflineCtx)
