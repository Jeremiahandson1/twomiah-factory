// A stand-in for QuickBooks Online's accounting API — the requests and replies the shared service
// (packages/tenant-backend/src/integrations/quickbooks.ts) already makes and reads, in Intuit's shapes:
//   POST /v3/company/{realm}/customer     { Customer }            → { Customer: { Id, SyncToken, … }, time }
//   GET  /v3/company/{realm}/customer/{id}                        → { Customer: { Id, SyncToken, … }, time }
//   POST /v3/company/{realm}/invoice      { Invoice }             → { Invoice: { Id, SyncToken, DocNumber, TotalAmt, … } }
//   GET  /v3/company/{realm}/invoice/{id}                         → { Invoice }
//   POST /v3/company/{realm}/payment      { Payment }             → { Payment: { Id, SyncToken, TotalAmt, … } }
//   POST oauth.platform.intuit.com/oauth2/v1/tokens/bearer        → { access_token, refresh_token, expires_in, … }
// and its refusals: a ValidationFault (400) with Fault.Error[{ Message, Detail, code }] — a duplicate display name is
// 6240, a stale SyncToken 5010, an unknown reference 2500 — and a 401 AUTHENTICATION fault with lowercase keys, as
// Intuit sends it for an expired or revoked token. Any other address is refused: no test reaches the internet.
type Rec = Record<string, any>

