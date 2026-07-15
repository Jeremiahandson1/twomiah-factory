import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Package } from 'lucide-react'
import api, { Product } from '../services/api'
import { money, statusColor } from '../lib/format'

function startingPrice(p: Product) {
  if (!p.variants.length) return null
  return Math.min(...p.variants.map((v) => v.priceCents))
}
function totalInventory(p: Product) {
  const tracked = p.variants.filter((v) => v.inventoryQty !== null)
  if (!tracked.length) return null
  return tracked.reduce((a, v) => a + (v.inventoryQty || 0), 0)
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { api.listProducts().then(setProducts).catch(() => {}).finally(() => setLoading(false)) }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        <Link to="/products/new" className="btn-primary"><Plus className="h-4 w-4" /> New product</Link>
      </div>

      {loading ? <PageSpinner /> : products.length === 0 ? (
        <div className="card p-10 text-center">
          <Package className="h-10 w-10 mx-auto text-gray-300" />
          <p className="mt-3 text-gray-500">No products yet.</p>
          <Link to="/products/new" className="btn-primary mt-4 inline-flex"><Plus className="h-4 w-4" /> Add your first product</Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y">
            {products.map((p) => {
              const img = p.images.find((i) => i.isPrimary) || p.images[0]
              const price = startingPrice(p)
              const inv = totalInventory(p)
              return (
                <Link key={p.id} to={`/products/${p.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                  <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
                    {img ? <img src={img.url} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-gray-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-gray-900 truncate">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.variants.length} variant(s){inv !== null && ` · ${inv} in stock`}</div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(p.status)}`}>{p.status}</span>
                  <div className="w-20 text-right text-sm font-medium text-gray-900">{price !== null ? money(price) : '—'}</div>
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function PageSpinner() {
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-500" /></div>
}
