/**
 * Offline Storage Service
 * 
 * Uses IndexedDB for offline data persistence
 * - Cache API responses
 * - Queue offline actions
 * - Sync when back online
 */

const DB_NAME = 'twomiah-build-offline';
const DB_VERSION = 1;

// Store names
const STORES = {
  CACHE: 'cache',
  PENDING_ACTIONS: 'pending_actions',
  USER_DATA: 'user_data',
};

let db = null;

/**
 * Initialize the database
 */
export async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

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
async function getDB() {
  if (!db) {
    await initDB();
  }
  return db;
}

// ============================================
// CACHE OPERATIONS
// ============================================

/**
 * Cache data with optional expiration
 */
export async function cacheData(key, data, { type = 'api', ttl = 3600000 } = {}) {
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
export async function getCachedData(key) {
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
export async function deleteCachedData(key) {
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
export async function clearCache() {
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
export async function clearExpiredCache() {
  const database = await getDB();
  
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORES.CACHE], 'readwrite');
    const store = transaction.objectStore(STORES.CACHE);
    const index = store.index('timestamp');
    
    const request = index.openCursor();
    let deleted = 0;
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
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
export async function queueAction(action) {
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
      record.id = request.result;
      resolve(record);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all pending actions
 */
export async function getPendingActions() {
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
export async function removePendingAction(id) {
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
export async function updatePendingAction(id, updates) {
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
export async function clearPendingActions() {
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
export async function setUserData(key, value) {
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
export async function getUserData(key) {
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
export async function syncPendingActions(apiClient) {
  const actions = await getPendingActions();
  const results = { success: 0, failed: 0, errors: [] };

  for (const action of actions) {
    try {
      // Execute the action
      await executeAction(action, apiClient);
      await removePendingAction(action.id);
      results.success++;
    } catch (error) {
      results.failed++;
      results.errors.push({ action, error: error.message });
      
      // Update retry count
      await updatePendingAction(action.id, { 
        retries: action.retries + 1,
        lastError: error.message,
      });
    }
  }

  return results;
}

/**
 * Execute a queued action
 */
async function executeAction(action, apiClient) {
  const { method, url, data } = action;

  switch (method) {
    case 'POST':
      return apiClient.post(url, data);
    case 'PUT':
      return apiClient.put(url, data);
    case 'DELETE':
      return apiClient.delete(url);
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

/**
 * Check if we're online
 */
export function isOnline() {
  return navigator.onLine;
}

/**
 * Listen for online/offline events
 */
export function onConnectivityChange(callback) {
  window.addEventListener('online', () => callback(true));
  window.addEventListener('offline', () => callback(false));
  
  // Return cleanup function
  return () => {
    window.removeEventListener('online', () => callback(true));
    window.removeEventListener('offline', () => callback(false));
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
