// Single API client for the store admin. Base URL is empty in production (the
// backend serves this SPA same-origin) or VITE_API_URL in dev. Access/refresh
// tokens live in localStorage; a 401 transparently refreshes once and retries.

const API_URL = import.meta.env.VITE_API_URL || ''

// Abort a request after this long so a hung backend surfaces a real, retryable
// error instead of leaving the UI stuck forever. Survives a Render cold start.
const DEFAULT_TIMEOUT_MS = 45_000

// Marks timeout/network failures as transient (vs a real HTTP status) so the
// auth check can preserve the session on a stall instead of forcing re-login.
function transientError(message: string): Error & { status?: number; isTransient?: boolean } {
  const err = new Error(message) as Error & { status?: number; isTransient?: boolean }
  err.status = 0
  err.isTransient = true
  return err
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted) throw transientError('Request timed out — the server may be waking up. Please try again.')
    throw transientError('Could not reach the server. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
  }
}

export type VendorTicket = {
  id: string; number: string; subject: string;
  status: string; priority: string; created_at: string
}

// A staff login for the store admin. Mirrors the `users` table's public columns
// (role is 'owner' | 'staff'); password material never reaches the browser.
export type StoreUser = {
  id: string
  email: string
  name: string | null
  role: string
  isActive: boolean
  createdAt: string
}

export type Product = {
  id: string
  slug: string
  name: string
  tagline: string | null
  description: string | null
  status: 'draft' | 'active' | 'archived'
  featured: boolean
  leadTimeDays: number | null
  seoTitle: string | null
  seoDescription: string | null
  position: number
  images: ProductImage[]
  variants: ProductVariant[]
}
export type ProductImage = { id: string; url: string; alt: string | null; position: number; isPrimary: boolean }
export type ProductVariant = {
  id: string; sku: string; name: string; priceCents: number
  compareAtPriceCents: number | null; weightOz: number | null
  inventoryQty: number | null; options: Record<string, string> | null; position: number
}
export type Order = {
  supplierOrderId?: string | null
  supplierStatus?: string | null
  supplierCostCents?: number | null
  supplierError?: string | null
  id: string; orderNumber: string | null; provider: string; status: string
  customerEmail: string; customerName: string | null; customerPhone: string | null
  shippingAddress: Address | null; billingAddress: Address | null
  subtotalCents: number; shippingCents: number; taxCents: number; discountCents: number; totalCents: number
  currency: string; trackingCarrier: string | null; trackingNumber: string | null
  internalNote: string | null; createdAt: string; items?: OrderItem[]
  labelUrl?: string | null; labelCostCents?: number | null; labelPurchasedAt?: string | null
}
export type OrderItem = {
  id: string; productName: string; variantName: string; sku: string; imageUrl: string | null
  unitPriceCents: number; quantity: number; lineTotalCents: number
}
export type Address = { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string }
export type ShippingZone = { name: string; countries: string[]; states: string[]; rateCents: number; freeThresholdCents?: number | null }
export type TaxRate = { country: string; state: string; rateBps: number }
export type StoreSettings = {
  id: string; companyName: string; supportEmail: string | null; currency: string
  flatShippingCents: number; freeShippingThresholdCents: number | null; taxRateBps: number; storefrontOrigin: string | null
  shippingZones?: ShippingZone[] | null; taxRates?: TaxRate[] | null
}
export type DiscountCode = {
  id: string; code: string; type: 'percent' | 'fixed'; value: number; active: boolean
  minSubtotalCents: number; maxUses: number | null; usedCount: number; expiresAt: string | null; createdAt: string
}
export type PaymentStatus = {
  config: { provider: string; mode: string; publishableKey: string | null; connected: boolean; hasWebhookSecret: boolean; updatedAt: string } | null
  webhookUrl: string
}
export type User = { id: string; email: string; name: string | null; role: string }

