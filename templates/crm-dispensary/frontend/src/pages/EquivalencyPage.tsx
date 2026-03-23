import { useState, useEffect } from 'react';
import { Scale, Plus, Edit, Trash2, Calculator, List, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const initialRuleForm = {
  state: '',
  category: '',
  equivalencyGrams: '',
  purchaseLimitGrams: '',
  description: '',
};

export default function EquivalencyPage() {
  const toast = useToast();
  const [tab, setTab] = useState('rules');

  // Rules
  const [rules, setRules] = useState<any[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [ruleModal, setRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [ruleForm, setRuleForm] = useState(initialRuleForm);
  const [savingRule, setSavingRule] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<any>(null);
  const [deletingRule, setDeletingRule] = useState(false);

  // Calculator
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [selectedQty, setSelectedQty] = useState('1');
  const [purchaseLimit, setPurchaseLimit] = useState(28); // default 1oz = 28g

  useEffect(() => {
    loadRules();
    loadProducts();
  }, []);

  const loadRules = async () => {
    setLoadingRules(true);
    try {
      const data = await api.get('/api/equivalency/rules');
      setRules(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load equivalency rules');
    } finally {
      setLoadingRules(false);
    }
  };

  const loadProducts = async () => {
    try {
      const data = await api.get('/api/products', { limit: 200 });
      setProducts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load products:', err);
    }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      await api.post('/api/equivalency/rules/seed-defaults');
      toast.success('Default rules seeded');
      loadRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to seed defaults');
    } finally {
      setSeeding(false);
    }
  };

  const openCreateRule = () => {
    setEditingRule(null);
    setRuleForm(initialRuleForm);
    setRuleModal(true);
  };

  const openEditRule = (rule: any) => {
    setEditingRule(rule);
    setRuleForm({
      state: rule.state || '',
      category: rule.category || '',
      equivalencyGrams: String(rule.equivalencyGrams || ''),
      purchaseLimitGrams: String(rule.purchaseLimitGrams || ''),
      description: rule.description || '',
    });
    setRuleModal(true);
  };

  const handleSaveRule = async () => {
    if (!ruleForm.category.trim()) {
      toast.error('Category is required');
      return;
    }
    setSavingRule(true);
    try {
      const payload = {
        ...ruleForm,
        equivalencyGrams: parseFloat(ruleForm.equivalencyGrams) || 0,
        purchaseLimitGrams: parseFloat(ruleForm.purchaseLimitGrams) || 0,
      };
      if (editingRule) {
        await api.put(`/api/equivalency/rules/${editingRule.id}`, payload);
        toast.success('Rule updated');
      } else {
        await api.post('/api/equivalency/rules', payload);
        toast.success('Rule created');
      }
      setRuleModal(false);
      loadRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save rule');
    } finally {
      setSavingRule(false);
    }
  };

  const handleDeleteRule = async () => {
    if (!ruleToDelete) return;
    setDeletingRule(true);
    try {
      await api.delete(`/api/equivalency/rules/${ruleToDelete.id}`);
      toast.success('Rule deleted');
      setDeleteOpen(false);
      setRuleToDelete(null);
      loadRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete rule');
    } finally {
      setDeletingRule(false);
    }
  };

  // Calculator logic
  const addToCart = () => {
    const product = products.find(p => p.id === selectedProduct);
    if (!product) {
      toast.error('Select a product');
      return;
    }
    const qty = parseInt(selectedQty) || 1;
    const rule = rules.find(r => r.category === (product.category || product.productType));
    const equivalentGrams = (rule?.equivalencyGrams || 1) * qty;

    setCartItems([...cartItems, {
      id: Date.now(),
      productId: product.id,
      productName: product.name,
      category: product.category || product.productType || '—',
      quantity: qty,
      equivalentGrams,
      ruleEquivalency: rule?.equivalencyGrams || 1,
    }]);
    setSelectedProduct('');
    setSelectedQty('1');
  };

  const removeFromCart = (itemId: number) => {
    setCartItems(cartItems.filter(i => i.id !== itemId));
  };

  const totalEquivalentGrams = cartItems.reduce((sum, item) => sum + item.equivalentGrams, 0);
  const limitPercentage = Math.min((totalEquivalentGrams / purchaseLimit) * 100, 100);
  const overLimit = totalEquivalentGrams > purchaseLimit;

  const tabs = [
    { id: 'rules', label: 'Rules', icon: List },
    { id: 'calculator', label: 'Calculator', icon: Calculator },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Product Equivalency</h1>
          <p className="text-gray-600">Flower equivalency rules and purchase limit calculator</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
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

      {/* Rules Tab */}
      {tab === 'rules' && (
        <div>
          <div className="flex justify-end gap-3 mb-4">
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {seeding ? 'Seeding...' : 'Seed Defaults'}
            </button>
            <Button onClick={openCreateRule}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Rule
            </Button>
          </div>

          {loadingRules ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">State</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Equivalency (g)</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Purchase Limit (g)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rules.map(rule => (
                    <tr key={rule.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-700">{rule.state || 'All'}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{rule.category}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{rule.equivalencyGrams}g</td>
                      <td className="px-4 py-3 text-right text-gray-700">{rule.purchaseLimitGrams}g</td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{rule.description || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => openEditRule(rule)} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                            <Edit className="w-3 h-3" /> Edit
                          </button>
                          <button onClick={() => { setRuleToDelete(rule); setDeleteOpen(true); }} className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1">
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                        <Scale className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>No equivalency rules configured</p>
                        <p className="text-sm mt-1">Click "Seed Defaults" to load standard rules or add your own</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Calculator Tab */}
      {tab === 'calculator' && (
        <div className="max-w-2xl space-y-6">
          {/* Add product */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Calculator className="w-5 h-5 text-green-600" />
              Add Products
            </h3>
            <div className="flex gap-3">
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              >
                <option value="">Select product...</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.category || p.productType || '—'})</option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={selectedQty}
                onChange={(e) => setSelectedQty(e.target.value)}
                className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-center"
                placeholder="Qty"
              />
              <Button onClick={addToCart}>Add</Button>
            </div>
          </div>

          {/* Purchase Limit Bar */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900">Purchase Limit</h3>
              <span className={`text-sm font-medium ${overLimit ? 'text-red-600' : 'text-gray-600'}`}>
                {totalEquivalentGrams.toFixed(1)}g / {purchaseLimit}g
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
              <div
                className={`h-4 rounded-full transition-all ${
                  overLimit ? 'bg-red-500' : limitPercentage > 80 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(limitPercentage, 100)}%` }}
              />
            </div>
            {overLimit && (
              <div className="flex items-center gap-2 mt-3 text-red-600">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">
                  Over purchase limit by {(totalEquivalentGrams - purchaseLimit).toFixed(1)}g!
                </span>
              </div>
            )}
          </div>

          {/* Cart Items */}
          <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-gray-100">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Equiv/Unit (g)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total (g)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cartItems.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.productName}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.category}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{item.ruleEquivalency}g</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{item.equivalentGrams.toFixed(1)}g</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => removeFromCart(item.id)} className="text-red-500 hover:text-red-700">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {cartItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      Add products above to calculate equivalency
                    </td>
                  </tr>
                )}
              </tbody>
              {cartItems.length > 0 && (
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-right font-semibold text-gray-900">Total Flower Equivalent:</td>
                    <td className={`px-4 py-3 text-right font-bold ${overLimit ? 'text-red-600' : 'text-green-600'}`}>
                      {totalEquivalentGrams.toFixed(1)}g
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Rule Modal */}
      <Modal
        isOpen={ruleModal}
        onClose={() => setRuleModal(false)}
        title={editingRule ? 'Edit Equivalency Rule' : 'New Equivalency Rule'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State (leave blank for all)</label>
            <input
              type="text"
              value={ruleForm.state}
              onChange={(e) => setRuleForm({ ...ruleForm, state: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="CO, CA, etc."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
            <input
              type="text"
              value={ruleForm.category}
              onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Concentrates, Edibles, Flower, etc."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Equivalency (grams)</label>
              <input
                type="number"
                step="0.1"
                value={ruleForm.equivalencyGrams}
                onChange={(e) => setRuleForm({ ...ruleForm, equivalencyGrams: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                placeholder="3.5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Limit (grams)</label>
              <input
                type="number"
                step="0.1"
                value={ruleForm.purchaseLimitGrams}
                onChange={(e) => setRuleForm({ ...ruleForm, purchaseLimitGrams: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                placeholder="28"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={ruleForm.description}
              onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="e.g., 1g concentrate = 3.5g flower equivalent"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setRuleModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveRule} disabled={savingRule}>
            {savingRule ? 'Saving...' : editingRule ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => { setDeleteOpen(false); setRuleToDelete(null); }}
        onConfirm={handleDeleteRule}
        title="Delete Rule"
        message={`Are you sure you want to delete the "${ruleToDelete?.category}" equivalency rule?`}
        confirmText="Delete"
        loading={deletingRule}
      />
    </div>
  );
}
