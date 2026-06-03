/**
 * Offline-aware API helpers — queues mutations when offline.
 */

import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { post as apiPost, put as apiPut, del as apiDel, ApiResponse } from '../api/client'
import { OfflineQueue } from './OfflineQueue'

export function useOfflineApi() {
  const { isOffline } = useNetworkStatus()

  const post = async <T = any>(path: string, body?: any): Promise<ApiResponse<T> & { queued?: boolean }> => {
    if (isOffline) {
      await OfflineQueue.enqueue('POST', path, body)
      return { ok: true, status: 0, data: null as any, queued: true }
    }
    return apiPost<T>(path, body)
  }

  const put = async <T = any>(path: string, body?: any): Promise<ApiResponse<T> & { queued?: boolean }> => {
    if (isOffline) {
      await OfflineQueue.enqueue('PUT', path, body)
      return { ok: true, status: 0, data: null as any, queued: true }
    }
    return apiPut<T>(path, body)
  }

  const del = async <T = any>(path: string): Promise<ApiResponse<T> & { queued?: boolean }> => {
    if (isOffline) {
      await OfflineQueue.enqueue('DELETE', path)
      return { ok: true, status: 0, data: null as any, queued: true }
    }
    return apiDel<T>(path)
  }

  return { post, put, del, isOffline }
}
