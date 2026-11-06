// A stand-in for QuickBooks Online's accounting API — the requests and replies the shared service
// (packages/tenant-backend/src/integrations/quickbooks.ts) already makes and reads, in Intuit's shapes:
//   POST /v3/company/{realm}/customer     { Customer }            → { Customer: { Id, SyncToken, … }, time }
//   GET  /v3/company/{realm}/customer/{id}                        → { Customer: { Id, SyncToken, … }, time }
//   POST /v3/company/{realm}/invoice      { Invoice }             → { Invoice: { Id, SyncToken, DocNumber, TotalAmt, … } }
//   GET  /v3/company/{realm}/invoice/{id}                         → { Invoice }
//   POST /v3/company/{realm}/payment      { Payment }             → { Payment: { Id, SyncToken, TotalAmt, … } }
//   POST oauth.platform.intuit.com/oauth2/v1/tokens/bearer        → { access_token, refresh_token, expires_in, … }
// and, for the online store's books (server/crm/store/books.ts):
//   GET  /v3/company/{realm}/query?query=select * from Account where Name = 'x'  → { QueryResponse: { Account: [...] } }
//   POST /v3/company/{realm}/account | item | salesreceipt | refundreceipt | deposit → { Account | Item | SalesReceipt | … }
//   (a deposit links receipts one time each and its lines must add up; Undeposited Funds and one bank account exist)
// and its refusals: a ValidationFault (400) with Fault.Error[{ Message, Detail, code }] — a duplicate display name is
// 6240, a stale SyncToken 5010, an unknown reference 2500 — and a 401 AUTHENTICATION fault with lowercase keys, as
// Intuit sends it for an expired or revoked token. Any other address is refused: no test reaches the internet.
type Rec = Record<string, any>

