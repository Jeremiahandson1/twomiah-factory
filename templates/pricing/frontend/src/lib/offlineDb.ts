const DB_NAME = 'twomiah-price'
const DB_VERSION = 1

export interface SyncQueueItem {
  id: string
  method: string
  url: string
  body: string | null
  createdAt: string
  attempts: number
  lastError: string | null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('pricebook')) db.createObjectStore('pricebook', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('estimatorData')) db.createObjectStore('estimatorData', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('quotes')) db.createObjectStore('quotes', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('estimates')) db.createObjectStore('estimates', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('syncQueue')) db.createObjectStore('syncQueue', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('syncMeta')) db.createObjectStore('syncMeta', { keyPath: 'storeName' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

export async function getById<T>(storeName: string, id: string): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.get(id)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

export async function putItem(storeName: string, item: any): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.put(item)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function putMany(storeName: string, items: any[]): Promise<void> {
  if (items.length === 0) return
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    for (const item of items) {
      store.put(item)
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function deleteItem(storeName: string, id: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function clearStore(storeName: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    store.clear()
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function countItems(storeName: string): Promise<number> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const request = store.count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => db.close()
  })
}

// ─── Sync queue helpers ────────────────────────────────────────────────────────

export async function queueSync(item: Omit<SyncQueueItem, 'id' | 'attempts' | 'lastError'>): Promise<void> {
  const fullItem: SyncQueueItem = {
    ...item,
    id: crypto.randomUUID(),
    attempts: 0,
    lastError: null,
  }
  await putItem('syncQueue', fullItem)
}

export async function getPendingSync(): Promise<SyncQueueItem[]> {
  return getAll<SyncQueueItem>('syncQueue')
}

export async function removeSyncItem(id: string): Promise<void> {
  await deleteItem('syncQueue', id)
}

export async function updateSyncItem(id: string, update: Partial<SyncQueueItem>): Promise<void> {
  const existing = await getById<SyncQueueItem>('syncQueue', id)
  if (!existing) return
  await putItem('syncQueue', { ...existing, ...update })
}

// ─── Sync meta ─────────────────────────────────────────────────────────────────

export async function getLastSync(storeName: string): Promise<{ lastSyncedAt: string; version: string } | null> {
  const meta = await getById<{ storeName: string; lastSyncedAt: string; version: string }>('syncMeta', storeName)
  if (!meta) return null
  return { lastSyncedAt: meta.lastSyncedAt, version: meta.version }
}

export async function setLastSync(storeName: string, version: string): Promise<void> {
  await putItem('syncMeta', {
    storeName,
    lastSyncedAt: new Date().toISOString(),
    version,
  })
}
