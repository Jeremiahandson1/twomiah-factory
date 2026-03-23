import { useState, useEffect } from 'react';
import { Landmark, Settings, Users, ArrowRightLeft, Search, RefreshCw, Plus, Link2, DollarSign, TrendingUp } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const txnStatusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  returned: 'bg-orange-100 text-orange-700',
};

export default function PayByBankPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('setup');

  // Setup
  const [config, setConfig] = useState({ clientId: '', secret: '', environment: 'sandbox', enabled: false });
  const [savingConfig, setSavingConfig] = useState(false);

  // Customer Accounts
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingCustomers, setLoadingCustomers] = useState(false);

  // Transactions
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [txnFilter, setTxnFilter] = useState('');
  const [txnPage, setTxnPage] = useState(1);
  const [txnTotal, setTxnTotal] = useState(0);

  // Stats
  const [stats, setStats] = useState<any>({ totalTransactions: 0, totalVolume: 0, avgSize: 0 });

  useEffect(() => {
    loadConfig();
    loadStats();
  }, []);

  useEffect(() => {
    if (tab === 'transactions') loadTransactions();
  }, [tab, txnFilter, txnPage]);

  const loadConfig = async () => {
    try {
      const data = await api.get('/api/pay-by-bank/config');
      if (data) {
        setConfig({
          clientId: data.clientId || '',
          secret: data.secret || '',
          environment: data.environment || 'sandbox',
          enabled: data.enabled ?? false,
        });
      }
    } catch (err) {
      console.error('Failed to load Plaid config:', err);
    }
  };

  const loadStats = async () => {
    try {
      const data = await api.get('/api/pay-by-bank/stats');
      if (data) setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/api/pay-by-bank/config', config);
      toast.success('Plaid configuration saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save configuration');
    } finally {
      setSavingConfig(false);
    }
  };

  const searchCustomers = async () => {
    if (!customerSearch.trim()) return;
    setLoadingCustomers(true);
    try {
      const data = await api.get('/api/customers', { search: customerSearch, limit: 20 });
      setCustomers(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to search customers:', err);
    } finally {
      setLoadingCustomers(false);
    }
  };

  const selectCustomer = async (customer: any) => {
    setSelectedCustomer(customer);
    setLoadingAccounts(true);
    try {
      const data = await api.get(`/api/pay-by-bank/accounts/${customer.id}`);
      setAccounts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load accounts:', err);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const linkNewAccount = async () => {
    if (!selectedCustomer) {
      toast.error('Select a customer first');
      return;
    }
    try {
      await api.post(`/api/pay-by-bank/link/${selectedCustomer.id}`);
      toast.success('Plaid Link initiated for customer');
    } catch (err: any) {
      toast.error(err.message || 'Failed to initiate Plaid Link');
    }
  };

  const loadTransactions = async () => {
    setLoadingTxns(true);
    try {
      const params: any = { page: txnPage, limit: 25 };
      if (txnFilter) params.status = txnFilter;
      const data = await api.get('/api/pay-by-bank/transactions', params);
      setTransactions(Array.isArray(data) ? data : data?.data || []);
      setTxnTotal(data?.total || 0);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setLoadingTxns(false);
    }
  };

  const tabs = [
    { id: 'setup', label: 'Setup', icon: Settings },
    { id: 'accounts', label: 'Customer Accounts', icon: Users },
    { id: 'transactions', label: 'Transactions', icon: ArrowRightLeft },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pay by Bank</h1>
          <p className="text-gray-600">Plaid-powered ACH payments for cannabis purchases</p>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <ArrowRightLeft className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">{stats.totalTransactions || 0}</p>
            <p className="text-sm text-gray-500">Total Transactions</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">${Number(stats.totalVolume || 0).toLocaleString()}</p>
            <p className="text-sm text-gray-500">Total Volume</p>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900">${Number(stats.avgSize || 0).toFixed(2)}</p>
            <p className="text-sm text-gray-500">Avg Transaction</p>
          </div>
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

      {/* Setup Tab */}
      {tab === 'setup' && (
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-2xl space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Plaid Configuration</h3>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
              />
              <span className={`text-sm font-medium ${config.enabled ? 'text-green-600' : 'text-gray-500'}`}>
                {config.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
            <input
              type="text"
              value={config.clientId}
              onChange={(e) => setConfig({ ...config, clientId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Enter Plaid client ID"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Secret</label>
            <input
              type="password"
              value={config.secret}
              onChange={(e) => setConfig({ ...config, secret: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="Enter Plaid secret"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Environment</label>
            <select
              value={config.environment}
              onChange={(e) => setConfig({ ...config, environment: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            >
              <option value="sandbox">Sandbox</option>
              <option value="development">Development</option>
              <option value="production">Production</option>
            </select>
          </div>

          <div className="flex gap-3">
            <Button onClick={saveConfig} disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save Configuration'}
            </Button>
          </div>
        </div>
      )}

      {/* Customer Accounts Tab */}
      {tab === 'accounts' && (
        <div className="space-y-6">
          {/* Search */}
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search customer by name or phone..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchCustomers()}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
            <Button onClick={searchCustomers} variant="secondary">
              Search
            </Button>
          </div>

          {/* Customer List */}
          {loadingCustomers ? (
            <div className="flex items-center justify-center h-16">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : customers.length > 0 && !selectedCustomer && (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="divide-y">
                {customers.map(c => (
                  <button
                    key={c.id}
                    onClick={() => selectCustomer(c)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{c.name || `${c.firstName} ${c.lastName}`}</p>
                      <p className="text-sm text-gray-500">{c.phone || c.email || ''}</p>
                    </div>
                    <span className="text-sm text-green-600">Select</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selected Customer */}
          {selectedCustomer && (
            <div>
              <div className="bg-white rounded-lg shadow-sm p-5 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                      <Users className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{selectedCustomer.name || `${selectedCustomer.firstName} ${selectedCustomer.lastName}`}</p>
                      <p className="text-sm text-gray-500">{selectedCustomer.phone || selectedCustomer.email || ''}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={linkNewAccount} variant="secondary" size="sm">
                      <Link2 className="w-4 h-4 mr-1 inline" />
                      Link New Account
                    </Button>
                    <button
                      onClick={() => { setSelectedCustomer(null); setAccounts([]); }}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                    >
                      Change
                    </button>
                  </div>
                </div>
              </div>

              {/* Linked Accounts */}
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Linked Bank Accounts</h3>
              {loadingAccounts ? (
                <div className="flex items-center justify-center h-16">
                  <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : accounts.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-lg shadow-sm text-gray-500">
                  <Landmark className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No linked bank accounts</p>
                  <p className="text-sm text-gray-400 mt-1">Use "Link New Account" to connect via Plaid</p>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  {accounts.map(account => (
                    <div key={account.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                      <div className="flex items-center gap-3 mb-3">
                        <Landmark className="w-5 h-5 text-blue-600" />
                        <div>
                          <p className="font-semibold text-gray-900">{account.bankName || 'Bank Account'}</p>
                          <p className="text-sm text-gray-500">****{account.mask || account.last4 || '----'}</p>
                        </div>
                      </div>
                      <div className="space-y-1 text-sm text-gray-600">
                        <p>Type: {account.subtype || account.type || 'Checking'}</p>
                        <p>Status: <span className={`px-2 py-0.5 text-xs rounded-full ${account.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {account.active ? 'Active' : 'Inactive'}
                        </span></p>
                        {account.linkedAt && <p>Linked: {new Date(account.linkedAt).toLocaleDateString()}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state if no search */}
          {!selectedCustomer && customers.length === 0 && !loadingCustomers && (
            <div className="text-center py-12 text-gray-500">
              <Search className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>Search for a customer to view linked bank accounts</p>
            </div>
          )}
        </div>
      )}

      {/* Transactions Tab */}
      {tab === 'transactions' && (
        <div>
          {/* Filter */}
          <div className="flex gap-1 mb-4 overflow-x-auto">
            {[
              { value: '', label: 'All' },
              { value: 'pending', label: 'Pending' },
              { value: 'processing', label: 'Processing' },
              { value: 'completed', label: 'Completed' },
              { value: 'failed', label: 'Failed' },
            ].map(s => (
              <button
                key={s.value}
                onClick={() => { setTxnFilter(s.value); setTxnPage(1); }}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap ${
                  txnFilter === s.value
                    ? 'bg-green-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bank</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingTxns ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center">
                        <div className="w-6 h-6 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No transactions found</td>
                    </tr>
                  ) : transactions.map(txn => (
                    <tr key={txn.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {txn.createdAt ? new Date(txn.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{txn.customerName || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {txn.bankName ? `${txn.bankName} ****${txn.mask || ''}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                        ${Number(txn.amount || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${txnStatusColors[txn.status] || 'bg-gray-100 text-gray-600'}`}>
                          {txn.status || 'unknown'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500">{txn.reference || txn.id?.slice(0, 8) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {txnTotal > 25 && (
              <div className="px-4 py-3 border-t flex items-center justify-between">
                <span className="text-sm text-gray-500">
                  Page {txnPage} of {Math.ceil(txnTotal / 25)}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setTxnPage(p => Math.max(1, p - 1))}
                    disabled={txnPage <= 1}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setTxnPage(p => p + 1)}
                    disabled={txnPage >= Math.ceil(txnTotal / 25)}
                    className="px-3 py-1 text-sm border rounded-lg disabled:opacity-50 hover:bg-gray-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
