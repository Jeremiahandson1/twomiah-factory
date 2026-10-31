/**
 * The phone's offline queue — the one API screens use. The rules live in ./engine.ts (pure, tested under bun); this file
 * only plugs in the phone: AsyncStorage for the list, the API client to send, NetInfo for the connection.
 * Read ./README.md before using it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { api } from '../api/client'
import { createEngine, type NewItem, type QueueItem, type QueueStatus, type Sender } from './engine'

export type { NewItem, QueueItem, QueueStatus, ItemView, Refusal, Method } from './engine'

/**
 * The API client throws when the request never gets an answer (fetch rejects offline) and answers with the status when
 * it does. 0 means "no answer". `Idempotency-Key` is the item's id, the same on every try — the server may use it to
 * recognise a repeat, and does: the server keeps the first answer and replays it (apps/unified server/http/savedOnce.ts, 10/30).
 */
const send: Sender = async ({ id, method, path, body }) => {
  try {
    const res = await api(path, {
      method,
      headers: { 'Idempotency-Key': id },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, data: res.data }
  } catch {
    return { status: 0 }
  }
}

const engine = createEngine({ kv: AsyncStorage, send })
let unsubscribeNet: (() => void) | null = null
let signedInAs: string | null = null

export const OfflineQueue = {
  /** Call when someone signs in (and with null when they sign out). Their queue is theirs alone. */
  async start(userId: string | null) {
    if (signedInAs === userId && unsubscribeNet) return
    signedInAs = userId
    if (!unsubscribeNet) {
      unsubscribeNet = NetInfo.addEventListener((s) => engine.setOnline(s.isConnected !== false && s.isInternetReachable !== false))
    }
    await engine.load(userId)
  },

  /** Keep a save for later. */
  enqueue: (req: NewItem): Promise<QueueItem> => engine.enqueue(req),
  /** Send now, or keep it if there is no signal. A refusal comes straight back; see README. */
  submit: (req: NewItem) => engine.submit(req),
  status: (): QueueStatus => engine.status(),
  subscribe: (fn: (s: QueueStatus) => void) => engine.subscribe(fn),
  /** Try again now; give `{ body }` to send a corrected save. */
  retry: (id: string, patch?: { body?: unknown }) => engine.retry(id, patch),
  retryAll: () => engine.retryAll(),
  discard: (id: string) => engine.discard(id),
  /** "Send now". */
  syncNow: () => engine.sendNow(),
}
