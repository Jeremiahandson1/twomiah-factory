// Order ahead — the customer-facing menu.
//
// T45 H24: order-ahead, the public menu and the customer portal were all switched on as features,
// and /menu, /shop, /order and /portal every one of them rendered the in-app 404. The only way a
// customer order could be created was the in-store kiosk. The public API — GET /api/public/menu and
// POST /api/public/menu/order — was complete the whole time and nothing in the product called it.
//
// Public on purpose: no session, no login. A customer opens the link, picks what they want, and
// leaves a name and a phone number. The server does the same age, stock, tax and purchase-limit
// work it does for the register, so an order placed here cannot be one a budtender would refuse.
import { useState, useEffect, useMemo } from 'react';
import { ShoppingCart, Plus, Minus, Check, Loader2, Store, Truck } from 'lucide-react';

type CartLine = { productId: string; name: string; price: number; quantity: number; isCannabis?: boolean };

const money = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MenuOrderPage() {
  const [menu, setMenu] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<any>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    // Ordering cannabis is age-restricted wherever it happens. This menu took a name and a phone
    // number and nothing else, so anyone could place an order and the age was only looked at when
    // they turned up at the counter. (T46 N5)
    dateOfBirth: '',
    orderType: 'pickup',
    deliveryAddress: '',
    notes: '',
  });

  // A tenant CRM holds one company, so the menu resolves its own shop. ?slug= still works for the
  // multi-shop case the API was originally written for.
  const slug = new URLSearchParams(window.location.search).get('slug');
  const qs = slug ? `?slug=${encodeURIComponent(slug)}` : '';

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/menu${qs}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'The menu is not available right now');
        setMenu(data);
      } catch (err: any) {
        setLoadError(err.message || 'The menu is not available right now');
      } finally {
        setLoading(false);
      }
    })();
  }, [qs]);

  const add = (product: any) => {
    setError('');
    setCart(prev => {
      const found = prev.find(l => l.productId === product.id);
      if (found) return prev.map(l => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { productId: product.id, name: product.name, price: Number(product.price || 0), quantity: 1, isCannabis: product.isCannabis === true }];
    });
  };

  const setQuantity = (productId: string, quantity: number) => {
    setCart(prev => (quantity <= 0
      ? prev.filter(l => l.productId !== productId)
      : prev.map(l => (l.productId === productId ? { ...l, quantity } : l))));
  };

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.price * l.quantity, 0), [cart]);
  const itemCount = useMemo(() => cart.reduce((s, l) => s + l.quantity, 0), [cart]);
  // A basket with regulated product in it is an age-restricted order. A t-shirt is not, and is
  // deliberately left alone. (T46 N5)
  const cartHasCannabis = useMemo(() => cart.some(l => l.isCannabis), [cart]);

  const placeOrder = async () => {
    setError('');
    if (!form.customerName.trim()) { setError('Tell us your name'); return; }
    if (!form.customerPhone.trim()) { setError('We need a phone number to reach you'); return; }
    if (cartHasCannabis && !form.dateOfBirth) { setError('Enter your date of birth — this shop has to check it before it can take the order'); return; }
    if (form.orderType === 'delivery' && !form.deliveryAddress.trim()) { setError('Delivery needs an address'); return; }
    setPlacing(true);
    try {
      const res = await fetch(`/api/public/menu/order${qs}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(l => ({ productId: l.productId, quantity: l.quantity })),
          customerName: form.customerName,
          customerPhone: form.customerPhone,
          customerEmail: form.customerEmail || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          orderType: form.orderType,
          deliveryAddress: form.orderType === 'delivery' ? form.deliveryAddress : undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      // The server refuses over the purchase limit, on stock, and on anything the register would
      // refuse — show its own words rather than a generic failure.
      if (!res.ok) throw new Error(data?.error || 'We could not place that order');
      setPlaced(data);
      setCart([]);
    } catch (err: any) {
      setError(err.message || 'We could not place that order');
    } finally {
      setPlacing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950">
        <Loader2 className="w-8 h-8 animate-spin text-green-700" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6 dark:bg-slate-950">
        <p className="text-gray-600 text-center dark:text-slate-300">{loadError}</p>
      </div>
    );
  }

  if (placed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6 dark:bg-slate-950">
        <div className="bg-white rounded-2xl border p-8 max-w-md w-full text-center dark:bg-slate-900 dark:border-slate-700">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <Check className="w-7 h-7 text-green-700" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-1 dark:text-slate-100">Order placed</h1>
          <p className="text-gray-600 mb-5 dark:text-slate-300">
            Order #{placed.orderNumber} — {money(Number(placed.total))} for {placed.type === 'delivery' ? 'delivery' : 'pickup'}.
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            You will get a call or a text when it is ready. Bring photo ID — it is checked at the counter.
          </p>
          <button
            onClick={() => { setPlaced(null); setCheckout(false); }}
            className="mt-6 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200"
          >
            Order something else
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <header className="bg-white border-b sticky top-0 z-10 dark:bg-slate-900 dark:border-slate-700">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {menu?.company?.logo
              ? <img src={menu.company.logo} alt="" className="w-9 h-9 rounded-lg object-cover" />
              : <Store className="w-7 h-7 text-green-700" />}
            <div>
              <h1 className="font-bold text-gray-900 dark:text-slate-100">{menu?.company?.name || 'Menu'}</h1>
              <p className="text-xs text-gray-500 dark:text-slate-400">Order ahead for pickup or delivery</p>
            </div>
          </div>
          <button
            onClick={() => setCheckout(true)}
            disabled={cart.length === 0}
            className="relative px-4 py-2 bg-green-700 text-white rounded-lg font-medium hover:bg-green-800 disabled:opacity-50"
          >
            <ShoppingCart className="w-4 h-4 inline mr-2" />
            {money(subtotal)}
            {itemCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-white text-green-700 text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center border border-green-600 dark:bg-slate-900">
                {itemCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {checkout ? (
          <div className="max-w-xl mx-auto">
            <button onClick={() => setCheckout(false)} className="text-sm text-gray-500 mb-4 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200">
              &larr; Back to the menu
            </button>

            <div className="bg-white rounded-xl border p-6 mb-6 dark:bg-slate-900 dark:border-slate-700">
              <h2 className="font-semibold text-gray-900 mb-4 dark:text-slate-100">Your order</h2>
              {cart.length === 0 ? (
                <p className="text-gray-500 dark:text-slate-400">Nothing in the basket yet.</p>
              ) : (
                <div className="space-y-3">
                  {cart.map(line => (
                    <div key={line.productId} className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-gray-900 truncate dark:text-slate-100">{line.name}</p>
                        <p className="text-sm text-gray-500 dark:text-slate-400">{money(line.price)} each</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => setQuantity(line.productId, line.quantity - 1)} className="w-7 h-7 rounded border border-gray-300 flex items-center justify-center dark:border-slate-700" aria-label="One fewer">
                          <Minus className="w-3 h-3 text-gray-600 dark:text-slate-300" />
                        </button>
                        <span className="w-6 text-center tabular-nums text-gray-900 dark:text-slate-100">{line.quantity}</span>
                        <button onClick={() => setQuantity(line.productId, line.quantity + 1)} className="w-7 h-7 rounded border border-gray-300 flex items-center justify-center dark:border-slate-700" aria-label="One more">
                          <Plus className="w-3 h-3 text-gray-600 dark:text-slate-300" />
                        </button>
                        <span className="w-16 text-right tabular-nums font-medium text-gray-900 dark:text-slate-100">{money(line.price * line.quantity)}</span>
                      </div>
                    </div>
                  ))}
                  <div className="border-t pt-3 flex justify-between font-semibold text-gray-900 dark:border-slate-700 dark:text-slate-100">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{money(subtotal)}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-slate-400">Tax is added when the order is confirmed.</p>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl border p-6 space-y-4 dark:bg-slate-900 dark:border-slate-700">
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">Where to send it</h2>

              <div className="flex gap-3">
                {[
                  { value: 'pickup', label: 'Pickup', icon: Store },
                  { value: 'delivery', label: 'Delivery', icon: Truck },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setForm({ ...form, orderType: opt.value })}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border font-medium transition ${
                      form.orderType === opt.value
                        ? 'border-green-500 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <opt.icon className="w-4 h-4" />{opt.label}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Your name *</label>
                <input
                  type="text" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-green-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Phone *</label>
                <input
                  type="tel" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-green-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Email</label>
                <input
                  type="email" value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-green-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              {cartHasCannabis && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Date of birth *</label>
                  <input
                    type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-green-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                  <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">
                    Required to order cannabis. Bring photo ID to collect — it is checked again at the counter.
                  </p>
                </div>
              )}
              {form.orderType === 'delivery' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Delivery address *</label>
                  <input
                    type="text" value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-green-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Anything else</label>
                <textarea
                  value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-green-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <p className="text-xs text-gray-500 dark:text-slate-400">
                Photo ID is checked when you collect. You must be 21 or over, or 18 with a valid medical card.
              </p>

              <button
                onClick={placeOrder}
                disabled={placing || cart.length === 0}
                className="w-full py-3 bg-green-700 text-white rounded-lg font-semibold hover:bg-green-800 disabled:opacity-50"
              >
                {placing ? <><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Placing…</> : 'Place order'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {(menu?.menu || []).length === 0 && (
              <p className="text-gray-500 text-center py-16 dark:text-slate-400">Nothing on the menu right now.</p>
            )}
            {(menu?.menu || []).map((section: any) => (
              <section key={section.key} className="mb-10">
                <h2 className="text-lg font-bold text-gray-900 mb-4 dark:text-slate-100">{section.label}</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {section.products.map((p: any) => (
                    <div key={p.id} className="bg-white rounded-xl border p-4 flex flex-col dark:bg-slate-900 dark:border-slate-700">
                      {p.imageUrl && <img src={p.imageUrl} alt="" className="w-full h-32 object-cover rounded-lg mb-3" />}
                      <p className="font-medium text-gray-900 dark:text-slate-100">{p.name}</p>
                      {p.brand && <p className="text-xs text-gray-500 dark:text-slate-400">{p.brand}</p>}
                      <div className="text-xs text-gray-500 mt-1 dark:text-slate-400">
                        {p.strainType && <span className="capitalize mr-2">{p.strainType}</span>}
                        {p.thcPercent && <span className="mr-2">THC {p.thcPercent}%</span>}
                        {p.cbdPercent && <span>CBD {p.cbdPercent}%</span>}
                      </div>
                      <div className="mt-auto pt-3 flex items-center justify-between">
                        <span className="font-semibold text-gray-900 tabular-nums dark:text-slate-100">{money(Number(p.price))}</span>
                        {p.inStock ? (
                          <button
                            onClick={() => add(p)}
                            className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800"
                          >
                            <Plus className="w-3 h-3 inline mr-1" />Add
                          </button>
                        ) : (
                          <span className="text-sm text-gray-500 dark:text-slate-400">Out of stock</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
