// Moved from templates/crm-store/frontend/src/pages/ProductsPage.tsx. The catalogue at GET /api/admin/products
// (server/crm/store/catalog/products.ts, products:read): every product with its photos and variants.
//
// Changes from the template:
//   · the list is the reply's `data` (the template read `products`); the app's API client and permissions;
//   · links are under /crm (/crm/products/new, /crm/products/:id);
//   · a failed load says so on the page (the template swallowed it and showed "No products yet" — an empty shop to a
//     person whose catalogue simply did not load);
//   · prices in the store's own currency (the template printed dollars whatever the currency);
//   · the status badge's ink has its ground in both themes (archived was gray-500 on gray-100, 4.4:1, under 4.5);
//     the empty-state icon and the photo placeholder have their dark partners;
//   · the header wraps at phone width.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Package, Plus } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useMayWrite } from '../../../../shared'
import { PRODUCT_STATUS, formatMoney, listOf, useStoreCurrency, type Product } from './lib'

/**
 * The price a shopper sees on the shop's grid (site/views/sections/shop/grid.ejs): the cheapest option, and its
 * compare-at ("was") price when it is higher — the list showed the sale price alone (store live test, 2026-10-26).
 */
function startingPrice(p: Product): { cents: number; wasCents: number | null } | null {
  if (!p.variants.length) return null
  const lo = p.variants.reduce((a, v) => (v.priceCents < a.priceCents ? v : a), p.variants[0])
  return { cents: lo.priceCents, wasCents: lo.compareAtPriceCents && lo.compareAtPriceCents > lo.priceCents ? lo.compareAtPriceCents : null }
}
function totalInventory(p: Product) {
  const tracked = p.variants.filter((v) => v.inventoryQty !== null)
  if (!tracked.length) return null
  return tracked.reduce((a, v) => a + (v.inventoryQty || 0), 0)
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const currency = useStoreCurrency()
  const mayCreate = useMayWrite('products:create')

  useEffect(() => {
    api.get('/api/admin/products')
      .then((r: unknown) => setProducts(listOf<Product>(r)))
      .catch((e: unknown) => setError(errorText(e, 'Could not load the products')))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Products</h1>
        {mayCreate && <Link to="/crm/products/new" className="btn btn-primary"><Plus className="h-4 w-4" /> New product</Link>}
      </div>

      <PageError message={error} />

      {loading ? <PageSpinner /> : error ? null : products.length === 0 ? (
        <div className="card p-10 text-center">
          <Package className="h-10 w-10 mx-auto text-gray-400 dark:text-slate-500" />
          <p className="mt-3 text-gray-600 dark:text-slate-300">No products yet.</p>
          {mayCreate && <Link to="/crm/products/new" className="btn btn-primary mt-4 inline-flex"><Plus className="h-4 w-4" /> Add your first product</Link>}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-gray-200 dark:divide-slate-800">
            {products.map((p) => {
              const img = p.images.find((i) => i.isPrimary) || p.images[0]
              const price = startingPrice(p)
              const inv = totalInventory(p)
              const status = PRODUCT_STATUS[p.status] || PRODUCT_STATUS.draft
              return (
                <Link key={p.id} to={`/crm/products/${p.id}`} className="flex items-center gap-3 sm:gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-800">
                  <div className="h-12 w-12 flex-shrink-0 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center dark:bg-slate-800">
                    {img ? <img src={img.url} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-gray-400 dark:text-slate-500" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-gray-900 truncate dark:text-slate-100">{p.name}</div>
                    <div className="text-xs text-gray-600 dark:text-slate-400">
                      {p.variants.length} {p.variants.length === 1 ? 'variant' : 'variants'}{inv !== null && ` · ${inv} in stock`}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>{status.label}</span>
                  <div className="w-24 text-right text-sm font-medium text-gray-900 dark:text-slate-100">
                    {price !== null ? formatMoney(price.cents, currency) : '—'}
                    {price?.wasCents != null && <div className="text-xs font-normal text-gray-600 line-through dark:text-slate-400"><span className="sr-only">Was </span>{formatMoney(price.wasCents, currency)}</div>}
                  </div>
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
  return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" /></div>
}
