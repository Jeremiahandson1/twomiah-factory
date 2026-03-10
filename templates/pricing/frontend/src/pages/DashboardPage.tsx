import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useApi } from '../hooks/useApi'
import { api } from '../services/api'
import {
  FilePlus,
  FileText,
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle2,
  Tag,
} from 'lucide-react'

interface DashboardStats {
  quotesToday: number
  closesToday: number
  revenueThisWeek: number
}

interface CommissionSummary {
  earned: number
  pending: number
}

interface Quote {
  id: string
  customerName: string
  status: 'draft' | 'presented' | 'signed' | 'closed' | 'expired'
  total: number
  createdAt: string
}

interface Promotion {
  id: string
  name: string
  discount: string
  expiresAt: string
}

const statusStyles: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  presented: 'bg-blue-100 text-blue-700',
  signed: 'bg-green-100 text-green-700',
  closed: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-red-100 text-red-700',
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function timeUntil(dateStr: string): string {
  const now = new Date()
  const target = new Date(dateStr)
  const diffMs = target.getTime() - now.getTime()
  if (diffMs <= 0) return 'Expired'
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  if (days > 0) return `${days}d ${hours}h left`
  return `${hours}h left`
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState<DashboardStats>({
    quotesToday: 0,
    closesToday: 0,
    revenueThisWeek: 0,
  })
  const [commissions, setCommissions] = useState<CommissionSummary>({
    earned: 0,
    pending: 0,
  })
  const [recentQuotes, setRecentQuotes] = useState<Quote[]>([])
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [statsData, commissionsData, quotesData, promosData] =
          await Promise.allSettled([
            api.get<DashboardStats>('/api/analytics/dashboard'),
            api.get<CommissionSummary>('/api/commissions/summary'),
            api.get<{ quotes: Quote[] }>('/api/quotes?limit=5&sort=-createdAt'),
            api.get<{ promotions: Promotion[] }>('/api/promotions/active'),
          ])

        if (statsData.status === 'fulfilled') setStats(statsData.value)
        if (commissionsData.status === 'fulfilled') setCommissions(commissionsData.value)
        if (quotesData.status === 'fulfilled') setRecentQuotes(quotesData.value.quotes || [])
        if (promosData.status === 'fulfilled') setPromotions(promosData.value.promotions || [])
      } finally {
        setLoading(false)
      }
    }
    loadDashboard()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
            Good {getGreetingTime()}, {user?.name?.split(' ')[0] || 'there'}
          </h1>
          <p className="text-gray-500 mt-1 text-base">
            Here is your sales overview for today.
          </p>
        </div>
        <Link
          to="/quote/new"
          className="inline-flex items-center gap-2 px-6 py-3.5 bg-primary-500 text-white text-lg font-semibold rounded-xl hover:bg-primary-600 transition-colors touch-manipulation shadow-sm"
        >
          <FilePlus size={22} />
          New Quote
        </Link>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard
          icon={<FileText size={24} className="text-blue-600" />}
          label="Quotes Today"
          value={stats.quotesToday.toString()}
          bgColor="bg-blue-50"
        />
        <StatCard
          icon={<CheckCircle2 size={24} className="text-green-600" />}
          label="Closes Today"
          value={stats.closesToday.toString()}
          bgColor="bg-green-50"
        />
        <StatCard
          icon={<TrendingUp size={24} className="text-purple-600" />}
          label="Revenue This Week"
          value={formatCurrency(stats.revenueThisWeek)}
          bgColor="bg-purple-50"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Quotes */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">Recent Quotes</h2>
            <Link
              to="/quotes"
              className="text-primary-600 text-sm font-medium hover:underline"
            >
              View all
            </Link>
          </div>
          {recentQuotes.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="text-base">No quotes yet. Create your first one!</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentQuotes.map((quote) => (
                <li key={quote.id}>
                  <Link
                    to={`/quote/${quote.id}`}
                    className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors touch-manipulation min-h-[56px]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate text-base">
                        {quote.customerName}
                      </p>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {new Date(quote.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
                          statusStyles[quote.status] || statusStyles.draft
                        }`}
                      >
                        {quote.status}
                      </span>
                      <span className="font-semibold text-gray-900 text-base">
                        {formatCurrency(quote.total)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Commission summary */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <DollarSign size={20} className="text-green-600" />
              Commissions
            </h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Earned (Paid)</span>
                <span className="text-lg font-bold text-green-700">
                  {formatCurrency(commissions.earned)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Pending (Bonus)</span>
                <span className="text-lg font-bold text-amber-600">
                  {formatCurrency(commissions.pending)}
                </span>
              </div>
            </div>
            <Link
              to="/commissions"
              className="block mt-4 text-center py-2.5 text-primary-600 font-medium border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors touch-manipulation"
            >
              View Details
            </Link>
          </div>

          {/* Active promotions */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Tag size={20} className="text-orange-500" />
              Active Promotions
            </h2>
            {promotions.length === 0 ? (
              <p className="text-gray-500 text-sm">No active promotions.</p>
            ) : (
              <ul className="space-y-3">
                {promotions.map((promo) => (
                  <li
                    key={promo.id}
                    className="flex items-center justify-between py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">
                        {promo.name}
                      </p>
                      <p className="text-xs text-gray-500">{promo.discount}</p>
                    </div>
                    <span className="flex items-center gap-1 text-xs font-medium text-orange-600 whitespace-nowrap ml-2">
                      <Clock size={14} />
                      {timeUntil(promo.expiresAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  bgColor,
}: {
  icon: React.ReactNode
  label: string
  value: string
  bgColor: string
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg ${bgColor} flex items-center justify-center`}>
          {icon}
        </div>
        <span className="text-sm font-medium text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}

function getGreetingTime(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}