export type Review = {
  id: string; productId: string; productName?: string | null; productSlug?: string | null
  authorName: string; authorEmail?: string | null; rating: number
  title?: string | null; body?: string | null
  status: 'pending' | 'approved' | 'rejected'; verifiedPurchase: boolean; createdAt: string
}
export type Parcel = { lengthIn: number; widthIn: number; heightIn: number; weightOz: number }
export type ShippingConfig = {
  connected: boolean; provider: string | null; mode?: string
  defaultParcel: Parcel; fromAddress: (Address & { name?: string; phone?: string }) | null
}
export type RateQuote = { id: string; carrier: string; service: string; amountCents: number; currency: string; estimatedDays?: number | null }
export type BoughtLabel = { carrier: string; service?: string; trackingCode: string; labelUrl: string; costCents: number }

class ApiClient {
  private baseUrl = API_URL
  private accessToken: string | null = localStorage.getItem('accessToken')
  private refreshToken: string | null = localStorage.getItem('refreshToken')

  setTokens(access: string, refresh: string) {
    this.accessToken = access
    this.refreshToken = refresh
    localStorage.setItem('accessToken', access)
    localStorage.setItem('refreshToken', refresh)
  }
  clearTokens() {
    this.accessToken = null
    this.refreshToken = null
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
  }
  get hasToken() { return !!this.accessToken }