export function createQboMock() {
  const customers = new Map<string, Rec>()
  const invoices = new Map<string, Rec>()
  const payments = new Map<string, Rec>()
  const accounts = new Map<string, Rec>()
  const items = new Map<string, Rec>()
  const salesReceipts = new Map<string, Rec>()
  const refundReceipts = new Map<string, Rec>()
  const deposits = new Map<string, Rec>()
  const calls: Array<{ method: string; path: string; body: any }> = []
  let nextId = 100
  /** Money the roofer's bookkeeper entered against a customer: bills, cheques and card spend (what a Purchase or Bill carries). */
  const spend: Array<{ customerId: string; amount: number; account: string; kind: 'COGS' | 'Expenses' }> = []
  let authFails = false
  const id = () => String(++nextId)
  const time = () => new Date().toISOString()
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const validation = (code: string, Message: string, Detail: string) =>
    reply(400, { Fault: { Error: [{ Message, Detail, code, element: '' }], type: 'ValidationFault' }, time: time() })
  const notFound = (what: string, oid: string) => validation('610', 'Object Not Found', `Object Not Found : Something you're trying to use has been made inactive. Check the fields with accounts, customers, items, vendors or employees. ${what} ${oid}`)

  const money = (n: number) => Math.round(n * 100) / 100
  const addAccount = (a: Rec) => { const made = { Active: true, SyncToken: '0', ...a, Id: id() }; accounts.set(made.Id, made); return made }
  addAccount({ Name: 'Undeposited Funds', AccountType: 'Other Current Asset', AccountSubType: 'UndepositedFunds' })
  addAccount({ Name: 'Checking', AccountType: 'Bank', AccountSubType: 'Checking' })

  function account(body: any) {
    const a = body
    if (!a?.Name || !a?.AccountType) return validation('2020', 'Required param missing, need to supply the required value for the API', 'Name and AccountType are required')
    if ([...accounts.values()].some((x) => x.Name.toLowerCase() === String(a.Name).toLowerCase())) return validation('6240', 'Duplicate Name Exists Error', 'The name supplied already exists.')
    return reply(200, { Account: addAccount(a), time: time() })
  }
  function item(body: any) {
    if (!body?.Name || body.Type !== 'Service') return validation('2020', 'Required param missing, need to supply the required value for the API', 'Name and Type are required')
    const acc = accounts.get(String(body.IncomeAccountRef?.value))
    if (!acc) return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : Account ${body.IncomeAccountRef?.value ?? '(none)'}`)
    if (!['Income', 'Other Current Liability'].includes(acc.AccountType)) return validation('6000', 'A business validation error has occurred while processing your request', 'Business Validation Error: The income account must be an income or liability account.')
    if ([...items.values()].some((x) => x.Name.toLowerCase() === String(body.Name).toLowerCase())) return validation('6240', 'Duplicate Name Exists Error', 'The name supplied already exists.')
    const made = { ...body, Id: id(), SyncToken: '0', Active: true }
    items.set(made.Id, made)
    return reply(200, { Item: made, time: time() })
  }
  /** A sales or refund receipt: a known customer, an account to hold the money, lines that are an item times a quantity. */
  function receipt(kind: 'SalesReceipt' | 'RefundReceipt', body: any) {
    const r = body
    if (!r?.CustomerRef?.value || !customers.has(String(r.CustomerRef.value))) return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : Customer ${r?.CustomerRef?.value ?? '(none)'}`)
    const accountRef = kind === 'SalesReceipt' ? r.DepositToAccountRef : r.RefundFromAccountRef
    if (!accounts.has(String(accountRef?.value))) return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : Account ${accountRef?.value ?? '(none)'}`)
    if (!Array.isArray(r.Line) || !r.Line.length) return validation('6000', 'A business validation error has occurred while processing your request', 'Business Validation Error: You must fill out at least one split line.')
    for (const l of r.Line) {
      if (l.DetailType !== 'SalesItemLineDetail' || typeof l.Amount !== 'number') return validation('2010', 'Request has invalid or unsupported property', 'Property Name:Line.Amount')
      const d = l.SalesItemLineDetail
      if (!items.has(String(d?.ItemRef?.value))) return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : Item ${d?.ItemRef?.value ?? '(none)'}`)
      if (Math.abs(money(d.Qty * d.UnitPrice) - l.Amount) > 0.005) return validation('6000', 'A business validation error has occurred while processing your request', `Business Validation Error: ${l.Description} — quantity times unit price is not the amount.`)
    }
    const total = money(r.Line.reduce((n: number, l: any) => n + l.Amount, 0))
    if (total < 0) return validation('6000', 'A business validation error has occurred while processing your request', 'Business Validation Error: The total cannot be negative.')
    const made = { ...r, Id: id(), SyncToken: '0', TotalAmt: total }
    ;(kind === 'SalesReceipt' ? salesReceipts : refundReceipts).set(made.Id, made)
    return reply(200, { [kind]: made, time: time() })
  }
  function deposit(body: any) {
    const dep = body
    const bank = accounts.get(String(dep?.DepositToAccountRef?.value))
    if (!bank || bank.AccountType !== 'Bank') return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : Account ${dep?.DepositToAccountRef?.value ?? '(none)'}`)
    if (!Array.isArray(dep.Line) || !dep.Line.length) return validation('6000', 'A business validation error has occurred while processing your request', 'Business Validation Error: You must fill out at least one split line.')
    const used = new Set<string>()
    for (const l of dep.Line) {
      for (const t of l.LinkedTxn || []) {
        const src = t.TxnType === 'SalesReceipt' ? salesReceipts.get(String(t.TxnId)) : t.TxnType === 'RefundReceipt' ? refundReceipts.get(String(t.TxnId)) : null
        if (!src) return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : ${t.TxnType} ${t.TxnId}`)
        if (src.depositedIn || used.has(src.Id)) return validation('6000', 'A business validation error has occurred while processing your request', `Business Validation Error: ${t.TxnType} ${src.DocNumber} is already deposited.`)
        const want = t.TxnType === 'SalesReceipt' ? src.TotalAmt : -src.TotalAmt
        if (Math.abs(l.Amount - want) > 0.005) return validation('6000', 'A business validation error has occurred while processing your request', `Business Validation Error: the amount of ${t.TxnType} ${src.DocNumber} is ${want}, not ${l.Amount}.`)
        used.add(src.Id)
      }
      if (!l.LinkedTxn?.length && !accounts.has(String(l.DepositLineDetail?.AccountRef?.value))) return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : Account ${l.DepositLineDetail?.AccountRef?.value ?? '(none)'}`)
    }
    const made = { ...dep, Id: id(), SyncToken: '0', TotalAmt: money(dep.Line.reduce((n: number, l: any) => n + l.Amount, 0)) }
    for (const sid of used) (salesReceipts.get(sid) ?? refundReceipts.get(sid))!.depositedIn = made.Id
    deposits.set(made.Id, made)
    return reply(200, { Deposit: made, time: time() })
  }
  /** select * from <Entity> where <Field> = '<value>' — the one shape the app asks. */
  function query(q: string) {
    const m = /^select \* from (\w+) where (\w+) (=|like) '((?:\\.|[^'])*)'/i.exec(q.trim())
    if (!m) return validation('4000', 'Query parse error', q)
    const [, entity, field, op, raw] = m
    const value = raw.replace(/\\(.)/g, '$1')
    const source = entity === 'Account' ? accounts : entity === 'Item' ? items : entity === 'Customer' ? customers : null
    if (!source) return validation('4000', 'Query parse error', `Unknown entity ${entity}`)
    const rows = [...source.values()].filter((r) => op.toLowerCase() === 'like'
      ? String(r[field]).toLowerCase().includes(value.replace(/%/g, '').toLowerCase())
      : String(r[field]).toLowerCase() === value.toLowerCase())
    return reply(200, { QueryResponse: rows.length ? { [entity]: rows } : {}, time: time() })
  }


  /** Reports/ProfitAndLoss?customer=<id>: that customer's invoices are income, what was entered against them is cost — in QuickBooks' own row shape. */
  function profitAndLoss(params: URLSearchParams) {
    const cid = params.get('customer')
    if (!cid || !customers.has(cid)) return validation('2500', 'Invalid Reference Id', `Invalid Reference Id : Customer ${cid ?? '(none)'}`)
    if (!params.get('start_date') || !params.get('end_date')) return validation('2020', 'Required param missing, need to supply the required value for the API', 'start_date and end_date are required')
    const income = money([...invoices.values()].filter((i) => String(i.CustomerRef?.value) === cid).reduce((n, i) => n + i.TotalAmt, 0))
    const cogs = money(spend.filter((x) => x.customerId === cid && x.kind === 'COGS').reduce((n, x) => n + x.amount, 0))
    const exp = money(spend.filter((x) => x.customerId === cid && x.kind === 'Expenses').reduce((n, x) => n + x.amount, 0))
    const cell = (label: string, v: number) => ({ type: 'Section', Summary: { ColData: [{ value: label }, { value: v.toFixed(2) }] } })
    const rows: any[] = [
      { ...cell('Total Income', income), group: 'Income' },
      { ...cell('Total Cost of Goods Sold', cogs), group: 'COGS' },
      { ...cell('Gross Profit', money(income - cogs)), group: 'GrossProfit' },
      { ...cell('Total Expenses', exp), group: 'Expenses' },
      { ...cell('Net Income', money(income - cogs - exp)), group: 'NetIncome' },
    ]
    return reply(200, { Header: { ReportName: 'ProfitAndLoss', StartPeriod: params.get('start_date'), EndPeriod: params.get('end_date'), Option: [{ Name: 'AccountingMethod', Value: params.get('accounting_method') || 'Accrual' }] }, Columns: { Column: [{ ColTitle: '' }, { ColTitle: 'Total' }] }, Rows: { Row: rows }, time: time() })
  }

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
    if (entity === 'query' && method === 'GET') return query(url.searchParams.get('query') || '')
    if (method === 'POST' && entity === 'account') return account(body)
    if (method === 'POST' && entity === 'item') return item(body)
    if (method === 'POST' && entity === 'salesreceipt') return receipt('SalesReceipt', body?.SalesReceipt)
    if (method === 'POST' && entity === 'refundreceipt') return receipt('RefundReceipt', body?.RefundReceipt)
    if (method === 'POST' && entity === 'deposit') return deposit(body?.Deposit)
    if (method === 'GET' && entity === 'reports' && oid === 'ProfitAndLoss') return profitAndLoss(url.searchParams)
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
    customers, invoices, payments, accounts, items, salesReceipts, refundReceipts, deposits, spend, calls, fetch: fetchMock,
    /** A second bank account, so the owner has to choose. */
    addBank(name: string) { return addAccount({ Name: name, AccountType: 'Bank', AccountSubType: 'Savings' }) },
    /** Every request from now on answers 401 (a revoked token), until switched back. */
    revoke(on = true) { authFails = on },
    writes: () => calls.filter((c) => c.method === 'POST' && c.path.startsWith('/v3/')),
  }
}
