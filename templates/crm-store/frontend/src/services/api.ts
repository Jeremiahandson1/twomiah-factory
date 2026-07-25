// Single API client for the store admin. Base URL is empty in production (the
// backend serves this SPA same-origin) or VITE_API_URL in dev. Access/refresh
// tokens live in localStorage; a 401 transparently refreshes once and retries.

const API_URL = import.meta.env.VITE_API_URL || ''

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
  id: string; orderNumber: string | null; provider: string; status: string
  customerEmail: string; customerName: string | null; customerPhone: string | null
  shippingAddress: Address | null; billingAddress: Address | null
  subtotalCents: number; shippingCents: number; taxCents: number; discountCents: number; totalCents: number
  currency: string; trackingCarrier: string | null; trackingNumber: string | null
  internalNote: string | null; createdAt: string; items?: OrderItem[]
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
    const res = await fetch(`${this.baseUrl}${endpoint}`, { ...options, headers })

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
      const res = await fetch(`${this.baseUrl}/api/auth/refresh`, {
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
  async orderStats() { return (await this.request<{ stats: { paidCount: number; pendingFulfillment: number; revenueCents: number } }>('/api/admin/orders/stats')).stats }
  async listCustomers() { return (await this.request<{ customers: any[] }>('/api/admin/orders/customers')).customers }
  async setOrderStatus(id: string, status: string) { return (await this.request<{ order: Order }>(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })).order }
  async setFulfillment(id: string, body: { trackingCarrier?: string; trackingNumber?: string; internalNote?: string; markShipped?: boolean }) { return (await this.request<{ order: Order }>(`/api/admin/orders/${id}/fulfillment`, { method: 'PATCH', body: JSON.stringify(body) })).order }

  // ── Settings ──
  async getSettings() { return (await this.request<{ settings: StoreSettings | null }>('/api/admin/settings')).settings }
  async updateSettings(body: Partial<StoreSettings>) { return (await this.request<{ settings: StoreSettings }>('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(body) })).settings }

  // ── Payments ──
  async getPaymentStatus() { return this.request<PaymentStatus>('/api/admin/payments') }
  async connectPayment(body: { provider: string; mode: string; secretKey: string; publishableKey?: string; webhookSecret?: string }) { return this.request('/api/admin/payments/connect', { method: 'POST', body: JSON.stringify(body) }) }
  async disconnectPayment() { return this.request('/api/admin/payments/disconnect', { method: 'POST' }) }

  // ── Discount codes ──
  async listDiscounts() { return (await this.request<{ codes: DiscountCode[] }>('/api/admin/discounts')).codes }
  async createDiscount(body: Partial<DiscountCode>) { return (await this.request<{ code: DiscountCode }>('/api/admin/discounts', { method: 'POST', body: JSON.stringify(body) })).code }
  async updateDiscount(id: string, body: Partial<DiscountCode>) { return (await this.request<{ code: DiscountCode }>(`/api/admin/discounts/${id}`, { method: 'PATCH', body: JSON.stringify(body) })).code }
  async deleteDiscount(id: string) { return this.request(`/api/admin/discounts/${id}`, { method: 'DELETE' }) }
}

export const api = new ApiClient()
export default api
