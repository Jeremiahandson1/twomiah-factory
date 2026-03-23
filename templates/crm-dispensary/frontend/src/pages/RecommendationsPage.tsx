import { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, User, Search, Sparkles, BarChart3,
  RefreshCw, Package, ArrowUpRight, ArrowDownRight, Minus, Star
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';

const strainColors: Record<string, string> = {
  sativa: 'bg-orange-100 text-orange-700',
  indica: 'bg-purple-100 text-purple-700',
  hybrid: 'bg-green-100 text-green-700',
  cbd: 'bg-blue-100 text-blue-700',
};

export default function RecommendationsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('trending');
  const [loading, setLoading] = useState(false);

  // Trending
  const [trendingProducts, setTrendingProducts] = useState<any[]>([]);
  const [trendingPage, setTrendingPage] = useState(1);
  const [trendingPagination, setTrendingPagination] = useState<any>(null);

  // Customer Recommendations
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [customerRecs, setCustomerRecs] = useState<any[]>([]);
  const [searchingCustomers, setSearchingCustomers] = useState(false);

  // Similar Products
  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [similarProducts, setSimilarProducts] = useState<any[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);

  // Performance
  const [performance, setPerformance] = useState<any>(null);

  useEffect(() => {
    if (tab === 'trending') loadTrending();
    if (tab === 'performance') loadPerformance();
  }, [tab, trendingPage]);

  const loadTrending = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/recommendations/trending', { page: trendingPage, limit: 20 });
      setTrendingProducts(Array.isArray(data) ? data : data?.data || []);
      if (data?.pagination) setTrendingPagination(data.pagination);
    } catch (err) {
      toast.error('Failed to load trending products');
    } finally {
      setLoading(false);
    }
  };

  const searchCustomers = async () => {
    if (!customerSearch.trim()) return;
    setSearchingCustomers(true);
    try {
      const data = await api.get('/api/customers', { search: customerSearch.trim(), limit: 10 });
      setCustomerResults(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to search customers');
    } finally {
      setSearchingCustomers(false);
    }
  };

  const loadCustomerRecs = async (customer: any) => {
    setSelectedCustomer(customer);
    setCustomerResults([]);
    setLoading(true);
    try {
      const data = await api.get(`/api/recommendations/for-customer/${customer.id}`);
      setCustomerRecs(Array.isArray(data) ? data : data?.data || data?.recommendations || []);
    } catch (err) {
      toast.error('Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  };

  const searchProducts = async () => {
    if (!productSearch.trim()) return;
    setSearchingProducts(true);
    try {
      const data = await api.get('/api/products', { search: productSearch.trim(), limit: 10 });
      setProductResults(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to search products');
    } finally {
      setSearchingProducts(false);
    }
  };

  const loadSimilar = async (product: any) => {
    setSelectedProduct(product);
    setProductResults([]);
    setLoading(true);
    try {
      const data = await api.get(`/api/recommendations/similar/${product.id}`);
      setSimilarProducts(Array.isArray(data) ? data : data?.data || data?.products || []);
    } catch (err) {
      toast.error('Failed to load similar products');
    } finally {
      setLoading(false);
    }
  };

  const loadPerformance = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/recommendations/performance');
      setPerformance(data);
    } catch (err) {
      toast.error('Failed to load performance data');
    } finally {
      setLoading(false);
    }
  };

  const getTrendIcon = (direction: string) => {
    if (direction === 'up') return <ArrowUpRight className="w-4 h-4 text-green-500" />;
    if (direction === 'down') return <ArrowDownRight className="w-4 h-4 text-red-500" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  const tabs = [
    { id: 'trending', label: 'Trending', icon: TrendingUp },
    { id: 'customer', label: 'Customer Recommendations', icon: User },
    { id: 'similar', label: 'Similar Products', icon: Package },
    { id: 'performance', label: 'Performance', icon: BarChart3 },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Recommendations</h1>
          <p className="text-gray-600">Product recommendations and trending insights</p>
        </div>
        <button
          onClick={() => {
            if (tab === 'trending') loadTrending();
            if (tab === 'performance') loadPerformance();
          }}
          className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'border-green-600 text-green-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Trending */}
      {tab === 'trending' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {trendingProducts.map(product => (
                  <div key={product.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 line-clamp-1">{product.name}</h3>
                        <p className="text-sm text-gray-500 capitalize">{product.category || '--'}</p>
                      </div>
                      {getTrendIcon(product.trendDirection)}
                    </div>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {product.strainType && (
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${strainColors[product.strainType?.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
                          {product.strainType}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-bold text-green-700 text-lg">${Number(product.price || 0).toFixed(2)}</span>
                      <span className="text-gray-500">{product.orderCount ?? 0} orders</span>
                    </div>
                  </div>
                ))}
              </div>
              {trendingProducts.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <TrendingUp className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No trending products yet</p>
                </div>
              )}

              {trendingPagination && trendingPagination.pages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-gray-600">Page {trendingPagination.page} of {trendingPagination.pages}</p>
                  <div className="flex gap-2">
                    <button onClick={() => setTrendingPage(p => Math.max(1, p - 1))} disabled={trendingPage <= 1} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">Previous</button>
                    <button onClick={() => setTrendingPage(p => p + 1)} disabled={trendingPage >= trendingPagination.pages} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Customer Recommendations */}
      {tab === 'customer' && (
        <div>
          {/* Search */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search for a customer</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchCustomers()}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="Name, email, or phone..."
                />
              </div>
              <Button onClick={searchCustomers} disabled={searchingCustomers}>
                {searchingCustomers ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {/* Search results dropdown */}
            {customerResults.length > 0 && (
              <div className="mt-2 bg-white border border-gray-200 rounded-lg shadow-lg divide-y max-h-48 overflow-y-auto">
                {customerResults.map(c => (
                  <button
                    key={c.id}
                    onClick={() => loadCustomerRecs(c)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <p className="font-medium text-gray-900">{c.name || c.firstName + ' ' + c.lastName}</p>
                    <p className="text-sm text-gray-500">{c.email || c.phone || '--'}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected customer */}
          {selectedCustomer && (
            <div className="mb-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-green-800">
                    Recommendations for {selectedCustomer.name || selectedCustomer.firstName + ' ' + selectedCustomer.lastName}
                  </p>
                  <p className="text-sm text-green-600">{selectedCustomer.email || ''}</p>
                </div>
                <button
                  onClick={() => { setSelectedCustomer(null); setCustomerRecs([]); }}
                  className="text-green-600 hover:text-green-800"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : selectedCustomer ? (
            <div className="space-y-3">
              {customerRecs.map((rec, idx) => (
                <div key={rec.id || idx} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{rec.productName || rec.name}</h3>
                    <p className="text-sm text-gray-500">{rec.reason || 'Recommended based on purchase history'}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-700">${Number(rec.price || 0).toFixed(2)}</p>
                    {rec.relevanceScore != null && (
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Star className="w-3 h-3 text-yellow-500" />
                        {(rec.relevanceScore * 100).toFixed(0)}% match
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {customerRecs.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Sparkles className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No recommendations available for this customer</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <User className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Search for a customer to see personalized recommendations</p>
            </div>
          )}
        </div>
      )}

      {/* Similar Products */}
      {tab === 'similar' && (
        <div>
          {/* Search */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search for a product</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchProducts()}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                  placeholder="Product name..."
                />
              </div>
              <Button onClick={searchProducts} disabled={searchingProducts}>
                {searchingProducts ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {productResults.length > 0 && (
              <div className="mt-2 bg-white border border-gray-200 rounded-lg shadow-lg divide-y max-h-48 overflow-y-auto">
                {productResults.map(p => (
                  <button
                    key={p.id}
                    onClick={() => loadSimilar(p)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <p className="font-medium text-gray-900">{p.name}</p>
                    <p className="text-sm text-gray-500">{p.category} | ${Number(p.price || 0).toFixed(2)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedProduct && (
            <div className="mb-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-green-800">Similar to: {selectedProduct.name}</p>
                  <p className="text-sm text-green-600">{selectedProduct.category} | ${Number(selectedProduct.price || 0).toFixed(2)}</p>
                </div>
                <button
                  onClick={() => { setSelectedProduct(null); setSimilarProducts([]); }}
                  className="text-green-600 hover:text-green-800"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : selectedProduct ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {similarProducts.map((product, idx) => (
                <div key={product.id || idx} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <h3 className="font-semibold text-gray-900 mb-1">{product.name}</h3>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {product.strainType && (
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${strainColors[product.strainType?.toLowerCase()] || 'bg-gray-100 text-gray-600'}`}>
                        {product.strainType}
                      </span>
                    )}
                    {product.category && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 capitalize">
                        {product.category}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-green-700">${Number(product.price || 0).toFixed(2)}</span>
                    {product.similarityScore != null && (
                      <span className="text-sm text-gray-500">{(product.similarityScore * 100).toFixed(0)}% similar</span>
                    )}
                  </div>
                </div>
              ))}
              {similarProducts.length === 0 && (
                <div className="col-span-full text-center py-12 text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No similar products found</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Package className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Search for a product to find similar items</p>
            </div>
          )}
        </div>
      )}

      {/* Performance */}
      {tab === 'performance' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : performance ? (
            <>
              {/* KPIs */}
              <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <p className="text-sm text-gray-500 mb-1">Click Rate</p>
                  <p className="text-2xl font-bold text-gray-900">{performance.clickRate ?? 0}%</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <p className="text-sm text-gray-500 mb-1">Purchase Rate</p>
                  <p className="text-2xl font-bold text-gray-900">{performance.purchaseRate ?? 0}%</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <p className="text-sm text-gray-500 mb-1">Revenue Attributed</p>
                  <p className="text-2xl font-bold text-green-700">${Number(performance.revenueAttributed || 0).toLocaleString()}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <p className="text-sm text-gray-500 mb-1">Total Impressions</p>
                  <p className="text-2xl font-bold text-gray-900">{Number(performance.totalImpressions || 0).toLocaleString()}</p>
                </div>
              </div>

              {/* Chart placeholders */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-900 mb-4">Click Rate Over Time</h3>
                  <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 h-48 flex items-center justify-center">
                    <p className="text-sm text-gray-400">Chart placeholder</p>
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
                  <h3 className="font-semibold text-gray-900 mb-4">Revenue from Recommendations</h3>
                  <div className="bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 h-48 flex items-center justify-center">
                    <p className="text-sm text-gray-400">Chart placeholder</p>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No performance data available</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
