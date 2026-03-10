import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';

interface Commission {
  id: string;
  customerName: string;
  quoteDate: string;
  parAmount: number;
  sellingAmount: number;
  baseCommission: number;
  bonusCommission: number;
  totalCommission: number;
  status: 'pending' | 'base_paid' | 'completed';
  repName?: string;
}

interface CommissionSummary {
  totalEarned: number;
  pending: number;
  paid: number;
}

interface Rep {
  id: string;
  name: string;
}

export default function CommissionsPage() {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [summary, setSummary] = useState<CommissionSummary>({ totalEarned: 0, pending: 0, paid: 0 });
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [isManager, setIsManager] = useState(false);

  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedRep, setSelectedRep] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchCommissions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      if (selectedRep) params.set('repId', selectedRep);

      const data = await api.get(`/api/commissions?${params.toString()}`);
      setCommissions(data.commissions);
      setSummary(data.summary);
      setIsManager(data.isManager);
      if (data.reps) setReps(data.reps);
    } catch {
      // Handle error silently
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedRep]);

  useEffect(() => {
    fetchCommissions();
  }, [fetchCommissions]);

  async function handlePayAction(commissionId: string, action: 'pay_base' | 'pay_bonus') {
    setActionLoading(commissionId);
    try {
      await api.post(`/api/commissions/${commissionId}/${action}`, {});
      await fetchCommissions();
    } catch {
      // Handle error
    } finally {
      setActionLoading(null);
    }
  }

  function handleExport() {
    const params = new URLSearchParams();
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (selectedRep) params.set('repId', selectedRep);
    window.open(`/api/commissions/export?${params.toString()}`, '_blank');
  }

  function getStatusBadge(status: Commission['status']) {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      base_paid: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
    };
    const labels: Record<string, string> = {
      pending: 'Pending',
      base_paid: 'Base Paid',
      completed: 'Completed',
    };
    return (
      <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Commissions</h1>
          <button
            onClick={handleExport}
            className="px-5 py-3 bg-gray-800 text-white font-semibold rounded-xl hover:bg-gray-900 transition-colors min-h-[48px] text-sm"
          >
            <svg className="w-4 h-4 inline-block mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export CSV
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-lg p-5">
            <p className="text-sm text-gray-500 font-medium">Total Earned</p>
            <p className="text-2xl font-black text-gray-900 mt-1">${summary.totalEarned.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl shadow-lg p-5">
            <p className="text-sm text-yellow-600 font-medium">Pending</p>
            <p className="text-2xl font-black text-yellow-700 mt-1">${summary.pending.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl shadow-lg p-5">
            <p className="text-sm text-green-600 font-medium">Paid</p>
            <p className="text-2xl font-black text-green-700 mt-1">${summary.paid.toLocaleString()}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[48px]"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[48px]"
              />
            </div>
            {isManager && reps.length > 0 && (
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Rep</label>
                <select
                  value={selectedRep}
                  onChange={(e) => setSelectedRep(e.target.value)}
                  className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[48px]"
                >
                  <option value="">All Reps</option>
                  {reps.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Commissions List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : commissions.length === 0 ? (
          <div className="bg-white rounded-xl shadow-lg p-12 text-center">
            <p className="text-gray-500 text-lg">No commissions found for this period.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {commissions.map((c) => (
              <div key={c.id} className="bg-white rounded-xl shadow-lg p-5">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold text-gray-900 text-lg">{c.customerName}</h3>
                    {c.repName && <p className="text-sm text-gray-500">Rep: {c.repName}</p>}
                    <p className="text-sm text-gray-500">{new Date(c.quoteDate).toLocaleDateString()}</p>
                  </div>
                  {getStatusBadge(c.status)}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <div>
                    <p className="text-xs text-gray-500">Par Amount</p>
                    <p className="font-semibold text-gray-700">${c.parAmount.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Selling Amount</p>
                    <p className="font-semibold text-gray-700">${c.sellingAmount.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Base Commission</p>
                    <p className="font-semibold text-gray-700">${c.baseCommission.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Bonus Commission</p>
                    <p className="font-semibold text-gray-700">${c.bonusCommission.toLocaleString()}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                  <div>
                    <span className="text-sm text-gray-500">Total: </span>
                    <span className="text-lg font-black text-blue-600">${c.totalCommission.toLocaleString()}</span>
                  </div>

                  {isManager && (
                    <div className="flex gap-2">
                      {c.status === 'pending' && (
                        <button
                          onClick={() => handlePayAction(c.id, 'pay_base')}
                          disabled={actionLoading === c.id}
                          className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 transition-colors min-h-[44px]"
                        >
                          {actionLoading === c.id ? '...' : 'Pay Base'}
                        </button>
                      )}
                      {c.status === 'base_paid' && (
                        <button
                          onClick={() => handlePayAction(c.id, 'pay_bonus')}
                          disabled={actionLoading === c.id}
                          className="px-4 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:bg-gray-300 transition-colors min-h-[44px]"
                        >
                          {actionLoading === c.id ? '...' : 'Pay Bonus'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
