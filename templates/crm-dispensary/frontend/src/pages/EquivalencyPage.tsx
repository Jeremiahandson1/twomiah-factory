import { useState, useEffect } from 'react';
import { Scale, Plus, Edit, Trash2, Calculator, List, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
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
  // Owner/admin may change the factors; a manager reads them. Same authority as the purchase limit,
  // because these decide what a gram is WORTH against it. (T39 M1 / T40 M2)
  const { isAdmin } = useAuth();
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

/**
 * THE FACTOR WAS ON EVERY ROW AND THE PAGE WAS READING THE WRONG KEY. (T41)
 *
 *   "Equivalency rules table shows a bare 'g' with no factor on every row (the API has the values);
 *    edible rows show 'g' instead of mg THC."
 *
 * The column is `equivalency_factor` and GET /api/equivalency/rules camelises it to
 * `equivalencyFactor`. This page asked for `equivalencyGrams` — a name the WRITE path accepts as
 * a synonym, which is why creating a rule worked and reading one back did not. `{undefined}g`
 * renders as a lone "g", on every row, next to a limit that rendered fine.
 *
 * Worse than the display: the Edit dialog prefilled from the same missing key, so opening a rule
 * showed an empty factor box and saving it stored ZERO — which turns a purchase limit into no limit
 * at all on a seed-to-sale till. And the in-page calculator fell back to 1 gram per unit, so it
 * agreed with neither the rule nor the register.
 *
 * One reader, used by all four places, accepting the old name so nothing breaks mid-deploy.
 */
const factorOf = (rule: any): number => Number(rule?.equivalencyFactor ?? rule?.equivalencyGrams ?? 0)
/**
 * …and the UNIT the factor is per. An edible's equivalency is per MILLIGRAM of THC, not per gram of
 * product, and printing "g" against it states the wrong rule to whoever is checking the limit.
 * `unit_of_measure` carries it (grams|mg|ml|each); 'each' reads as a count, so it gets no suffix.
 */
const unitOf = (rule: any): string => {
  const u = String(rule?.unitOfMeasure ?? 'g').trim().toLowerCase()
  if (u === 'each' || u === 'unit' || u === 'units') return ''
  if (u === 'grams' || u === 'gram') return 'g'
  return u
}

  const openEditRule = (rule: any) => {
    setEditingRule(rule);
    setRuleForm({
      state: rule.state || '',
      category: rule.category || '',
      equivalencyGrams: String(factorOf(rule) || ''),
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
    // The rule's own factor. Falling back to 1 made the calculator disagree with the register.
    const equivalentGrams = (factorOf(rule) || 1) * qty;

    setCartItems([...cartItems, {
      id: Date.now(),
      productId: product.id,
      productName: product.name,
      category: product.category || product.productType || '—',
      quantity: qty,
      equivalentGrams,
      ruleEquivalency: factorOf(rule) || 1,
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Product Equivalency</h1>
          <p className="text-gray-600 dark:text-slate-400">Flower equivalency rules and purchase limit calculator</p>
        </div>
      </div>

      {/* These rules are what the register converts a basket with before applying the purchase limit, so
          they decide which sales it refuses. They are seeded with the common standard table rather than
          left empty (an empty table lets concentrate through a flower cap), which means they are a
          starting point and not a statement of any state's law. Say so, where the operator sets them. */}
      <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200" role="note">
        <span className="font-medium">These factors decide which sales the register refuses.</span>{' '}
        New accounts start from a standard equivalency table — concentrates and vapes at 2.5&times;, edibles
        and tinctures at 10&nbsp;mg THC to the gram, topicals not counted. They are a starting point, not
        legal advice: check them against your state&rsquo;s rules and edit them here.
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap flex-shrink-0 transition-colors ${
              tab === t.id
                ? 'border-green-600 text-green-700 dark:text-green-300'
                : 'border-transparent text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-slate-200'
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
            {/* admin only: this REPLACES the shop's factors, which are its limit (T41) */}
            {isAdmin && (
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 dark:text-slate-200 dark:bg-slate-900 dark:border-slate-700"
            >
              {seeding ? 'Seeding...' : 'Seed Defaults'}
            </button>
            )}
            {isAdmin && (
            <Button onClick={openCreateRule}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Rule
            </Button>
            )}
          </div>

          {loadingRules ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-x-auto dark:bg-slate-900">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-slate-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">State</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Category</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400" title="Grams of flower this category is worth against the purchase limit">Flower-equivalent</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400" title="The unit the factor is per — an edible's is per mg of THC, not per gram of product">Per</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Purchase Limit (g)</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Description</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rules.map(rule => (
                    <tr key={rule.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">{rule.state || 'All'}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">{rule.category}</td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">{factorOf(rule) || '—'}{factorOf(rule) ? 'g' : ''}</td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-slate-400">{unitOf(rule) ? `per ${unitOf(rule)}` : 'each'}</td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">{rule.purchaseLimitGrams}g</td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate dark:text-slate-400">{rule.description || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {isAdmin && (<>
                          <button onClick={() => openEditRule(rule)} className="text-sm text-gray-600 hover:text-gray-900 dark:hover:text-slate-200 flex items-center gap-1 dark:text-slate-400">
                            <Edit className="w-3 h-3" /> Edit
                          </button>
                          <button onClick={() => { setRuleToDelete(rule); setDeleteOpen(true); }} className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 flex items-center gap-1">
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                          </>)}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {rules.length === 0 && (
                    <tr>
                      {/* 7, not 6: the "Per" column was added beside the flower-equivalent factor
                          (T41), so the empty-state row has to span one more or the table shifts. */}
                      <td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">
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
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 dark:bg-slate-900">
            <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 dark:text-slate-100">
              <Calculator className="w-5 h-5 text-green-700 dark:text-green-300" />
              Add Products
            </h3>
            <div className="flex gap-3">
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
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
                className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-center dark:border-slate-700 dark:text-slate-100"
                placeholder="Qty"
              />
              <Button onClick={addToCart}>Add</Button>
            </div>
          </div>

          {/* Purchase Limit Bar */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 dark:bg-slate-900">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900 dark:text-slate-100">Purchase Limit</h3>
              <span className={`text-sm font-medium ${overLimit ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-slate-300'}`}>
                {Number(totalEquivalentGrams).toFixed(1)}g / {purchaseLimit}g
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden dark:bg-slate-700 dark:text-slate-100">
              <div
                className={`h-4 rounded-full transition-all ${
                  overLimit ? 'bg-red-500' : limitPercentage > 80 ? 'bg-yellow-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(limitPercentage, 100)}%` }}
              />
            </div>
            {overLimit && (
              <div className="flex items-center gap-2 mt-3 text-red-600 dark:text-red-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">
                  Over purchase limit by {Number(totalEquivalentGrams - purchaseLimit).toFixed(1)}g!
                </span>
              </div>
            )}
          </div>

          {/* Cart Items */}
          <div className="bg-white rounded-lg shadow-sm overflow-x-auto border border-gray-100 dark:bg-slate-900">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-slate-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Product</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Category</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Equiv/Unit (g)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400">Total (g)</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase dark:text-slate-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cartItems.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">{item.productName}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">{item.category}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">{item.ruleEquivalency}g</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-slate-100">{Number(item.equivalentGrams).toFixed(1)}g</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => removeFromCart(item.id)} className="text-red-500 hover:text-red-700 dark:hover:text-red-300 dark:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {cartItems.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">
                      Add products above to calculate equivalency
                    </td>
                  </tr>
                )}
              </tbody>
              {cartItems.length > 0 && (
                <tfoot className="bg-gray-50 dark:bg-slate-900">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-slate-100">Total Flower Equivalent:</td>
                    <td className={`px-4 py-3 text-right font-bold ${overLimit ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}`}>
                      {Number(totalEquivalentGrams).toFixed(1)}g
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
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">State (leave blank for all)</label>
            <input
              type="text"
              value={ruleForm.state}
              onChange={(e) => setRuleForm({ ...ruleForm, state: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="CO, CA, etc."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Category *</label>
            <input
              type="text"
              value={ruleForm.category}
              onChange={(e) => setRuleForm({ ...ruleForm, category: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="Concentrates, Edibles, Flower, etc."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Equivalency (grams)</label>
              <input
                type="number"
                step="0.1"
                value={ruleForm.equivalencyGrams}
                onChange={(e) => setRuleForm({ ...ruleForm, equivalencyGrams: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
                placeholder="3.5"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Purchase Limit (grams)</label>
              <input
                type="number"
                step="0.1"
                value={ruleForm.purchaseLimitGrams}
                onChange={(e) => setRuleForm({ ...ruleForm, purchaseLimitGrams: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
                placeholder="28"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Description</label>
            <textarea
              value={ruleForm.description}
              onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="e.g., 1g concentrate = 3.5g flower equivalent"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setRuleModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium dark:text-slate-200">Cancel</button>
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
