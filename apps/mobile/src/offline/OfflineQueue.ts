/**
 * Offline mutation queue — persists failed POST/PUT/DELETE requests
 * to AsyncStorage and replays them in FIFO order when connectivity returns.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { api } from '../api/client'

const STORAGE_KEY = 'twomiah_offline_queue'

export interface QueuedMutation {
  id: string
  method: 'POST' | 'PUT' | 'DELETE'
  path: string
  body?: any
  timestamp: number
}

export type QueueListener = (queue: QueuedMutation[]) => void

let queue: QueuedMutation[] = []
let listeners: QueueListener[] = []
let syncing = false
let initialized = false

function notify() {
  listeners.forEach(fn => fn([...queue]))
}

async function persist() {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

export const OfflineQueue = {
  async init() {
    if (initialized) return
    initialized = true
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)
      if (raw) queue = JSON.parse(raw)
    } catch { /* start fresh */ }

    // Auto-sync when connectivity returns
    NetInfo.addEventListener(state => {
      if (state.isConnected && queue.length > 0 && !syncing) {
        OfflineQueue.sync()
      }
    })
  },

  subscribe(listener: QueueListener) {
    listeners.push(listener)
    return () => { listeners = listeners.filter(l => l !== listener) }
  },

  async enqueue(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: any) {
    const mutation: QueuedMutation = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      method,
      path,
      body,
      timestamp: Date.now(),
    }
    queue.push(mutation)
    await persist()
    notify()
    return mutation
  },

  get pendingCount() { return queue.length },
  get isSyncing() { return syncing },
  getQueue() { return [...queue] },

  async sync() {
    if (syncing || queue.length === 0) return
    syncing = true
    notify()

    while (queue.length > 0) {
      const mutation = queue[0]
      const res = await api(mutation.path, {
        method: mutation.method,
        body: mutation.body ? JSON.stringify(mutation.body) : undefined,
      })

      if (res.ok || (res.status >= 400 && res.status < 500)) {
        // Success or client error (don't retry 4xx) — remove from queue
        queue.shift()
        await persist()
        notify()
      } else {
        // Server error or network failure — stop and retry later
        break
      }
    }

    syncing = false
    notify()
  },

  async clear() {
    queue = []
    await persist()
    notify()
  },
}
