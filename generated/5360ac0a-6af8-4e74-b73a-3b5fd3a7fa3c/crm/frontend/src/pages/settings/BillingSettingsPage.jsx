import React, { useState, useEffect } from 'react';
import { 
  CreditCard, Check, ArrowRight, Loader2, AlertTriangle, 
  Plus, Package, Calendar, Receipt, X, ChevronRight
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const PLANS = {
  starter: { id: 'starter', name: 'Starter', price: 49, priceAnnual: 39, users: 2 },
  pro: { id: 'pro', name: 'Pro', price: 149, priceAnnual: 119, users: 5 },
  business: { id: 'business', name: 'Business', price: 299, priceAnnual: 239, users: 15 },
  construction: { id: 'construction', name: 'Construction', price: 599, priceAnnual: 479, users: 20 },
  enterprise: { id: 'enterprise', name: 'Enterprise', price: 199, priceAnnual: 159, perUser: true },
};

const PLAN_ORDER = ['starter', 'pro', 'business', 'construction', 'enterprise'];

export default function BillingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  const [subscription, setSubscription] = useState(null);
  const [usage, setUsage] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [addons, setAddons] = useState([]);
  
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showAddonModal, setShowAddonModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);

  useEffect(() => {
    loadBillingData();
  }, []);

  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  });

  const loadBillingData = async () => {
    try {
      const [subRes, usageRes, invoicesRes, pmRes, addonsRes] = await Promise.all([
        fetch(`${API_URL}/api/billing/subscription`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/api/billing/usage`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/api/billing/invoices`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/api/billing/payment-methods`, { headers: getAuthHeaders() }),
        fetch(`${API_URL}/api/billing/addons`, { headers: getAuthHeaders() }),
      ]);

      const [subData, usageData, invoicesData, pmData, addonsData] = await Promise.all([
        subRes.json(),
        usageRes.json(),
        invoicesRes.json(),
        pmRes.json(),
        addonsRes.json(),
      ]);

      setSubscription(subData.subscription);
      setUsage(usageData);
      setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
      setPaymentMethods(pmData.paymentMethods || []);
      setAddons(addonsData.addons || []);
    } catch (err) {
      setError('Failed to load billing data');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePlan = async (newPlan) => {
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/billing/subscription/change-plan`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ plan: newPlan }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Failed to change plan');

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      setSuccess(data.message || 'Plan updated successfully');
      setShowPlanModal(false);
      loadBillingData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePurchaseAddon = async (addonId) => {
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/billing/addons/purchase`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ addonId }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Failed to purchase add-on');

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      setSuccess('Add-on activated successfully');
      setShowAddonModal(false);
      loadBillingData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelSubscription = async () => {
    setSaving(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/billing/subscription/cancel`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ immediate: false }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'Failed to cancel subscription');

      setSuccess('Subscription will be canceled at the end of your billing period');
      setShowCancelModal(false);
      loadBillingData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async () => {
    try {
      const response = await fetch(`${API_URL}/api/billing/subscription/reactivate`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      if (!response.ok) throw new Error('Failed to reactivate');

      setSuccess('Subscription reactivated');
      loadBillingData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAddPaymentMethod = async () => {
    try {
      const response = await fetch(`${API_URL}/api/billing/payment-methods/setup`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      const data = await response.json();
      if (data.clientSecret) {
        alert('Payment method setup would open Stripe Elements here');
      }
    } catch (err) {
      setError('Failed to setup payment method');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  const currentPlan = PLANS[subscription?.plan] || PLANS.starter;
  const isTrialing = subscription?.status === 'trialing';
  const isCanceled = subscription?.cancelAtPeriodEnd;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Billing & Subscription</h1>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
          {error}
          <button onClick={() => setError('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-center justify-between">
          {success}
          <button onClick={() => setSuccess('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Current Plan */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Current Plan</h2>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-3xl font-bold text-gray-900">{currentPlan.name}</span>
              {isTrialing && <span className="bg-yellow-100 text-yellow-700 text-sm px-2 py-1 rounded-full">Trial</span>}
              {isCanceled && <span className="bg-red-100 text-red-700 text-sm px-2 py-1 rounded-full">Canceling</span>}
            </div>
            <p className="text-gray-500 mt-1">${currentPlan.perUser ? `${currentPlan.price}/user` : currentPlan.price}/mo · {currentPlan.users} users</p>
          </div>
          <button onClick={() => setShowPlanModal(true)} className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 flex items-center gap-2">
            Change Plan <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {isTrialing && subscription?.currentPeriodEnd && (
          <div className="mt-4 p-4 bg-yellow-50 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            <span className="text-yellow-700">Trial ends {new Date(subscription.currentPeriodEnd).toLocaleDateString()}. Add payment to continue.</span>
          </div>
        )}

        {isCanceled && (
          <div className="mt-4 p-4 bg-red-50 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <span className="text-red-700">Cancels {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</span>
            </div>
            <button onClick={handleReactivate} className="text-orange-600 hover:underline font-medium">Reactivate</button>
          </div>
        )}
      </div>

      {/* Usage */}
      {usage && (
        <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Usage</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <UsageBar label="Users" current={usage.users?.current || 0} limit={usage.users?.limit} />
            <UsageBar label="Contacts" current={usage.contacts?.current || 0} limit={usage.contacts?.limit} />
            <UsageBar label="Jobs (monthly)" current={usage.jobs?.current || 0} limit={usage.jobs?.limit} />
          </div>
        </div>
      )}

      {/* Add-ons */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Add-ons</h2>
          <button onClick={() => setShowAddonModal(true)} className="text-orange-500 hover:text-orange-600 flex items-center gap-1 font-medium">
            <Plus className="w-4 h-4" /> Add Features
          </button>
        </div>
        
        {addons.filter(a => a.purchased).length > 0 ? (
          <div className="space-y-3">
            {addons.filter(a => a.purchased).map((addon) => (
              <div key={addon.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{addon.name}</p>
                  <p className="text-sm text-gray-500">${addon.price}/mo</p>
                </div>
                <span className="text-green-600 text-sm font-medium">Active</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No add-ons. Enhance your plan with additional features.</p>
        )}
      </div>

      {/* Payment Methods */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Payment Methods</h2>
          <button onClick={handleAddPaymentMethod} className="text-orange-500 hover:text-orange-600 flex items-center gap-1 font-medium">
            <Plus className="w-4 h-4" /> Add Card
          </button>
        </div>

        {paymentMethods.length > 0 ? (
          <div className="space-y-3">
            {paymentMethods.map((pm) => (
              <div key={pm.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="font-medium text-gray-900">•••• {pm.card?.last4}</p>
                    <p className="text-sm text-gray-500">Expires {pm.card?.exp_month}/{pm.card?.exp_year}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No payment methods on file.</p>
        )}
      </div>

      {/* Invoices */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Billing History</h2>
        {invoices.length > 0 ? (
          <div className="space-y-2">
            {invoices.slice(0, 5).map((invoice) => (
              <div key={invoice.id} className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <Receipt className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="font-medium text-gray-900">{new Date(invoice.createdAt).toLocaleDateString()}</p>
                    <p className="text-sm text-gray-500">Invoice #{invoice.number}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900">${(Number(invoice.total) || 0).toFixed(2)}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${invoice.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {invoice.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No billing history yet.</p>
        )}
      </div>

      {/* Cancel */}
      {subscription?.status === 'active' && !isCanceled && (
        <div className="text-center">
          <button onClick={() => setShowCancelModal(true)} className="text-red-500 hover:underline">Cancel Subscription</button>
        </div>
      )}

      {/* Modals */}
      {showPlanModal && <PlanModal currentPlan={subscription?.plan} onSelect={handleChangePlan} onClose={() => setShowPlanModal(false)} saving={saving} />}
      {showAddonModal && <AddonModal addons={addons} onPurchase={handlePurchaseAddon} onClose={() => setShowAddonModal(false)} saving={saving} />}
      {showCancelModal && <CancelModal onConfirm={handleCancelSubscription} onClose={() => setShowCancelModal(false)} saving={saving} periodEnd={subscription?.currentPeriodEnd} />}
    </div>
  );
}

function UsageBar({ label, current, limit }) {
  const percentage = limit ? Math.min((current / limit) * 100, 100) : 0;
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className={isAtLimit ? 'text-red-600 font-medium' : 'text-gray-900'}>{current.toLocaleString()} / {limit?.toLocaleString() || '∞'}</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function PlanModal({ currentPlan, onSelect, onClose, saving }) {
  const [selected, setSelected] = useState(currentPlan);
  const currentIndex = PLAN_ORDER.indexOf(currentPlan);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b flex items-center justify-between">
          <div><h2 className="text-xl font-bold text-gray-900">Change Plan</h2><p className="text-gray-500">Select a new plan</p></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-3">
          {PLAN_ORDER.map((planId, index) => {
            const plan = PLANS[planId];
            const isCurrent = planId === currentPlan;
            const isUpgrade = index > currentIndex;
            const isDowngrade = index < currentIndex;
            return (
              <button key={planId} onClick={() => setSelected(planId)} className={`w-full p-4 rounded-lg border-2 text-left transition ${selected === planId ? 'border-orange-500 bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{plan.name}</span>
                      {isCurrent && <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Current</span>}
                      {isUpgrade && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Upgrade</span>}
                      {isDowngrade && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Downgrade</span>}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{plan.users} users included</p>
                  </div>
                  <div className="text-right"><span className="text-xl font-bold">${plan.perUser ? `${plan.price}/user` : plan.price}</span><span className="text-gray-500">/mo</span></div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="p-6 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={() => onSelect(selected)} disabled={saving || selected === currentPlan} className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {selected === currentPlan ? 'Current Plan' : 'Change Plan'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddonModal({ addons, onPurchase, onClose, saving }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b flex items-center justify-between">
          <div><h2 className="text-xl font-bold text-gray-900">Add Features</h2><p className="text-gray-500">Enhance your plan</p></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 grid gap-3">
          {addons.map((addon) => (
            <div key={addon.id} className="p-4 rounded-lg border flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{addon.name}</span>
                  {addon.purchased && <span className="text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">Active</span>}
                </div>
                <p className="text-sm text-gray-500 mt-1">{addon.features?.join(', ')}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-gray-900">${addon.price}/mo</p>
                {!addon.purchased && <button onClick={() => onPurchase(addon.id)} disabled={saving} className="text-orange-500 hover:text-orange-600 text-sm font-medium mt-1">Add</button>}
              </div>
            </div>
          ))}
        </div>
        <div className="p-6 border-t flex justify-end"><button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Close</button></div>
      </div>
    </div>
  );
}

function CancelModal({ onConfirm, onClose, saving, periodEnd }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-6">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><AlertTriangle className="w-6 h-6 text-red-500" /></div>
        <h2 className="text-xl font-bold text-gray-900 text-center mb-2">Cancel Subscription?</h2>
        <p className="text-gray-500 text-center mb-6">Access continues until {periodEnd && new Date(periodEnd).toLocaleDateString()}.</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-3 border text-gray-700 rounded-lg hover:bg-gray-50">Keep</button>
          <button onClick={onConfirm} disabled={saving} className="flex-1 px-4 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
