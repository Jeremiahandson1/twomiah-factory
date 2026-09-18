import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import api from '../services/api'
import { money, formatDate } from '../lib/format'

type Customer = { email: string; name: string | null; phone: string | null; orderCount: number; totalSpentCents: number; lastOrderAt: string }

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { api.listCustomers().then(setCustomers).catch(() => {}).finally(() => setLoading(false)) }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
      {loading ? <PageSpinner /> : customers.length === 0 ? (
        <div className="card p-10 text-center">
          <Users className="h-10 w-10 mx-auto text-gray-300" />
          <p className="mt-3 text-gray-500">No customers yet. They'll appear here after the first order.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-gray-400 border-b">
              <tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Orders</th><th className="px-4 py-3">Spent</th><th className="px-4 py-3">Last order</th></tr>
            </thead>
            <tbody className="divide-y">
              {customers.map((c) => (
                <tr key={c.email} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{c.name || c.email}</div>
                    <div className="text-xs text-gray-500">{c.email}{c.phone ? ` · ${c.phone}` : ''}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.orderCount}</td>
                  <td className="px-4 py-3 font-medium">{money(c.totalSpentCents)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(c.lastOrderAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
}
