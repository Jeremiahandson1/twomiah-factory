# Roofing parity — canvass offline on the phone (gap 11)

**Status: NOT BUILT in this change.** The owner has the field-service session rebuilding the phone's offline queue
(`apps/mobile/src/offline/`), because the current one drops refused replies silently and can hang; nothing under that folder was
touched here. This page records what was confirmed in the code, what the leader says, and exactly what the wiring needs, so it
can be built against the new queue once it exists.

Leader: JobNimbus. Read on 2026-10-30; a point the pages did not state is marked "not stated", never assumed.

Sources
- [How Do I Take, Upload, and Edit Photos?](https://support.jobnimbus.com/how-do-i-take-upload-and-edit-photos)
- [How do I upload photos to a contact in the mobile app](https://support.jobnimbus.com/how-do-i-upload-photos-to-a-contact-in-the-mobile-app)
- [Using JobNimbus's mobile app](https://support.jobnimbus.com/using-jobnimbuss-mobile-app) and the [app page](https://jobnimbus.com/?p=1064)
  — neither says anything about working offline.

## What the leader states

| # | JobNimbus | Twomiah today | Mark |
|---|---|---|---|
| 1 | A photo taken with no data or Wi-Fi "will be cached in your mobile app and will upload as soon as you have wifi or data" — stated for **Android** only; iOS and web not stated | Not built for the canvass: the Canvass screen has no photo capture at all, and nothing queues | **Not built** |
| 2 | Any other offline behaviour (contacts, jobs, notes, documents, signatures) | Not stated on any page read | **Not claimed** |

So the only offline behaviour the leader's own pages state is photos held on the phone and sent later. The gap asks for more —
**canvass stops and photos** — which is the standard to build to.

## What was confirmed in the code (read, not run on a phone)

- `apps/mobile/app/(tabs)/canvass.tsx` sends every session, door and end with `post()` from the api client directly. It does not
  import `useOfflineApi`, `OfflineQueue` or the offline context.
- Nothing in the app calls `useOfflineApi` at all; `OfflineProvider` and `OfflineBanner` are mounted but never given anything to queue.
- The api client's `api()` has no `try/catch` around `fetch`, so with no signal a canvass call **throws** instead of returning a
  failed reply; the screen does not catch it.
- The current `OfflineQueue.sync()` removes any 4xx reply from the queue as if it had been sent — a refused door vanishes.
- The phone's Canvass screen has no photo capture; the desktop page sends up to six damage photos with each door as data URLs in
  the door's `photos` field (the same `POST /api/canvassing/sessions/:id/stops`), so a phone screen calling the same route would send them there.

## What the wiring needs (build against the new queue)

Which canvass requests must queue when there is no signal, or when a send fails with no answer:
1. `POST /api/canvassing/sessions` — starting a session. It needs a **local id**, because the doors that follow name it; the queue
   must swap in the real id once the server answers, in the doors' paths.
2. `POST /api/canvassing/sessions/:id/stops` — every door, **with its photos** (up to six). Photos should stay as the camera's files
   on the phone and be read to data only when the door is sent, so the queue is not megabytes of text in a small key-value store;
   a photo whose file is gone is left off, the door is still sent, and the rep is told.
3. `POST /api/canvassing/sessions/:id/end` — ending, queued **behind** every door still waiting.

What the queue and the screen must do:
- **Order.** First in, first out; a door never goes before its session.
- **A refused reply is shown, not dropped.** A 4xx (other than "sign in again") should move the item to a list the rep sees with the
  server's sentence and a dismiss; a door that names a session that was refused is refused with it. A 401 or no answer keeps
  everything and stops; a 5xx, 408 and 429 retry later.
- **Safe to send twice.** A reply lost on a weak signal means the phone cannot know a door was saved. The server must treat a door
  sent again as the first — the doors and sessions need a client-made key the server remembers (a `clientId`), answered 200 with
  the original on a repeat; and the time the door was knocked (`visitedAt`) and the session began (`startedAt`) must be accepted,
  or a door sent hours later is dated when it syncs. **Neither exists on the server today.** A tested server change for exactly
  this was written and set aside (not committed) when the instruction came to leave the offline folder alone; it is a migration
  adding `client_id` to `canvassing_session` and `canvassing_stop` with a unique index, plus the two times, in
  `server/crm/roof/field/canvassing.ts`, with five server tests. It is held as a patch for the lead.
- **Whose.** A queued item belongs to the signed-in person and is sent only while they are signed in.
- **Survives closing the app.** The open session and its waiting doors are kept on the phone so an offline restart carries on; once
  everything is sent, the screen takes the server's version (real ids, real lead counts).
- **Shows what waits.** "N waiting to send", a "Send now" button, doors marked "waiting to send"; the toast says "Saved on this
  phone" rather than "Lead created", since the lead is made when the door is sent.
- **No card-taking on the phone** (owner decision pending) — unaffected.
- A test in the phone's style (`tests/mobile/*.test.ts`, plain bun, no React Native): the queue's rules with the network, storage
  and photo files as stand-ins — queued while offline, sent in order, local id swapped, a refused item kept and shown, a repeat
  not doubled, another person's items not sent.
