import { useState, useEffect, useCallback } from 'react'
import { useOffline } from '../../hooks/useOffline'

export function OfflineBanner() {
  const { online, pendingCount, syncing, lastSyncAge, manualSync } = useOffline()
  const [dismissed, setDismissed] = useState(false)
  const [showSynced, setShowSynced] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)

  // Track transitions from offline to online
  useEffect(() => {
    if (!online) {
      setWasOffline(true)
      setDismissed(false)
    }
    if (online && wasOffline && pendingCount === 0 && !syncing) {
      setShowSynced(true)
      const timer = setTimeout(() => {
        setShowSynced(false)
        setWasOffline(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [online, wasOffline, pendingCount, syncing])

  const handleDismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  // Fully synced flash message
  if (showSynced) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-green-600 px-4 py-2 text-sm text-white shadow-md">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        <span>All synced</span>
      </div>
    )
  }

  if (dismissed) return null

  // Offline banner
  if (!online) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-amber-600 px-4 py-2 text-sm text-white shadow-md">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 11-12.728 0M12 9v4m0 4h.01" />
          </svg>
          <span>
            You're offline &mdash; working from local data
            {lastSyncAge !== 'never synced' ? ` (synced ${lastSyncAge})` : ' (not yet synced)'}
          </span>
        </div>
        <button
          onClick={handleDismiss}
          className="ml-4 flex-shrink-0 rounded p-1 hover:bg-amber-700"
          aria-label="Dismiss"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  // Back online with pending items
  if (online && pendingCount > 0) {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between bg-green-600 px-4 py-2 text-sm text-white shadow-md">
        <div className="flex items-center gap-2">
          {syncing ? (
            <>
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span>Back online &mdash; syncing {pendingCount} item{pendingCount !== 1 ? 's' : ''}...</span>
            </>
          ) : (
            <>
              <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{pendingCount} item{pendingCount !== 1 ? 's' : ''} waiting to sync</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!syncing && (
            <button
              onClick={manualSync}
              className="rounded bg-green-700 px-3 py-1 text-xs font-medium hover:bg-green-800"
            >
              Sync now
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 rounded p-1 hover:bg-green-700"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return null
}
