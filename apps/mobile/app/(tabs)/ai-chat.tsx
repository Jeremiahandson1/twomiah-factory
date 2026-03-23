/**
 * AI Budtender Chat — AI-powered product recommendations with inline product cards.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, Modal, ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post } from '../../src/api/client'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { useToast } from '../../src/components/ToastProvider'
import { useHaptics } from '../../src/hooks/useHaptics'

const STRAIN_COLORS: Record<string, string> = {
  indica: '#8b5cf6',
  sativa: '#f59e0b',
  hybrid: '#22c55e',
  cbd: '#3b82f6',
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  products?: any[]
  timestamp: Date
}

export default function AIChatScreen() {
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const flatListRef = useRef<FlatList>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [cartCount, setCartCount] = useState(0)
  const [showRating, setShowRating] = useState(false)
  const [selectedRating, setSelectedRating] = useState(0)
  const [sessionActive, setSessionActive] = useState(false)

  // Start session on mount
  useEffect(() => {
    startSession()
    return () => { /* session cleanup handled by endChat */ }
  }, [])

  const startSession = async () => {
    const res = await post('/api/ai-budtender/session', {})
    if (res.ok) {
      setSessionId(res.data.sessionId || res.data.id)
      setSessionActive(true)
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        text: "Hey! I'm your AI budtender. Tell me what you're looking for — whether it's a mood, effect, flavor, or specific product. I'll find the perfect match for you.",
        timestamp: new Date(),
      }])
    } else {
      toast.error('Failed to start AI session')
    }
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || !sessionId || sending) return

    haptics.light()
    setInput('')
    setSending(true)

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])

    // Scroll to bottom
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)

    const res = await post('/api/ai-budtender/chat', {
      sessionId,
      message: text,
    })

    if (res.ok) {
      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        text: res.data.message || res.data.text || '',
        products: res.data.products || [],
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, aiMsg])
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100)
    } else {
      haptics.error()
      toast.error('Failed to get response')
      // Add error message
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: 'assistant',
        text: "Sorry, I had trouble processing that. Could you try again?",
        timestamp: new Date(),
      }])
    }

    setSending(false)
  }

  const addToCart = async (product: any) => {
    haptics.success()
    const res = await post('/api/cart/items', {
      productId: product.id,
      quantity: 1,
    })
    if (res.ok) {
      setCartCount(prev => prev + 1)
      toast.success(`${product.name} added to cart`)
    } else {
      toast.error('Failed to add to cart')
    }
  }

  const endChat = async () => {
    setShowRating(true)
  }

  const submitRating = async () => {
    if (sessionId && selectedRating > 0) {
      await post(`/api/ai-budtender/session/${sessionId}/rate`, {
        rating: selectedRating,
      })
    }
    haptics.success()
    toast.success('Thanks for your feedback!')
    setShowRating(false)
    setSessionActive(false)
    setMessages([])
    setSessionId(null)
    setSelectedRating(0)
    // Restart session
    startSession()
  }

  const renderProductCard = (product: any) => {
    const strainColor = STRAIN_COLORS[product.strainType] || '#64748b'
    return (
      <View key={product.id} style={[styles.productCard, { backgroundColor: t.background, borderColor: t.border }]}>
        <View style={styles.productHeader}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.productName, { color: t.text }]} numberOfLines={1}>
              {product.name}
            </Text>
            <View style={styles.productMeta}>
              {product.strainType && (
                <View style={[styles.strainBadge, { backgroundColor: strainColor + '20' }]}>
                  <Text style={[styles.strainText, { color: strainColor }]}>
                    {product.strainType}
                  </Text>
                </View>
              )}
              {product.thcPercent != null && (
                <Text style={[styles.thcText, { color: t.textSecondary }]}>
                  THC {product.thcPercent}%
                </Text>
              )}
            </View>
          </View>
          <Text style={[styles.productPrice, { color: t.text }]}>
            ${((product.price || 0) / 100).toFixed(2)}
          </Text>
        </View>
        {product.description && (
          <Text style={[styles.productDesc, { color: t.textMuted }]} numberOfLines={2}>
            {product.description}
          </Text>
        )}
        <TouchableOpacity
          style={[styles.addToCartBtn, { backgroundColor: t.primary }]}
          onPress={() => addToCart(product)}
        >
          <Ionicons name="cart" size={14} color="#fff" />
          <Text style={styles.addToCartText}>Add to Cart</Text>
        </TouchableOpacity>
      </View>
    )
  }

  const renderMessage = ({ item: msg, index }: { item: ChatMessage; index: number }) => {
    const isUser = msg.role === 'user'
    return (
      <View style={[styles.msgContainer, isUser ? styles.msgRight : styles.msgLeft]}>
        {!isUser && (
          <View style={[styles.avatarCircle, { backgroundColor: '#8b5cf6' + '20' }]}>
            <Ionicons name="sparkles" size={14} color="#8b5cf6" />
          </View>
        )}
        <View style={{ flex: 1, maxWidth: '80%' }}>
          <View style={[
            styles.bubble,
            isUser
              ? [styles.userBubble, { backgroundColor: t.primary }]
              : [styles.aiBubble, { backgroundColor: t.surface, borderColor: t.border }],
          ]}>
            <Text style={[
              styles.bubbleText,
              { color: isUser ? '#fff' : t.text },
            ]}>
              {msg.text}
            </Text>
          </View>
          {/* Inline product recommendations */}
          {msg.products && msg.products.length > 0 && (
            <View style={styles.productsContainer}>
              {msg.products.map(renderProductCard)}
            </View>
          )}
          <Text style={[styles.timestamp, { color: t.textMuted }, isUser && { textAlign: 'right' }]}>
            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
        <View style={[styles.headerAvatar, { backgroundColor: '#8b5cf6' + '20' }]}>
          <Ionicons name="sparkles" size={20} color="#8b5cf6" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: t.text }]}>AI Budtender</Text>
          <Text style={[styles.headerSub, { color: '#22c55e' }]}>Online</Text>
        </View>
        {cartCount > 0 && (
          <View style={styles.cartBadgeContainer}>
            <Ionicons name="cart" size={22} color={t.textSecondary} />
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{cartCount}</Text>
            </View>
          </View>
        )}
        <TouchableOpacity style={styles.endBtn} onPress={endChat}>
          <Text style={styles.endBtnText}>End Chat</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.emptyChat}>
              <Ionicons name="chatbubble-ellipses-outline" size={48} color={t.textMuted} />
              <Text style={[styles.emptyChatText, { color: t.textMuted }]}>Starting session...</Text>
            </View>
          }
        />

        {/* Typing indicator */}
        {sending && (
          <View style={[styles.typingRow, { backgroundColor: t.surface }]}>
            <ActivityIndicator size="small" color={t.primary} />
            <Text style={[styles.typingText, { color: t.textMuted }]}>AI is thinking...</Text>
          </View>
        )}

        {/* Input bar */}
        <View style={[styles.inputBar, { backgroundColor: t.surface, borderTopColor: t.border }]}>
          <TextInput
            style={[styles.textInput, { color: t.text, backgroundColor: t.background, borderColor: t.border }]}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about strains, effects, or products..."
            placeholderTextColor={t.textMuted}
            multiline
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={sendMessage}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: t.primary, opacity: (input.trim() && !sending) ? 1 : 0.4 }]}
            onPress={sendMessage}
            disabled={!input.trim() || sending}
          >
            <Ionicons name="send" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Rating Modal */}
      <Modal visible={showRating} transparent animationType="fade">
        <View style={styles.ratingOverlay}>
          <View style={[styles.ratingModal, { backgroundColor: t.surface }]}>
            <Text style={[styles.ratingTitle, { color: t.text }]}>Rate Your Experience</Text>
            <Text style={[styles.ratingSubtitle, { color: t.textMuted }]}>
              How helpful was the AI budtender?
            </Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(star => (
                <TouchableOpacity
                  key={star}
                  onPress={() => { setSelectedRating(star); haptics.light() }}
                >
                  <Ionicons
                    name={star <= selectedRating ? 'star' : 'star-outline'}
                    size={36}
                    color={star <= selectedRating ? '#f59e0b' : t.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.ratingActions}>
              <TouchableOpacity
                style={[styles.ratingSkipBtn, { borderColor: t.border }]}
                onPress={() => { setShowRating(false); setSelectedRating(0); startSession() }}
              >
                <Text style={[styles.ratingSkipText, { color: t.textSecondary }]}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ratingSubmitBtn, { backgroundColor: t.primary, opacity: selectedRating > 0 ? 1 : 0.4 }]}
                onPress={submitRating}
                disabled={selectedRating === 0}
              >
                <Text style={styles.ratingSubmitText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700' },
  headerSub: { fontSize: 12, fontWeight: '600' },
  cartBadgeContainer: { position: 'relative', marginRight: 8 },
  cartBadge: {
    position: 'absolute', top: -4, right: -6,
    backgroundColor: '#ef4444', borderRadius: 8,
    minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  cartBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  endBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#ef444420' },
  endBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '700' },
  emptyChat: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 8 },
  emptyChatText: { fontSize: 14 },
  msgContainer: { flexDirection: 'row', marginBottom: 16, gap: 8 },
  msgLeft: { justifyContent: 'flex-start' },
  msgRight: { justifyContent: 'flex-end' },
  avatarCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '100%' },
  userBubble: { borderBottomRightRadius: 4 },
  aiBubble: { borderBottomLeftRadius: 4, borderWidth: 1 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  timestamp: { fontSize: 10, marginTop: 4, marginHorizontal: 4 },
  productsContainer: { marginTop: 8, gap: 8 },
  productCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  productHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  productName: { fontSize: 14, fontWeight: '700' },
  productMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  strainBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  strainText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  thcText: { fontSize: 11 },
  productPrice: { fontSize: 16, fontWeight: '700' },
  productDesc: { fontSize: 12, marginTop: 6, lineHeight: 16 },
  addToCartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, borderRadius: 8, marginTop: 8,
  },
  addToCartText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  typingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8,
  },
  typingText: { fontSize: 13 },
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  textInput: {
    flex: 1, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, maxHeight: 100,
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  ratingOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  ratingModal: {
    borderRadius: 20, padding: 24, width: '85%', alignItems: 'center',
  },
  ratingTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  ratingSubtitle: { fontSize: 14, marginBottom: 20, textAlign: 'center' },
  starsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  ratingActions: { flexDirection: 'row', gap: 12, width: '100%' },
  ratingSkipBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1,
    alignItems: 'center',
  },
  ratingSkipText: { fontSize: 15, fontWeight: '600' },
  ratingSubmitBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },
  ratingSubmitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
