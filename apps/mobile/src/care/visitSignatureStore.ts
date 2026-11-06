/**
 * The client's signature for a visit, kept on the phone as soon as it is taken (so a restart or a lost signal loses nothing) until the
 * visit is clocked out — the clock-out sends it with the punch (see CareContext.clockOut), and it is also sent right away when the
 * visit already has a server id. Keyed by the visit id (a saved-offline visit has a local id).
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { PendingSignature } from './rules'

const KEY = (visitId: string) => `twomiah_care_visit_signature_${visitId}_v1`
const memory = new Map<string, PendingSignature>()

export async function loadPending(visitId: string): Promise<PendingSignature | null> {
  if (memory.has(visitId)) return memory.get(visitId)!
  try {
    const raw = await AsyncStorage.getItem(KEY(visitId))
    const p = raw ? JSON.parse(raw) : null
    if (p && typeof p === 'object' && (p.signature || p.reasonCode) && typeof p.savedAt === 'string') { memory.set(visitId, p); return p }
  } catch { /* nothing kept */ }
  return null
}
export const peekPending = (visitId: string) => memory.get(visitId) ?? null

export async function savePending(visitId: string, p: PendingSignature): Promise<void> {
  memory.set(visitId, p)
  try { await AsyncStorage.setItem(KEY(visitId), JSON.stringify(p)) } catch { /* kept in memory for this session */ }
}

export async function clearPending(visitId: string): Promise<void> {
  memory.delete(visitId)
  try { await AsyncStorage.removeItem(KEY(visitId)) } catch { /* nothing to clear */ }
}
