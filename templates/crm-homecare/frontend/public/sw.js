/**
 * {{COMPANY_NAME}} Care — Service Worker (sw.js)
 *
 * Responsibilities:
 *   1. Intercept clock-in/out and time entry API calls
 *   2. Queue them in IndexedDB when the device is offline
 *   3. Replay the queue via Background Sync when connection returns
 *   4. Notify the React app via postMessage so the UI updates
 *
 * This service worker is registered by useOfflineSync (hooks/useNative.js).
 */

const CACHE_NAME   = 'homecare-v1';
const DB_NAME      = 'homecare-offline';
const DB_VERSION   = 1;
const STORE_NAME   = 'queue';
const SYNC_TAG     = 'sync-queue';

// API routes that should be queued when offline (caregiver clock-in/out, time entries)
const QUEUEABLE_PATTERNS = [
  /\/api\/time-tracking/,
  /\/api\/evv/,
  /\/api\/scheduling\/.*\/clock/,
];

// ── IndexedDB helpers ──────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function enqueue(request) {
  const db = await openDB();
  const body = await request.text().catch(() => '');
  const entry = {
    id:      crypto.randomUUID(),
    url:     request.url,
    method:  request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    ts:      Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).add(entry);
    req.onsuccess = () => resolve(entry.id);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function dequeue(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readwrite');
    const req = tx.objectStore(STORE_NAME).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function getAllQueued() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Broadcast helpers ──────────────────────────────────────────────────────────

async function broadcast(type, payload = {}) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type, ...payload }));
}

// ── Service worker lifecycle ───────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // Activate immediately without waiting for old SW to become idle
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Take control of all open tabs right away
  event.waitUntil(self.clients.claim());
});

// ── Fetch interception ─────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only intercept mutating requests to queueable API routes
  if (request.method === 'GET') return;
  if (!QUEUEABLE_PATTERNS.some(pattern => pattern.test(request.url))) return;

  event.respondWith(
    fetch(request.clone())
      .catch(async () => {
        // Network failed — queue for later
        const id = await enqueue(request.clone());
        await broadcast('QUEUED', { id });

        // Register background sync so we retry when back online
        if ('sync' in self.registration) {
          await self.registration.sync.register(SYNC_TAG).catch(() => {});
        }

        // Return a synthetic offline response so the app knows what happened
        return new Response(
          JSON.stringify({ queued: true, id, message: 'Saved offline — will sync when reconnected' }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      })
  );
});

// ── Background Sync ────────────────────────────────────────────────────────────

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;

  event.waitUntil(
    replayQueue()
  );
});

async function replayQueue() {
  const entries = await getAllQueued();
  if (!entries.length) return;

  for (const entry of entries) {
    try {
      const response = await fetch(entry.url, {
        method:  entry.method,
        headers: entry.headers,
        body:    entry.body || undefined,
      });

      if (response.ok) {
        await dequeue(entry.id);
        await broadcast('SYNCED', { id: entry.id });
      }
      // If server returns non-ok, leave in queue to retry next sync
    } catch {
      // Still offline — leave in queue, Background Sync will retry
    }
  }
}

// ── Manual sync trigger (for devices without Background Sync API) ──────────────

self.addEventListener('message', (event) => {
  if (event.data?.type === 'TRIGGER_SYNC') {
    event.waitUntil(replayQueue());
  }
});
