import React, { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { api } from '../../services/api';

interface AnalyticsData {
  revenue: {
    thisWeek: number;
    thisMonth: number;
    thisYear: number;
  };
  funnel: Array<{
    stage: string;
    count: number;
    conversionRate: number;
  }>;
  leaderboard: Array<{
    rank: number;
    name: string;
    revenueClosed: number;
    closeRate: number;
    avgTicket: number;
    commissionEarned: number;
  }>;
  productPerformance: Array<{
    product: string;
    revenue: number;
  }>;
  promotions: Array<{
    name: string;
    usageCount: number;
    totalDiscount: number;
    revenue: number;
  }>;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const result = await api.get('/api/analytics');
        setData(result);
      } catch {
        // handle
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Failed to load analytics data.</p>
      </div>
    );
  }

  const maxFunnelCount = Math.max(...data.funnel.map((f) => f.count), 1);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytics Dashboard</h1>

        {/* Revenue Cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-lg p-5">
            <p className="text-sm text-gray-500 font-medium">This Week</p>
            <p className="text-3xl font-black text-gray-900 mt-1">${data.revenue.thisWeek.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl shadow-lg p-5">
            <p className="text-sm text-gray-500 font-medium">This Month</p>
            <p className="text-3xl font-black text-gray-900 mt-1">${data.revenue.thisMonth.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl shadow-lg p-5">
            <p className="text-sm text-gray-500 font-medium">This Year</p>
            <p className="text-3xl font-black text-gray-900 mt-1">${data.revenue.thisYear.toLocaleString()}</p>
          </div>
        </div>

        {/* Quote Funnel */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Quote Funnel</h2>
          <div className="space-y-3">
            {data.funnel.map((stage, i) => {
              const pct = (stage.count / maxFunnelCount) * 100;
              return (
                <div key={stage.stage} className="flex items-center gap-4">
                  <div className="w-28 text-right">
                    <p className="font-semibold text-gray-900 text-sm">{stage.stage}</p>
                  </div>
                  <div className="flex-1 h-10 bg-gray-100 rounded-lg overflow-hidden relative">
                    <div
                      className="h-full rounded-lg transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: COLORS[i % COLORS.length],
                      }}
                    />
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm font-bold text-white drop-shadow">
                      {stage.count}
                    </span>
                  </div>
                  <div className="w-16 text-right">
                    <span className="text-sm font-semibold text-gray-600">{stage.conversionRate}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Product Performance Bar Chart */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Product Performance</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.productPerformance}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="product" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(value: number) => [`$${value.toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="revenue" fill="#3B82F6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Product Revenue Pie Chart */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Revenue Distribution</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={data.productPerformance}
                  dataKey="revenue"
                  nameKey="product"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ product, percent }) => `${product} ${(percent * 100).toFixed(0)}%`}
                >
                  {data.productPerformance.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Rep Leaderboard */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-900">Rep Leaderboard</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase">Rank</th>
                  <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase">Name</th>
                  <th className="px-5 py-3 text-right text-xs font-bold text-gray-500 uppercase">Revenue Closed</th>
                  <th className="px-5 py-3 text-right text-xs font-bold text-gray-500 uppercase">Close Rate</th>
                  <th className="px-5 py-3 text-right text-xs font-bold text-gray-500 uppercase">Avg Ticket</th>
                  <th className="px-5 py-3 text-right text-xs font-bold text-gray-500 uppercase">Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.leaderboard.map((rep) => (
                  <tr key={rep.rank} className="hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        rep.rank === 1
                          ? 'bg-yellow-100 text-yellow-700'
                          : rep.rank === 2
                          ? 'bg-gray-200 text-gray-700'
                          : rep.rank === 3
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {rep.rank}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-semibold text-gray-900">{rep.name}</td>
                    <td className="px-5 py-4 text-right font-bold text-gray-900">${rep.revenueClosed.toLocaleString()}</td>
                    <td className="px-5 py-4 text-right text-gray-700">{rep.closeRate}%</td>
                    <td className="px-5 py-4 text-right text-gray-700">${rep.avgTicket.toLocaleString()}</td>
                    <td className="px-5 py-4 text-right font-semibold text-green-600">${rep.commissionEarned.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active Promotions Performance */}
        {data.promotions.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Active Promotions</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.promotions.map((promo, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-4">
                  <h3 className="font-bold text-gray-900">{promo.name}</h3>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div>
                      <p className="text-xs text-gray-500">Uses</p>
                      <p className="font-bold text-gray-900">{promo.usageCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Total Discount</p>
                      <p className="font-bold text-red-600">${promo.totalDiscount.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Revenue</p>
                      <p className="font-bold text-green-600">${promo.revenue.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
