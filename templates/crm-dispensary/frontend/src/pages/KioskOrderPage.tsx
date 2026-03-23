import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ShoppingCart, Plus, Minus, Trash2, ChevronRight, ChevronLeft,
  CheckCircle, Leaf, X, Search
} from 'lucide-react';
import api from '../services/api';

type KioskStep = 'age-verify' | 'browse' | 'cart' | 'checkout' | 'thank-you';

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  image?: string;
  category?: string;
  strainType?: string;
}

const strainColors: Record<string, string> = {
  sativa: 'bg-orange-100 text-orange-700 border-orange-200',
  indica: 'bg-purple-100 text-purple-700 border-purple-200',
  hybrid: 'bg-green-100 text-green-700 border-green-200',
  cbd: 'bg-blue-100 text-blue-700 border-blue-200',
};

const INACTIVITY_TIMEOUT = 60000; // 60 seconds

export default function KioskOrderPage() {
  const [step, setStep] = useState<KioskStep>('age-verify');
  const [sessionToken, setSessionToken] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset inactivity timer on any interaction
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    if (step === 'thank-you') {
      inactivityTimer.current = setTimeout(resetKiosk, INACTIVITY_TIMEOUT);
    }
  }, [step]);

  useEffect(() => {
    const handleActivity = () => resetInactivityTimer();
    window.addEventListener('touchstart', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('mousemove', handleActivity);
    return () => {
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('mousemove', handleActivity);
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [resetInactivityTimer]);

  useEffect(() => {
    if (step === 'thank-you') {
      inactivityTimer.current = setTimeout(resetKiosk, INACTIVITY_TIMEOUT);
    }
  }, [step]);

  const resetKiosk = () => {
    setStep('age-verify');
    setSessionToken('');
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setOrderNumber('');
    setSearchQuery('');
    setSelectedCategory('all');
    setError('');
  };

  const handleAgeVerify = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams(window.location.search);
      const locationId = params.get('location') || '';
      const data = await api.post('/api/kiosk/session/start', { locationId });
      setSessionToken(data.token || data.sessionToken || '');
      await loadMenu();
      setStep('browse');
    } catch (err: any) {
      setError(err.message || 'Failed to start session');
    } finally {
      setLoading(false);
    }
  };

  const loadMenu = async () => {
    try {
      const data = await api.get('/api/kiosk/menu');
      const items = Array.isArray(data) ? data : data?.data || data?.products || [];
      setProducts(items);
      const cats = [...new Set(items.map((p: any) => p.category).filter(Boolean))] as string[];
      setCategories(cats);
    } catch (err) {
      console.error('Failed to load menu:', err);
    }
  };

  const addToCart = async (product: any) => {
    const existing = cart.find(item => item.productId === product.id);
    if (existing) {
      setCart(prev => prev.map(item =>
        item.productId === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart(prev => [...prev, {
        productId: product.id,
        name: product.name,
        price: Number(product.price) || 0,
        quantity: 1,
        image: product.image || product.imageUrl,
        category: product.category,
        strainType: product.strainType,
      }]);
    }

    // Sync with backend
    if (sessionToken) {
      try {
        await api.post(`/api/kiosk/session/${sessionToken}/add-item`, {
          productId: product.id,
          quantity: 1,
        });
      } catch (err) {
        // Silently fail - cart state is local
      }
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => {
      const updated = prev.map(item => {
        if (item.productId === productId) {
          const newQty = item.quantity + delta;
          return newQty <= 0 ? null : { ...item, quantity: newQty };
        }
        return item;
      }).filter(Boolean) as CartItem[];
      return updated;
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const filteredProducts = products.filter(p => {
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    const matchesSearch = !searchQuery || p.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleCheckout = async () => {
    if (!customerName.trim()) {
      setError('Please enter your name');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const data = await api.post(`/api/kiosk/session/${sessionToken}/checkout`, {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        items: cart.map(item => ({ productId: item.productId, quantity: item.quantity })),
      });
      setOrderNumber(data.orderNumber || data.order?.orderNumber || '#' + (data.orderId || '').slice(0, 6));
      setStep('thank-you');
    } catch (err: any) {
      setError(err.message || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  };

  // Age Verification
  if (step === 'age-verify') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-8">
        <div className="text-center max-w-lg">
          <div className="w-24 h-24 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-8">
            <Leaf className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Welcome</h1>
          <p className="text-xl text-gray-300 mb-12">Please verify your age to continue</p>
          {error && (
            <div className="bg-red-500/20 border border-red-500/50 text-red-300 rounded-xl p-4 mb-6">
              {error}
            </div>
          )}
          <button
            onClick={handleAgeVerify}
            disabled={loading}
            className="w-full py-6 px-8 bg-green-600 hover:bg-green-700 text-white text-2xl font-bold rounded-2xl transition-colors disabled:opacity-50 touch-manipulation"
          >
            {loading ? 'Starting...' : 'I am 21 or older'}
          </button>
          <p className="text-gray-500 text-sm mt-6">
            You must be 21 years or older to use this service. Valid ID required at pickup.
          </p>
        </div>
      </div>
    );
  }

  // Browse Products
  if (step === 'browse') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <div className="bg-white shadow-sm px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Leaf className="w-6 h-6 text-green-600" />
            Browse Menu
          </h1>
          <button
            onClick={() => setStep('cart')}
            className="relative flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-semibold text-lg transition-colors touch-manipulation"
          >
            <ShoppingCart className="w-6 h-6" />
            Cart
            {cartCount > 0 && (
              <span className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                {cartCount}
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 text-lg border border-gray-200 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="px-6 py-4 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-5 py-2.5 rounded-xl text-base font-medium whitespace-nowrap transition-colors touch-manipulation ${
              selectedCategory === 'all'
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 border border-gray-200'
            }`}
          >
            All
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-2.5 rounded-xl text-base font-medium whitespace-nowrap capitalize transition-colors touch-manipulation ${
                selectedCategory === cat
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        <div className="flex-1 px-6 pb-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredProducts.map(product => (
              <div key={product.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                {/* Image */}
                <div className="aspect-square bg-gray-100 flex items-center justify-center">
                  {product.image || product.imageUrl ? (
                    <img
                      src={product.image || product.imageUrl}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Leaf className="w-12 h-12 text-gray-300" />
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  {/* Strain badge */}
                  <div className="flex gap-1 mb-2 flex-wrap">
                    {product.strainType && (
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border capitalize ${strainColors[product.strainType?.toLowerCase()] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {product.strainType}
                      </span>
                    )}
                    {product.category && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 border border-gray-200 capitalize">
                        {product.category}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-gray-900 text-base mb-1 line-clamp-2">{product.name}</h3>
                  {/* THC/CBD */}
                  <div className="flex gap-3 text-xs text-gray-500 mb-2">
                    {product.thcPercent != null && <span>THC: {product.thcPercent}%</span>}
                    {product.cbdPercent != null && <span>CBD: {product.cbdPercent}%</span>}
                  </div>
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-xl font-bold text-green-700">${Number(product.price || 0).toFixed(2)}</span>
                    <button
                      onClick={() => addToCart(product)}
                      className="w-12 h-12 bg-green-600 hover:bg-green-700 text-white rounded-xl flex items-center justify-center transition-colors touch-manipulation"
                    >
                      <Plus className="w-6 h-6" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {filteredProducts.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <Leaf className="w-16 h-16 mx-auto mb-4 text-gray-300" />
              <p className="text-xl">No products found</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Cart
  if (step === 'cart') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <div className="bg-white shadow-sm px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <button
            onClick={() => setStep('browse')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-lg touch-manipulation"
          >
            <ChevronLeft className="w-6 h-6" />
            Continue Shopping
          </button>
          <h1 className="text-xl font-bold text-gray-900">Your Cart</h1>
          <div className="w-32" />
        </div>

        {/* Cart Items */}
        <div className="flex-1 px-6 py-6">
          {cart.length === 0 ? (
            <div className="text-center py-20 text-gray-500">
              <ShoppingCart className="w-20 h-20 mx-auto mb-4 text-gray-300" />
              <p className="text-2xl font-medium mb-2">Your cart is empty</p>
              <button
                onClick={() => setStep('browse')}
                className="mt-4 px-8 py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-semibold text-lg transition-colors touch-manipulation"
              >
                Browse Products
              </button>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-3">
              {cart.map(item => (
                <div key={item.productId} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 flex items-center gap-4">
                  <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-full h-full object-cover rounded-lg" />
                    ) : (
                      <Leaf className="w-8 h-8 text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 text-lg">{item.name}</h3>
                    <p className="text-green-700 font-bold text-lg">${item.price.toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => updateQuantity(item.productId, -1)}
                      className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors touch-manipulation"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <span className="text-xl font-bold w-8 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.productId, 1)}
                      className="w-10 h-10 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors touch-manipulation"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  <button
                    onClick={() => removeFromCart(item.productId)}
                    className="w-10 h-10 rounded-lg text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors touch-manipulation"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}

              {/* Total */}
              <div className="bg-white rounded-xl shadow-sm p-5 border border-gray-100">
                <div className="flex items-center justify-between text-2xl font-bold">
                  <span className="text-gray-900">Total</span>
                  <span className="text-green-700">${cartTotal.toFixed(2)}</span>
                </div>
                <p className="text-sm text-gray-500 mt-1">Tax calculated at pickup</p>
              </div>

              <button
                onClick={() => setStep('checkout')}
                className="w-full py-5 bg-green-600 hover:bg-green-700 text-white text-xl font-bold rounded-xl transition-colors touch-manipulation"
              >
                Proceed to Checkout
                <ChevronRight className="w-6 h-6 inline ml-2" />
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Checkout
  if (step === 'checkout') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Header */}
        <div className="bg-white shadow-sm px-6 py-4 flex items-center justify-between sticky top-0 z-10">
          <button
            onClick={() => setStep('cart')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 text-lg touch-manipulation"
          >
            <ChevronLeft className="w-6 h-6" />
            Back to Cart
          </button>
          <h1 className="text-xl font-bold text-gray-900">Checkout</h1>
          <div className="w-32" />
        </div>

        <div className="flex-1 px-6 py-8 flex items-start justify-center">
          <div className="w-full max-w-lg">
            <div className="bg-white rounded-xl shadow-sm p-8 border border-gray-100">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Pickup Information</h2>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-6">
                  {error}
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label className="block text-lg font-medium text-gray-700 mb-2">Name *</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="w-full px-4 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="Enter your name"
                  />
                </div>
                <div>
                  <label className="block text-lg font-medium text-gray-700 mb-2">Phone (optional)</label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={e => setCustomerPhone(e.target.value)}
                    className="w-full px-4 py-4 text-lg border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="(555) 123-4567"
                  />
                </div>
              </div>

              {/* Order summary */}
              <div className="mt-6 pt-6 border-t">
                <div className="flex justify-between text-lg mb-2">
                  <span className="text-gray-600">{cartCount} item{cartCount !== 1 ? 's' : ''}</span>
                  <span className="font-bold text-gray-900">${cartTotal.toFixed(2)}</span>
                </div>
              </div>

              <button
                onClick={handleCheckout}
                disabled={submitting}
                className="w-full mt-6 py-5 bg-green-600 hover:bg-green-700 text-white text-xl font-bold rounded-xl transition-colors disabled:opacity-50 touch-manipulation"
              >
                {submitting ? 'Placing Order...' : 'Place Order for Pickup'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Thank You
  if (step === 'thank-you') {
    return (
      <div className="min-h-screen bg-green-600 flex items-center justify-center p-8">
        <div className="text-center max-w-lg">
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-8">
            <CheckCircle className="w-14 h-14 text-green-600" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Thank You!</h1>
          <p className="text-xl text-green-100 mb-6">Your order has been placed</p>
          <div className="bg-white/20 backdrop-blur rounded-2xl p-6 mb-8">
            <p className="text-green-100 text-lg mb-1">Order Number</p>
            <p className="text-4xl font-bold text-white">{orderNumber}</p>
          </div>
          <p className="text-green-100 text-lg mb-8">
            Please wait for your name to be called at the counter.
          </p>
          <button
            onClick={resetKiosk}
            className="px-8 py-4 bg-white text-green-700 text-xl font-bold rounded-xl hover:bg-green-50 transition-colors touch-manipulation"
          >
            Start New Order
          </button>
          <p className="text-green-200 text-sm mt-6">
            This screen will reset automatically in 60 seconds
          </p>
        </div>
      </div>
    );
  }

  return null;
}