export function createQboMock() {
  const customers = new Map<string, Rec>()
  const invoices = new Map<string, Rec>()
  const payments = new Map<string, Rec>()
  const calls: Array<{ method: string; path: string; body: any }> = []
  let nextId = 100
  let authFails = false
  const id = () => String(++nextId)
  const time = () => new Date().toISOString()
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const validation = (code: string, Message: string, Detail: string) =>
    reply(400, { Fault: { Error: [{ Message, Detail, code, element: '' }], type: 'ValidationFault' }, time: time() })
  const notFound = (what: string, oid: string) => validation('610', 'Object Not Found', `Object Not Found : Something you're trying to use has been made inactive. Check the fields with accounts, customers, items, vendors or employees. ${what} ${oid}`)

  function customer(body: any) {
    const c = body?.Customer
    if (!c?.DisplayName) return validation('2020', 'Required param missing, need to supply the required value for the API', 'Required parameter DisplayName is missing in the request')
    const clash = [...customers.values()].find((x) => x.DisplayName.toLowerCase() === String(c.DisplayName).toLowerCase() && x.Id !== c.Id)
    if (clash) return validation('6240', 'Duplicate Name Exists Error', 'The name supplied already exists. : Another customer, vendor or employee is already using this name. Please use a different name.')
    if (c.Id) {
      const cur = customers.get(String(c.Id))
      if (!cur) return notFound('Customer', c.Id)
      if (String(c.SyncToken) !== cur.SyncToken) return validation('5010', 'Stale Object Error', `Stale Object Error : You and ${'another user'} were working on the same thing.`)
      const next = { ...cur, ...c, Id: cur.Id, SyncToken: String(Number(cur.SyncToken) + 1) }
      customers.set(cur.Id, next)
      return reply(200, { Customer: next, time: time() })
    }
    const made = { ...c, Id: id(), SyncToken: '0', Active: true }
    customers.set(made.Id, made)
    return reply(200, { Customer: made, time: time() })
  }

  function invoice(body: any) {
    const inv = body?.Invoice
    const ref = inv?.CustomerRef?.value
    if (!ref || !customers.has(String(ref))) return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : Something you're trying to use has been made inactive. Customer Id ${ref ?? '(none)'}`)
    if (!Array.isArray(inv.Line) || !inv.Line.length) return validation('6000', 'A business validation error has occurred while processing your request', 'Business Validation Error: You must fill out at least one split line.')
    for (const l of inv.Line) if (l.DetailType !== 'SalesItemLineDetail' || typeof l.Amount !== 'number') return validation('2010', 'Request has invalid or unsupported property', 'Property Name:Line.Amount')
    const total = Math.round(inv.Line.reduce((s: number, l: any) => s + l.Amount, 0) * 100) / 100
    if (inv.Id) {
      const cur = invoices.get(String(inv.Id))
      if (!cur) return notFound('Invoice', inv.Id)
      if (String(inv.SyncToken) !== cur.SyncToken) return validation('5010', 'Stale Object Error', 'Stale Object Error : You and another user were working on the same thing.')
      const next = { ...cur, ...inv, Id: cur.Id, SyncToken: String(Number(cur.SyncToken) + 1), TotalAmt: total }
      invoices.set(cur.Id, next)
      return reply(200, { Invoice: next, time: time() })
    }
    const made = { ...inv, Id: id(), SyncToken: '0', TotalAmt: total, Balance: total }
    invoices.set(made.Id, made)
    return reply(200, { Invoice: made, time: time() })
  }

  function payment(body: any) {
    const p = body?.Payment
    if (!p?.CustomerRef?.value || !customers.has(String(p.CustomerRef.value))) return validation('2500', 'Invalid Reference Id', 'Invalid Reference Id : Customer')
    if (!(typeof p.TotalAmt === 'number' && p.TotalAmt > 0)) return validation('2050', 'Amount is invalid', 'TotalAmt must be greater than 0')
    for (const l of p.Line || []) for (const t of l.LinkedTxn || []) {
      const inv = invoices.get(String(t.TxnId))
      if (t.TxnType !== 'Invoice' || !inv) return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : Invoice ${t.TxnId}`)
      if (String(inv.CustomerRef.value) !== String(p.CustomerRef.value)) return validation('6000', 'A business validation error has occurred while processing your request', 'Business Validation Error: The transaction you linked to belongs to another customer.')
      if (l.Amount > inv.Balance + 0.005) return validation('6000', 'A business validation error has occurred while processing your request', 'Business Validation Error: The payment amount exceeds the open balance.')
      inv.Balance = Math.round((inv.Balance - l.Amount) * 100) / 100
    }
    const made = { ...p, Id: id(), SyncToken: '0' }
    payments.set(made.Id, made)
    return reply(200, { Payment: made, time: time() })
  }

  const fetchMock = async (input: any, init: any = {}): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = String(init.method || 'GET').toUpperCase()
    const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body
    calls.push({ method, path: url.pathname, body })
    if (url.hostname === 'oauth.platform.intuit.com') {
      return reply(200, { access_token: 'access-' + id(), refresh_token: 'refresh-' + id(), expires_in: 3600, x_refresh_token_expires_in: 8726400, token_type: 'bearer' })
    }
    if (url.hostname !== 'quickbooks.api.intuit.com' && url.hostname !== 'sandbox-quickbooks.api.intuit.com') throw new Error(`A test tried to reach ${url.hostname} — refused (no live calls from tests)`)
    if (authFails || !String(init.headers?.Authorization || '').startsWith('Bearer ')) {
      return reply(401, { fault: { error: [{ message: 'message=AuthenticationFailed; errorCode=003200; statusCode=401', detail: 'Token revoked', code: '3200' }], type: 'AUTHENTICATION' }, time: time() })
    }
    const m = /^\/v3\/company\/([^/]+)\/([a-z]+)(?:\/([^/]+))?$/.exec(url.pathname)
    if (!m) return reply(404, { Fault: { Error: [{ Message: 'Unsupported Operation', Detail: url.pathname, code: '500' }], type: 'ValidationFault' } })
    const [, , entity, oid] = m
    const store = entity === 'customer' ? customers : entity === 'invoice' ? invoices : entity === 'payment' ? payments : null
    if (!store) return reply(400, { Fault: { Error: [{ Message: 'Unsupported Operation', Detail: entity, code: '500' }], type: 'ValidationFault' } })
    if (method === 'GET') {
      const rec = oid ? store.get(oid) : null
      if (!rec) return notFound(entity, String(oid))
      return reply(200, { [entity[0].toUpperCase() + entity.slice(1)]: rec, time: time() })
    }
    if (entity === 'customer') return customer(body)
    if (entity === 'invoice') return invoice(body)
    return payment(body)
  }

  return {
    customers, invoices, payments, calls, fetch: fetchMock,
    /** Every request from now on answers 401 (a revoked token), until switched back. */
    revoke(on = true) { authFails = on },
    writes: () => calls.filter((c) => c.method === 'POST' && c.path.startsWith('/v3/')),
  }
}
