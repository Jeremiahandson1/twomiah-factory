import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Minus, Trash2, User, CreditCard, Banknote, ShieldCheck, Gift, X, Check } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface CartItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  weight?: number;
  category: string;
  taxCategory?: string | null;
  strainType?: string;
}

// Values MUST match the backend product category enum (singular).
const categories = [
  { value: '', label: 'All' },
  { value: 'flower', label: 'Flower' },
  { value: 'edible', label: 'Edibles' },
  { value: 'concentrate', label: 'Concentrates' },
  { value: 'vape', label: 'Vapes' },
  { value: 'pre_roll', label: 'Pre-Rolls' },
  { value: 'topical', label: 'Topicals' },
  { value: 'accessory', label: 'Merch' },
];

// The per-transaction purchase limit comes from Settings (company.purchaseLimitOz), loaded below;
// this is only the fallback until it arrives. (go-live QA V-1)
const DEFAULT_WEIGHT_LIMIT_OZ = 2.5;

export default function POSPage() {
  const { user } = useAuth();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'debit'>('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [idVerified, setIdVerified] = useState(false);
  const [loyaltyApplied, setLoyaltyApplied] = useState(false);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [processing, setProcessing] = useState(false);

  // Sales-tax rate from company Settings, so the register quotes what the operator
  // configured — not a hardcoded 15% that disagreed with both Settings and the
  // recorded order (the backend computes tax from company.taxRate too). (B3)
  const [taxRate, setTaxRate] = useState(0);
  // Cannabis excise rate (Settings → exciseTaxRate). The register showed a single "Tax" line
  // and no excise, so the quoted total disagreed with the recorded order. (QA F-01)
  const [exciseRate, setExciseRate] = useState(0.15);
  const [WEIGHT_LIMIT_OZ, setWeightLimitOz] = useState(DEFAULT_WEIGHT_LIMIT_OZ);

  // Loyalty reward redemption (go-live QA M-7): rewards come from Loyalty → Rewards; the
  // cashier picks one, the server prices it and charges its points. The old flow applied an
  // opaque "$1 per 100 pts" discount that never touched the catalog.
  const [rewards, setRewards] = useState<any[]>([]);
  const [memberPoints, setMemberPoints] = useState<number | null>(null);
  const [rewardPickerOpen, setRewardPickerOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<any>(null);

  useEffect(() => {
    loadProducts();
  }, [activeCategory]);

  useEffect(() => {
    api.get('/api/company').then((c: any) => {
      const co = c?.data || c;
      const r = Number(co?.taxRate);
      if (Number.isFinite(r)) setTaxRate(r / 100);
      const e = co?.exciseTaxRate != null && co?.exciseTaxRate !== '' ? Number(co.exciseTaxRate) : NaN;
      if (Number.isFinite(e)) setExciseRate(e / 100);
      const lim = Number(co?.purchaseLimitOz);
      if (Number.isFinite(lim) && lim > 0) setWeightLimitOz(lim);
    }).catch(() => {});
    api.get('/api/loyalty/rewards').then((r: any) => {
      const list = Array.isArray(r) ? r : r?.data || [];
      setRewards(list.filter((x: any) => x.isActive !== false && x.active !== false));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (productSearch) loadProducts();
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  const loadProducts = async () => {
    setLoadingProducts(true);
    try {
      const params: any = { limit: 100 };
      if (productSearch) params.search = productSearch;
      if (activeCategory) params.category = activeCategory;
      const data = await api.get('/api/products', params);
      setProducts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      setLoadingProducts(false);
    }
  };

  const searchCustomers = async (query: string) => {
    setCustomerSearch(query);
    if (query.length < 2) {
      setCustomerResults([]);
      return;
    }
    try {
      const data = await api.get('/api/contacts', { search: query, limit: 5 });
      setCustomerResults(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Customer search failed:', err);
    }
  };

  const selectCustomer = (c: any) => {
    setCustomer(c);
    setShowCustomerSearch(false);
    setCustomerSearch('');
    setCustomerResults([]);
    setLoyaltyApplied(false);
    setLoyaltyDiscount(0);
  };

  const addToCart = (product: any) => {
    const existingQty = cart.find(i => i.productId === product.id)?.quantity ?? 0;
    if (typeof product.stockQuantity === 'number' && existingQty + 1 > product.stockQuantity) {
      toast.error(`Only ${product.stockQuantity} of ${product.name} in stock`);
    }
    setCart(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        return prev.map(i =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          quantity: 1,
          // Per-unit weight in GRAMS. Seeded products carry weightGrams; older rows use
          // weight + weightUnit. Reading only weightOz/weight left this 0, so the limit
          // meter never moved. (retest#7)
          weight: Number(
            product.weightGrams != null && String(product.weightGrams) !== ''
              ? product.weightGrams
              : product.weight
                ? (product.weightUnit === 'oz' ? Number(product.weight) * 28.3495 : Number(product.weight))
                : 0
          ) || 0,
          category: product.category,
          taxCategory: product.taxCategory ?? null,
          strainType: product.strainType,
        },
      ];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    if (delta > 0) {
      const item = cart.find(i => i.id === itemId);
      const stock = item ? products.find(p => p.id === item.productId)?.stockQuantity : undefined;
      if (item && typeof stock === 'number' && item.quantity + delta > stock) {
        toast.error(`Only ${stock} of ${item.name} in stock`);
      }
    }
    setCart(prev =>
      prev
        .map(i => (i.id === itemId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i))
        .filter(i => i.quantity > 0)
    );
  };

  const removeItem = (itemId: string) => {
    setCart(prev => prev.filter(i => i.id !== itemId));
  };

  // Mirrors the backend math (orders.ts): excise on the cannabis share, sales tax on everything,
  // BOTH on the post-discount base (QA F-01 / F-07). The server's numbers are authoritative;
  // this only keeps the on-screen quote in step with what gets recorded.
  const CANNABIS_CATEGORIES = ['flower', 'pre_roll', 'preroll', 'edible', 'concentrate', 'vape', 'tincture'];
  const isCannabisItem = (i: CartItem) =>
    i.taxCategory === 'cannabis' || (i.taxCategory !== 'non_cannabis' && CANNABIS_CATEGORIES.includes(String(i.category || '').toLowerCase()));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const cannabisSubtotal = cart.reduce((sum, i) => sum + (isCannabisItem(i) ? i.price * i.quantity : 0), 0);
  const discountAmount = loyaltyApplied ? Math.min(loyaltyDiscount, subtotal) : 0;
  const cannabisShare = subtotal > 0 ? cannabisSubtotal / subtotal : 0;
  const exciseAmount = round2(Math.max(0, cannabisSubtotal - discountAmount * cannabisShare) * exciseRate);
  const salesTaxAmount = round2(Math.max(0, subtotal - discountAmount) * taxRate);
  const taxAmount = round2(exciseAmount + salesTaxAmount);
  const total = round2(subtotal + taxAmount - discountAmount);
  const changeDue = paymentMethod === 'cash' && cashTendered ? parseFloat(cashTendered) - total : 0;

  // i.weight is per-unit GRAMS; the limit meter is in oz. Convert (g / 28.3495).
  // Categories must match the backend cannabis list or the meter under-counts.
  const totalWeightOz = cart.reduce((sum, i) => {
    if (['flower', 'pre_roll', 'edible', 'concentrate', 'vape', 'tincture'].includes(i.category)) {
      return sum + ((Number(i.weight) || 0) * i.quantity) / 28.3495;
    }
    return sum;
  }, 0);
  const weightPercent = Math.min((totalWeightOz / WEIGHT_LIMIT_OZ) * 100, 100);
  const overWeight = totalWeightOz > WEIGHT_LIMIT_OZ;

  // Any cart line whose quantity exceeds the loaded product's stock. Blocks
  // Complete Sale so the cashier can't fire an order the server will reject
  // with a 400 "Insufficient stock" (the inline per-line warning shows which).
  const overStock = cart.some(i => {
    const stock = products.find(p => p.id === i.productId)?.stockQuantity;
    return typeof stock === 'number' && i.quantity > stock;
  });

  // Price a catalog reward against the current cart (mirrors the server — the server's number wins).
  const rewardValue = (r: any): { discount: number; problem?: string } => {
    const val = Number(r.discountValue || 0);
    const type = String(r.discountType || 'fixed');
    if (type === 'percent') {
      const cats: string[] = (Array.isArray(r.applicableCategories) ? r.applicableCategories : []).map((x: any) => String(x).toLowerCase());
      const base = cats.length
        ? cart.filter(i => cats.includes(String(i.category || '').toLowerCase())).reduce((s, i) => s + i.price * i.quantity, 0)
        : subtotal;
      if (cats.length && base <= 0) return { discount: 0, problem: `applies to ${cats.join('/')} items — none in cart` };
      return { discount: round2(base * val / 100) };
    }
    if (type === 'free_item') {
      const line = r.productId ? cart.find(i => i.productId === r.productId) : null;
      if (!line) return { discount: 0, problem: 'add the reward product to the cart first' };
      return { discount: round2(line.price) };
    }
    return { discount: round2(Math.min(val, subtotal)) };
  };

  const applyLoyalty = async () => {
    if (!customer) {
      toast.error('Select a customer first');
      return;
    }
    try {
      const data = await api.get('/api/loyalty/check', { phone: customer.phone || '' });
      if (!data.found) {
        toast.error('Customer is not enrolled in the loyalty program');
        return;
      }
      const balance = Number(data.points_balance || 0);
      setMemberPoints(balance);
      if (rewards.length > 0) {
        // Let the cashier pick from the configured Rewards catalog.
        if (!rewards.some(r => balance >= Number(r.pointsCost || r.pointsRequired || 0))) {
          const cheapest = Math.min(...rewards.map(r => Number(r.pointsCost || r.pointsRequired || 0)));
          toast.error(`No rewards available yet — ${balance} pts (cheapest reward is ${cheapest} pts)`);
          return;
        }
        setRewardPickerOpen(true);
        return;
      }
      // No catalog configured: fall back to the generic conversion ($1 per 100 pts, max 10% of subtotal).
      if (balance < 100) {
        toast.error('No rewards available (need at least 100 points)');
        return;
      }
      const maxDiscount = subtotal * 0.1;
      const pointsDiscount = Math.floor(balance / 100);
      const discount = Math.min(pointsDiscount, maxDiscount);
      setSelectedReward(null);
      setLoyaltyDiscount(discount);
      setLoyaltyApplied(true);
      toast.success(`Loyalty discount applied: $${Number(discount).toFixed(2)} (${balance} pts)`);
    } catch (err: any) {
      toast.error(err.message || 'No rewards available');
    }
  };

  const chooseReward = (r: any) => {
    const cost = Number(r.pointsCost || r.pointsRequired || 0);
    if (memberPoints != null && memberPoints < cost) {
      toast.error(`Needs ${cost} pts — customer has ${memberPoints}`);
      return;
    }
    const { discount, problem } = rewardValue(r);
    if (problem) {
      toast.error(`${r.name}: ${problem}`);
      return;
    }
    setSelectedReward(r);
    setLoyaltyDiscount(discount);
    setLoyaltyApplied(true);
    setRewardPickerOpen(false);
    toast.success(`${r.name} applied: -$${discount.toFixed(2)} for ${cost} pts`);
  };

  const clearLoyalty = () => {
    setSelectedReward(null);
    setLoyaltyDiscount(0);
    setLoyaltyApplied(false);
    setRewardPickerOpen(false);
  };

  const completeOrder = async () => {
    if (!idVerified) {
      toast.error('ID must be verified before completing sale');
      return;
    }
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    if (overWeight) {
      toast.error('Order exceeds weight limit');
      return;
    }
    if (paymentMethod === 'cash' && parseFloat(cashTendered || '0') < total) {
      toast.error('Insufficient cash tendered');
      return;
    }

    setProcessing(true);
    try {
      const created: any = await api.post('/api/orders', {
        contactId: customer?.id || null,
        items: cart.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          priceOverride: i.price,
        })),
        type: 'walk_in',
        paymentMethod,
        idVerified,
        // The register's only discount is loyalty-funded and is expressed as the points
        // redeemed (server converts 100 pts = $1). Sending it AGAIN as discountAmount made
        // the server apply it twice (loyalty + "manager" discount). (QA discount audit)
        discountAmount: 0,
        // A catalog reward is redeemed by id (server prices it + charges its pointsCost);
        // the generic fallback still sends points at 100 pts = $1.
        loyaltyRewardId: loyaltyApplied && selectedReward ? selectedReward.id : undefined,
        loyaltyPointsRedeemed: loyaltyApplied
          ? (selectedReward ? Number(selectedReward.pointsCost || selectedReward.pointsRequired || 0) : Math.round(discountAmount * 100))
          : 0,
      });
      // Settle the sale immediately. Creating the order alone left it 'pending':
      // stock never decremented (B2), paymentStatus stayed pending (B6), the tender
      // lived only in a note (N2) and no loyalty was awarded (M5). /complete does all
      // four in one transaction.
      const orderId = created?.id || created?.data?.id;
      if (orderId) {
        await api.post(`/api/orders/${orderId}/complete`, {
          paymentMethod,
          cashTendered: paymentMethod === 'cash' ? parseFloat(cashTendered || '0') : undefined,
          idVerified,
        });
      }
      toast.success('Order completed!');
      // Reset
      setCart([]);
      setCustomer(null);
      setCashTendered('');
      setIdVerified(false);
      setLoyaltyApplied(false);
      setLoyaltyDiscount(0);
      setSelectedReward(null);
      setMemberPoints(null);
      searchRef.current?.focus();
    } catch (err: any) {
      toast.error(err.message || 'Failed to complete order');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6 gap-0">
      {/* LEFT: Product Grid */}
      <div className="flex-1 flex flex-col bg-gray-50 border-r overflow-hidden dark:bg-slate-900">
        {/* Category Tabs */}
        <div className="flex gap-1 p-3 overflow-x-auto bg-white border-b dark:bg-slate-900">
          {categories.map(cat => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeCategory === cat.value
                  ? 'bg-green-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="p-3 bg-white border-b dark:bg-slate-900">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search products..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm dark:border-slate-700 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {loadingProducts ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {products.map(product => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={product.stockQuantity <= 0}
                  className={`p-3 rounded-lg text-left transition-all ${
                    product.stockQuantity <= 0
                      ? 'bg-gray-100 opacity-50 cursor-not-allowed dark:bg-slate-800'
                      : 'bg-white hover:shadow-md hover:border-green-300 border border-gray-200 dark:bg-slate-800 dark:border-slate-700'
                  }`}
                >
                  <p className="font-medium text-gray-900 text-sm truncate dark:text-slate-100">{product.name}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {product.strainType && product.strainType !== 'na' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        product.strainType === 'sativa' ? 'bg-orange-100 text-orange-700' :
                        product.strainType === 'indica' ? 'bg-purple-100 text-purple-700' :
                        product.strainType === 'cbd' ? 'bg-blue-100 text-blue-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {product.strainType}
                      </span>
                    )}
                    {product.thcPercent != null && (
                      <span className="text-xs text-gray-500 dark:text-slate-400">{product.thcPercent}%</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-semibold text-green-700">${Number(product.price).toFixed(2)}</span>
                    <span className={`text-xs ${product.stockQuantity <= 5 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {product.stockQuantity} left
                    </span>
                  </div>
                </button>
              ))}
              {products.length === 0 && (
                <p className="col-span-full text-center text-gray-500 py-8 dark:text-slate-400">No products found</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Cart */}
      <div className="w-96 flex flex-col bg-white dark:bg-slate-900">
        {/* Customer */}
        <div className="p-4 border-b">
          {customer ? (
            <div className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-green-600" />
                <div>
                  <p className="font-medium text-gray-900 text-sm dark:text-slate-100">{customer.name}</p>
                  {customer.loyaltyTier && (
                    <span className="text-xs text-green-600">{customer.loyaltyTier} member</span>
                  )}
                </div>
              </div>
              <button onClick={() => { setCustomer(null); setLoyaltyApplied(false); setLoyaltyDiscount(0); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowCustomerSearch(!showCustomerSearch)}
                className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-green-400 hover:text-green-600 flex items-center gap-2 dark:border-slate-700 dark:text-slate-400"
              >
                <User className="w-4 h-4" /> Add Customer (optional)
              </button>
              {showCustomerSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 p-2 dark:bg-slate-900">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search by name or phone..."
                    value={customerSearch}
                    onChange={(e) => searchCustomers(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
                  />
                  {customerResults.length > 0 && (
                    <div className="mt-1 divide-y max-h-40 overflow-y-auto">
                      {customerResults.map(c => (
                        <button
                          key={c.id}
                          onClick={() => selectCustomer(c)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                        >
                          <p className="font-medium text-gray-900 dark:text-slate-100">{c.name}</p>
                          <p className="text-xs text-gray-500 dark:text-slate-400">{c.phone || c.email || ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Weight Limit Bar */}
        <div className="px-4 py-2 border-b">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 dark:text-slate-400">Weight Limit</span>
            <span className={`text-xs font-medium ${overWeight ? 'text-red-600' : 'text-gray-700'}`}>
              {Number(totalWeightOz).toFixed(1)} / {WEIGHT_LIMIT_OZ} oz
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                overWeight ? 'bg-red-500' : weightPercent > 80 ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(weightPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {cart.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">Cart is empty</p>
          ) : (
            cart.map(item => {
              // Available stock for this line's product (looked up from the loaded
              // catalog — CartItem doesn't carry stock). When the cart quantity
              // exceeds it, flag the line so the cashier isn't blindsided by the
              // server rejecting the whole order at Complete Sale.
              const stock = products.find(p => p.id === item.productId)?.stockQuantity;
              const overStock = typeof stock === 'number' && item.quantity > stock;
              return (
              <div key={item.id} className="flex flex-wrap items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-slate-900">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate dark:text-slate-100">{item.name}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">${Number(item.price).toFixed(2)} ea</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateQuantity(item.id, -1)}
                    className="w-7 h-7 rounded-full bg-white border flex items-center justify-center hover:bg-gray-100 dark:bg-slate-900"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-8 text-center font-medium text-sm">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.id, 1)}
                    className="w-7 h-7 rounded-full bg-white border flex items-center justify-center hover:bg-gray-100 dark:bg-slate-900"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <span className="font-medium text-gray-900 text-sm w-16 text-right dark:text-slate-100">
                  ${Number(item.price * item.quantity).toFixed(2)}
                </span>
                <button onClick={() => removeItem(item.id)} className="text-gray-400 hover:text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
                {overStock && (
                  <p className="w-full text-xs font-medium text-red-600">
                    Only {stock} in stock — exceeds available
                  </p>
                )}
              </div>
              );
            })
          )}
        </div>

        {/* Totals */}
        <div className="border-t p-4 space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-600 dark:text-slate-400">
              <span>Subtotal</span>
              <span>${Number(subtotal).toFixed(2)}</span>
            </div>
            {loyaltyApplied && discountAmount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>
                  {selectedReward ? `${selectedReward.name} (${Number(selectedReward.pointsCost || selectedReward.pointsRequired || 0)} pts)` : 'Loyalty Discount'}
                  <button onClick={clearLoyalty} className="ml-2 text-xs text-gray-400 hover:text-red-500" title="Remove reward">✕</button>
                </span>
                <span>-${Number(discountAmount).toFixed(2)}</span>
              </div>
            )}
            {cannabisSubtotal > 0 && (
              <div className="flex justify-between text-gray-600 dark:text-slate-400">
                <span>Excise Tax ({Number(exciseRate * 100).toFixed(exciseRate * 100 % 1 ? 1 : 0)}%)</span>
                <span>${Number(exciseAmount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600 dark:text-slate-400">
              <span>Sales Tax ({Number(taxRate * 100).toFixed(taxRate * 100 % 1 ? 1 : 0)}%)</span>
              <span>${Number(salesTaxAmount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg text-gray-900 pt-1 border-t dark:text-slate-100">
              <span>Total</span>
              <span>${Number(total).toFixed(2)}</span>
            </div>
          </div>

          {/* Loyalty */}
          {customer && !loyaltyApplied && !rewardPickerOpen && (
            <button
              onClick={applyLoyalty}
              className="w-full px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-sm font-medium hover:bg-amber-100 flex items-center justify-center gap-2"
            >
              <Gift className="w-4 h-4" /> {rewards.length ? 'Redeem a Reward' : 'Apply Loyalty Reward'}
            </button>
          )}
          {rewardPickerOpen && (
            <div className="border border-amber-200 rounded-lg bg-amber-50 p-2 space-y-1 dark:bg-slate-800 dark:border-slate-700">
              <div className="flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 px-1">
                <span>Rewards · {memberPoints ?? 0} pts available</span>
                <button onClick={() => setRewardPickerOpen(false)} className="text-gray-500 hover:text-gray-800">Cancel</button>
              </div>
              {rewards.map(r => {
                const cost = Number(r.pointsCost || r.pointsRequired || 0);
                const { discount, problem } = rewardValue(r);
                const affordable = memberPoints == null || memberPoints >= cost;
                const disabled = !affordable || !!problem;
                return (
                  <button
                    key={r.id}
                    onClick={() => chooseReward(r)}
                    disabled={disabled}
                    title={problem || (!affordable ? `Needs ${cost} pts` : '')}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between ${
                      disabled ? 'bg-white/60 text-gray-400 cursor-not-allowed dark:bg-slate-900/40' : 'bg-white hover:bg-amber-100 text-gray-900 dark:bg-slate-900 dark:text-slate-100'
                    }`}
                  >
                    <span>
                      <span className="font-medium">{r.name}</span>
                      <span className="ml-2 text-xs text-gray-500">{cost} pts</span>
                      {problem && <span className="ml-2 text-xs text-red-500">{problem}</span>}
                    </span>
                    <span className="text-green-700 font-medium">{problem ? '' : `-$${discount.toFixed(2)}`}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Payment Method */}
          <div className="flex gap-2">
            <button
              onClick={() => setPaymentMethod('cash')}
              className={`flex-1 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
                paymentMethod === 'cash'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Banknote className="w-4 h-4" /> Cash
            </button>
            <button
              onClick={() => setPaymentMethod('debit')}
              className={`flex-1 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
                paymentMethod === 'debit'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <CreditCard className="w-4 h-4" /> Debit
            </button>
          </div>

          {/* Cash Tendered */}
          {paymentMethod === 'cash' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">Cash Tendered</label>
              <input
                type="number"
                step="0.01"
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
                placeholder="0.00"
              />
              {parseFloat(cashTendered || '0') >= total && total > 0 && (
                <p className="text-sm text-green-600 mt-1 font-medium">
                  Change: ${Number(changeDue).toFixed(2)}
                </p>
              )}
            </div>
          )}

          {/* ID Verified */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={idVerified}
              onChange={(e) => setIdVerified(e.target.checked)}
              className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500 dark:border-slate-700"
            />
            <ShieldCheck className="w-4 h-4 text-gray-500 dark:text-slate-400" />
            <span className="text-sm text-gray-700 dark:text-slate-200">ID Verified (21+)</span>
          </label>

          {/* Complete */}
          <button
            onClick={completeOrder}
            disabled={processing || cart.length === 0 || !idVerified || overWeight || overStock}
            className={`w-full py-3 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-colors ${
              processing || cart.length === 0 || !idVerified || overWeight || overStock
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            <Check className="w-5 h-5" />
            {processing ? 'Processing...' : 'Complete Sale'}
          </button>
        </div>
      </div>
    </div>
  );
}
