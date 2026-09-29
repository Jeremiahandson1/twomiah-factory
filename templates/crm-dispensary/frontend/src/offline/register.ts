// Turning the offline layer on.
//
// T45 H17: public/sw.js had been in this template all along and nothing ever registered it, so
// "Offline POS enabled" was a claim with no machinery behind it — a reload with no internet could
// not open the register. This is the missing line, plus the flush that empties the sale queue the
// moment the connection comes back.
import api from '../services/api'
import { flush, pendingCount, isOnline } from './queue'

let flushing = false

/**
 * Send whatever is queued. Safe to call often — it does nothing when there is nothing to send, and
 * will not overlap itself.
 */
/** What a sync did, for anyone watching the till. */
export const OFFLINE_SYNC_EVENT = 'offline-sync-result'

export async function flushOfflineQueue(): Promise<void> {
  if (flushing || !isOnline() || pendingCount() === 0) return
  flushing = true
  try {
    const result = await flush((endpoint, body) => api.post(endpoint, body))
    // A sale the server REFUSED is product that left the shop with no sale behind it, and a sale it
    // repriced is a drawer that will not add up. Both used to be swallowed here: the queue emptied,
    // the banner cleared, and nobody at the till knew. Announced so the register can say so, and
    // recorded server-side either way for the Queue tab. (T46 N1)
    if (result.refused.length || result.repriced.length) {
      window.dispatchEvent(new CustomEvent(OFFLINE_SYNC_EVENT, { detail: result }))
    }
  } catch {
    // Still unreachable. The queue keeps everything; the next 'online' event or the next interval
    // tries again. Nothing is lost by failing here.
  } finally {
    flushing = false
  }
}

export function installOfflineSupport(): void {
  if (typeof window === 'undefined') return

  // Empty the queue as soon as the browser says it is back, and once on load in case the tab was
  // closed while something was still held.
  window.addEventListener('online', () => { void flushOfflineQueue() })
  void flushOfflineQueue()

  // A slow reconnect does not always fire an 'online' event, so also check on a gentle timer.
  window.setInterval(() => { void flushOfflineQueue() }, 60_000)

  if (!('serviceWorker' in navigator)) return

  // Only in a built app. Under `vite dev` a service worker caches the dev server's module graph and
  // makes every subsequent edit look like it did not apply.
  if (import.meta.env?.DEV) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // A registration failure must never take the app down with it — the register still works, it
      // just will not survive a reload with no connection.
      console.warn('[offline] service worker did not register:', err?.message || err)
    })
  })

  // The worker wakes the page when the browser grants a background sync; the page owns the session
  // token, so the page is what actually sends.
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'FLUSH_OFFLINE_QUEUE') void flushOfflineQueue()
  })
}
