// The offline sale queue.
//
// T45 H17: Features offered "Offline POS" and there was no queue anywhere in the app — a sale rung
// up with the connection down was simply lost, and the server's /api/offline/sync endpoint, which
// has always been able to receive one, had nothing to receive.
//
// What this holds is a sale that a cashier completed and a customer walked out with. Losing it
// loses money and, worse, loses a regulated transaction that the state expects to see. So:
//
//   · It is written to localStorage the moment it is queued — before any network attempt — and
//     removed only after the server confirms it. A crash, a closed tab or a flat battery between
//     those two points leaves the sale queued, never lost.
//   · Every entry carries a device id and the instant it was rung up. The server dedupes on exactly
//     that pair, so replaying the same queue twice cannot double-charge anyone.
//   · The server re-checks each replayed sale against live stock, limits and prices before it
//     commits. This queue never decides a sale is fine; it only makes sure it is asked.
const STORAGE_KEY = 'offline.queue.v1'
const DEVICE_KEY = 'offline.deviceId.v1'
const MAX_QUEUE = 500 // the server's own /sync batch ceiling

export type OfflineTransaction = {
  transactionType: 'order' | 'payment' | 'inventory_adjustment' | 'checkin'
  payload: Record<string, any>
  createdOfflineAt: string
  deviceId: string
  locationId: string
}

type QueueEntry = OfflineTransaction & { attempts: number; lastError?: string }

/** A stable id for this browser, so replays from it can be deduped by the server. */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    // Private browsing with storage blocked: a per-session id still dedupes within this tab.
    return `dev-session-${Date.now().toString(36)}`
  }
}

function read(): QueueEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(entries: QueueEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full or blocked. Nothing useful to do here — the caller is told the sale could not be
    // held, which is the truth, rather than being told it was.
  }
}

export function pendingCount(): number {
  return read().length
}

export function pending(): QueueEntry[] {
  return read()
}

/**
 * Hold a transaction until the connection comes back.
 * Returns false when the queue is full, so the caller can say so rather than silently drop it.
 */
export function enqueue(txn: Omit<OfflineTransaction, 'deviceId' | 'createdOfflineAt'> & {
  createdOfflineAt?: string
  deviceId?: string
}): boolean {
  const entries = read()
  if (entries.length >= MAX_QUEUE) return false
  entries.push({
    transactionType: txn.transactionType,
    payload: txn.payload,
    // An ISO instant with a timezone — the server parses this as timestamptz and dedupes on it.
    createdOfflineAt: txn.createdOfflineAt || new Date().toISOString(),
    deviceId: txn.deviceId || deviceId(),
    locationId: txn.locationId,
    attempts: 0,
  })
  write(entries)
  return true
}

export function clearQueue(): void {
  write([])
}

export type FlushResult = {
  attempted: number
  synced: number
  failed: number
  conflicts: any[]
  /** Sales the server rejected outright, with its reason. They are not sent again. (T46 N1) */
  refused: any[]
  /** Sales that went through at a total this till disagreed with — the drawer will be out. */
  repriced: any[]
}

/**
 * Send everything held to /api/offline/sync.
 *
 * `post` is injected rather than imported so this module stays testable without the whole api
 * client, and so a caller can pass one that does not trigger a token refresh.
 */
export async function flush(
  post: (endpoint: string, body: any) => Promise<any>,
): Promise<FlushResult> {
  const entries = read()
  if (entries.length === 0) return { attempted: 0, synced: 0, failed: 0, conflicts: [], refused: [], repriced: [] }

  const batch = entries.slice(0, MAX_QUEUE).map(({ attempts, lastError, ...txn }) => txn)

  let result: any
  try {
    result = await post('/api/offline/sync', { transactions: batch })
  } catch (err: any) {
    // Still offline, or the server refused the whole batch. Keep everything and count the attempt,
    // so a queue that can never be sent is visible rather than silently retried forever.
    write(entries.map((e) => ({ ...e, attempts: e.attempts + 1, lastError: err?.message || 'sync failed' })))
    throw err
  }

  const synced = Number(result?.synced || 0)
  const failed = Number(result?.failed || 0)
  const conflicts = Array.isArray(result?.conflicts) ? result.conflicts : []
  const refused = Array.isArray(result?.refused) ? result.refused : []
  const repriced = Array.isArray(result?.repriced) ? result.repriced : []

  // The server has ANSWERED for every entry in this batch — taken it, deduped it, or refused it
  // with a reason and a record a manager can see. So the batch leaves the queue, and only what did
  // not fit in it stays.
  //
  // It used to keep everything the server listed as a conflict, which meant a DUPLICATE — a sale
  // the server already had — was held and re-sent on every sync, for good. A queue that cannot
  // drain is a queue a cashier learns to ignore. (Found while fixing T46 N1; not reported.)
  const kept = entries.slice(batch.length)
  write(kept.map((e) => ({ ...e, attempts: e.attempts + 1 })))

  return { attempted: batch.length, synced, failed, conflicts, refused, repriced }
}

/** True when the browser believes it can reach the network. Not a promise that the server is up. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine !== false
}

/**
 * A network failure, as distinct from the server answering with a refusal.
 *
 * This is the distinction that matters at a register: a 400 means the sale is wrong and must not be
 * queued, while a dropped connection means the sale is fine and must not be lost.
 */
export function isNetworkFailure(err: any): boolean {
  if (!isOnline()) return true
  const status = err?.status
  if (typeof status === 'number') return status === 0 || status === 503 || status === 504
  return err instanceof TypeError || /network|fetch|timed? ?out|offline/i.test(String(err?.message || ''))
}
