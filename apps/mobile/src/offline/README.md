# Offline queue

Saves made on the phone without signal are kept and sent later, in order. One small API; the rules are in `engine.ts`
(pure TypeScript, tested by `tests/mobile/offline-queue.test.ts`). Use this instead of writing another queue.

```ts
import { OfflineQueue } from '../offline/OfflineQueue'     // the API
import { useOfflineApi } from '../offline/useOfflineApi'   // the same, as a hook for screens
import { useOfflineQueue } from '../offline/OfflineContext' // the state, for lists and banners
```

## Writing

```ts
const { post, put, patch, del } = useOfflineApi()
const r = await post(`/api/jobs/${id}/arrive`, { lat, lng }, { recordKey: `job:${id}`, label: `${job.number} · arrived` })
if (r.queued) showWaiting()          // saved on the phone, will be sent — show it as "waiting to send", never as done
else if (!r.ok) showError(r.error)   // the server refused it: its words are in r.error; nothing was queued
else done(r.data)
```

- **`recordKey`** — items with the same key go one at a time, oldest first. Use one key per thing the saves are about
  (`job:<id>`, `visit:<id>`, `quote:<id>`). Different keys do not wait on each other. Default: the path.
- **`label`** — what a person calls it ("J-12 · arrived"). It is shown in the waiting list.
- A write goes **now** when there is signal and nothing of that record is waiting. If something is waiting it goes behind
  it (never ahead). No answer, 408/425/429/401, 502/503/504 or a 5xx → kept (`queued: true`). A refusal (other 4xx) comes
  straight back to the screen and is not queued.
- Bodies are JSON. Photos and files are not queued yet (see Known limits).

## The four calls

| Call | What it does |
|---|---|
| `OfflineQueue.enqueue(req)` | Keep a save for later, always (no attempt first). Resolves once it is written to the phone. |
| `OfflineQueue.status()` / `subscribe(fn)` / `useOfflineQueue()` | `{ online, sending, waiting, failed, items }`. Each item: `id, method, path, body, recordKey, label, state ('waiting' \| 'sending' \| 'failed'), blocked, tries, lastError, refusal` |
| `OfflineQueue.retry(id, { body? })` · `retryAll()` · `syncNow()` | Try again now. `retry` on a failed item makes it waiting again, optionally with a **corrected body**; `syncNow` skips every wait. |
| `OfflineQueue.discard(id)` | Give it up on purpose. Anything of the same record that waited behind it is released. |

Also `OfflineQueue.submit(req)` (what the hook calls) and `OfflineQueue.start(userId)` (called by `OfflineProvider`).

## What happens to a save

| Server says | Item becomes |
|---|---|
| 2xx | gone |
| **a refusal: 400, 403, 404, 409, 410, 413, 422 …** | **`failed`**, with `refusal = { status, message, fields? }` — the server's own words. Never dropped, never retried on its own. Items behind it on the same record show `blocked: true` and wait. Show it as **"couldn't send — tap to fix"**; `retry(id, { body })` or `discard(id)` |
| no answer, 401, 408, 425, 429, 502, 503, 504 | `waiting`, tried again after 5 s, 10 s, 20 s … up to 5 min. No signal pauses all tries until the wait is over or the connection comes back (then everything goes at once) |
| 500, 501 … | `waiting` with the same waits; after 8 in a row it is reported as `failed` ("The server keeps failing on this") so it is seen |

A waiting item never blocks another record. A failed item blocks only its own record.

## Guarantees and limits

- Every change is written to the phone before it is reported. Closing the app mid-queue is safe: on the next start the
  list is read back, a save that was out at the time is `waiting` again, order is kept, failed saves are still failed.
- The queue is the signed-in person's (`twomiah_offline_queue_v2:<userId>`). Another person on the same phone never
  sees it and nothing is sent with their sign-in.
- **At least once, not exactly once.** If the phone loses the *reply* to a save the server did take, the retry sends it
  again. Each try carries `Idempotency-Key: <item id>` (the same on every try), **but the server does not look at it yet**.
  Until it does: make queued saves safe to repeat (a PUT of the whole value; a status change to a status it is already
  in; a create that carries a client-made id), and say so in the PR of the screen that depends on it.
- JSON only. Queueing a photo needs the file kept on the phone (`expo-file-system`, a native build) and an upload
  transport; the engine takes any `Sender`, so that is an addition to `OfflineQueue.ts`, not to the rules.
- 401 is retried (the API client has already tried to refresh the sign-in); the item says "Signed out".
