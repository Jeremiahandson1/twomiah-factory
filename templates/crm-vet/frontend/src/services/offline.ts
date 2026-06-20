/**
 * Offline Storage Service
 * 
 * Uses IndexedDB for offline data persistence
 * - Cache API responses
 * - Queue offline actions
 * - Sync when back online
 */

const DB_NAME = '{{COMPANY_SLUG}}-offline';
const DB_VERSION = 1;

// Store names
const STORES = {
  CACHE: 'cache',
  PENDING_ACTIONS: 'pending_actions',
  USER_DATA: 'user_data',
};

let db: IDBDatabase | null = null;

/**
 * Initialize the database
 */
export async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Cache store for API responses
      if (!database.objectStoreNames.contains(STORES.CACHE)) {
        const cacheStore = database.createObjectStore(STORES.CACHE, { keyPath: 'key' });
        cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
        cacheStore.createIndex('type', 'type', { unique: false });
      }

      // Pending actions store for offline operations
      if (!database.objectStoreNames.contains(STORES.PENDING_ACTIONS)) {
        const actionsStore = database.createObjectStore(STORES.PENDING_ACTIONS, { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        actionsStore.createIndex('timestamp', 'timestamp', { unique: false });
        actionsStore.createIndex('type', 'type', { unique: false });
      }

      // User data store
      if (!database.objectStoreNames.contains(STORES.USER_DATA)) {
        database.createObjectStore(STORES.USER_DATA, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Get database connection
 */
async function getDB(): Promise<IDBDatabase> {
  if (!db) {
    await initDB();
  }
  return db!;
}

// ============================================
// CACHE OPERATIONS
// ============================================

/**
 * Cache data with optional expiration
 */
export async function cacheData(key: string, data: unknown, { type = 'api', ttl = 3600000 }: { type?: string; ttl?: number } = {}): Promise<Record<string, unknown>> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.CACHE], 'readwrite');
    const store = transaction.objectStore(STORES.CACHE);
    
    const record = {
      key,
      data,
      type,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
    };
    
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get cached data
 */
export async function getCachedData(key: string): Promise<unknown> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.CACHE], 'readonly');
    const store = transaction.objectStore(STORES.CACHE);
    
    const request = store.get(key);
    
    request.onsuccess = () => {
      const record = request.result;
      
      // Check if expired
      if (record && record.expiresAt < Date.now()) {
        // Delete expired record
        deleteCachedData(key);
        resolve(null);
      } else {
        resolve(record?.data || null);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete cached data
 */
export async function deleteCachedData(key: string): Promise<boolean> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.CACHE], 'readwrite');
    const store = transaction.objectStore(STORES.CACHE);
    
    const request = store.delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all cached data
 */
export async function clearCache(): Promise<boolean> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.CACHE], 'readwrite');
    const store = transaction.objectStore(STORES.CACHE);
    
    const request = store.clear();
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear expired cache entries
 */
export async function clearExpiredCache(): Promise<number> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.CACHE], 'readwrite');
    const store = transaction.objectStore(STORES.CACHE);
    const index = store.index('timestamp');
    
    const request = index.openCursor();
    let deleted = 0;
    
    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        if (cursor.value.expiresAt < Date.now()) {
          cursor.delete();
          deleted++;
        }
        cursor.continue();
      } else {
        resolve(deleted);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// PENDING ACTIONS (Offline Queue)
// ============================================

/**
 * Queue an action for later sync
 */
export async function queueAction(action: Record<string, unknown>): Promise<Record<string, unknown>> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.PENDING_ACTIONS], 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_ACTIONS);
    
    const record = {
      ...action,
      timestamp: Date.now(),
      retries: 0,
    };
    
    const request = store.add(record);
    request.onsuccess = () => {
      (record as Record<string, unknown>).id = request.result;
      resolve(record);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pending actions
 */
export async function getPendingActions(): Promise<Record<string, unknown>[]> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.PENDING_ACTIONS], 'readonly');
    const store = transaction.objectStore(STORES.PENDING_ACTIONS);
    
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove a pending action
 */
export async function removePendingAction(id: number): Promise<boolean> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.PENDING_ACTIONS], 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_ACTIONS);
    
    const request = store.delete(id);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update a pending action (e.g., increment retries)
 */
export async function updatePendingAction(id: number, updates: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.PENDING_ACTIONS], 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_ACTIONS);
    
    const getRequest = store.get(id);
    
    getRequest.onsuccess = () => {
      const record = getRequest.result;
      if (record) {
        const updated = { ...record, ...updates };
        const putRequest = store.put(updated);
        putRequest.onsuccess = () => resolve(updated);
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        resolve(null);
      }
    };
    
    getRequest.onerror = () => reject(getRequest.error);
  });
}

/**
 * Clear all pending actions
 */
export async function clearPendingActions(): Promise<boolean> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.PENDING_ACTIONS], 'readwrite');
    const store = transaction.objectStore(STORES.PENDING_ACTIONS);
    
    const request = store.clear();
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// USER DATA
// ============================================

/**
 * Store user data locally
 */
export async function setUserData(key: string, value: unknown): Promise<unknown> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.USER_DATA], 'readwrite');
    const store = transaction.objectStore(STORES.USER_DATA);
    
    const request = store.put({ key, value, updatedAt: Date.now() });
    request.onsuccess = () => resolve(value);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get user data
 */
export async function getUserData(key: string): Promise<unknown> {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.USER_DATA], 'readonly');
    const store = transaction.objectStore(STORES.USER_DATA);
    
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// SYNC UTILITIES
// ============================================

/**
 * Process pending actions when online
 */
interface SyncResults {
  success: number;
  failed: number;
  errors: { action: Record<string, unknown>; error: string }[];
}

export async function syncPendingActions(apiClient: Record<string, unknown>): Promise<SyncResults> {
  const actions = await getPendingActions();
  const results: SyncResults = { success: 0, failed: 0, errors: [] };

  for (const action of actions) {
    try {
      // Execute the action
      await executeAction(action, apiClient);
      await removePendingAction(action.id as number);
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({ action, error: (error as Error).message });
      
      // Update retry count
      await updatePendingAction(action.id as number, {
        retries: (action.retries as number) + 1,
        lastError: (error as Error).message,
      });
    }
  }

  return results;
}

/**
 * Execute a queued action
 */
async function executeAction(action: Record<string, unknown>, apiClient: Record<string, unknown>): Promise<unknown> {
  const { method, url, data } = action;

  switch (method) {
    case 'POST':
      return (apiClient as { post: (url: unknown, data: unknown) => Promise<unknown> }).post(url, data);
    case 'PUT':
      return (apiClient as { put: (url: unknown, data: unknown) => Promise<unknown> }).put(url, data);
    case 'DELETE':
      return (apiClient as { delete: (url: unknown) => Promise<unknown> }).delete(url);
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

/**
 * Check if we're online
 */
export function isOnline(): boolean {
  return navigator.onLine;
}

/**
 * Listen for online/offline events
 */
export function onConnectivityChange(callback: (online: boolean) => void): () => void {
  const onOnline = () => callback(true);
  const onOffline = () => callback(false);

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  // Return cleanup function
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

export default {
  initDB,
  cacheData,
  getCachedData,
  deleteCachedData,
  clearCache,
  clearExpiredCache,
  queueAction,
  getPendingActions,
  removePendingAction,
  updatePendingAction,
  clearPendingActions,
  setUserData,
  getUserData,
  syncPendingActions,
  isOnline,
  onConnectivityChange,
};
