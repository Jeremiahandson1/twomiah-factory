import { getAll, putMany, clearStore, getPendingSync, removeSyncItem, updateSyncItem, setLastSync, getLastSync, putItem } from '../lib/offlineDb'
import { api } from './api'

// ─── Download all data for offline use ─────────────────────────────────────────

export async function downloadPricebook(): Promise<{ categories: number; products: number }> {
  const categoriesRes = await api.get<{ data: any[] }>('/api/pricebook/categories')
  const categories = categoriesRes.data || []

  // Store categories with type marker
  const categoryItems = categories.map((c: any) => ({ ...c, _type: 'category' }))
  await clearStore('pricebook')
  await putMany('pricebook', categoryItems)

  const productsRes = await api.get<{ data: any[] }>('/api/pricebook/products')
  const products = productsRes.data || []

  // For each product, fetch ranges and addons and store enriched product
  const enrichedProducts: any[] = []
  for (const product of products) {
    try {
      const [rangesRes, addonsRes] = await Promise.all([
        api.get<{ data: any[] }>(`/api/pricebook/products/${product.id}/ranges`).catch(() => ({ data: [] })),
        api.get<{ data: any[] }>(`/api/pricebook/products/${product.id}/addons`).catch(() => ({ data: [] })),
      ])
      enrichedProducts.push({
        ...product,
        _type: 'product',
        ranges: rangesRes.data || [],
        addons: addonsRes.data || [],
      })
    } catch {
      enrichedProducts.push({ ...product, _type: 'product', ranges: [], addons: [] })
    }
  }
  await putMany('pricebook', enrichedProducts)

  // Update sync meta
  await setLastSync('pricebook', new Date().toISOString())

  return { categories: categories.length, products: enrichedProducts.length }
}

export async function downloadEstimatorData(): Promise<{ products: number }> {
  const res = await api.get<{ data: any[] }>('/api/estimator/products')
  const products = res.data || []

  await clearStore('estimatorData')
  await putMany('estimatorData', products)
  await setLastSync('estimatorData', new Date().toISOString())

  return { products: products.length }
}

export async function downloadSettings(): Promise<void> {
  const settingsRes = await api.get<any>('/api/settings')
  await putItem('settings', { key: 'tenantSettings', ...settingsRes })

  try {
    const profileRes = await api.get<any>('/api/auth/me')
    await putItem('settings', { key: 'repProfile', ...profileRes })
  } catch {
    // Profile fetch is non-critical
  }

  await setLastSync('settings', new Date().toISOString())
}

export async function downloadAll(onProgress?: (msg: string) => void): Promise<void> {
  onProgress?.('Downloading pricebook...')
  const pb = await downloadPricebook()
  onProgress?.(`Cached ${pb.products} products`)

  onProgress?.('Downloading estimator data...')
  const est = await downloadEstimatorData()
  onProgress?.(`Cached ${est.products} estimator products`)

  onProgress?.('Downloading settings...')
  await downloadSettings()

  onProgress?.('Ready for offline use!')
}

// ─── Sync pending queue ────────────────────────────────────────────────────────

export interface SyncResult {
  synced: number
  failed: number
  errors: string[]
}

export async function syncPendingQueue(): Promise<SyncResult> {
  const pending = await getPendingSync()
  if (pending.length === 0) return { synced: 0, failed: 0, errors: [] }

  let synced = 0
  let failed = 0
  const errors: string[] = []

  for (const item of pending) {
    try {
      const options: RequestInit = { method: item.method }
      if (item.body) {
        options.body = item.body
        options.headers = { 'Content-Type': 'application/json' }
      }

      // Use raw fetch to bypass the offline-aware wrapper
      const token = localStorage.getItem('token')
      if (token) {
        options.headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` }
      }

      const res = await fetch(item.url, options)
      if (res.ok) {
        await removeSyncItem(item.id)
        synced++
      } else if (res.status === 409) {
        // Conflict -- server wins, remove from queue
        errors.push(`Conflict on ${item.method} ${item.url}`)
        await removeSyncItem(item.id)
        failed++
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        await updateSyncItem(item.id, { attempts: item.attempts + 1, lastError: err.error })
        failed++
        errors.push(`${item.method} ${item.url}: ${err.error}`)
      }
    } catch (e) {
      await updateSyncItem(item.id, { attempts: item.attempts + 1, lastError: (e as Error).message })
      failed++
      errors.push(`${item.method} ${item.url}: ${(e as Error).message}`)
    }
  }

  return { synced, failed, errors }
}

// ─── Connection monitoring ─────────────────────────────────────────────────────

let onlineCallbacks: (() => void)[] = []

export function onConnectionRestored(callback: () => void) {
  onlineCallbacks.push(callback)
}

export function removeConnectionCallback(callback: () => void) {
  onlineCallbacks = onlineCallbacks.filter((c) => c !== callback)
}

// Init listener
if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    for (const cb of onlineCallbacks) cb()
    // Auto-sync
    await syncPendingQueue()
  })
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

// ─── Get sync age ──────────────────────────────────────────────────────────────

export async function getLastSyncAge(storeName: string): Promise<string> {
  const meta = await getLastSync(storeName)
  if (!meta) return 'never synced'

  const diff = Date.now() - new Date(meta.lastSyncedAt).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`
  return `${Math.floor(diff / 86400000)} days ago`
}

// ─── Pricebook version check ───────────────────────────────────────────────────

export async function checkPricebookVersion(): Promise<boolean> {
  // Compare stored version to server version
  // Return true if needs refresh
  try {
    const res = await fetch('/api/settings', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    })
    const data = await res.json()
    const serverVersion = data.pricebookVersion || '0'
    const local = await getLastSync('pricebook')
    return !local || local.version !== serverVersion
  } catch {
    return false
  }
}
