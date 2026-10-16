// ONE response path for every staff request in home care — the api client's AND the ~500 raw fetch() calls the screens
// make with a token they read from useAuth() or localStorage. Installed over window.fetch by services/api.ts.
//
// Why it has to sit under fetch itself (Run 3, 10/16):
//   · HIGH 10 — the access token lives an hour. A screen that captured it at render kept sending it after it expired,
//     got 401 on every poll and printed "Failed to load schedule data" / "No caregivers found" until a full reload. The
//     old wrapper (AuthContext, M-05) refreshed the token in the background but still handed the screen its 401, and the
//     screen's next poll sent the same dead token again.
//   · A View As write gets 403 "View As is read-only…", and most screens swallow a failed save: the button said
//     "Saving…" and went back, with nothing on screen.
//   · A cancelled agency gets 402 ACCOUNT_LOCKED from every data route; each screen showed its own "Failed to load".
//
// The rules, for a request to /api/* that carries a token THIS session issued (the current one, or one it held before a
// refresh — never a View As or portal token, which belong to someone else):
//   1. a stale token is replaced by the current one before the request goes;
//   2. a 401 refreshes the session once (single-flight, shared with the api client) and replays the request with the
//      new token — the screen gets the real answer and never sees the 401;
//   3. if the session cannot be refreshed, it has ended: the person is sent to sign in, told why, and the screen's
//      request never settles — so no screen paints an empty list on its way out.
// And for every /api/* response, whoever sent it:
//   4. 402 ACCOUNT_LOCKED → the lock page (unless already there) — for staff. A request sent with a PORTAL's credentials
//      (a family or client portal token, or the client's x-portal-token link) is the portal's: it is told the agency is
//      paused (portalPaused) and stays where it is. The staff lock page means nothing to a relative (Run 4, blocker 3);
//   5. 403 view_as_read_only → the server's own sentence, shown once as a toast.
// Sign-in, refresh and sign-out (/api/auth/login|refresh|logout) pass through untouched: a wrong password is a 401 the
// login form must show, not a session to refresh.

export interface SessionPort {
  /** The access token the session holds now, or null when signed out. */
  current(): string | null
  /** Did this session issue this token (now or before a refresh)? */
  owns(token: string): boolean
  /** Refresh the access token. true = current() is now a fresh token. */
  refresh(): Promise<boolean>
  /** The session cannot be refreshed: clear it and send the person to sign in. Called once per ending. */
  ended(): void
  /** Show a message (the View As refusal). */
  notify(message: string): void
  /** Open the lock page. */
  locked(): void
  /** A portal (family or client) request was refused because the agency is locked: show the portal's "paused" screen. */
  portalPaused(): void
  /** Is the lock page (or a door a locked agency keeps) on screen now? */
  onLockPage(): boolean
}

const PASS_THROUGH = /\/api\/auth\/(login|refresh|logout)(\?|$)/

function urlOf(input: any): string {
  if (typeof input === 'string') return input
  if (input && typeof input.href === 'string') return input.href
  if (input && typeof input.url === 'string') return input.url
  return ''
}

function headersOf(input: any, init?: any): Headers {
  return new Headers(init?.headers ?? (input && typeof input === 'object' && 'headers' in input ? input.headers : undefined))
}

function bearerOf(h: Headers): string | null {
  const v = h.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(v)
  return m ? m[1].trim() : null
}

/** Sent with a family or client portal's credentials, not a staff session's? (The JWT's role claim, read not verified.) */
export function isPortalRequest(h: Headers): boolean {
  if (h.get('x-portal-token')) return true
  const token = bearerOf(h)
  if (!token) return false
  try {
    const part = token.split('.')[1] || ''
    const role = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))?.role
    return role === 'family' || role === 'client'
  } catch {
    return false
  }
}

/** The never-settling answer for a screen whose session has ended: the page is navigating to sign-in. */
const NEVER = () => new Promise<Response>(() => {})

export function createSessionFetch(nativeFetch: (input: any, init?: any) => Promise<Response>, port: SessionPort) {
  let ending = false
  let lastNotice = { text: '', at: 0 }

  const send = (input: any, init: any, headers: Headers, token: string) => {
    headers.set('Authorization', `Bearer ${token}`)
    // A Request object carries its own headers; the init's win, so the token always goes in the init.
    return nativeFetch(input, { ...(init || {}), headers })
  }

  async function notice(res: Response, sentWith: Headers): Promise<void> {
    if (res.status !== 402 && res.status !== 403) return
    const body = await res.clone().json().catch(() => null)
    if (res.status === 402 && body?.code === 'ACCOUNT_LOCKED') {
      if (isPortalRequest(sentWith)) port.portalPaused()
      else if (!port.onLockPage()) port.locked()
      return
    }
    if (res.status === 403 && body?.code === 'view_as_read_only' && body?.error) {
      // A save often fires several writes at once; say it once.
      const now = Date.now()
      if (lastNotice.text !== body.error || now - lastNotice.at > 3000) port.notify(body.error)
      lastNotice = { text: body.error, at: now }
    }
  }

  return async function sessionFetch(input: any, init?: any): Promise<Response> {
    const url = urlOf(input)
    if (!url.includes('/api/') || PASS_THROUGH.test(url)) return nativeFetch(input, init)

    const headers = headersOf(input, init)
    const sent = bearerOf(headers)
    const ours = !!sent && port.owns(sent)
    // A request whose body is a Request object can be read once: keep a copy for the replay.
    const replayable = ours && input && typeof input === 'object' && typeof input.clone === 'function' ? input.clone() : input

    let res: Response
    if (ours) {
      if (ending) return NEVER()
      const now = port.current()
      res = await send(input, init, headers, now && now !== sent ? now : (sent as string))
      if (res.status === 401) {
        const refreshed = await port.refresh()
        const fresh = refreshed ? port.current() : null
        if (fresh) res = await send(replayable, init, headersOf(replayable, init), fresh)
        if (!fresh || res.status === 401) {
          if (!ending) { ending = true; port.ended() }
          return NEVER()
        }
      }
    } else {
      res = await nativeFetch(input, init)
    }
    await notice(res, headers)
    return res
  }
}
