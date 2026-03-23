import { useState, useEffect } from 'react';
import {
  ShoppingCart, Plus, Package, Truck, Check, X, Search,
  ChevronDown, ChevronRight, FileText, Sparkles
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-purple-100 text-purple-700',
  shipped: 'bg-yellow-100 text-yellow-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  partial: 'bg-orange-100 text-orange-700',
};

export default function PurchaseOrdersPage() {
  const toast = useToast();
  const [tab, setTab] = useState('orders');
  const [loading, setLoading] = useState(true);

  // Orders
  const [orders, setOrders] = useState<any[]>([]);
  const [orderModal, setOrderModal] = useState(false);
  const [orderForm, setOrderForm] = useState({
    supplierName: '', supplierEmail: '', supplierPhone: '',
    expectedDate: '', notes: '',
  });
  const [lineItems, setLineItems] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [creatingSuggested, setCreatingSuggested] = useState(false);

  // Receive
  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [receiveItems, setReceiveItems] = useState<Record<string, string>>({});
  const [receiving, setReceiving] = useState(false);

  // By supplier
  const [supplierGroups, setSupplierGroups] = useState<any[]>([]);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  useEffect(() => {
    if (tab === 'orders') loadOrders();
    if (tab === 'receive') loadOrders();
    if (tab === 'by-supplier') loadBySupplier();
  }, [tab]);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/purchase-orders', { limit: 50 });
      setOrders(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load purchase orders');
    } finally {
      setLoading(false);
    }
  };

  const loadBySupplier = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/purchase-orders/by-supplier');
      setSupplierGroups(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load supplier data');
    } finally {
      setLoading(false);
    }
  };

  const searchProducts = async (query: string) => {
    setProductSearch(query);
    if (query.length < 2) { setSearchResults([]); return; }
    try {
      const data = await api.get('/api/products', { search: query, limit: 10 });
      setSearchResults(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      // Silently fail search
    }
  };

  const addLineItem = (product: any) => {
    if (lineItems.find(li => li.productId === product.id)) {
      toast.error('Product already added');
      return;
    }
    setLineItems([...lineItems, {
      productId: product.id, productName: product.name, sku: product.sku || '',
      quantity: '1', unitCost: String(product.wholesalePrice || product.cost || ''),
    }]);
    setProductSearch('');
    setSearchResults([]);
  };

  const updateLineItem = (index: number, updates: any) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], ...updates };
    setLineItems(updated);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const getLineTotal = () => {
    return lineItems.reduce((sum, li) => sum + (parseFloat(li.quantity) || 0) * (parseFloat(li.unitCost) || 0), 0);
  };

  const handleCreatePO = async () => {
    if (!orderForm.supplierName) { toast.error('Supplier name required'); return; }
    if (lineItems.length === 0) { toast.error('Add at least one item'); return; }
    setSaving(true);
    try {
      await api.post('/api/purchase-orders', {
        ...orderForm,
        items: lineItems.map(li => ({
          ...li,
          quantity: parseInt(li.quantity) || 1,
          unitCost: parseFloat(li.unitCost) || 0,
        })),
      });
      toast.success('Purchase order created');
      setOrderModal(false);
      setOrderForm({ supplierName: '', supplierEmail: '', supplierPhone: '', expectedDate: '', notes: '' });
      setLineItems([]);
      loadOrders();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create PO');
    } finally {
      setSaving(false);
    }
  };

  const createFromSuggestions = async () => {
    setCreatingSuggested(true);
    try {
      const data = await api.post('/api/purchase-orders/from-suggestions');
      toast.success(`${data?.created || 0} purchase orders created from reorder suggestions`);
      loadOrders();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create from suggestions');
    } finally {
      setCreatingSuggested(false);
    }
  };

  const selectPOForReceive = async (po: any) => {
    try {
      const data = await api.get(`/api/purchase-orders/${po.id}`);
      setSelectedPO(data);
      const items: Record<string, string> = {};
      (data?.items || []).forEach((_: any, index: number) => { items[String(index)] = ''; });
      setReceiveItems(items);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load PO details');
    }
  };

  const handleReceive = async () => {
    if (!selectedPO) return;
    setReceiving(true);
    try {
      const items = Object.entries(receiveItems)
        .filter(([_, qty]) => qty && parseInt(qty) > 0)
        .map(([itemIndex, qty]) => ({ itemIndex: parseInt(itemIndex), receivedQty: parseInt(qty) }));
      if (items.length === 0) { toast.error('Enter received quantities'); setReceiving(false); return; }
      await api.put(`/api/purchase-orders/${selectedPO.id}/receive`, { items });
      toast.success('Inventory updated');
      setSelectedPO(null);
      loadOrders();
    } catch (err: any) {
      toast.error(err.message || 'Failed to receive items');
    } finally {
      setReceiving(false);
    }
  };

  const receivableOrders = orders.filter(o => ['submitted', 'confirmed', 'shipped', 'partial'].includes(o.status));

  const tabs = [
    { id: 'orders', label: 'Orders', icon: FileText },
    { id: 'receive', label: 'Receive', icon: Package },
    { id: 'by-supplier', label: 'By Supplier', icon: Truck },
  ];

  return (
    <div>
      <PageHeader title="Purchase Orders" action={
        <div className="flex gap-2">
          <button onClick={createFromSuggestions} disabled={creatingSuggested}
            className="flex items-center gap-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">
            <Sparkles className="w-4 h-4" />{creatingSuggested ? 'Creating...' : 'From Suggestions'}
          </button>
          <Button onClick={() => setOrderModal(true)}><Plus className="w-4 h-4 mr-2 inline" />Create PO</Button>
        </div>
      } />

      <div className="flex gap-1 mb-6 overflow-x-auto border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Orders Tab */}
      {tab === 'orders' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No purchase orders yet</div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">PO #</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Supplier</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Items</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Total</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Expected</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(po => (
                    <tr key={po.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-green-600">{po.poNumber || po.id?.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-sm font-medium">{po.supplierName}</td>
                      <td className="px-4 py-3 text-sm">{po.itemCount || 0}</td>
                      <td className="px-4 py-3 text-sm font-medium">${(po.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[po.status] || 'bg-gray-100 text-gray-700'}`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{po.expectedDate || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{po.createdAt ? new Date(po.createdAt).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Receive Tab */}
      {tab === 'receive' && (
        <div>
          {!selectedPO ? (
            <div>
              <h3 className="text-lg font-semibold mb-4">Select a PO to Receive</h3>
              {receivableOrders.length === 0 ? (
                <div className="text-center py-12 text-gray-500">No POs waiting to be received</div>
              ) : (
                <div className="space-y-3">
                  {receivableOrders.map(po => (
                    <div key={po.id} className="border rounded-lg p-4 bg-white flex items-center justify-between hover:bg-gray-50 cursor-pointer"
                      onClick={() => selectPOForReceive(po)}>
                      <div>
                        <div className="font-medium">{po.poNumber || po.id?.slice(0, 8)} &mdash; {po.supplierName}</div>
                        <div className="text-sm text-gray-500">{po.itemCount || 0} items &middot; ${(po.total || 0).toFixed(2)}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[po.status] || ''}`}>{po.status}</span>
                        <ChevronRight className="w-5 h-5 text-gray-400" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">
                  Receiving: {selectedPO.poNumber || selectedPO.id?.slice(0, 8)} &mdash; {selectedPO.supplierName}
                </h3>
                <button onClick={() => setSelectedPO(null)} className="text-gray-500 hover:text-gray-700"><X className="w-5 h-5" /></button>
              </div>
              <div className="overflow-x-auto border rounded-lg mb-4">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Product</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">SKU</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Ordered</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Already Received</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Receive Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedPO.items || []).map((item: any, index: number) => (
                      <tr key={index} className="border-t">
                        <td className="px-4 py-3 text-sm font-medium">{item.productName}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{item.sku || '-'}</td>
                        <td className="px-4 py-3 text-sm">{item.quantity}</td>
                        <td className="px-4 py-3 text-sm">{item.receivedQuantity || 0}</td>
                        <td className="px-4 py-3">
                          <input type="number" min="0" max={item.quantity - (item.receivedQuantity || 0)}
                            value={receiveItems[String(index)] || ''} onChange={e => setReceiveItems({ ...receiveItems, [String(index)]: e.target.value })}
                            className="w-24 px-2 py-1 border rounded text-sm" placeholder="0" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button onClick={handleReceive} disabled={receiving}>
                <Check className="w-4 h-4 mr-2 inline" />{receiving ? 'Receiving...' : 'Receive Items'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* By Supplier Tab */}
      {tab === 'by-supplier' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : supplierGroups.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No suppliers found</div>
          ) : (
            <div className="space-y-3">
              {supplierGroups.map(group => (
                <div key={group.supplierName} className="border rounded-lg bg-white">
                  <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                    onClick={() => setExpandedSupplier(expandedSupplier === group.supplierName ? null : group.supplierName)}>
                    <div>
                      <div className="font-semibold">{group.supplierName}</div>
                      <div className="text-sm text-gray-500">{group.orderCount} orders &middot; Total: ${(group.totalSpent || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>
                    {expandedSupplier === group.supplierName ? <ChevronDown className="w-5 h-5 text-gray-400" /> : <ChevronRight className="w-5 h-5 text-gray-400" />}
                  </div>
                  {expandedSupplier === group.supplierName && (
                    <div className="border-t px-4 pb-4">
                      <table className="w-full mt-2">
                        <thead>
                          <tr className="text-left text-xs text-gray-500">
                            <th className="py-2">PO #</th>
                            <th className="py-2">Status</th>
                            <th className="py-2">Total</th>
                            <th className="py-2">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(group.orders || []).map((po: any) => (
                            <tr key={po.id} className="border-t text-sm">
                              <td className="py-2 text-green-600">{po.poNumber || po.id?.slice(0, 8)}</td>
                              <td className="py-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLES[po.status] || ''}`}>{po.status}</span>
                              </td>
                              <td className="py-2">${(po.total || 0).toFixed(2)}</td>
                              <td className="py-2 text-gray-500">{po.createdAt ? new Date(po.createdAt).toLocaleDateString() : '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create PO Modal */}
      <Modal isOpen={orderModal} onClose={() => setOrderModal(false)} title="Create Purchase Order" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Supplier Name *</label>
            <input value={orderForm.supplierName} onChange={e => setOrderForm({ ...orderForm, supplierName: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" placeholder="Supplier name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Supplier Email</label>
              <input type="email" value={orderForm.supplierEmail} onChange={e => setOrderForm({ ...orderForm, supplierEmail: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Supplier Phone</label>
              <input value={orderForm.supplierPhone} onChange={e => setOrderForm({ ...orderForm, supplierPhone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Expected Delivery Date</label>
            <input type="date" value={orderForm.expectedDate} onChange={e => setOrderForm({ ...orderForm, expectedDate: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" />
          </div>

          {/* Line Items */}
          <div>
            <label className="block text-sm font-medium mb-2">Line Items</label>
            <div className="relative mb-2">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
              <input value={productSearch} onChange={e => searchProducts(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border rounded-lg text-sm" placeholder="Search products to add..." />
              {searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 bg-white border rounded-b-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                  {searchResults.map(p => (
                    <div key={p.id} className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm flex justify-between"
                      onClick={() => addLineItem(p)}>
                      <span>{p.name}</span>
                      <span className="text-gray-400">{p.sku}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {lineItems.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left">
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2 w-20">Qty</th>
                      <th className="px-3 py-2 w-28">Unit Cost</th>
                      <th className="px-3 py-2 w-24">Subtotal</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((li, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-2">{li.productName}</td>
                        <td className="px-3 py-2">
                          <input type="number" min="1" value={li.quantity} onChange={e => updateLineItem(i, { quantity: e.target.value })}
                            className="w-full px-2 py-1 border rounded text-sm" />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" step="0.01" value={li.unitCost} onChange={e => updateLineItem(i, { unitCost: e.target.value })}
                            className="w-full px-2 py-1 border rounded text-sm" />
                        </td>
                        <td className="px-3 py-2 font-medium">${((parseFloat(li.quantity) || 0) * (parseFloat(li.unitCost) || 0)).toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <button onClick={() => removeLineItem(i)} className="text-red-500 hover:text-red-700"><X className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-gray-50">
                      <td colSpan={3} className="px-3 py-2 text-right font-medium">Total:</td>
                      <td className="px-3 py-2 font-bold">${getLineTotal().toFixed(2)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={orderForm.notes} onChange={e => setOrderForm({ ...orderForm, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" rows={2} />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setOrderModal(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
          <Button onClick={handleCreatePO} disabled={saving}>{saving ? 'Creating...' : 'Create PO'}</Button>
        </div>
      </Modal>
    </div>
  );
}
