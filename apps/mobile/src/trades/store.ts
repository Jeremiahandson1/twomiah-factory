/**
 * THE ONLINE STORE — the back-room bench: pack and ship orders, look up and count stock, approve reviews. The shop's takings, refunds,
 * cancelling an order, and every payment key stay on the desktop (no card taking, no refunds on the phone).
 *
 * Words: the phone says "Packed" for the server's `fulfilled` (wording only; the status sent and read is the server's). "Shipped" emails
 * the buyer and cannot be undone, so it asks first. A packer never sees a total: the figures are on the desktop.
 *
 * LABEL BUYING. The server's purchase flow is tested end to end with the carrier stubbed (tests/store-orders.test.ts, `labels`): rates,
 * buy at the chosen rate, tracking stored, one label per order even from two screens, cancelled order refused. Not covered: the live
 * carrier, the carrier failing, no carrier account, a seat without shipping:label. The button ships OFF (below), and when on shows the
 * cost before it buys; turn it off here if a real phone finds a problem. (READY.md, "needs a real phone")
 */
import type { TileDef } from '../home/tiles'
import { type ScreenSpec, type Row, type Action, words, dayOnly, join, money } from './kit'

// OFF (owner, 2026-10-29: untested features stay off): the button is absent, not disabled, until one real label is bought on a live
// carrier account and the price shown matched the charge. Then set this true.
export const LABEL_BUY_ON = false

const STATS = '/api/admin/orders/stats'
const paged = (b: any): number => Number(b?.pagination?.total ?? (Array.isArray(b?.data) ? b.data.length : Array.isArray(b) ? b.length : 0))

export const STORE_TILES: TileDef[] = [
  { id: 'to-pack', label: 'To pack', icon: 'cube', tone: 'warning', any: ['orders:read'], source: STATS, value: (s) => s?.pendingFulfillment,
    opens: 'the paid orders waiting to be packed', list: { path: '/api/admin/orders', query: { tile: 'to_pack' } }, screen: 'trade', spec: 'store-orders', total: paged, banner: 'To pack' },
  { id: 'at-supplier', label: 'At the supplier', icon: 'business', tone: 'info', any: ['orders:read'], source: STATS, value: (s) => s?.atSupplier,
    opens: 'the orders sent on to the supplier', list: { path: '/api/admin/orders', query: { tile: 'at_supplier' } }, screen: 'trade', spec: 'store-orders', total: paged, banner: 'At the supplier' },
  { id: 'orders', label: 'Orders', icon: 'receipt', tone: 'accent', any: ['orders:read'], source: STATS, value: (s) => s?.paidCount,
    opens: 'the orders counted', list: { path: '/api/admin/orders', query: { tile: 'counted' } }, screen: 'trade', spec: 'store-orders', total: paged, banner: 'Orders' },
  { id: 'reviews-to-approve', label: 'Reviews to approve', icon: 'star', tone: 'warning', any: ['reviews:read'], source: STATS, value: (s) => s?.reviewsPending,
    opens: 'the reviews waiting for a decision', list: { path: '/api/admin/reviews', query: { tile: 'pending' } }, screen: 'trade', spec: 'store-reviews', total: paged, banner: 'Reviews to approve' },
]

const ORDER_WORDS: Record<string, string> = {
  pending: 'Not paid yet', paid: 'Paid', fulfilled: 'Packed', shipped: 'Shipped', delivered: 'Delivered',
  ready_for_pickup: 'Ready for pickup', picked_up: 'Picked up', cancelled: 'Cancelled', refunded: 'Refunded',
}
const ORDER_TONE: Record<string, Row['tone']> = { paid: 'warning', fulfilled: 'info', shipped: 'info', delivered: 'success', ready_for_pickup: 'info', picked_up: 'success', cancelled: 'neutral', refunded: 'neutral', pending: 'neutral' }
const orderWord = (s: string) => ORDER_WORDS[s] || words(s)
const addressLines = (a: any) => a ? [a.line1, a.line2, join(a.city, a.state, a.postalCode), a.country].filter(Boolean).join('\n') : undefined
const THE_FLOOR = ['orders:update']
/** Moves the floor makes (the server holds them to its table; the button is offered only where that table allows it). */
const move = (id: string, label: string, icon: string, to: string, from: string[], fulfilments: string[], done: string, confirm?: Action['confirm']): Action => ({
  id, label, icon, any: THE_FLOOR, when: (d) => from.includes(d.status) && fulfilments.includes(d.fulfillment || 'ship'), confirm,
  request: (d) => ({ method: 'PATCH', path: `/api/admin/orders/${d.id}/status`, body: { status: to } }), done,
})
const SHIPPED_WORDS = { title: 'Mark this shipped?', body: (d: any) => `${d.customerEmail ? `${d.customerEmail} is emailed that it is on its way.` : 'The buyer is told it is on its way.'} This cannot be undone from the phone.`, button: 'Mark shipped' }

