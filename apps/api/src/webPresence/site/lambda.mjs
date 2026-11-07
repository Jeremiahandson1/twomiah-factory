// Netlify runs a function uploaded through the API as a classic (Lambda-style) function: handler(event) → { statusCode, headers, body }.
// These two turn that event into a Request and the Response back, so handler.mjs is plain Request → Response (and testable).
export function toRequest(event) {
  const headers = new Headers()
  for (const [k, v] of Object.entries(event.headers || {})) if (v != null) headers.set(k, String(v))
  const host = headers.get('x-forwarded-host') || headers.get('host') || 'localhost'
  const qs = event.rawQuery ? '?' + event.rawQuery : ''
  const url = 'https://' + host + (event.path || '/') + qs
  const method = String(event.httpMethod || 'GET').toUpperCase()
  const hasBody = event.body != null && event.body !== '' && method !== 'GET' && method !== 'HEAD'
  const body = hasBody ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body, 'utf8')) : undefined
  return new Request(url, { method, headers, body })
}
/**
 * The function's Blobs connection, from the event. `connectLambda` gives only the CACHED edge address, so a read can answer the
 * previous version for up to a minute after a save. When Netlify also sends the uncached address (`url_uncached`, which its own
 * modern-function bootstrap reads from the same payload), it is set too and `fresh` is true: reads can then be strong.
 * Returns { fresh, siteID, deployID }. Never throws: a payload it cannot read leaves the cached connection as it was.
 */
export function blobsContext(event, setContext) {
  const h = (event && event.headers) || {}
  const out = { fresh: false, siteID: h['x-nf-site-id'] || '', deployID: h['x-nf-deploy-id'] || '' }
  try {
    const data = JSON.parse(Buffer.from(String(event.blobs || ''), 'base64').toString('utf8'))
    if (data && typeof data.url_uncached === 'string' && /^https:\/\//.test(data.url_uncached) && data.url && data.token) {
      setContext({ deployID: out.deployID, edgeURL: data.url, uncachedEdgeURL: data.url_uncached, siteID: out.siteID, token: data.token })
      out.fresh = true
    }
  } catch { /* the cached connection stays */ }
  return out
}

/** A store whose every read is strong (the latest write, never an edge's older copy). Writes and everything else are the store's own. */
export function strongReads(store) {
  return new Proxy(store, {
    get(t, p) {
      if (p === 'get' || p === 'getWithMetadata' || p === 'getMetadata') return (k, o = {}) => t[p](k, { ...o, consistency: 'strong' })
      const v = t[p]
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
}

/**
 * Clear this site's cached pages at Netlify's CDN by tag, with the token Netlify hands a Lambda-style function for exactly this
 * (docs: context.clientContext.custom.purge_api_token). Null when either is missing — the caller then keeps pages short-lived.
 */
export function purger(context, siteID, fetchImpl = fetch) {
  const token = context && context.clientContext && context.clientContext.custom && context.clientContext.custom.purge_api_token
  if (!token || !siteID) return null
  return async (tags) => {
    try {
      const r = await fetchImpl('https://api.netlify.com/api/v1/purge', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ site_id: siteID, cache_tags: tags }) })
      return r.ok
    } catch { return false }
  }
}

/** The response back as the event Netlify expects. (The route is the request's path: routes.mjs.) */
export async function fromResponse(res) {
  const headers = {}
  res.headers.forEach((v, k) => { headers[k] = v })
  const type = String(res.headers.get('content-type') || '')
  const text = /^(text\/|application\/(json|xml))/.test(type)
  const buf = Buffer.from(await res.arrayBuffer())
  return { statusCode: res.status, headers, body: text ? buf.toString('utf8') : buf.toString('base64'), isBase64Encoded: !text }
}
