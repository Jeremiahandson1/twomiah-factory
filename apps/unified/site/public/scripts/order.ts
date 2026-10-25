// Pickup ordering on the business's website (/order and /order/done; views/sections/order), served at /scripts/order.js.
// Dependency-free. It reads what can be ordered and when from /api/public/food/ordering, keeps the cart in this browser
// (blocked storage just means the cart is not remembered), and sends the order to /api/public/food/orders, which
// prices it again on the server and answers with the Stripe Checkout page on the business's own account. Back from
// paying, /order/done asks /api/public/food/orders/confirm whether the payment came in.
(function () {
  'use strict'
  type Size = { id: string; name: string; priceCents: number | null }
  type Mod = { id: string; name: string; priceCents: number }
  type Item = { id: string; name: string; is86ed: boolean; description?: string | null; imageUrl?: string | null; sizes: Size[]; modifiers?: Mod[] }
  type Section = { id: string; name: string; items: Item[] }
  type Line = { itemId: string; sizeId: string; modIds: string[]; qty: number; name: string; detail: string; eachCents: number }
  type Answer = { offered: boolean; open: boolean; reason: string | null; slots: Array<{ at: string; label: string }>; delivery: Array<{ company: string; name: string; url: string }>; menu: Section[]; taxRateBps: number; business: { name: string; phone: string | null } }

  const KEY = 'order-cart'
  const money = (c: number) => { const v = Math.abs(Math.round(c)); return (c < 0 ? '−' : '') + '$' + Math.floor(v / 100).toLocaleString('en-US') + '.' + String(v % 100).padStart(2, '0') }
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch])
  const taxOn = (sub: number, bps: number) => Math.floor((sub * bps + 5000) / 10000)
  const read = (): Line[] => { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : [] } catch { return [] } }
  const save = (c: Line[]) => { try { localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* not remembered */ } }

  async function done(box: HTMLElement) {
    const sid = box.getAttribute('data-session') || ''
    try {
      const r = await fetch('/api/public/food/orders/confirm?session_id=' + encodeURIComponent(sid), { headers: { accept: 'application/json' } })
      const j = await r.json()
      if (!r.ok) { box.innerHTML = '<h1>We could not find that order</h1><p>If you paid, call us and we will sort it out.</p>'; return }
      const o = j.order
      if (o.status === 'awaiting_payment') { box.innerHTML = '<h1>We have not received your payment yet</h1><p>If you just paid, refresh this page in a minute. If you did not finish paying, nothing was charged.</p>'; return }
      save([])
      const lines = o.lines.map((l: any) => `<li>${l.qty} × ${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}${l.note ? ' — ' + esc(l.note) : ''}</li>`).join('')
      box.innerHTML = `<h1>Thanks${o.name ? ', ' + esc(o.name) : ''}! Order #${esc(o.number)}</h1>${o.pickup ? `<p>Pickup about <strong>${esc(o.pickup)}</strong>. We will let you know when it is ready.</p>` : ''}<ul>${lines}</ul><p>Total paid: <strong>${money(o.totalCents)}</strong></p>`
    } catch { box.innerHTML = '<p>We could not check your payment. Refresh this page in a minute.</p>' }
  }

  async function page(root: HTMLElement) {
    let a: Answer
    try {
      const r = await fetch('/api/public/food/ordering', { headers: { accept: 'application/json' } })
      if (!r.ok) { root.innerHTML = '<p class="order-muted">We are not taking orders online. Call us to order.</p>'; return }
      a = await r.json()
    } catch { root.innerHTML = '<p class="order-muted">The menu did not load. Refresh to try again.</p>'; return }
    const delivery = document.getElementById('order-delivery')
    if (delivery && a.delivery.length) {
      delivery.innerHTML = a.delivery.map((d) => `<a class="btn" href="${esc(d.url)}" target="_blank" rel="noopener">Order on ${esc(d.name)}</a>`).join('')
      delivery.hidden = false
    }
    if (!a.offered) { root.innerHTML = a.delivery.length ? '' : '<p class="order-muted">We are not taking orders online. Call us to order.</p>'; return }
    const items = new Map<string, Item>()
    for (const s of a.menu) for (const i of s.items) items.set(i.id, i)
    let cart = read().filter((l) => items.has(l.itemId))
    let section = a.menu[0]?.id || ''
    let error = ''
    let busy = false

    function render() {
      // What the guest typed survives a redraw (a quantity changed, an error shown).
      const old = document.getElementById('order-form') as HTMLFormElement | null
      const kept: Record<string, string | boolean> = {}
      if (old) for (const n of ['name', 'phone', 'email', 'pickupAt', 'smsConsent']) { const el = old.elements.namedItem(n) as HTMLInputElement | null; if (el) kept[n] = el.type === 'checkbox' ? el.checked : el.value }
      draw()
      const fresh = document.getElementById('order-form') as HTMLFormElement | null
      if (fresh) for (const [n, val] of Object.entries(kept)) { const el = fresh.elements.namedItem(n) as HTMLInputElement | null; if (el) { if (el.type === 'checkbox') el.checked = !!val; else el.value = String(val) } }
    }
    function draw() {
      const sub = cart.reduce((n, l) => n + l.qty * l.eachCents, 0)
      const tax = taxOn(sub, a.taxRateBps)
      const sec = a.menu.find((s) => s.id === section)
      const closed = !a.open ? `<div class="order-closed" role="status"><strong>${esc(a.reason || 'We are not taking online orders right now.')}</strong>${a.business.phone ? ` <span>Call ${esc(a.business.phone)}.</span>` : ''}</div>` : ''
      const tabs = a.menu.map((s) => `<button type="button" class="order-tab" role="tab" aria-selected="${s.id === section}" data-tab="${esc(s.id)}">${esc(s.name)}</button>`).join('')
      const grid = (sec?.items || []).map((i) => {
        const from = Math.min(...i.sizes.map((z) => z.priceCents || 0))
        return `<button type="button" class="order-item" data-item="${esc(i.id)}" ${i.is86ed || !a.open ? 'disabled' : ''}>${i.imageUrl ? `<img class="order-item__img" src="${esc(i.imageUrl)}" alt="" loading="lazy">` : ''}<span class="order-item__name">${esc(i.name)}</span>${i.description ? `<span class="order-item__desc">${esc(i.description)}</span>` : ''}<span>${i.is86ed ? 'Sold out' : (i.sizes.length > 1 ? 'from ' : '') + money(from)}</span></button>`
      }).join('')
      const lines = cart.map((l, n) => `<li><div class="order-line"><span>${esc(l.name)}${l.detail ? `<small>${esc(l.detail)}</small>` : ''}</span><span>${money(l.qty * l.eachCents)}</span></div><div class="order-qty"><button type="button" data-less="${n}" aria-label="One fewer ${esc(l.name)}">−</button><span>${l.qty}</span><button type="button" data-more="${n}" aria-label="One more ${esc(l.name)}">+</button></div></li>`).join('')
      const consent = (document.getElementById('order-consent') as HTMLTemplateElement | null)?.innerHTML || ''
      const form = a.open && cart.length ? `<form class="order-form" id="order-form" novalidate>
        <label>Your name<input name="name" autocomplete="name" required maxlength="40"></label>
        <label>Mobile<input name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="30"></label>
        <label>Email<input name="email" type="email" autocomplete="email" maxlength="200"></label>
        <label>Pickup time<select name="pickupAt">${a.slots.map((s) => `<option value="${esc(s.at)}">${esc(s.label)}</option>`).join('')}</select></label>
        ${consent}
        ${error ? `<p class="order-error" role="alert">${esc(error)}</p>` : ''}
        <button type="submit" class="btn btn--primary" ${busy ? 'disabled' : ''}>${busy ? 'Opening the payment page…' : 'Pay ' + money(sub + tax)}</button>
        <p class="order-muted">You pay by card on a secure Stripe page. We ask for a phone or an email to tell you when it is ready.</p>
      </form>` : ''
      root.innerHTML = `${closed}<div class="order-layout"><div><div class="order-tabs" role="tablist">${tabs}</div><div class="order-items">${grid}</div></div>
        <aside class="order-cart" aria-label="Your order"><h2>Your order</h2>${cart.length ? `<ul>${lines}</ul>` : '<p class="order-muted">Nothing yet.</p>'}
        <div class="order-sum"><span>Subtotal</span><span>${money(sub)}</span></div><div class="order-sum"><span>Tax</span><span>${money(tax)}</span></div><div class="order-sum order-total"><span>Total</span><span>${money(sub + tax)}</span></div>${form}</aside></div>`
    }

    function sheet(item: Item) {
      let size = item.sizes[0]
      const mods: string[] = []
      let qty = 1
      const box = document.createElement('div')
      box.className = 'order-sheet'
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', item.name)
      const each = () => (size.priceCents || 0) + (item.modifiers || []).filter((m) => mods.includes(m.id)).reduce((n, m) => n + m.priceCents, 0)
      const draw = () => {
        box.innerHTML = `<div class="order-sheet__box"><h2>${esc(item.name)}</h2>${item.description ? `<p>${esc(item.description)}</p>` : ''}
          ${item.sizes.length > 1 ? '<p><strong>Size</strong></p>' + item.sizes.map((s) => `<button type="button" class="order-opt" role="radio" aria-checked="${s.id === size.id}" data-size="${esc(s.id)}"><span>${esc(s.name)}</span><span>${money(s.priceCents || 0)}</span></button>`).join('') : ''}
          ${(item.modifiers || []).length ? '<p><strong>Make it yours</strong></p>' + (item.modifiers || []).map((m) => `<button type="button" class="order-opt" aria-pressed="${mods.includes(m.id)}" data-mod="${esc(m.id)}"><span>${esc(m.name)}</span><span>${m.priceCents ? '+' + money(m.priceCents) : ''}</span></button>`).join('') : ''}
          <div class="order-qty"><button type="button" data-q="-1" aria-label="One fewer">−</button><span>${qty}</span><button type="button" data-q="1" aria-label="One more">+</button></div>
          <div class="order-sheet__actions"><button type="button" class="order-sheet__cancel" data-close>Cancel</button><button type="button" class="order-sheet__add" data-add>Add · ${money(each() * qty)}</button></div></div>`
      }
      box.addEventListener('click', (e) => {
        const t = e.target as HTMLElement
        if (t === box || t.closest('[data-close]')) { box.remove(); return }
        const s = t.closest('[data-size]'); if (s) { size = item.sizes.find((z) => z.id === s.getAttribute('data-size')) || size; draw(); return }
        const m = t.closest('[data-mod]'); if (m) { const id = m.getAttribute('data-mod') || ''; const k = mods.indexOf(id); if (k >= 0) mods.splice(k, 1); else mods.push(id); draw(); return }
        const q = t.closest('[data-q]'); if (q) { qty = Math.max(1, Math.min(20, qty + Number(q.getAttribute('data-q')))); draw(); return }
        if (t.closest('[data-add]')) {
          const picked = (item.modifiers || []).filter((x) => mods.includes(x.id))
          const detail = [item.sizes.length > 1 ? size.name : '', ...picked.map((x) => x.name)].filter(Boolean).join(' · ')
          cart.push({ itemId: item.id, sizeId: size.id, modIds: picked.map((x) => x.id), qty, name: item.name, detail, eachCents: each() })
          save(cart); box.remove(); render()
        }
      })
      document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { box.remove(); document.removeEventListener('keydown', onKey) } })
      draw(); document.body.appendChild(box)
    }

    root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement
      const tab = t.closest('[data-tab]'); if (tab) { section = tab.getAttribute('data-tab') || section; render(); return }
      const it = t.closest('[data-item]'); if (it) { const i = items.get(it.getAttribute('data-item') || ''); if (i) sheet(i); return }
      const less = t.closest('[data-less]'); if (less) { const n = Number(less.getAttribute('data-less')); cart[n].qty--; cart = cart.filter((l) => l.qty > 0); save(cart); render(); return }
      const more = t.closest('[data-more]'); if (more) { const n = Number(more.getAttribute('data-more')); cart[n].qty = Math.min(20, cart[n].qty + 1); save(cart); render() }
    })
    root.addEventListener('submit', async (e) => {
      e.preventDefault()
      const f = e.target as HTMLFormElement
      const v = (n: string) => ((f.elements.namedItem(n) as HTMLInputElement | null)?.value || '').trim()
      const consent = (f.elements.namedItem('smsConsent') as HTMLInputElement | null)?.checked || false
      if (!v('name')) { error = 'Your name, please, for the order.'; render(); return }
      busy = true; error = ''; render()
      try {
        const r = await fetch('/api/public/food/orders', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ name: v('name'), phone: v('phone'), email: v('email'), pickupAt: v('pickupAt'), smsConsent: consent, lines: cart.map((l) => ({ menuItemId: l.itemId, sizeId: l.sizeId, modifierIds: l.modIds, qty: l.qty })) }) })
        const j = await r.json().catch(() => ({}))
        if (r.ok && j.url) { window.location.href = j.url; return }
        error = j.error || 'The order did not go through. Try again.'
      } catch { error = 'The order did not go through. Check your connection and try again.' }
      busy = false; render()
    })
    render()
  }

  document.addEventListener('DOMContentLoaded', () => {
    const d = document.getElementById('order-done'); if (d) { done(d); return }
    const root = document.getElementById('order-root'); if (root) page(root)
  })
})()
