import { useState, useEffect } from 'react';
import {
  ShieldAlert, AlertTriangle, Eye, CheckCircle, XCircle, Settings, BarChart3,
  Play, RefreshCw, TrendingUp, DollarSign, Users, Clock, Plus
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 animate-pulse',
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-blue-100 text-blue-700',
};

const TYPE_STYLES: Record<string, string> = {
  void_pattern: 'bg-purple-100 text-purple-700',
  discount_abuse: 'bg-orange-100 text-orange-700',
  cash_variance: 'bg-red-100 text-red-700',
  inventory_shrinkage: 'bg-yellow-100 text-yellow-700',
  time_theft: 'bg-blue-100 text-blue-700',
  refund_pattern: 'bg-pink-100 text-pink-700',
};

export default function FraudDetectionPage() {
  const toast = useToast();
  const [tab, setTab] = useState('alerts');
  const [loading, setLoading] = useState(true);

  // Alerts
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertFilter, setAlertFilter] = useState('all');

  // Rules
  const [rules, setRules] = useState<any[]>([]);
  const [ruleModal, setRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const [ruleForm, setRuleForm] = useState({
    name: '', type: 'void_pattern', threshold: '', period: '24h', description: '', active: true,
  });
  const [savingRule, setSavingRule] = useState(false);

  // Dashboard
  const [dashboardData, setDashboardData] = useState<any>(null);

  // Scan
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any>(null);

  useEffect(() => {
    if (tab === 'alerts') loadAlerts();
    if (tab === 'rules') loadRules();
    if (tab === 'dashboard') loadDashboard();
  }, [tab, alertFilter]);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const params: any = { limit: 50 };
      if (alertFilter !== 'all') params.severity = alertFilter;
      const data = await api.get('/api/fraud-detection/alerts', params);
      setAlerts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load alerts');
    } finally {
      setLoading(false);
    }
  };

  const loadRules = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/fraud-detection/rules');
      setRules(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      toast.error('Failed to load rules');
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/fraud-detection/dashboard');
      setDashboardData(data);
    } catch (err) {
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleAlertAction = async (id: string, action: 'investigate' | 'resolve' | 'dismiss') => {
    try {
      await api.post(`/api/fraud-detection/alerts/${id}/${action}`);
      toast.success(`Alert ${action}d`);
      loadAlerts();
    } catch (err: any) {
      toast.error(err.message || `Failed to ${action} alert`);
    }
  };

  const toggleRule = async (id: string, active: boolean) => {
    try {
      await api.put(`/api/fraud-detection/rules/${id}`, { active });
      toast.success(`Rule ${active ? 'enabled' : 'disabled'}`);
      loadRules();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update rule');
    }
  };

  const openCreateRule = () => {
    setEditingRule(null);
    setRuleForm({ name: '', type: 'void_pattern', threshold: '', period: '24h', description: '', active: true });
    setRuleModal(true);
  };

  const openEditRule = (rule: any) => {
    setEditingRule(rule);
    setRuleForm({
      name: rule.name, type: rule.type, threshold: String(rule.threshold || ''),
      period: rule.period || '24h', description: rule.description || '', active: rule.active,
    });
    setRuleModal(true);
  };

  const handleSaveRule = async () => {
    if (!ruleForm.name || !ruleForm.threshold) { toast.error('Name and threshold required'); return; }
    setSavingRule(true);
    try {
      const payload = { ...ruleForm, threshold: parseFloat(ruleForm.threshold) };
      if (editingRule) {
        await api.put(`/api/fraud-detection/rules/${editingRule.id}`, payload);
        toast.success('Rule updated');
      } else {
        await api.post('/api/fraud-detection/rules', payload);
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

  const runScan = async () => {
    setScanning(true);
    setScanResults(null);
    try {
      const data = await api.post('/api/fraud-detection/scan');
      setScanResults(data);
      toast.success(`Scan complete: ${data?.alertsGenerated || 0} alerts generated`);
      loadAlerts();
    } catch (err: any) {
      toast.error(err.message || 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const tabs = [
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
    { id: 'rules', label: 'Rules', icon: Settings },
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  ];

  return (
    <div>
      <PageHeader title="Fraud & Theft Detection" action={
        <Button onClick={runScan} disabled={scanning}>
          <Play className="w-4 h-4 mr-2 inline" />{scanning ? 'Scanning...' : 'Run Scan'}
        </Button>
      } />

      {scanResults && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
          <div>
            <div className="font-medium text-green-800">Scan Complete</div>
            <div className="text-sm text-green-600">
              {scanResults.alertsGenerated || 0} new alerts &middot; {scanResults.transactionsScanned || 0} transactions scanned &middot; {scanResults.duration || '0s'}
            </div>
          </div>
          <button onClick={() => setScanResults(null)} className="text-green-600 hover:text-green-800"><XCircle className="w-5 h-5" /></button>
        </div>
      )}

      <div className="flex gap-1 mb-6 overflow-x-auto border-b">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.id ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* Alerts Tab */}
      {tab === 'alerts' && (
        <div>
          <div className="flex gap-2 mb-4">
            {['all', 'critical', 'high', 'medium', 'low'].map(f => (
              <button key={f} onClick={() => setAlertFilter(f)}
                className={`px-3 py-1 text-sm rounded-full ${alertFilter === f ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No alerts found</div>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Severity</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Description</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Employee</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Time</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map(alert => (
                    <tr key={alert.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_STYLES[alert.severity] || 'bg-gray-100 text-gray-700'}`}>
                          {alert.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_STYLES[alert.type] || 'bg-gray-100 text-gray-700'}`}>
                          {(alert.type || '').replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm max-w-xs truncate">{alert.description}</td>
                      <td className="px-4 py-3 text-sm">
                        {alert.employeeName ? (
                          <span className="text-green-600 hover:underline cursor-pointer">{alert.employeeName}</span>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${alert.status === 'open' ? 'bg-red-100 text-red-700' : alert.status === 'investigating' ? 'bg-yellow-100 text-yellow-700' : alert.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {alert.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{alert.createdAt ? new Date(alert.createdAt).toLocaleString() : '-'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {alert.status === 'open' && (
                            <button onClick={() => handleAlertAction(alert.id, 'investigate')}
                              className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 flex items-center gap-1">
                              <Eye className="w-3 h-3" />Investigate
                            </button>
                          )}
                          {(alert.status === 'open' || alert.status === 'investigating') && (
                            <>
                              <button onClick={() => handleAlertAction(alert.id, 'resolve')}
                                className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 flex items-center gap-1">
                                <CheckCircle className="w-3 h-3" />Resolve
                              </button>
                              <button onClick={() => handleAlertAction(alert.id, 'dismiss')}
                                className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 flex items-center gap-1">
                                <XCircle className="w-3 h-3" />Dismiss
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Rules Tab */}
      {tab === 'rules' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={openCreateRule}><Plus className="w-4 h-4 mr-2 inline" />Add Rule</Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : rules.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No detection rules configured</div>
          ) : (
            <div className="space-y-3">
              {rules.map(rule => (
                <div key={rule.id} className="border rounded-lg p-4 bg-white flex items-center justify-between">
                  <div className="flex-1" onClick={() => openEditRule(rule)} role="button">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{rule.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_STYLES[rule.type] || 'bg-gray-100 text-gray-700'}`}>
                        {(rule.type || '').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <div className="text-sm text-gray-500">
                      Threshold: {rule.threshold} &middot; Period: {rule.period}
                      {rule.description && <span> &middot; {rule.description}</span>}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer ml-4">
                    <span className="text-sm text-gray-500">{rule.active ? 'Active' : 'Inactive'}</span>
                    <div className={`relative w-10 h-5 rounded-full transition-colors ${rule.active ? 'bg-green-500' : 'bg-gray-300'}`}
                      onClick={() => toggleRule(rule.id, !rule.active)}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${rule.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </div>
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dashboard Tab */}
      {tab === 'dashboard' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-white border rounded-lg p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Open Alerts</span>
                    <AlertTriangle className="w-5 h-5 text-yellow-500" />
                  </div>
                  <div className="text-2xl font-bold">{dashboardData?.openAlerts || 0}</div>
                </div>
                <div className="bg-white border rounded-lg p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Critical</span>
                    <ShieldAlert className="w-5 h-5 text-red-500" />
                  </div>
                  <div className="text-2xl font-bold text-red-600">{dashboardData?.criticalCount || 0}</div>
                </div>
                <div className="bg-white border rounded-lg p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Est. Shrinkage</span>
                    <DollarSign className="w-5 h-5 text-orange-500" />
                  </div>
                  <div className="text-2xl font-bold">${(dashboardData?.estimatedShrinkage || 0).toLocaleString()}</div>
                </div>
                <div className="bg-white border rounded-lg p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-500">Top Flagged</span>
                    <Users className="w-5 h-5 text-purple-500" />
                  </div>
                  <div className="text-lg font-bold truncate">{dashboardData?.topFlaggedEmployee || 'None'}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="border rounded-lg bg-white p-6">
                  <h3 className="font-semibold mb-4">Alerts Over Time</h3>
                  <div className="h-48 flex items-end justify-between gap-2 px-4">
                    {(dashboardData?.alertsByWeek || Array.from({ length: 8 }, () => Math.floor(Math.random() * 20))).map((v: number, i: number) => (
                      <div key={i} className="flex flex-col items-center flex-1">
                        <div className="bg-red-400 rounded-t w-full" style={{ height: `${Math.max((v / 20) * 100, 5)}%` }} />
                        <div className="text-xs text-gray-400 mt-1">W{i + 1}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="border rounded-lg bg-white p-6">
                  <h3 className="font-semibold mb-4">Shrinkage Trend</h3>
                  <div className="h-48 flex items-end justify-between gap-2 px-4">
                    {(dashboardData?.shrinkageByMonth || Array.from({ length: 6 }, () => Math.floor(Math.random() * 5000))).map((v: number, i: number) => (
                      <div key={i} className="flex flex-col items-center flex-1">
                        <div className="bg-orange-400 rounded-t w-full" style={{ height: `${Math.max((v / 5000) * 100, 5)}%` }} />
                        <div className="text-xs text-gray-400 mt-1">M{i + 1}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Rule Modal */}
      <Modal isOpen={ruleModal} onClose={() => setRuleModal(false)} title={editingRule ? 'Edit Rule' : 'Create Rule'} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Rule Name *</label>
            <input value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., Excessive Voids" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select value={ruleForm.type} onChange={e => setRuleForm({ ...ruleForm, type: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg">
                <option value="void_pattern">Void Pattern</option>
                <option value="discount_abuse">Discount Abuse</option>
                <option value="cash_variance">Cash Variance</option>
                <option value="inventory_shrinkage">Inventory Shrinkage</option>
                <option value="time_theft">Time Theft</option>
                <option value="refund_pattern">Refund Pattern</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Period</label>
              <select value={ruleForm.period} onChange={e => setRuleForm({ ...ruleForm, period: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg">
                <option value="1h">1 hour</option>
                <option value="8h">8 hours (shift)</option>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Threshold *</label>
            <input type="number" value={ruleForm.threshold} onChange={e => setRuleForm({ ...ruleForm, threshold: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" placeholder="e.g., 5 (voids per period) or 100 ($ amount)" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea value={ruleForm.description} onChange={e => setRuleForm({ ...ruleForm, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" rows={2} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={ruleForm.active} onChange={e => setRuleForm({ ...ruleForm, active: e.target.checked })}
              className="rounded text-green-600" />
            <span className="text-sm font-medium">Active</span>
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setRuleModal(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
          <Button onClick={handleSaveRule} disabled={savingRule}>{savingRule ? 'Saving...' : 'Save Rule'}</Button>
        </div>
      </Modal>
    </div>
  );
}
