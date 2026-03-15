import { useState, useEffect, useCallback } from 'react';
import { Gift, Settings, Users, Plus, Edit, Trash2, Save } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const initialRewardForm = {
  name: '',
  description: '',
  pointsCost: '',
  discountType: 'fixed',
  discountValue: '',
  isActive: true,
};

export default function LoyaltyPage() {
  const { isManager } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('config');

  // Config
  const [config, setConfig] = useState({
    pointsPerDollar: 1,
    tierThresholds: { silver: 500, gold: 1500, platinum: 5000 },
    welcomePoints: 50,
    birthdayBonus: 100,
    isEnabled: true,
  });
  const [savingConfig, setSavingConfig] = useState(false);

  // Rewards
  const [rewards, setRewards] = useState<any[]>([]);
  const [loadingRewards, setLoadingRewards] = useState(false);
  const [rewardModal, setRewardModal] = useState(false);
  const [editingReward, setEditingReward] = useState<any>(null);
  const [rewardForm, setRewardForm] = useState(initialRewardForm);
  const [savingReward, setSavingReward] = useState(false);
  const [deleteRewardOpen, setDeleteRewardOpen] = useState(false);
  const [rewardToDelete, setRewardToDelete] = useState<any>(null);
  const [deletingReward, setDeletingReward] = useState(false);

  // Members
  const [members, setMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  useEffect(() => {
    loadConfig();
    loadRewards();
  }, []);

  useEffect(() => {
    if (tab === 'members') loadMembers();
  }, [tab, memberSearch]);

  const loadConfig = async () => {
    try {
      const data = await api.get('/api/company');
      if (data) {
        setConfig(prev => ({
          ...prev,
          pointsPerDollar: data.loyaltyPointsPerDollar ?? prev.pointsPerDollar,
          isEnabled: data.loyaltyEnabled ?? prev.isEnabled,
          tierThresholds: data.loyaltyTierThresholds ?? prev.tierThresholds,
          welcomePoints: data.loyaltyWelcomePoints ?? prev.welcomePoints,
          birthdayBonus: data.loyaltyBirthdayBonus ?? prev.birthdayBonus,
        }));
      }
    } catch (err) {
      console.error('Failed to load loyalty config:', err);
    }
  };

  const loadRewards = async () => {
    setLoadingRewards(true);
    try {
      const data = await api.get('/api/loyalty/rewards');
      setRewards(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load rewards:', err);
    } finally {
      setLoadingRewards(false);
    }
  };

  const loadMembers = async () => {
    setLoadingMembers(true);
    try {
      const params: any = { limit: 50 };
      if (memberSearch) params.search = memberSearch;
      const data = await api.get('/api/loyalty/members', params);
      setMembers(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load members:', err);
    } finally {
      setLoadingMembers(false);
    }
  };

  const saveConfig = async () => {
    setSavingConfig(true);
    try {
      await api.put('/api/company', {
        loyaltyPointsPerDollar: config.pointsPerDollar,
        loyaltyEnabled: config.isEnabled,
        loyaltyTierThresholds: config.tierThresholds,
        loyaltyWelcomePoints: config.welcomePoints,
        loyaltyBirthdayBonus: config.birthdayBonus,
      });
      toast.success('Loyalty settings saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save config');
    } finally {
      setSavingConfig(false);
    }
  };

  const openCreateReward = () => {
    setEditingReward(null);
    setRewardForm(initialRewardForm);
    setRewardModal(true);
  };

  const openEditReward = (reward: any) => {
    setEditingReward(reward);
    setRewardForm({
      name: reward.name || '',
      description: reward.description || '',
      pointsCost: String(reward.pointsCost || ''),
      discountType: reward.discountType || 'fixed',
      discountValue: String(reward.discountValue || ''),
      isActive: reward.isActive ?? true,
    });
    setRewardModal(true);
  };

  const handleSaveReward = async () => {
    if (!rewardForm.name.trim()) {
      toast.error('Reward name is required');
      return;
    }
    setSavingReward(true);
    try {
      const payload = {
        ...rewardForm,
        pointsCost: parseInt(rewardForm.pointsCost) || 0,
        discountValue: parseFloat(rewardForm.discountValue) || 0,
      };
      if (editingReward) {
        await api.put(`/api/loyalty/rewards/${editingReward.id}`, payload);
        toast.success('Reward updated');
      } else {
        await api.post('/api/loyalty/rewards', payload);
        toast.success('Reward created');
      }
      setRewardModal(false);
      loadRewards();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save reward');
    } finally {
      setSavingReward(false);
    }
  };

  const handleDeleteReward = async () => {
    if (!rewardToDelete) return;
    setDeletingReward(true);
    try {
      await api.delete(`/api/loyalty/rewards/${rewardToDelete.id}`);
      toast.success('Reward deleted');
      setDeleteRewardOpen(false);
      setRewardToDelete(null);
      loadRewards();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete reward');
    } finally {
      setDeletingReward(false);
    }
  };

  const tabs = [
    { id: 'config', label: 'Configuration', icon: Settings },
    { id: 'rewards', label: 'Rewards', icon: Gift },
    { id: 'members', label: 'Members', icon: Users },
  ];

  const tierBadgeColor: Record<string, string> = {
    bronze: 'bg-amber-100 text-amber-700',
    silver: 'bg-gray-200 text-gray-700',
    gold: 'bg-yellow-100 text-yellow-700',
    platinum: 'bg-indigo-100 text-indigo-700',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Loyalty Program</h1>
          <p className="text-gray-600">Manage rewards and loyalty tiers</p>
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

      {/* Config Tab */}
      {tab === 'config' && (
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-2xl space-y-6">
          <div className="flex items-center gap-3 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.isEnabled}
                onChange={(e) => setConfig({ ...config, isEnabled: e.target.checked })}
                className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
              />
              <span className="font-medium text-gray-900">Enable Loyalty Program</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Points per Dollar Spent</label>
            <input
              type="number"
              value={config.pointsPerDollar}
              onChange={(e) => setConfig({ ...config, pointsPerDollar: parseInt(e.target.value) || 0 })}
              className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Welcome Bonus Points</label>
            <input
              type="number"
              value={config.welcomePoints}
              onChange={(e) => setConfig({ ...config, welcomePoints: parseInt(e.target.value) || 0 })}
              className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Birthday Bonus Points</label>
            <input
              type="number"
              value={config.birthdayBonus}
              onChange={(e) => setConfig({ ...config, birthdayBonus: parseInt(e.target.value) || 0 })}
              className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>

          <div>
            <h3 className="font-medium text-gray-900 mb-3">Tier Thresholds (lifetime points)</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Silver</label>
                <input
                  type="number"
                  value={config.tierThresholds.silver}
                  onChange={(e) => setConfig({
                    ...config,
                    tierThresholds: { ...config.tierThresholds, silver: parseInt(e.target.value) || 0 },
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Gold</label>
                <input
                  type="number"
                  value={config.tierThresholds.gold}
                  onChange={(e) => setConfig({
                    ...config,
                    tierThresholds: { ...config.tierThresholds, gold: parseInt(e.target.value) || 0 },
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Platinum</label>
                <input
                  type="number"
                  value={config.tierThresholds.platinum}
                  onChange={(e) => setConfig({
                    ...config,
                    tierThresholds: { ...config.tierThresholds, platinum: parseInt(e.target.value) || 0 },
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                />
              </div>
            </div>
          </div>

          <Button onClick={saveConfig} disabled={savingConfig}>
            <Save className="w-4 h-4 mr-2 inline" />
            {savingConfig ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      )}

      {/* Rewards Tab */}
      {tab === 'rewards' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={openCreateReward}>
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Reward
            </Button>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rewards.map(reward => (
              <div key={reward.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Gift className="w-5 h-5 text-green-600" />
                    <h3 className="font-semibold text-gray-900">{reward.name}</h3>
                  </div>
                  <span className={`px-2 py-0.5 text-xs rounded-full ${reward.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {reward.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-sm text-gray-600 mb-3">{reward.description || 'No description'}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{reward.pointsCost} points</span>
                  <span className="font-medium text-green-700">
                    {reward.discountType === 'percent' ? `${reward.discountValue}% off` : `$${Number(reward.discountValue).toFixed(2)} off`}
                  </span>
                </div>
                <div className="flex gap-2 mt-4 pt-3 border-t">
                  <button onClick={() => openEditReward(reward)} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                    <Edit className="w-3 h-3" /> Edit
                  </button>
                  <button onClick={() => { setRewardToDelete(reward); setDeleteRewardOpen(true); }} className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Delete
                  </button>
                </div>
              </div>
            ))}
            {rewards.length === 0 && !loadingRewards && (
              <p className="col-span-full text-center text-gray-500 py-8">No rewards configured yet</p>
            )}
          </div>
        </div>
      )}

      {/* Members Tab */}
      {tab === 'members' && (
        <div>
          <div className="mb-4">
            <div className="relative max-w-md">
              <input
                type="text"
                placeholder="Search members..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="w-full pl-4 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tier</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Points</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Lifetime Points</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Spent</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {members.map(member => (
                  <tr key={member.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{member.customerName || member.name}</p>
                      <p className="text-xs text-gray-500">{member.email || member.phone || ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${tierBadgeColor[member.tier || member.loyaltyTier] || 'bg-gray-100 text-gray-600'}`}>
                        {member.tier || member.loyaltyTier || 'Bronze'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">{member.points || 0}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{member.lifetimePoints || 0}</td>
                    <td className="px-4 py-3 text-right text-gray-900">${Number(member.totalSpent || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{member.joinedAt ? new Date(member.joinedAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
                {members.length === 0 && !loadingMembers && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">No members found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reward Modal */}
      <Modal
        isOpen={rewardModal}
        onClose={() => setRewardModal(false)}
        title={editingReward ? 'Edit Reward' : 'New Reward'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reward Name *</label>
            <input
              type="text"
              value={rewardForm.name}
              onChange={(e) => setRewardForm({ ...rewardForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="$5 Off Next Purchase"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={rewardForm.description}
              onChange={(e) => setRewardForm({ ...rewardForm, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Points Cost</label>
            <input
              type="number"
              value={rewardForm.pointsCost}
              onChange={(e) => setRewardForm({ ...rewardForm, pointsCost: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              placeholder="100"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discount Type</label>
              <select
                value={rewardForm.discountType}
                onChange={(e) => setRewardForm({ ...rewardForm, discountType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
              >
                <option value="fixed">Fixed ($)</option>
                <option value="percent">Percentage (%)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discount Value</label>
              <input
                type="number"
                step="0.01"
                value={rewardForm.discountValue}
                onChange={(e) => setRewardForm({ ...rewardForm, discountValue: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900"
                placeholder={rewardForm.discountType === 'percent' ? '10' : '5.00'}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rewardForm.isActive}
              onChange={(e) => setRewardForm({ ...rewardForm, isActive: e.target.checked })}
              className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
            />
            <span className="text-sm text-gray-700">Active</span>
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setRewardModal(false)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium">Cancel</button>
          <Button onClick={handleSaveReward} disabled={savingReward}>
            {savingReward ? 'Saving...' : editingReward ? 'Update' : 'Create'}
          </Button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteRewardOpen}
        onClose={() => { setDeleteRewardOpen(false); setRewardToDelete(null); }}
        onConfirm={handleDeleteReward}
        title="Delete Reward"
        message={`Are you sure you want to delete "${rewardToDelete?.name}"?`}
        confirmText="Delete"
        loading={deletingReward}
      />
    </div>
  );
}