const labelAction: Action = {
  id: 'buy-label', label: 'Buy a shipping label', icon: 'pricetag', any: ['shipping:label'],
  when: (d) => !!d.shippingAddress && !d.labelUrl && ['paid', 'fulfilled'].includes(d.status) && (d.fulfillment || 'ship') === 'ship',
  confirm: { title: 'Buy a shipping label', body: () => 'This buys a real label and charges your carrier account the price you pick. It marks the order shipped and emails the buyer. It cannot be undone.', button: 'Buy label' },
  inputs: [{ id: 'rate', label: 'Pick a price', required: true, kind: 'choice',
    options: { path: (d) => `/api/admin/shipping/orders/${d.id}/rates`, label: (r) => join(r.carrier, r.service, money(r.amountCents / 100), r.estimatedDays ? `${r.estimatedDays} days` : undefined) || 'Rate', value: (r) => r.id, none: 'No prices came back. Check the carrier account on the desktop.' } }],
  request: (d, v) => ({ method: 'POST', path: `/api/admin/shipping/orders/${d.id}/label`, body: { rateId: v.rate, markShipped: true } }),
  done: 'Label bought · marked shipped',
}

const orderRow = (o: any): Row & { id: string } => ({
  id: o.id, key: o.id, title: o.orderNumber ? `#${String(o.orderNumber).replace(/^#/, '')}` : 'Order', subtitle: join(o.customerName, o.fulfillment === 'pickup' ? 'Pickup' : undefined),
  meta: dayOnly(o.createdAt), badge: orderWord(o.status), tone: ORDER_TONE[o.status],
})

