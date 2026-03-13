import { useEffect, useState } from 'react'
import { supabase, API_URL as API } from '../supabase'
import {
  TrendingUp, Users, PieChart, Rocket, LifeBuoy, Star,
  Package, Layers, BarChart3, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'

interface AnalyticsData {
  revenueByMonth: { month: string; mrr: number; count: number }[]
  customerGrowth: { month: string; total: number; new: number }[]
  planDistribution: { plan: string; count: number }[]
  deployMetrics: { total: number; successful: number; failed: number }
  ticketMetrics: { open: number; avgResolutionHours: number; avgRating: number }
  featureAdoption: { feature: string; count: number }[]
  topProducts: { product: string; count: number }[]
}

const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-blue-500',
  pro: 'bg-purple-500',
  business: 'bg-emerald-500',
  enterprise: 'bg-orange-500',
  unknown: 'bg-gray-500',
}

function MiniBarChart({ data, valueKey, labelKey, color = '#3b82f6', height = 120 }: {
  data: { [k: string]: any }[]
  valueKey: string
  labelKey: string
  color?: string
  height?: number
}) {
  if (!data.length) return <div className="text-gray-500 text-sm">No data yet</div>
  const max = Math.max(...data.map(d => d[valueKey]), 1)
  const barWidth = Math.max(16, Math.min(40, Math.floor(300 / data.length)))
  const gap = 4
  const svgWidth = data.length * (barWidth + gap)

  return (
    <div className="overflow-x-auto">
      <svg width={svgWidth} height={height + 30} className="block">
        {data.map((d, i) => {
          const barH = (d[valueKey] / max) * height
          const x = i * (barWidth + gap)
          const y = height - barH
          return (
            <g key={i}>
              <rect x={x} y={y} width={barWidth} height={barH} rx={3} fill={color} opacity={0.85} />
              <title>{d[labelKey]}: {typeof d[valueKey] === 'number' ? d[valueKey].toLocaleString() : d[valueKey]}</title>
              <text x={x + barWidth / 2} y={height + 14} textAnchor="middle" fill="#6b7280" fontSize={9}>
                {d[labelKey]?.slice(5) || ''}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string | number; icon: any; color: string; sub?: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-gray-400">{label}</span>
        <Icon size={18} className={color} />
      </div>
      <span className="text-3xl font-bold text-white">{value}</span>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

function defaultDateRange() {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dateRange, setDateRange] = useState(defaultDateRange)
  const [fromInput, setFromInput] = useState(dateRange.from)
  const [toInput, setToInput] = useState(dateRange.to)

  const fetchAnalytics = (from: string, to: string) => {
    setLoading(true)
    setError('')
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { setLoading(false); return }
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const qs = params.toString()
      fetch(API + '/api/v1/factory/analytics' + (qs ? '?' + qs : ''), {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load analytics')))
        .then(d => { setData(d); setLoading(false) })
        .catch(e => { setError(e.message); setLoading(false) })
    }).catch(() => { setError('Auth failed'); setLoading(false) })
  }

  useEffect(() => {
    fetchAnalytics(dateRange.from, dateRange.to)
  }, [dateRange])

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-white mb-2">Analytics</h1>
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-white mb-2">Analytics</h1>
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error || 'Failed to load analytics data'}
        </div>
      </div>
    )
  }

  const totalCustomers = data.customerGrowth.length > 0
    ? data.customerGrowth[data.customerGrowth.length - 1].total
    : 0
  const lastMonthNew = data.customerGrowth.length > 0
    ? data.customerGrowth[data.customerGrowth.length - 1].new
    : 0
  const currentMrr = data.revenueByMonth.length > 0
    ? data.revenueByMonth.reduce((s, r) => s + r.mrr, 0)
    : 0
  const deploySuccessRate = data.deployMetrics.total > 0
    ? Math.round((data.deployMetrics.successful / data.deployMetrics.total) * 100)
    : 0
  const totalPlanCount = data.planDistribution.reduce((s, p) => s + p.count, 0)

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Analytics</h1>
      <p className="text-gray-400 text-sm mb-4">Platform metrics and reporting</p>

      {/* Date range filter */}
      <div className="flex items-center gap-3 mb-8">
        <label className="text-sm text-gray-400">From</label>
        <input
          type="date"
          value={fromInput}
          onChange={e => setFromInput(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <label className="text-sm text-gray-400">To</label>
        <input
          type="date"
          value={toInput}
          onChange={e => setToInput(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={() => setDateRange({ from: fromInput, to: toInput })}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
        >
          Apply
        </button>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total MRR"
          value={'$' + currentMrr.toLocaleString()}
          icon={TrendingUp}
          color="text-emerald-400"
          sub={'ARR: $' + (currentMrr * 12).toLocaleString()}
        />
        <StatCard
          label="Total Customers"
          value={totalCustomers}
          icon={Users}
          color="text-blue-400"
          sub={lastMonthNew > 0 ? `+${lastMonthNew} this month` : undefined}
        />
        <StatCard
          label="Deploy Success"
          value={deploySuccessRate + '%'}
          icon={Rocket}
          color={deploySuccessRate >= 80 ? 'text-green-400' : 'text-yellow-400'}
          sub={`${data.deployMetrics.successful}/${data.deployMetrics.total} deployments`}
        />
        <StatCard
          label="Open Tickets"
          value={data.ticketMetrics.open}
          icon={LifeBuoy}
          color={data.ticketMetrics.open > 10 ? 'text-red-400' : 'text-blue-400'}
          sub={`Avg ${data.ticketMetrics.avgResolutionHours}h resolution`}
        />
      </div>

      {/* Revenue trend + Customer growth */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-emerald-400" />
            <span className="text-sm font-medium text-white">Revenue Trend (MRR)</span>
          </div>
          <MiniBarChart data={data.revenueByMonth} valueKey="mrr" labelKey="month" color="#10b981" height={140} />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users size={18} className="text-blue-400" />
            <span className="text-sm font-medium text-white">Customer Growth</span>
          </div>
          <MiniBarChart data={data.customerGrowth} valueKey="total" labelKey="month" color="#3b82f6" height={140} />
        </div>
      </div>

      {/* Plan distribution + Support metrics + Deploy breakdown */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {/* Plan Distribution */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <PieChart size={18} className="text-purple-400" />
            <span className="text-sm font-medium text-white">Plan Distribution</span>
          </div>
          <div className="space-y-3">
            {data.planDistribution.map(({ plan, count }) => {
              const pct = totalPlanCount > 0 ? Math.round((count / totalPlanCount) * 100) : 0
              return (
                <div key={plan}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300 capitalize">{plan}</span>
                    <span className="text-gray-400">{count} ({pct}%)</span>
                  </div>
                  <div className="w-full bg-gray-800 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${PLAN_COLORS[plan] || PLAN_COLORS.unknown}`}
                      style={{ width: pct + '%' }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Support Metrics */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <LifeBuoy size={18} className="text-orange-400" />
            <span className="text-sm font-medium text-white">Support Metrics</span>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Open Tickets</span>
              <span className="text-white font-semibold">{data.ticketMetrics.open}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Avg Resolution</span>
              <span className="text-white font-semibold">{data.ticketMetrics.avgResolutionHours}h</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Avg Rating</span>
              <div className="flex items-center gap-1">
                <Star size={14} className="text-yellow-400 fill-yellow-400" />
                <span className="text-white font-semibold">{data.ticketMetrics.avgRating || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Deploy Breakdown */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Rocket size={18} className="text-green-400" />
            <span className="text-sm font-medium text-white">Deploy Breakdown</span>
          </div>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Total Deploys</span>
              <span className="text-white font-semibold">{data.deployMetrics.total}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Successful</span>
              <div className="flex items-center gap-1">
                <ArrowUpRight size={14} className="text-green-400" />
                <span className="text-green-400 font-semibold">{data.deployMetrics.successful}</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">Failed</span>
              <div className="flex items-center gap-1">
                <ArrowDownRight size={14} className="text-red-400" />
                <span className="text-red-400 font-semibold">{data.deployMetrics.failed}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Feature Adoption + Top Products */}
      <div className="grid grid-cols-2 gap-4">
        {/* Feature Adoption */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Layers size={18} className="text-cyan-400" />
            <span className="text-sm font-medium text-white">Feature Adoption</span>
          </div>
          {data.featureAdoption.length === 0 ? (
            <p className="text-gray-500 text-sm">No feature data yet</p>
          ) : (
            <div className="overflow-y-auto max-h-64">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-2 font-medium">Feature</th>
                    <th className="text-right py-2 font-medium">Tenants</th>
                    <th className="text-right py-2 font-medium">Adoption</th>
                  </tr>
                </thead>
                <tbody>
                  {data.featureAdoption.map(({ feature, count }) => (
                    <tr key={feature} className="border-b border-gray-800/50">
                      <td className="py-2 text-gray-300">{feature}</td>
                      <td className="py-2 text-right text-white">{count}</td>
                      <td className="py-2 text-right text-gray-400">
                        {totalCustomers > 0 ? Math.round((count / totalCustomers) * 100) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Top Products */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Package size={18} className="text-pink-400" />
            <span className="text-sm font-medium text-white">Top Products</span>
          </div>
          {data.topProducts.length === 0 ? (
            <p className="text-gray-500 text-sm">No product data yet</p>
          ) : (
            <div className="space-y-3">
              {data.topProducts.map(({ product, count }) => {
                const pct = totalCustomers > 0 ? Math.round((count / totalCustomers) * 100) : 0
                return (
                  <div key={product}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300 capitalize">{product}</span>
                      <span className="text-gray-400">{count} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-pink-500"
                        style={{ width: Math.min(100, pct) + '%' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