  private async request<T>(endpoint: string, options: RequestInit = {}, retry = true): Promise<T> {
    const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData
    const headers: Record<string, string> = {
      // Let the browser set the multipart boundary for FormData uploads.
      ...(options.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      ...(options.headers as Record<string, string>),
    }
    const res = await fetchWithTimeout(`${this.baseUrl}${endpoint}`, { ...options, headers })

    if (res.status === 401 && retry && this.refreshToken) {
      const refreshed = await this.tryRefresh()
      if (refreshed) return this.request<T>(endpoint, options, false)
      this.clearTokens()
      if (!location.pathname.endsWith('/login')) location.href = '/login'
      throw new Error('Session expired')
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`)
    return data as T
  }

  private async tryRefresh(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/auth/refresh`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      })
      if (!res.ok) return false
      const data = await res.json()
      this.setTokens(data.accessToken, data.refreshToken)
      return true
    } catch { return false }
  }

  // ── Auth ──
  async login(email: string, password: string) {
    const data = await this.request<{ accessToken: string; refreshToken: string; user: User }>(
      '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }, false)
    this.setTokens(data.accessToken, data.refreshToken)
    return data.user
  }
  async logout() { try { await this.request('/api/auth/logout', { method: 'POST' }) } finally { this.clearTokens() } }
  async getMe() { return (await this.request<{ user: User }>('/api/auth/me')).user }
  async changePassword(currentPassword: string, newPassword: string) {
    return this.request('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
  }
  async forgotPassword(email: string) {
    return this.request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }, false)
  }
  async resetPassword(token: string, password: string) {
    return this.request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }, false)
  }

  // ── Products ──
  async listProducts() { return (await this.request<{ products: Product[] }>('/api/admin/products')).products }
  async getProduct(id: string) { return (await this.request<{ product: Product }>(`/api/admin/products/${id}`)).product }
  async createProduct(body: Partial<Product>) { return (await this.request<{ product: Product }>('/api/admin/products', { method: 'POST', body: JSON.stringify(body) })).product }
  async updateProduct(id: string, body: Partial<Product>) { return (await this.request<{ product: Product }>(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).product }
  async deleteProduct(id: string) { return this.request(`/api/admin/products/${id}`, { method: 'DELETE' }) }
  async addVariant(productId: string, body: Partial<ProductVariant>) { return (await this.request<{ variant: ProductVariant }>(`/api/admin/products/${productId}/variants`, { method: 'POST', body: JSON.stringify(body) })).variant }
  async updateVariant(variantId: string, body: Partial<ProductVariant>) { return (await this.request<{ variant: ProductVariant }>(`/api/admin/products/variants/${variantId}`, { method: 'PATCH', body: JSON.stringify(body) })).variant }
  async deleteVariant(variantId: string) { return this.request(`/api/admin/products/variants/${variantId}`, { method: 'DELETE' }) }
  async addImage(productId: string, body: { url: string; alt?: string; isPrimary?: boolean }) { return (await this.request<{ image: ProductImage }>(`/api/admin/products/${productId}/images`, { method: 'POST', body: JSON.stringify(body) })).image }
  async uploadImage(productId: string, file: File) {
    const fd = new FormData()
    fd.append('file', file)
    return (await this.request<{ image: ProductImage }>(`/api/admin/products/${productId}/images/upload`, { method: 'POST', body: fd })).image
  }
  async updateImage(imageId: string, body: Partial<ProductImage>) { return (await this.request<{ image: ProductImage }>(`/api/admin/products/images/${imageId}`, { method: 'PATCH', body: JSON.stringify(body) })).image }
  async deleteImage(imageId: string) { return this.request(`/api/admin/products/images/${imageId}`, { method: 'DELETE' }) }

  // ── Orders ──
  async listOrders(status?: string) { return (await this.request<{ orders: Order[] }>(`/api/admin/orders${status ? `?status=${status}` : ''}`)).orders }
  async getOrder(id: string) { return (await this.request<{ order: Order }>(`/api/admin/orders/${id}`)).order }
  async orderStats() { return (await this.request<{ stats: { paidCount: number; pendingFulfillment: number; revenueCents: number; atSupplier: number } }>('/api/admin/orders/stats')).stats }
  async listCustomers() { return (await this.request<{ customers: any[] }>('/api/admin/orders/customers')).customers }
  async setOrderStatus(id: string, status: string) { return (await this.request<{ order: Order }>(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })).order }
  async setFulfillment(id: string, body: { trackingCarrier?: string; trackingNumber?: string; internalNote?: string; markShipped?: boolean }) { return (await this.request<{ order: Order }>(`/api/admin/orders/${id}/fulfillment`, { method: 'PATCH', body: JSON.stringify(body) })).order }

  // ── Settings ──
  async getSettings() { return (await this.request<{ settings: StoreSettings | null }>('/api/admin/settings')).settings }
  async updateSettings(body: Partial<StoreSettings>) { return (await this.request<{ settings: StoreSettings }>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(body) })).settings }
  async completeOnboarding() { return this.request<{ success: boolean }>('/api/onboarding/complete', { method: 'POST' }) }

  // ── Payments ──
  async getPaymentStatus() { return this.request<PaymentStatus>('/api/admin/payments') }
  async connectPayment(body: { provider: string; mode: string; secretKey: string; publishableKey?: string; webhookSecret?: string }) { return this.request('/api/admin/payments/connect', { method: 'POST', body: JSON.stringify(body) }) }
  async disconnectPayment() { return this.request('/api/admin/payments/disconnect', { method: 'POST' }) }

  // ── Suppliers (dropshipping) ──
  async getSupplierStatus() { return this.request<any>('/api/admin/suppliers') }

  // Contact Twomiah — vendor support. Our backend proxies these to the
  // factory with the tenant sync key; nothing tenant-identifying is sent
  // from the browser.
  async getPlatformTickets() {
    return this.request<{ data: VendorTicket[]; unavailable?: boolean }>('/api/platform-support/tickets')
  }
  async createPlatformTicket(input: { subject: string; description?: string; priority?: string }) {
    return this.request<{ number?: string }>('/api/platform-support/tickets', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }
  // Staff logins. Owner-only on the backend; `staff` is the only creatable role.
  async listUsers() { return (await this.request<{ data: StoreUser[] }>('/api/admin/users')).data }
  async createUser(input: { name: string; email: string; password: string }) {
    return this.request<StoreUser>('/api/admin/users', { method: 'POST', body: JSON.stringify(input) })
  }
  // Revoke = deactivate. Orders and fulfilment reference the user, and the seat
  // count is of active users, so isActive=false is what frees a seat.
  async updateUser(id: string, input: { name?: string; isActive?: boolean }) {
    return this.request<StoreUser>(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(input) })
  }
  async connectSupplier(body: { provider: string; mode: string; apiKey: string; accountEmail?: string }) { return this.request('/api/admin/suppliers/connect', { method: 'POST', body: JSON.stringify(body) }) }
  async disconnectSupplier() { return this.request('/api/admin/suppliers/disconnect', { method: 'POST' }) }
  async setSupplierAutoForward(enabled: boolean) { return this.request('/api/admin/suppliers/auto-forward', { method: 'POST', body: JSON.stringify({ enabled }) }) }
  async getVariantSupplierMap() { return (await this.request<{ map: Array<{ variantId: string; supplierVariantRef: string; supplierItemName: string | null }> }>('/api/admin/suppliers/variant-map')).map }
  async setVariantSupplierRef(variantId: string, ref: string) { return this.request<{ ok: boolean; name?: string; cleared?: boolean }>(`/api/admin/suppliers/variant-map/${variantId}`, { method: 'PUT', body: JSON.stringify({ ref }) }) }
  async forwardOrderToSupplier(id: string) { return this.request<{ ok: boolean; note?: string }>(`/api/admin/suppliers/orders/${id}/forward`, { method: 'POST' }) }
  async holdSupplierOrder(id: string) { return this.request<{ ok: boolean }>(`/api/admin/suppliers/orders/${id}/hold`, { method: 'POST' }) }

  // ── Discount codes ──
  async listDiscounts() { return (await this.request<{ codes: DiscountCode[] }>('/api/admin/discounts')).codes }
  async createDiscount(body: Partial<DiscountCode>) { return (await this.request<{ code: DiscountCode }>('/api/admin/discounts', { method: 'POST', body: JSON.stringify(body) })).code }
  async updateDiscount(id: string, body: Partial<DiscountCode>) { return (await this.request<{ code: DiscountCode }>(`/api/admin/discounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).code }
  async deleteDiscount(id: string) { return this.request(`/api/admin/discounts/${id}`, { method: 'DELETE' }) }

  // ── Reviews ──
  async listReviews(status = 'pending') { return (await this.request<{ data: Review[] }>(`/api/admin/reviews?status=${status}`)).data }
  async reviewCounts() { return this.request<{ pending: number; approved: number; rejected: number }>('/api/admin/reviews/counts') }
  async setReviewStatus(id: string, status: 'pending' | 'approved' | 'rejected') {
    return this.request<Review>(`/api/admin/reviews/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) })
  }
  async deleteReview(id: string) { return this.request(`/api/admin/reviews/${id}`, { method: 'DELETE' }) }

  // ── Shipping labels ──
  async shippingConfig() { return this.request<ShippingConfig>('/api/admin/shipping/config') }
  async connectShipping(body: { provider: 'easypost'; apiKey: string; mode: 'test' | 'live'; fromAddress: Address & { name?: string; phone?: string }; defaultParcel?: Parcel }) {
    return this.request<{ ok: boolean }>('/api/admin/shipping/config', { method: 'POST', body: JSON.stringify(body) })
  }
  async disconnectShipping() { return this.request<{ ok: boolean }>('/api/admin/shipping/config', { method: 'DELETE' }) }
  async orderRates(orderId: string) { return (await this.request<{ data: RateQuote[] }>(`/api/admin/shipping/orders/${orderId}/rates`)).data }
  async buyLabel(orderId: string, body: { rateId?: string; markShipped?: boolean }) {
    return this.request<{ label: BoughtLabel; order: Order }>(`/api/admin/shipping/orders/${orderId}/label`, { method: 'POST', body: JSON.stringify(body) })
  }
}

export const api = new ApiClient()
export default api
