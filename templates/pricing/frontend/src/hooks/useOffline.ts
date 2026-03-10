import { useState, useEffect, useCallback } from 'react'
import { syncPendingQueue, isOnline, onConnectionRestored, removeConnectionCallback, downloadAll, getLastSyncAge } from '../services/syncService'
import { countItems } from '../lib/offlineDb'

export function useOffline() {
  const [online, setOnline] = useState(isOnline())
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncAge, setLastSyncAge] = useState('never')

  // Listen for online/offline events
  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    const refreshCounts = async () => {
      const count = await countItems('syncQueue')
      setPendingCount(count)
      const age = await getLastSyncAge('pricebook')
      setLastSyncAge(age)
    }
    refreshCounts()
    const interval = setInterval(refreshCounts, 30000) // refresh every 30s

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      clearInterval(interval)
    }
  }, [])

  // Auto-sync on reconnect
  useEffect(() => {
    const cb = async () => {
      setSyncing(true)
      await syncPendingQueue()
      const count = await countItems('syncQueue')
      setPendingCount(count)
      setSyncing(false)
    }
    onConnectionRestored(cb)
    return () => removeConnectionCallback(cb)
  }, [])

  const manualSync = useCallback(async () => {
    if (!online) return
    setSyncing(true)
    await syncPendingQueue()
    const count = await countItems('syncQueue')
    setPendingCount(count)
    setSyncing(false)
  }, [online])

  const initOffline = useCallback(async (onProgress?: (msg: string) => void) => {
    await downloadAll(onProgress)
    const age = await getLastSyncAge('pricebook')
    setLastSyncAge(age)
  }, [])

  return { online, pendingCount, syncing, lastSyncAge, manualSync, initOffline }
}
