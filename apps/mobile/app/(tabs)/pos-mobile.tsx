/**
 * Mobile POS — point of sale with product grid, cart, and checkout flow.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity,
  TextInput, Modal, ScrollView, Animated, Dimensions, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post } from '../../src/api/client'
import { FilterChips } from '../../src/components/FilterChips'
import { SearchBar } from '../../src/components/SearchBar'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { EmptyState } from '../../src/components/EmptyState'
import { useToast } from '../../src/components/ToastProvider'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useDebounce } from '../../src/hooks/useDebounce'

const { height: SCREEN_HEIGHT } = Dimensions.get('window')

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'flower', label: 'Flower' },
  { key: 'edible', label: 'Edibles' },
  { key: 'concentrate', label: 'Concentrates' },
  { key: 'vape', label: 'Vapes' },
  { key: 'preroll', label: 'Pre-Rolls' },
  { key: 'topical', label: 'Topicals' },
]

const STRAIN_COLORS: Record<string, string> = {
  indica: '#8b5cf6',
  sativa: '#f59e0b',
  hybrid: '#22c55e',
  cbd: '#3b82f6',
}

interface CartItem {
  product: any
  quantity: number
}

export default function POSMobileScreen() {
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [cart, setCart] = useState<CartItem[]>([])
  const [showCart, setShowCart] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [customerPhone, setCustomerPhone] = useState('')
  const [customer, setCustomer] = useState<any>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'debit'>('cash')
  const [cashTendered, setCashTendered] = useState('')
  const [completing, setCompleting] = useState(false)
  const cartSlideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current

  const loadProducts = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' })
    if (category !== 'all') params.set('category', category)
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const res = await get(`/api/products?${params}`)
    if (res.ok) setProducts(res.data.data || res.data || [])
    setLoading(false)
  }, [category, debouncedSearch])

  useEffect(() => { setLoading(true); loadProducts() }, [loadProducts])

  const onRefresh = async () => { setRefreshing(true); await loadProducts(); setRefreshing(false) }

  // Cart operations
  const addToCart = (product: any) => {
    haptics.light()
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) {
        return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      }
      return [...prev, { product, quantity: 1 }]
    })
    toast.success(`${product.name} added`)
  }

  const updateQuantity = (productId: string, delta: number) => {
    haptics.light()
    setCart(prev => {
      const updated = prev.map(i => {
        if (i.product.id === productId) {
          const newQty = i.quantity + delta
          return newQty > 0 ? { ...i, quantity: newQty } : null
        }
        return i
      }).filter(Boolean) as CartItem[]
      return updated
    })
  }

  const removeFromCart = (productId: string) => {
    haptics.medium()
    setCart(prev => prev.filter(i => i.product.id !== productId))
  }

  const clearCart = () => {
    haptics.medium()
    setCart([])
    setCustomer(null)
    setCustomerPhone('')
  }

  const cartTotal = cart.reduce((sum, i) => sum + (i.product.price || 0) * i.quantity, 0)
  const cartItemCount = cart.reduce((sum, i) => sum + i.quantity, 0)

  // Cart panel animation
  const openCart = () => {
    setShowCart(true)
    Animated.spring(cartSlideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }).start()
  }
  const closeCart = () => {
    Animated.timing(cartSlideAnim, { toValue: SCREEN_HEIGHT, duration: 250, useNativeDriver: true }).start(() => setShowCart(false))
  }

  // Customer lookup
  const lookupCustomer = async () => {
    if (!customerPhone.trim()) return
    setLookingUp(true)
    const res = await get(`/api/loyalty/check?phone=${encodeURIComponent(customerPhone.trim())}`)
    if (res.ok && res.data) {
      setCustomer(res.data)
      haptics.success()
      toast.success(`Found: ${res.data.name || 'Customer'}`)
    } else {
      setCustomer(null)
      toast.info('No loyalty member found')
    }
    setLookingUp(false)
  }

  // Checkout
  const completeOrder = async () => {
    if (cart.length === 0) { toast.warning('Cart is empty'); return }
    setCompleting(true)

    const items = cart.map(i => ({
      productId: i.product.id,
      name: i.product.name,
      quantity: i.quantity,
      pricePerUnit: i.product.price,
      total: i.product.price * i.quantity,
    }))

    const orderRes = await post('/api/orders', {
      items,
      type: 'walk_in',
      paymentMethod,
      total: cartTotal,
      customerId: customer?.id || undefined,
      customerName: customer?.name || undefined,
      customerPhone: customerPhone.trim() || undefined,
      cashTendered: paymentMethod === 'cash' ? Math.round(parseFloat(cashTendered || '0') * 100) : undefined,
    })

    if (orderRes.ok) {
      const orderId = orderRes.data.id || orderRes.data.data?.id
      // Complete immediately for POS
      if (orderId) {
        await post(`/api/orders/${orderId}/complete`, { paymentMethod })
      }
      haptics.success()
      const changeDue = paymentMethod === 'cash'
        ? Math.round(parseFloat(cashTendered || '0') * 100) - cartTotal
        : 0
      if (paymentMethod === 'cash' && changeDue > 0) {
        toast.success(`Order complete! Change due: $${(changeDue / 100).toFixed(2)}`)
      } else {
        toast.success('Order completed!')
      }
      setCart([])
      setCustomer(null)
      setCustomerPhone('')
      setCashTendered('')
      setShowCheckout(false)
      closeCart()
    } else {
      haptics.error()
      toast.error(orderRes.error || 'Failed to complete order')
    }
    setCompleting(false)
  }

  const getStockColor = (qty: number) => {
    if (qty <= 0) return '#ef4444'
    if (qty <= 5) return '#f59e0b'
    return '#22c55e'
  }

  const renderProduct = ({ item: product }: { item: any }) => {
    const strainColor = STRAIN_COLORS[product.strainType] || '#64748b'
    const cartItem = cart.find(i => i.product.id === product.id)

    return (
      <View style={[styles.productCard, { backgroundColor: t.surface, borderColor: t.border }]}>
        {product.imageUrl ? (
          <Image source={{ uri: product.imageUrl }} style={styles.productImg} />
        ) : (
          <View style={[styles.productImg, styles.imgPlaceholder, { backgroundColor: t.surfaceAlt || t.background }]}>
            <Ionicons name="leaf" size={24} color={t.textMuted} />
          </View>
        )}
        <View style={styles.productInfo}>
          <Text style={[styles.productName, { color: t.text }]} numberOfLines={1}>{product.name}</Text>
          {product.strainType && (
            <View style={[styles.strainBadge, { backgroundColor: strainColor + '20' }]}>
              <Text style={[styles.strainText, { color: strainColor }]}>{product.strainType}</Text>
            </View>
          )}
          <View style={styles.productMetaRow}>
            {product.thcPercent != null && (
              <Text style={[styles.thcText, { color: t.textMuted }]}>THC {product.thcPercent}%</Text>
            )}
            <View style={styles.stockRow}>
              <View style={[styles.stockDot, { backgroundColor: getStockColor(product.stockQuantity ?? 0) }]} />
              <Text style={[styles.stockText, { color: t.textMuted }]}>{product.stockQuantity ?? 0}</Text>
            </View>
          </View>
          <View style={styles.priceRow}>
            <Text style={[styles.price, { color: t.text }]}>${((product.price || 0) / 100).toFixed(2)}</Text>
            {cartItem ? (
              <View style={styles.qtyControls}>
                <TouchableOpacity style={[styles.qtyBtn, { backgroundColor: t.border }]} onPress={() => updateQuantity(product.id, -1)}>
                  <Ionicons name="remove" size={14} color={t.text} />
                </TouchableOpacity>
                <Text style={[styles.qtyText, { color: t.text }]}>{cartItem.quantity}</Text>
                <TouchableOpacity style={[styles.qtyBtn, { backgroundColor: t.primary }]} onPress={() => updateQuantity(product.id, 1)}>
                  <Ionicons name="add" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: t.primary }]}
                onPress={() => addToCart(product)}
                disabled={(product.stockQuantity ?? 0) <= 0}
              >
                <Ionicons name="add" size={16} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search products..." />
      <FilterChips options={CATEGORIES} selected={category} onSelect={setCategory} />

      {loading ? (
        <SkeletonList count={6} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={item => item.id}
          renderItem={renderProduct}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={{ padding: 8, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={<EmptyState icon="leaf-outline" title="No products" subtitle="No products match your search" />}
        />
      )}

      {/* Cart FAB */}
      {cartItemCount > 0 && (
        <TouchableOpacity style={[styles.cartFab, { backgroundColor: t.primary }]} onPress={openCart}>
          <Ionicons name="cart" size={22} color="#fff" />
          <View style={styles.cartFabBadge}>
            <Text style={styles.cartFabBadgeText}>{cartItemCount}</Text>
          </View>
          <Text style={styles.cartFabTotal}>${(cartTotal / 100).toFixed(2)}</Text>
        </TouchableOpacity>
      )}

      {/* Cart Slide-Up Panel */}
      {showCart && (
        <View style={styles.cartOverlay}>
          <TouchableOpacity style={styles.cartOverlayBg} onPress={closeCart} activeOpacity={1} />
          <Animated.View style={[
            styles.cartPanel,
            { backgroundColor: t.surface, transform: [{ translateY: cartSlideAnim }] },
          ]}>
            <View style={styles.cartHandle}>
              <View style={[styles.handleBar, { backgroundColor: t.border }]} />
            </View>
            <View style={styles.cartHeader}>
              <Text style={[styles.cartTitle, { color: t.text }]}>Cart ({cartItemCount})</Text>
              <TouchableOpacity onPress={clearCart}>
                <Text style={{ color: '#ef4444', fontSize: 14, fontWeight: '600' }}>Clear</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.cartScroll}>
              {cart.map(item => (
                <View key={item.product.id} style={[styles.cartItem, { borderBottomColor: t.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cartItemName, { color: t.text }]}>{item.product.name}</Text>
                    <Text style={[styles.cartItemPrice, { color: t.textSecondary }]}>
                      ${((item.product.price || 0) / 100).toFixed(2)} each
                    </Text>
                  </View>
                  <View style={styles.cartQtyRow}>
                    <TouchableOpacity style={[styles.qtyBtn, { backgroundColor: t.border }]} onPress={() => updateQuantity(item.product.id, -1)}>
                      <Ionicons name="remove" size={14} color={t.text} />
                    </TouchableOpacity>
                    <Text style={[styles.qtyText, { color: t.text }]}>{item.quantity}</Text>
                    <TouchableOpacity style={[styles.qtyBtn, { backgroundColor: t.primary }]} onPress={() => updateQuantity(item.product.id, 1)}>
                      <Ionicons name="add" size={14} color="#fff" />
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.cartItemTotal, { color: t.text }]}>
                    ${(((item.product.price || 0) * item.quantity) / 100).toFixed(2)}
                  </Text>
                  <TouchableOpacity onPress={() => removeFromCart(item.product.id)} style={{ padding: 4 }}>
                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))}

              {/* Customer Lookup */}
              <View style={styles.customerSection}>
                <Text style={[styles.customerLabel, { color: t.text }]}>Customer (optional)</Text>
                <View style={[styles.customerRow, { borderColor: t.border }]}>
                  <Ionicons name="call" size={16} color={t.textMuted} />
                  <TextInput
                    style={[styles.customerInput, { color: t.text }]}
                    value={customerPhone}
                    onChangeText={setCustomerPhone}
                    placeholder="Phone for loyalty"
                    placeholderTextColor={t.textMuted}
                    keyboardType="phone-pad"
                    onSubmitEditing={lookupCustomer}
                  />
                  <TouchableOpacity
                    style={[styles.lookupBtn, { backgroundColor: t.primary }]}
                    onPress={lookupCustomer}
                    disabled={lookingUp}
                  >
                    <Ionicons name="search" size={16} color="#fff" />
                  </TouchableOpacity>
                </View>
                {customer && (
                  <View style={[styles.customerInfo, { backgroundColor: '#22c55e18' }]}>
                    <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                    <Text style={{ color: '#22c55e', fontSize: 13, fontWeight: '600' }}>
                      {customer.name} — {customer.pointsBalance || 0} pts
                    </Text>
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Subtotal & Checkout */}
            <View style={[styles.cartFooter, { borderTopColor: t.border }]}>
              <View style={styles.subtotalRow}>
                <Text style={[styles.subtotalLabel, { color: t.textSecondary }]}>Subtotal</Text>
                <Text style={[styles.subtotalValue, { color: t.text }]}>${(cartTotal / 100).toFixed(2)}</Text>
              </View>
              <TouchableOpacity
                style={[styles.checkoutBtn, { backgroundColor: t.primary }]}
                onPress={() => setShowCheckout(true)}
              >
                <Ionicons name="card" size={18} color="#fff" />
                <Text style={styles.checkoutBtnText}>Checkout</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      )}

      {/* Checkout Modal */}
      <Modal visible={showCheckout} transparent animationType="slide">
        <View style={styles.checkoutOverlay}>
          <View style={[styles.checkoutModal, { backgroundColor: t.surface }]}>
            <View style={styles.checkoutHeader}>
              <Text style={[styles.checkoutTitle, { color: t.text }]}>Complete Order</Text>
              <TouchableOpacity onPress={() => setShowCheckout(false)}>
                <Ionicons name="close" size={24} color={t.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.checkoutTotal, { color: t.text }]}>
              Total: ${(cartTotal / 100).toFixed(2)}
            </Text>

            {/* Payment Method */}
            <Text style={[styles.fieldLabel, { color: t.textSecondary }]}>Payment Method</Text>
            <View style={styles.paymentRow}>
              <TouchableOpacity
                style={[
                  styles.paymentOption,
                  { borderColor: paymentMethod === 'cash' ? t.primary : t.border },
                  paymentMethod === 'cash' && { backgroundColor: t.primary + '10' },
                ]}
                onPress={() => setPaymentMethod('cash')}
              >
                <Ionicons name="cash" size={20} color={paymentMethod === 'cash' ? t.primary : t.textMuted} />
                <Text style={[styles.paymentLabel, { color: paymentMethod === 'cash' ? t.primary : t.textSecondary }]}>Cash</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.paymentOption,
                  { borderColor: paymentMethod === 'debit' ? t.primary : t.border },
                  paymentMethod === 'debit' && { backgroundColor: t.primary + '10' },
                ]}
                onPress={() => setPaymentMethod('debit')}
              >
                <Ionicons name="card" size={20} color={paymentMethod === 'debit' ? t.primary : t.textMuted} />
                <Text style={[styles.paymentLabel, { color: paymentMethod === 'debit' ? t.primary : t.textSecondary }]}>Debit</Text>
              </TouchableOpacity>
            </View>

            {/* Cash Tendered */}
            {paymentMethod === 'cash' && (
              <>
                <Text style={[styles.fieldLabel, { color: t.textSecondary, marginTop: 16 }]}>Cash Tendered</Text>
                <TextInput
                  style={[styles.cashInput, { color: t.text, borderColor: t.border, backgroundColor: t.background }]}
                  value={cashTendered}
                  onChangeText={setCashTendered}
                  placeholder="0.00"
                  placeholderTextColor={t.textMuted}
                  keyboardType="decimal-pad"
                />
                {cashTendered && parseFloat(cashTendered) * 100 >= cartTotal && (
                  <Text style={styles.changeText}>
                    Change: ${((parseFloat(cashTendered) * 100 - cartTotal) / 100).toFixed(2)}
                  </Text>
                )}
              </>
            )}

            <TouchableOpacity
              style={[styles.completeBtn, { backgroundColor: '#22c55e', opacity: completing ? 0.6 : 1 }]}
              onPress={completeOrder}
              disabled={completing}
            >
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
              <Text style={styles.completeBtnText}>
                {completing ? 'Processing...' : 'Complete Order'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  gridRow: { gap: 8, paddingHorizontal: 8 },
  productCard: {
    flex: 1, borderRadius: 12, borderWidth: 1, overflow: 'hidden', marginBottom: 8,
  },
  productImg: { width: '100%', height: 90 },
  imgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  productInfo: { padding: 10 },
  productName: { fontSize: 13, fontWeight: '700' },
  strainBadge: { alignSelf: 'flex-start', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, marginTop: 4 },
  strainText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
  productMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  thcText: { fontSize: 10 },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stockDot: { width: 5, height: 5, borderRadius: 3 },
  stockText: { fontSize: 10 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  price: { fontSize: 15, fontWeight: '700' },
  addBtn: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  qtyText: { fontSize: 14, fontWeight: '700', minWidth: 16, textAlign: 'center' },
  cartFab: {
    position: 'absolute', bottom: 16, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, elevation: 6,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
  },
  cartFabBadge: {
    backgroundColor: '#fff', borderRadius: 10, minWidth: 20, height: 20,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  cartFabBadgeText: { color: '#000', fontSize: 12, fontWeight: '800' },
  cartFabTotal: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cartOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 100 },
  cartOverlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  cartPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: SCREEN_HEIGHT * 0.75,
  },
  cartHandle: { alignItems: 'center', paddingTop: 10 },
  handleBar: { width: 40, height: 4, borderRadius: 2 },
  cartHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  cartTitle: { fontSize: 18, fontWeight: '700' },
  cartScroll: { maxHeight: SCREEN_HEIGHT * 0.4, paddingHorizontal: 20 },
  cartItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cartItemName: { fontSize: 14, fontWeight: '600' },
  cartItemPrice: { fontSize: 12, marginTop: 2 },
  cartQtyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cartItemTotal: { fontSize: 14, fontWeight: '700', minWidth: 50, textAlign: 'right' },
  customerSection: { marginTop: 16, marginBottom: 8 },
  customerLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  customerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10, paddingLeft: 12, overflow: 'hidden',
  },
  customerInput: { flex: 1, paddingVertical: 10, fontSize: 14 },
  lookupBtn: { padding: 10 },
  customerInfo: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 8, padding: 10, borderRadius: 8,
  },
  cartFooter: { borderTopWidth: 1, paddingHorizontal: 20, paddingVertical: 14, paddingBottom: 30 },
  subtotalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  subtotalLabel: { fontSize: 15 },
  subtotalValue: { fontSize: 20, fontWeight: '700' },
  checkoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12,
  },
  checkoutBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  checkoutOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  checkoutModal: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40,
  },
  checkoutHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16,
  },
  checkoutTitle: { fontSize: 20, fontWeight: '700' },
  checkoutTotal: { fontSize: 28, fontWeight: '800', textAlign: 'center', marginBottom: 20 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  paymentRow: { flexDirection: 'row', gap: 12 },
  paymentOption: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, borderWidth: 2,
  },
  paymentLabel: { fontSize: 15, fontWeight: '600' },
  cashInput: {
    borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 20,
    fontWeight: '700', textAlign: 'center',
  },
  changeText: { color: '#22c55e', fontSize: 16, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  completeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 12, marginTop: 20,
  },
  completeBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
})
