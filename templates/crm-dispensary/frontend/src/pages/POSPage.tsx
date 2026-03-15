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
  strainType?: string;
}

const categories = [
  { value: '', label: 'All' },
  { value: 'flower', label: 'Flower' },
  { value: 'edibles', label: 'Edibles' },
  { value: 'concentrates', label: 'Concentrates' },
  { value: 'vapes', label: 'Vapes' },
  { value: 'pre-rolls', label: 'Pre-Rolls' },
  { value: 'topicals', label: 'Topicals' },
  { value: 'merch', label: 'Merch' },
];

const WEIGHT_LIMIT_OZ = 2.5;

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

  const TAX_RATE = 0.15; // Cannabis tax rate placeholder

  useEffect(() => {
    loadProducts();
  }, [activeCategory]);

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
          weight: product.weightOz || product.weight || 0,
          category: product.category,
          strainType: product.strainType,
        },
      ];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(i => (i.id === itemId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i))
        .filter(i => i.quantity > 0)
    );
  };

  const removeItem = (itemId: string) => {
    setCart(prev => prev.filter(i => i.id !== itemId));
  };

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const taxAmount = subtotal * TAX_RATE;
  const discountAmount = loyaltyApplied ? loyaltyDiscount : 0;
  const total = subtotal + taxAmount - discountAmount;
  const changeDue = paymentMethod === 'cash' && cashTendered ? parseFloat(cashTendered) - total : 0;

  const totalWeightOz = cart.reduce((sum, i) => {
    if (['flower', 'pre-rolls'].includes(i.category)) {
      return sum + (i.weight || 0) * i.quantity;
    }
    return sum;
  }, 0);
  const weightPercent = Math.min((totalWeightOz / WEIGHT_LIMIT_OZ) * 100, 100);
  const overWeight = totalWeightOz > WEIGHT_LIMIT_OZ;

  const applyLoyalty = async () => {
    if (!customer) {
      toast.error('Select a customer first');
      return;
    }
    try {
      const data = await api.get('/api/loyalty/check', { phone: customer.phone || '' });
      if (!data.found || !data.points_balance || data.points_balance < 100) {
        toast.error('No rewards available (need at least 100 points)');
        return;
      }
      // Apply $1 per 100 points, max 10% of subtotal
      const maxDiscount = subtotal * 0.1;
      const pointsDiscount = Math.floor(data.points_balance / 100);
      const discount = Math.min(pointsDiscount, maxDiscount);
      setLoyaltyDiscount(discount);
      setLoyaltyApplied(true);
      toast.success(`Loyalty discount applied: $${discount.toFixed(2)} (${data.points_balance} pts)`);
    } catch (err: any) {
      toast.error(err.message || 'No rewards available');
    }
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
      await api.post('/api/orders', {
        contactId: customer?.id || null,
        items: cart.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          priceOverride: i.price,
        })),
        type: 'walk_in',
        discountAmount: discountAmount,
        loyaltyPointsRedeemed: loyaltyApplied ? Math.round(discountAmount * 100) : 0,
        notes: paymentMethod === 'cash' ? `Cash tendered: $${parseFloat(cashTendered).toFixed(2)}` : undefined,
      });
      toast.success('Order completed!');
      // Reset
      setCart([]);
      setCustomer(null);
      setCashTendered('');
      setIdVerified(false);
      setLoyaltyApplied(false);
      setLoyaltyDiscount(0);
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
      <div className="flex-1 flex flex-col bg-gray-50 border-r overflow-hidden">
        {/* Category Tabs */}
        <div className="flex gap-1 p-3 overflow-x-auto bg-white border-b">
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
        <div className="p-3 bg-white border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search products..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm"
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
                      ? 'bg-gray-100 opacity-50 cursor-not-allowed'
                      : 'bg-white hover:shadow-md hover:border-green-300 border border-gray-200'
                  }`}
                >
                  <p className="font-medium text-gray-900 text-sm truncate">{product.name}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {product.strainType && product.strainType !== 'n/a' && (
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
                      <span className="text-xs text-gray-500">{product.thcPercent}%</span>
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
                <p className="col-span-full text-center text-gray-500 py-8">No products found</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Cart */}
      <div className="w-96 flex flex-col bg-white">
        {/* Customer */}
        <div className="p-4 border-b">
          {customer ? (
            <div className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-green-600" />
                <div>
                  <p className="font-medium text-gray-900 text-sm">{customer.name}</p>
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
                className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-green-400 hover:text-green-600 flex items-center gap-2"
              >
                <User className="w-4 h-4" /> Add Customer (optional)
              </button>
              {showCustomerSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 p-2">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search by name or phone..."
                    value={customerSearch}
                    onChange={(e) => searchCustomers(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  />
                  {customerResults.length > 0 && (
                    <div className="mt-1 divide-y max-h-40 overflow-y-auto">
                      {customerResults.map(c => (
                        <button
                          key={c.id}
                          onClick={() => selectCustomer(c)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                        >
                          <p className="font-medium text-gray-900">{c.name}</p>
                          <p className="text-xs text-gray-500">{c.phone || c.email || ''}</p>
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
            <span className="text-xs text-gray-500">Weight Limit</span>
            <span className={`text-xs font-medium ${overWeight ? 'text-red-600' : 'text-gray-700'}`}>
              {totalWeightOz.toFixed(1)} / {WEIGHT_LIMIT_OZ} oz
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
            cart.map(item => (
              <div key={item.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{item.name}</p>
                  <p className="text-xs text-gray-500">${item.price.toFixed(2)} ea</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateQuantity(item.id, -1)}
                    className="w-7 h-7 rounded-full bg-white border flex items-center justify-center hover:bg-gray-100"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-8 text-center font-medium text-sm">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.id, 1)}
                    className="w-7 h-7 rounded-full bg-white border flex items-center justify-center hover:bg-gray-100"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <span className="font-medium text-gray-900 text-sm w-16 text-right">
                  ${(item.price * item.quantity).toFixed(2)}
                </span>
                <button onClick={() => removeItem(item.id)} className="text-gray-400 hover:text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Totals */}
        <div className="border-t p-4 space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Tax ({(TAX_RATE * 100).toFixed(0)}%)</span>
              <span>${taxAmount.toFixed(2)}</span>
            </div>
            {loyaltyApplied && discountAmount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Loyalty Discount</span>
                <span>-${discountAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg text-gray-900 pt-1 border-t">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </div>

          {/* Loyalty */}
          {customer && !loyaltyApplied && (
            <button
              onClick={applyLoyalty}
              className="w-full px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-sm font-medium hover:bg-amber-100 flex items-center justify-center gap-2"
            >
              <Gift className="w-4 h-4" /> Apply Loyalty Reward
            </button>
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
              <label className="block text-xs font-medium text-gray-600 mb-1">Cash Tendered</label>
              <input
                type="number"
                step="0.01"
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                placeholder="0.00"
              />
              {parseFloat(cashTendered || '0') >= total && total > 0 && (
                <p className="text-sm text-green-600 mt-1 font-medium">
                  Change: ${changeDue.toFixed(2)}
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
              className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
            />
            <ShieldCheck className="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-700">ID Verified (21+)</span>
          </label>

          {/* Complete */}
          <button
            onClick={completeOrder}
            disabled={processing || cart.length === 0 || !idVerified || overWeight}
            className={`w-full py-3 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-colors ${
              processing || cart.length === 0 || !idVerified || overWeight
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
