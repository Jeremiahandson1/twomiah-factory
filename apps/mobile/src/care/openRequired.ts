/**
 * What is still open on the visit on screen, reported by the parts of the screen that know (the task list, the in-visit items, the
 * client signature) and read by the Clock out button — which stays greyed until nothing is open. A tiny store, so the parts need no
 * shared parent state. Each part reports under its own key and clears itself when it goes away.
 */
import { useSyncExternalStore } from 'react'

const parts = new Map<string, string[]>()
const listeners = new Set<() => void>()
let snapshot: string[] = []

function rebuild() {
  snapshot = [...parts.values()].flat()
  listeners.forEach((l) => l())
}

/** Report (or, with an empty list, clear) what one part of the screen still needs. */
export function reportOpen(key: string, names: string[]) {
  const had = parts.get(key)
  if (!names.length && !had) return
  if (had && had.length === names.length && had.every((n, i) => n === names[i])) return
  if (names.length) parts.set(key, names); else parts.delete(key)
  rebuild()
}

export const clearOpen = (key: string) => reportOpen(key, [])
export const resetOpen = () => { parts.clear(); rebuild() }

/** Everything still open, in the order the parts reported it. */
export function useOpenRequired(): string[] {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => snapshot, () => snapshot)
}
export const currentOpen = () => snapshot
