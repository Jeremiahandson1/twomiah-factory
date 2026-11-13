// WHAT LEAVES THE PHONE AT SIGN-OUT (code review 12-2, 2026-11-13).
//
// Signing out took the tokens off the phone and left everything the app had saved for working without signal: the
// care schedule with its clients' names, addresses and care notes, and every page kept for offline reading. On a shared
// phone, or one handed back, that stayed readable in the app's storage after the person had signed out — the read cache
// until someone else signed in, the care schedule for good.
//
// The READ COPIES go at sign-out: they are copies of what the server holds, and come back at the next sign-in. What the
// person has NOT yet been able to send — the queue of saves, a note being written, a signature held for a visit — stays:
// it exists nowhere else, and deleting it would lose their work without a word. It goes when it is sent.
export const READ_COPY_PREFIXES = ['twomiah_care_cache_v2_', 'twomiah_care_downloaded_v1_', 'twomiah_read_cache_v1:'] as const

export interface WipeStore {
  getAllKeys(): Promise<readonly string[]>
  multiRemove(keys: string[]): Promise<void>
}

/** Remove every read copy this app keeps (any signed-in person's). Answers how many keys went; never throws. */
export async function wipeReadCopies(store: WipeStore): Promise<number> {
  try {
    const keys = (await store.getAllKeys()).filter((k) => READ_COPY_PREFIXES.some((p) => k.startsWith(p)))
    if (keys.length) await store.multiRemove(keys)
    return keys.length
  } catch { return 0 }
}
