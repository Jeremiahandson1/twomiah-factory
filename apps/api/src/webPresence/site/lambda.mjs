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
/** The query the redirect rules add (?r=api/model) reaches the handler as the Request's own query. */
export async function fromResponse(res) {
  const headers = {}
  res.headers.forEach((v, k) => { headers[k] = v })
  const type = String(res.headers.get('content-type') || '')
  const text = /^(text\/|application\/(json|xml))/.test(type)
  const buf = Buffer.from(await res.arrayBuffer())
  return { statusCode: res.status, headers, body: text ? buf.toString('utf8') : buf.toString('base64'), isBase64Encoded: !text }
}
