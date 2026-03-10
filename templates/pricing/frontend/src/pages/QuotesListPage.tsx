import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'
import { Search, FileText, Plus, Calendar } from 'lucide-react'

interface Quote {
  id: string
  customerName: string
  customerEmail?: string
  status: 'draft' | 'presented' | 'signed' | 'closed' | 'expired'
  total: number
  repName?: string
  createdAt: string
  updatedAt: string
}

const statusStyles: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  presented: 'bg-blue-100 text-blue-700',
  signed: 'bg-green-100 text-green-700',
  closed: 'bg-emerald-100 text-emerald-700',
  expired: 'bg-red-100 text-red-700',
}

const statusTabs = ['all', 'draft', 'presented', 'signed', 'closed', 'expired'] as const
type StatusFilter = (typeof statusTabs)[number]

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

export default function QuotesListPage() {
  const { user } = useAuth()
  const isManagerOrAdmin = user?.role === 'admin' || user?.role === 'manager'

  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    async function loadQuotes() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (statusFilter !== 'all') params.set('status', statusFilter)
        if (search) params.set('search', search)
        if (dateFrom) params.set('from', dateFrom)
        if (dateTo) params.set('to', dateTo)

        const data = await api.get<{ quotes: Quote[] }>(
          `/api/quotes?${params.toString()}`
        )
        setQuotes(data.quotes || [])
      } catch {
        setQuotes([])
      } finally {
        setLoading(false)
      }
    }
    loadQuotes()
  }, [statusFilter, search, dateFrom, dateTo])

  // Debounced search
  const [searchInput, setSearchInput] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Quotes</h1>
        <Link
          to="/quote/new"
          className="inline-flex items-center gap-2 px-5 py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors touch-manipulation text-base"
        >
          <Plus size={20} />
          New Quote
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 space-y-4">
        {/* Status tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
          {statusTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors touch-manipulation min-h-[44px] ${
                statusFilter === tab
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Search and date filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              size={20}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Search by customer name..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-11 pr-4 py-3 text-base border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div className="flex gap-2 items-center">
            <Calendar size={18} className="text-gray-400 flex-shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="py-3 px-3 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="From"
            />
            <span className="text-gray-400">-</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="py-3 px-3 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              placeholder="To"
            />
          </div>
        </div>
      </div>

      {/* Quote cards */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500" />
        </div>
      ) : quotes.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <FileText size={48} className="mx-auto mb-4 text-gray-300" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">No quotes found</h2>
          <p className="text-gray-500 mb-6">
            {search || statusFilter !== 'all'
              ? 'Try adjusting your filters.'
              : 'Create your first quote to get started.'}
          </p>
          {!search && statusFilter === 'all' && (
            <Link
              to="/quote/new"
              className="inline-flex items-center gap-2 px-5 py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors touch-manipulation"
            >
              <Plus size={20} />
              Create Quote
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {quotes.map((quote) => (
            <Link
              key={quote.id}
              to={`/quote/${quote.id}`}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-gray-300 transition-all touch-manipulation"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-gray-900 text-base truncate">
                    {quote.customerName}
                  </h3>
                  {quote.customerEmail && (
                    <p className="text-sm text-gray-500 truncate mt-0.5">
                      {quote.customerEmail}
                    </p>
                  )}
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ml-2 flex-shrink-0 ${
                    statusStyles[quote.status] || statusStyles.draft
                  }`}
                >
                  {quote.status}
                </span>
              </div>

              <div className="flex items-end justify-between mt-4">
                <div>
                  <p className="text-xs text-gray-400">
                    {new Date(quote.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                  {isManagerOrAdmin && quote.repName && (
                    <p className="text-xs text-gray-500 mt-1">Rep: {quote.repName}</p>
                  )}
                </div>
                <p className="text-xl font-bold text-gray-900">
                  {formatCurrency(quote.total)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
