/**
 * The phone's plug for ./readCache.ts: AsyncStorage for the copies, the API client for the read, the signed-in person from
 * OfflineQueue.start. `getSaved(path)` is `get(path)` that falls back to the last good copy when there is no signal.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { get } from '../api/client'
import { createReadCache, type ReadResult } from './readCache'

const cache = createReadCache({ kv: AsyncStorage })
let user: string | null = null

export const setReadCacheUser = (userId: string | null) => {
  if (user && user !== userId) void cache.clear(user).catch(() => {})
  user = userId
}
export const getSaved = <T = any>(path: string): Promise<ReadResult<T>> => cache.read<T>(user, path, () => get<T>(path))

/** "Saved copy from 3:12 PM" — for the line a screen shows when it is reading a kept copy. */
export const savedCopyNote = (savedAt?: string) => {
  const d = savedAt ? new Date(savedAt) : null
  return d && !Number.isNaN(d.getTime()) ? `Saved copy from ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — no signal` : 'Saved copy — no signal'
}