export const STORE: ScreenSpec[] = [
  {
    id: 'store-orders', title: 'Orders', any: ['orders:read'],
    list: { path: '/api/admin/orders' },
    chips: [
      { id: 'to_pack', label: 'To pack', query: { tile: 'to_pack' } }, { id: 'at_supplier', label: 'At the supplier', query: { tile: 'at_supplier' } },
      { id: 'shipped', label: 'Shipped', query: { status: 'shipped' } }, { id: 'counted', label: 'All orders', query: { tile: 'counted' } },
    ],
    rows: orderRow,
    empty: { title: 'Nothing here', body: 'Orders show here as customers check out.' },
    detail: {
      path: (id) => `/api/admin/orders/${id}`,
      title: (d) => (d.orderNumber ? `Order #${String(d.orderNumber).replace(/^#/, '')}` : 'Order'), subtitle: (d) => d.customerName, badge: (d) => orderWord(d.status),
      sections: [
        { title: 'Pack', rows: (d) => (d.items || []).map((i: any) => ({ key: i.id, title: `${i.quantity} × ${i.productName}`, subtitle: join(i.variantName && i.variantName !== 'Default' ? i.variantName : undefined, i.sku) })), empty: 'No items on this order.' },
        { title: 'Ship to', fields: [{ label: 'Name', get: (d) => d.shippingAddress ? d.customerName : undefined }, { label: 'Address', get: (d) => addressLines(d.shippingAddress) }, { label: 'How', get: (d) => (d.fulfillment === 'pickup' ? 'Pickup at the counter' : d.fulfillment === 'digital' ? 'Nothing to send' : 'Post') }] },
        { title: 'Tracking', fields: [{ label: 'Carrier', get: (d) => d.trackingCarrier }, { label: 'Number', get: (d) => d.trackingNumber }, { label: 'Label', get: (d) => (d.labelUrl ? 'Bought' : undefined) }] },
        { title: 'Customer', links: (d) => [d.customerPhone ? { label: `Call ${d.customerPhone}`, url: `tel:${d.customerPhone}`, icon: 'call' } : null, d.customerEmail ? { label: d.customerEmail, url: `mailto:${d.customerEmail}`, icon: 'mail' } : null].filter(Boolean) as any },
      ],
      actions: [
        move('packed', 'Mark packed', 'cube', 'fulfilled', ['paid'], ['ship'], 'Marked packed'),
        move('ready', 'Ready for pickup', 'storefront', 'ready_for_pickup', ['paid'], ['pickup'], 'Marked ready', { title: 'Ready for pickup?', body: (d) => `${d.customerEmail || 'The buyer'} is emailed that it is ready.`, button: 'Tell them' }),
        move('picked-up', 'Picked up', 'checkmark-done', 'picked_up', ['ready_for_pickup'], ['pickup'], 'Marked picked up'),
        { id: 'ship', label: 'Mark shipped with tracking', icon: 'paper-plane', any: THE_FLOOR, when: (d) => ['paid', 'fulfilled'].includes(d.status) && (d.fulfillment || 'ship') === 'ship', confirm: SHIPPED_WORDS,
          inputs: [{ id: 'carrier', label: 'Carrier (USPS, UPS …)', required: true }, { id: 'number', label: 'Tracking number', required: true }],
          request: (d, v) => ({ method: 'PATCH', path: `/api/admin/orders/${d.id}/fulfillment`, body: { trackingCarrier: v.carrier, trackingNumber: v.number, markShipped: true } }), done: 'Marked shipped' },
        ...(LABEL_BUY_ON ? [labelAction] : []),
        move('delivered', 'Mark delivered', 'checkmark-circle', 'delivered', ['shipped'], ['ship'], 'Marked delivered'),
      ],
    },
  },
  {
    id: 'store-stock', title: 'Stock', any: ['products:read'],
    list: { path: '/api/admin/products', query: { limit: '50' } },
    pick: (b) => (b?.data || []).flatMap((p: any) => (p.variants || []).map((v: any) => ({ ...v, productName: p.name }))),
    search: { param: 'q', placeholder: 'Name, SKU or barcode' },
    rows: (v) => ({ id: v.id, key: v.id, title: v.productName || 'Product', subtitle: join(v.name && v.name !== 'Default' ? v.name : undefined, v.sku), badge: v.inventoryQty == null ? 'Not tracked' : `${v.inventoryQty} in stock`, tone: v.inventoryQty == null ? 'neutral' : v.inventoryQty <= 0 ? 'danger' : 'success' }),
    empty: { title: 'Nothing found', body: 'Try the name, the SKU, or the whole barcode number.' },
    detail: {
      path: () => null, title: (d) => d.productName || 'Product', subtitle: (d) => join(d.name !== 'Default' ? d.name : undefined, d.sku),
      sections: [{ fields: [{ label: 'In stock', get: (d) => (d.inventoryQty == null ? 'Not tracked' : String(d.inventoryQty)) }, { label: 'SKU', get: (d) => d.sku }, { label: 'Barcode', get: (d) => d.gtin }] }],
      actions: [{ id: 'count', label: 'Set the count', icon: 'create', any: ['products:update'], when: (d) => d.inventoryQty != null,
        confirm: { title: 'Set the count', body: (d) => `The system says ${d.inventoryQty}. Count what is on the shelf and enter it. If a sale lands first, nothing is saved and you are told.`, button: 'Save count' },
        inputs: [{ id: 'qty', label: 'On the shelf', kind: 'number', required: true }],
        request: (d, v) => ({ method: 'PATCH', path: `/api/admin/products/variants/${d.id}`, body: { inventoryQty: Math.max(0, Math.floor(Number(v.qty) || 0)), inventoryFrom: d.inventoryQty } }), done: 'Count saved' }],
    },
  },
  {
    id: 'store-reviews', title: 'Reviews', any: ['reviews:read'],
    list: { path: '/api/admin/reviews', query: { tile: 'pending' } },
    chips: [{ id: 'pending', label: 'Waiting', query: { tile: 'pending' } }, { id: 'approved', label: 'Approved', query: { status: 'approved' } }, { id: 'rejected', label: 'Rejected', query: { status: 'rejected' } }],
    rows: (r) => ({ id: r.id, key: r.id, title: r.productName || 'Review', subtitle: join(r.authorName, `${r.rating}★`, r.title), meta: dayOnly(r.createdAt), badge: words(r.status), tone: r.status === 'pending' ? 'warning' : r.status === 'approved' ? 'success' : 'neutral' }),
    empty: { title: 'Nothing waiting', body: 'New reviews show here for a decision.' },
    detail: {
      path: () => null, title: (d) => d.productName || 'Review', subtitle: (d) => join(d.authorName, `${d.rating}★`), badge: (d) => words(d.status),
      sections: [{ fields: [{ label: 'Title', get: (d) => d.title }, { label: 'Review', get: (d) => d.body }, { label: 'Bought it', get: (d) => (d.verifiedPurchase ? 'Yes' : 'Not checked') }] }],
      actions: [
        { id: 'approve', label: 'Approve', icon: 'checkmark-circle', any: ['reviews:update'], when: (d) => d.status !== 'approved', request: (d) => ({ method: 'PATCH', path: `/api/admin/reviews/${d.id}`, body: { status: 'approved' } }), done: 'Approved' },
        { id: 'reject', label: 'Reject', icon: 'close-circle', any: ['reviews:update'], when: (d) => d.status !== 'rejected', confirm: { title: 'Reject this review?', body: () => 'It will not show on the website.', button: 'Reject' },
          request: (d) => ({ method: 'PATCH', path: `/api/admin/reviews/${d.id}`, body: { status: 'rejected' } }), done: 'Rejected' },
      ],
    },
  },
]
