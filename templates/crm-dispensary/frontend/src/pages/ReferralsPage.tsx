import { useState, useEffect } from 'react';
import {
  Users, Gift, Settings, RefreshCw, Award, DollarSign,
  CheckCircle, Clock, XCircle, TrendingUp, Crown
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { Button, PageHeader } from '../components/ui/DataTable';

const referralStatusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  qualified: 'bg-blue-100 text-blue-700',
  rewarded: 'bg-green-100 text-green-700',
  expired: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-700',
};

export default function ReferralsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('config');
  const [loading, setLoading] = useState(false);

  // Config
  const [config, setConfig] = useState<any>({
    enabled: false,
    referrerRewardType: 'discount_percent',
    referrerRewardValue: 10,
    referredRewardType: 'discount_percent',
    referredRewardValue: 10,
    minPurchase: 0,
    expirationDays: 30,
    maxReferralsPerCustomer: 0,
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Referrals
  const [referrals, setReferrals] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<any>(null);

  // Stats
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    if (tab === 'config') loadConfig();
    if (tab === 'referrals') loadReferrals();
    if (tab === 'stats') loadStats();
  }, [tab, page]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/referrals/config');
      if (data) setConfig(data);
    } catch (err) {
      // Config may not exist yet
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/api/referrals/config', config);
      toast.success('Referral program settings saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save settings');
    } finally {
      setSavingConfig(false);
    }
  };

  const loadReferrals = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/referrals', { page, limit: 20 });
      setReferrals(Array.isArray(data) ? data : data?.data || []);
      if (data?.pagination) setPagination(data.pagination);
    } catch (err) {
      toast.error('Failed to load referrals');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    setLoading(true);
    try {
      const data = await api.get('/api/referrals/stats');
      setStats(data);
    } catch (err) {
      toast.error('Failed to load referral stats');
    } finally {
      setLoading(false);
    }
  };

  const awardReward = async (referralId: string) => {
    try {
      await api.post(`/api/referrals/${referralId}/award`);
      toast.success('Reward awarded successfully');
      loadReferrals();
    } catch (err: any) {
      toast.error(err.message || 'Failed to award reward');
    }
  };

  const rewardTypes = [
    { value: 'discount_percent', label: 'Discount (%)' },
    { value: 'discount_fixed', label: 'Discount ($)' },
    { value: 'loyalty_points', label: 'Loyalty Points' },
    { value: 'free_item', label: 'Free Item' },
    { value: 'store_credit', label: 'Store Credit ($)' },
  ];

  const tabs = [
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'referrals', label: 'Referrals', icon: Users },
    { id: 'stats', label: 'Stats', icon: TrendingUp },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Referral Program</h1>
          <p className="text-gray-600">Manage referrals and reward settings</p>
        </div>
        <button
          onClick={() => {
            if (tab === 'referrals') loadReferrals();
            if (tab === 'stats') loadStats();
          }}
          className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
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

      {/* Config */}
      {tab === 'config' && (
        <div className="max-w-2xl">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
              <div className="space-y-5">
                {/* Enabled toggle */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <p className="font-medium text-gray-900">Enable Referral Program</p>
                    <p className="text-sm text-gray-500">Allow customers to refer friends and earn rewards</p>
                  </div>
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={e => setConfig({ ...config, enabled: e.target.checked })}
                      className="sr-only"
                    />
                    <div className={`w-11 h-6 rounded-full transition-colors ${config.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mt-0.5 ${config.enabled ? 'translate-x-5.5 ml-[22px]' : 'translate-x-0.5 ml-[2px]'}`} />
                    </div>
                  </div>
                </label>

                <hr />

                {/* Referrer Reward */}
                <div>
                  <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Gift className="w-4 h-4 text-green-600" />
                    Referrer Reward (person who refers)
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reward Type</label>
                      <select
                        value={config.referrerRewardType}
                        onChange={e => setConfig({ ...config, referrerRewardType: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
                      >
                        {rewardTypes.map(rt => (
                          <option key={rt.value} value={rt.value}>{rt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
                      <input
                        type="number"
                        step="0.01"
                        value={config.referrerRewardValue}
                        onChange={e => setConfig({ ...config, referrerRewardValue: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                      />
                    </div>
                  </div>
                </div>

                {/* Referred Reward */}
                <div>
                  <h3 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Award className="w-4 h-4 text-green-600" />
                    Referred Reward (new customer)
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Reward Type</label>
                      <select
                        value={config.referredRewardType}
                        onChange={e => setConfig({ ...config, referredRewardType: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
                      >
                        {rewardTypes.map(rt => (
                          <option key={rt.value} value={rt.value}>{rt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
                      <input
                        type="number"
                        step="0.01"
                        value={config.referredRewardValue}
                        onChange={e => setConfig({ ...config, referredRewardValue: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                      />
                    </div>
                  </div>
                </div>

                <hr />

                {/* Additional settings */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Min Purchase ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={config.minPurchase}
                      onChange={e => setConfig({ ...config, minPurchase: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Expiration (days)</label>
                    <input
                      type="number"
                      value={config.expirationDays}
                      onChange={e => setConfig({ ...config, expirationDays: parseInt(e.target.value) || 30 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                      placeholder="30"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Max Referrals</label>
                    <input
                      type="number"
                      value={config.maxReferralsPerCustomer}
                      onChange={e => setConfig({ ...config, maxReferralsPerCustomer: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                      placeholder="0 = unlimited"
                    />
                    <p className="text-xs text-gray-500 mt-1">0 = unlimited</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end mt-6 pt-4 border-t">
                <Button onClick={saveConfig} disabled={savingConfig}>
                  {savingConfig ? 'Saving...' : 'Save Settings'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Referrals List */}
      {tab === 'referrals' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Referrer</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Referred</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Code</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Created</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-700">Rewarded</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {referrals.map(ref => (
                      <tr key={ref.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 font-medium">{ref.referrerName || '--'}</td>
                        <td className="px-4 py-3 text-gray-600">{ref.referredName || '--'}</td>
                        <td className="px-4 py-3 font-mono text-gray-600">{ref.code || '--'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${referralStatusColors[ref.status] || 'bg-gray-100 text-gray-600'}`}>
                            {ref.status || 'pending'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {ref.createdAt ? new Date(ref.createdAt).toLocaleDateString() : '--'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {ref.rewardedAt ? new Date(ref.rewardedAt).toLocaleDateString() : '--'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {ref.status === 'qualified' && (
                            <button
                              onClick={() => awardReward(ref.id)}
                              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                            >
                              Award
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {referrals.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                          <Users className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                          No referrals yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {pagination && pagination.pages > 1 && (
                <div className="px-4 py-3 border-t flex items-center justify-between">
                  <p className="text-sm text-gray-600">Page {pagination.page} of {pagination.pages}</p>
                  <div className="flex gap-2">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">Previous</button>
                    <button onClick={() => setPage(p => p + 1)} disabled={page >= pagination.pages} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50">Next</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      {tab === 'stats' && (
        <div>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : stats ? (
            <>
              {/* KPIs */}
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <Users className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Total Referrals</p>
                      <p className="text-2xl font-bold text-gray-900">{stats.totalReferrals ?? 0}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Conversion Rate</p>
                      <p className="text-2xl font-bold text-gray-900">{stats.conversionRate ?? 0}%</p>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                      <DollarSign className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Rewards Issued</p>
                      <p className="text-2xl font-bold text-gray-900">{stats.rewardsIssued ?? 0}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Referrers Leaderboard */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-100">
                <div className="px-5 py-4 border-b">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Crown className="w-5 h-5 text-yellow-500" />
                    Top Referrers
                  </h3>
                </div>
                <div className="divide-y">
                  {(stats.topReferrers || []).map((referrer: any, idx: number) => (
                    <div key={referrer.id || idx} className="px-5 py-4 flex items-center gap-4">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        idx === 0 ? 'bg-yellow-100 text-yellow-700' :
                        idx === 1 ? 'bg-gray-200 text-gray-700' :
                        idx === 2 ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{referrer.name || 'Unknown'}</p>
                        <p className="text-sm text-gray-500">{referrer.email || ''}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-gray-900">{referrer.count ?? 0} referrals</p>
                        <p className="text-sm text-green-600">{referrer.successful ?? 0} converted</p>
                      </div>
                    </div>
                  ))}
                  {(!stats.topReferrers || stats.topReferrers.length === 0) && (
                    <div className="px-5 py-8 text-center text-gray-500">
                      No top referrers yet
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <TrendingUp className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No referral stats available</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
