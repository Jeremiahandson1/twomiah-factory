/**
 * Reading with no signal — pure TypeScript, tested by tests/mobile/read-cache.test.ts.
 *
 * Housecall Pro and ServiceTitan let a tech open a job they had loaded before and read it without signal. This keeps the last
 * good answer of each read (a job, today's jobs, a job's checklists and photos) on the phone, per signed-in person, and gives it
 * back — marked as a saved copy with the time it was saved — only when the read gets NO ANSWER (no signal, a timeout, a gateway
 * error). A refusal (404, 403) is the server's real answer and is never replaced by an old copy. The list is capped, oldest
 * dropped first, and another person on the same phone never sees it.
 */
export interface KV { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }
export interface ReadResult<T = any> { ok: boolean; status: number; data: T; error?: string; fromCache?: boolean; savedAt?: string }
export type Fetcher<T = any> = () => Promise<{ ok: boolean; status: number; data: T; error?: string }>

const NO_ANSWER = new Set([0, 408, 425, 429, 502, 503, 504])
export const MAX_COPIES = 60
const BIG = 400_000

export function createReadCache(deps: { kv: KV; now?: () => number }) {
  const now = deps.now ?? (() => Date.now())
  const indexKey = (user: string) => `twomiah_read_cache_v1:${user}:index`
  const itemKey = (user: string, path: string) => `twomiah_read_cache_v1:${user}:${path}`
  const readIndex = async (user: string): Promise<string[]> => { try { return JSON.parse((await deps.kv.getItem(indexKey(user))) || '[]') } catch { return [] } }

  async function remember(user: string, path: string, data: unknown) {
    let text: string
    try { text = JSON.stringify({ savedAt: new Date(now()).toISOString(), data }) } catch { return }
    if (text.length > BIG) return
    try {
      await deps.kv.setItem(itemKey(user, path), text)
      const index = [path, ...(await readIndex(user)).filter((p) => p !== path)]
      for (const old of index.slice(MAX_COPIES)) await deps.kv.removeItem(itemKey(user, old))
      await deps.kv.setItem(indexKey(user), JSON.stringify(index.slice(0, MAX_COPIES)))
    } catch { /* the phone's storage is full or gone: the read just is not kept */ }
  }

  return {
    /** The read, kept when it works; the kept copy when it gets no answer. `user` null (nobody signed in) keeps nothing. */
    async read<T = any>(user: string | null, path: string, fetcher: Fetcher<T>): Promise<ReadResult<T>> {
      let r: Awaited<ReturnType<Fetcher<T>>>
      try { r = await fetcher() } catch { r = { ok: false, status: 0, data: null as any } }
      if (r.ok) { if (user) await remember(user, path, r.data); return r }
      if (!user || !NO_ANSWER.has(r.status)) return r
      try {
        const kept = JSON.parse((await deps.kv.getItem(itemKey(user, path))) || 'null')
        if (kept && 'data' in kept) return { ok: true, status: 200, data: kept.data, fromCache: true, savedAt: kept.savedAt }
      } catch { /* no usable copy */ }
      return r
    },
    /** Forget everything kept for this person (signing out). */
    async clear(user: string) {
      for (const p of await readIndex(user)) await deps.kv.removeItem(itemKey(user, p))
      await deps.kv.removeItem(indexKey(user))
    },
  }
}
