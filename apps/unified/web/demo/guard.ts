// The lock. Installed before the CRM loads: from then on this page has no way to the network except a read of its own
// recorded data file.
//   fetch / XMLHttpRequest   an /api call is answered by the demo's backend; another address on this site is a clean 404;
//                            an address on any other site is refused, and the visitor is told
//   WebSocket / EventSource  the live connection is a stand-in that never carries anything; any other is refused
//   sendBeacon / window.open / links  nothing leaves: an outside link, mailto:, tel:, sms: and a download from /api are stopped
// The page's Content-Security-Policy (app.html, _headers) forbids the same things a second time, in the browser itself.
import { NOT_AVAILABLE, NOT_SENT, type DemoReply, type DemoRequest } from './router'

export const OUTSIDE = 'Links and calls that leave the demo are turned off.'

export interface GuardOptions {
  respond: (req: DemoRequest) => DemoReply
  notice: (message: string) => void
}

const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Installs the lock and returns the one fetch left over: for the recorded data file, and nothing else. */
export function installGuard(opts: GuardOptions): { readData: (path: string) => Promise<Response> } {
  const realFetch = window.fetch.bind(window)

  async function readBody(req: Request): Promise<unknown> {
    if (req.method === 'GET' || req.method === 'HEAD') return undefined
    const type = req.headers.get('content-type') || ''
    if (type.includes('multipart/form-data')) {
      const fields: Record<string, unknown> = {}
      for (const [k, v] of (await req.clone().formData()).entries()) fields[k] = typeof v === 'string' ? v : (v as File).name
      return fields
    }
    const text = await req.clone().text()
    try { return JSON.parse(text) } catch { return text }
  }

  const guardedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input as RequestInfo, init)
    const url = new URL(req.url, location.href)
    if (url.origin !== location.origin) { opts.notice(OUTSIDE); throw new TypeError('Failed to fetch') }
    if (url.pathname.startsWith('/api/')) {
      const r = opts.respond({ method: req.method, url, body: await readBody(req) })
      return json(r.status, r.body)
    }
    return json(404, { error: NOT_AVAILABLE, code: 'DEMO_UNAVAILABLE' })
  }
  window.fetch = guardedFetch as typeof fetch

  // XMLHttpRequest: the same answers, for the code that still uses it.
  class DemoXhr extends EventTarget {
    readyState = 0; status = 0; statusText = ''; response: unknown = null; responseText = ''; responseType: XMLHttpRequestResponseType = ''
    timeout = 0; withCredentials = false; responseURL = ''
    upload = new EventTarget()
    onload: ((e: Event) => void) | null = null; onerror: ((e: Event) => void) | null = null; onloadend: ((e: Event) => void) | null = null
    onreadystatechange: ((e: Event) => void) | null = null; onprogress: ((e: Event) => void) | null = null; onabort: ((e: Event) => void) | null = null
    private method = 'GET'; private url = ''; private headers = new Headers()
    open(method: string, url: string | URL) { this.method = method; this.url = String(url); this.readyState = 1 }
    setRequestHeader(k: string, v: string) { this.headers.set(k, v) }
    getResponseHeader(k: string) { return k.toLowerCase() === 'content-type' ? 'application/json' : null }
    getAllResponseHeaders() { return 'content-type: application/json\r\n' }
    abort() { this.fire('abort'); this.fire('loadend') }
    overrideMimeType() {}
    send(body?: Document | XMLHttpRequestBodyInit | null) {
      const init: RequestInit = { method: this.method, headers: this.headers }
      if (body != null && this.method !== 'GET' && this.method !== 'HEAD') init.body = body as BodyInit
      guardedFetch(this.url, init).then(async (res) => {
        this.status = res.status; this.statusText = res.statusText; this.readyState = 4
        this.responseText = await res.text()
        this.response = this.responseType === 'json' ? (this.responseText ? JSON.parse(this.responseText) : null) : this.responseText
        this.fire('readystatechange'); this.fire('load'); this.fire('loadend')
      }, () => { this.readyState = 4; this.fire('readystatechange'); this.fire('error'); this.fire('loadend') })
    }
    private fire(type: string) {
      const e = new Event(type)
      this.dispatchEvent(e)
      ;(this as any)[`on${type}`]?.(e)
    }
  }
  ;(window as any).XMLHttpRequest = DemoXhr

  // The live connection: open, and silent. Any other socket is refused.
  class DemoSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
    readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3
    readyState = 0; url: string; protocol = ''; extensions = ''; bufferedAmount = 0; binaryType: BinaryType = 'blob'
    onopen: ((e: Event) => void) | null = null; onclose: ((e: CloseEvent) => void) | null = null; onmessage: ((e: MessageEvent) => void) | null = null; onerror: ((e: Event) => void) | null = null
    constructor(url: string | URL) {
      super()
      const u = new URL(String(url), location.href)
      if (u.host !== location.host || u.pathname !== '/api/live-socket') { opts.notice(OUTSIDE); throw new DOMException('Blocked in the demo', 'SecurityError') }
      this.url = u.href
      setTimeout(() => { this.readyState = 1; const e = new Event('open'); this.dispatchEvent(e); this.onopen?.(e) }, 0)
    }
    send() {}
    close() { if (this.readyState === 3) return; this.readyState = 3; const e = new CloseEvent('close', { code: 1000 }); this.dispatchEvent(e); this.onclose?.(e) }
  }
  ;(window as any).WebSocket = DemoSocket

  // Server-sent events: refused (the demo has none).
  class DemoEventSource extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2
    readyState = 2; url = ''; withCredentials = false
    onopen: ((e: Event) => void) | null = null; onmessage: ((e: MessageEvent) => void) | null = null; onerror: ((e: Event) => void) | null = null
    constructor(url: string | URL) { super(); this.url = String(url); setTimeout(() => { const e = new Event('error'); this.dispatchEvent(e); this.onerror?.(e) }, 0) }
    close() {}
  }
  ;(window as any).EventSource = DemoEventSource

  try { Object.defineProperty(navigator, 'sendBeacon', { value: () => false, configurable: true }) } catch { /* read-only here: the page policy stops it */ }

  const open = window.open.bind(window)
  window.open = ((url?: string | URL, ...rest: unknown[]) => {
    if (url === undefined || url === '' || url === 'about:blank') return (open as any)(url, ...rest)
    const u = new URL(String(url), location.href)
    if (u.origin !== location.origin) { opts.notice(OUTSIDE); return null }
    if (u.pathname.startsWith('/api/')) { opts.notice(NOT_AVAILABLE); return null }
    return (open as any)(url, ...rest)
  }) as typeof window.open

  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return
    const href = a.getAttribute('href') || ''
    const stop = (message: string) => { e.preventDefault(); e.stopPropagation(); opts.notice(message) }
    if (/^(mailto|tel|sms|facetime|callto|whatsapp):/i.test(href)) return stop(NOT_SENT)
    let u: URL
    try { u = new URL(a.href, location.href) } catch { return }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return
    if (u.origin !== location.origin) return stop(OUTSIDE)
    if (u.pathname.startsWith('/api/')) return stop(NOT_AVAILABLE)
  }, true)

  return {
    readData: (path: string) => {
      if (!/^\/demo-data\/[a-z0-9-]+\.json$/.test(path)) throw new Error('Only the recorded data may be read from here.')
      return realFetch(path, { credentials: 'omit', cache: 'no-cache' })
    },
  }
}
