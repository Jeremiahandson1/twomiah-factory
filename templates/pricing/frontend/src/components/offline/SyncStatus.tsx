import { useState, useCallback } from 'react'
import { useOffline } from '../../hooks/useOffline'
import { downloadAll, getLastSyncAge, syncPendingQueue } from '../../services/syncService'
import { getPendingSync, type SyncQueueItem } from '../../lib/offlineDb'

export function SyncStatus() {
  const { online, pendingCount, syncing, lastSyncAge, manualSync } = useOffline()
  const [showDetails, setShowDetails] = useState(false)
  const [pendingItems, setPendingItems] = useState<SyncQueueItem[]>([])
  const [storeAges, setStoreAges] = useState<Record<string, string>>({})
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState('')

  const toggleDetails = useCallback(async () => {
    if (!showDetails) {
      // Load details when opening
      const [items, pbAge, estAge, settingsAge] = await Promise.all([
        getPendingSync(),
        getLastSyncAge('pricebook'),
        getLastSyncAge('estimatorData'),
        getLastSyncAge('settings'),
      ])
      setPendingItems(items)
      setStoreAges({
        pricebook: pbAge,
        estimatorData: estAge,
        settings: settingsAge,
      })
    }
    setShowDetails((prev) => !prev)
  }, [showDetails])

  const handleRedownload = useCallback(async () => {
    if (!online) return
    setDownloading(true)
    try {
      await downloadAll((msg) => setDownloadProgress(msg))
    } catch (e) {
      setDownloadProgress('Download failed')
    }
    setDownloading(false)
  }, [online])

  // Dot color
  let dotColor = 'bg-green-500'
  let label = 'Synced'
  if (!online) {
    dotColor = 'bg-red-500'
    label = 'Offline'
  } else if (pendingCount > 0) {
    dotColor = 'bg-amber-500'
    label = `${pendingCount} pending`
  }

  return (
    <div className="relative">
      {/* Compact indicator */}
      <button
        onClick={toggleDetails}
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
        <span>{label}</span>
      </button>

      {/* Details panel */}
      {showDetails && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">Sync Status</h3>
            <button
              onClick={() => setShowDetails(false)}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Connection status */}
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={online ? 'text-green-700' : 'text-red-700'}>
              {online ? 'Connected' : 'No connection'}
            </span>
          </div>

          {/* Last sync times */}
          <div className="mb-3 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Last synced</p>
            <div className="space-y-1 text-sm text-gray-600">
              <div className="flex justify-between">
                <span>Pricebook</span>
                <span className="text-gray-400">{storeAges.pricebook || lastSyncAge}</span>
              </div>
              <div className="flex justify-between">
                <span>Estimator</span>
                <span className="text-gray-400">{storeAges.estimatorData || 'never synced'}</span>
              </div>
              <div className="flex justify-between">
                <span>Settings</span>
                <span className="text-gray-400">{storeAges.settings || 'never synced'}</span>
              </div>
            </div>
          </div>

          {/* Pending items */}
          {pendingItems.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
                Pending ({pendingItems.length})
              </p>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {pendingItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded bg-gray-50 px-2 py-1 text-xs">
                    <span className="truncate text-gray-700">
                      {item.method} {new URL(item.url, window.location.origin).pathname}
                    </span>
                    {item.attempts > 0 && (
                      <span className="ml-1 flex-shrink-0 text-amber-600" title={item.lastError || ''}>
                        {item.attempts}x
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Download progress */}
          {downloading && (
            <div className="mb-3 rounded bg-blue-50 px-3 py-2 text-xs text-blue-700">
              {downloadProgress || 'Preparing download...'}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={manualSync}
              disabled={!online || syncing || pendingCount === 0}
              className="flex-1 rounded-md bg-orange-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button
              onClick={handleRedownload}
              disabled={!online || downloading}
              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloading ? 'Downloading...' : 'Re-download'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
