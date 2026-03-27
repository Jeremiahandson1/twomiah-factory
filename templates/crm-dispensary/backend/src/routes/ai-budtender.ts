import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import crypto from 'crypto'

const app = new Hono()
app.use('*', authenticate)

// ============================================
// KEYWORD FALLBACK ENGINE (used when no API key)
// ============================================

interface IntentMatch {
  intent: string
  strainType: string | null
  category: string | null
  effects: string[]
}

const INTENT_MAP: Record<string, IntentMatch> = {
  'sleep|relax|calm|wind down|insomnia|bedtime|chill': {
    intent: 'relaxation',
    strainType: 'indica',
    category: null,
    effects: ['relaxing', 'sleepy', 'calming'],
  },
  'energy|focus|creative|uplift|motivated|productive|wake': {
    intent: 'energy',
    strainType: 'sativa',
    category: null,
    effects: ['energizing', 'focused', 'creative', 'uplifting'],
  },
  'pain|relief|medical|chronic|inflammation|ache|sore': {
    intent: 'pain_relief',
    strainType: null,
    category: null,
    effects: ['pain relief', 'anti-inflammatory', 'therapeutic'],
  },
  'anxiety|stress|nervous|worried|tense': {
    intent: 'anxiety_relief',
    strainType: 'indica',
    category: null,
    effects: ['calming', 'anti-anxiety', 'relaxing'],
  },
  'edible|gummy|gummies|candy|chocolate|brownie|cookie|food': {
    intent: 'edibles',
    strainType: null,
    category: 'edibles',
    effects: [],
  },
  'vape|cartridge|cart|pen|oil': {
    intent: 'vapes',
    strainType: null,
    category: 'vapes',
    effects: [],
  },
  'flower|bud|nug|smoke|joint|pre-roll|preroll': {
    intent: 'flower',
    strainType: null,
    category: 'flower',
    effects: [],
  },
  'concentrate|dab|wax|shatter|rosin|resin|extract': {
    intent: 'concentrates',
    strainType: null,
    category: 'concentrates',
    effects: [],
  },
  'topical|cream|lotion|balm|salve|patch': {
    intent: 'topicals',
    strainType: null,
    category: 'topicals',
    effects: [],
  },
  'cbd|low thc|non-psychoactive|hemp|mild': {
    intent: 'high_cbd',
    strainType: null,
    category: null,
    effects: ['therapeutic', 'mild', 'non-psychoactive'],
  },
  'strong|potent|high thc|powerful|intense': {
    intent: 'high_potency',
    strainType: null,
    category: null,
    effects: ['potent', 'strong'],
  },
  'hybrid|balanced|mix|best of both|middle': {
    intent: 'balanced',
    strainType: 'hybrid',
    category: null,
    effects: ['balanced', 'versatile'],
  },
  'cheap|affordable|budget|deal|sale|discount|value': {
    intent: 'budget',
    strainType: null,
    category: null,
    effects: [],
  },
  'new|latest|just dropped|fresh|recent': {
    intent: 'new_arrivals',
    strainType: null,
    category: null,
    effects: [],
  },
}

function parseUserIntent(message: string): IntentMatch[] {
  const lower = message.toLowerCase()
  const matches: IntentMatch[] = []

  for (const [keywords, match] of Object.entries(INTENT_MAP)) {
    const pattern = new RegExp(`\\b(${keywords})\\b`, 'i')
    if (pattern.test(lower)) {
      matches.push(match)
    }
  }

  return matches
}

function buildResponseMessage(
  intents: IntentMatch[],
  products: any[],
  customerName: string | null,
  greeting: boolean,
  companyName: string,
): string {
  if (greeting) {
    const name = customerName ? ` ${customerName}` : ''
    return `Welcome${name}! I'm your budtender at ${companyName}. What are you looking for today? I can help you find the perfect product whether you're looking for relaxation, energy, pain relief, or anything else.`
  }

  if (!intents.length && !products.length) {
    return `I'd love to help you find something great! Could you tell me more about what you're looking for? For example:\n• What effects are you after? (relaxation, energy, pain relief)\n• Do you have a preferred product type? (flower, edibles, vapes, concentrates)\n• Any preference for indica, sativa, or hybrid?`
  }

  if (!products.length) {
    const intentNames = intents.map(i => i.intent).join(', ')
    return `I understand you're looking for something for ${intentNames}, but I don't have any matching products in stock right now. Would you like to try a different category or effect?`
  }

  const intentDescriptions: Record<string, string> = {
    relaxation: 'relaxation and sleep',
    energy: 'energy and focus',
    pain_relief: 'pain relief',
    anxiety_relief: 'stress and anxiety relief',
    edibles: 'edibles',
    vapes: 'vapes',
    flower: 'flower',
    concentrates: 'concentrates',
    topicals: 'topicals',
    high_cbd: 'high-CBD, milder options',
    high_potency: 'high-potency products',
    balanced: 'balanced hybrid effects',
    budget: 'great value',
    new_arrivals: 'our newest products',
  }

  const primaryIntent = intents[0]
  const description = intentDescriptions[primaryIntent?.intent] || 'your needs'

  let response = `Great choice! Here are my top picks for ${description}:\n\n`

  products.slice(0, 5).forEach((p, i) => {
    const thc = p.thc_percent ? ` | THC: ${p.thc_percent}%` : ''
    const cbd = p.cbd_percent ? ` | CBD: ${p.cbd_percent}%` : ''
    const price = p.sale_price && Number(p.sale_price) < Number(p.price)
      ? `$${Number(p.sale_price).toFixed(2)} (was $${Number(p.price).toFixed(2)})`
      : `$${Number(p.price).toFixed(2)}`
    const strain = p.strain_type ? ` (${p.strain_type})` : ''

    response += `${i + 1}. **${p.name}**${strain}${thc}${cbd} — ${price}\n`
    if (p.description) {
      const desc = p.description.length > 80 ? p.description.slice(0, 80) + '...' : p.description
      response += `   ${desc}\n`
    }
    response += '\n'
  })

  if (products.length > 5) {
    response += `I have ${products.length - 5} more options if you'd like to see them. `
  }

  response += `Would you like to add any of these to your cart, or would you like me to refine the search?`

  return response
}

// ============================================
// CLAUDE AI RESPONSE GENERATION
// ============================================

let AnthropicClient: any = null

async function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null
  if (!AnthropicClient) {
    try {
      const mod = await import('@anthropic-ai/sdk')
      AnthropicClient = mod.default
    } catch {
      console.warn('[@anthropic-ai/sdk] not installed — falling back to keyword matching')
      return null
    }
  }
  return new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function buildSystemPrompt(
  companyName: string,
  personality: string,
  customSystemPrompt: string | null,
  products: any[],
  purchaseHistory: any[] | null,
): string {
  const personalityGuide: Record<string, string> = {
    friendly: 'You are warm, approachable, and enthusiastic. Use casual language and emojis sparingly.',
    professional: 'You are knowledgeable and polished. Use clear, precise language.',
    casual: 'You are laid-back and conversational. Talk like a knowledgeable friend.',
    educational: 'You love teaching customers about cannabis science. Explain terpenes, cannabinoids, and effects in detail.',
  }

  const personalityInstruction = personalityGuide[personality] || personalityGuide.friendly

  const productCatalog = products.map(p => ({
    name: p.name,
    category: p.category,
    strainType: p.strain_type,
    thcPercent: p.thc_percent ? Number(p.thc_percent) : null,
    cbdPercent: p.cbd_percent ? Number(p.cbd_percent) : null,
    price: Number(p.price),
    salePrice: p.sale_price ? Number(p.sale_price) : null,
    effects: typeof p.effects === 'string' ? JSON.parse(p.effects || '[]') : (p.effects || []),
    description: p.description,
    stockQuantity: p.stock_quantity ? Number(p.stock_quantity) : null,
    weight: p.weight,
    unit: p.unit,
  }))

  let historySection = ''
  if (purchaseHistory && purchaseHistory.length > 0) {
    const historyLines = purchaseHistory.map(h =>
      `- ${h.product_name} (${h.category || 'unknown category'}) — purchased ${h.purchased_at || 'recently'}`
    )
    historySection = `\n\n## Customer Purchase History (last 10 orders)\n${historyLines.join('\n')}\nUse this history to personalize recommendations. Reference past purchases when relevant.`
  }

  let customSection = ''
  if (customSystemPrompt) {
    customSection = `\n\n## Additional Instructions from Store Owner\n${customSystemPrompt}`
  }

  return `You are the AI budtender for ${companyName}. ${personalityInstruction}

## Rules
- Only recommend products from the available inventory listed below. NEVER make up product names.
- Always include the price when recommending a product. If a product is on sale, mention both the sale price and original price.
- Recommend 3-5 products maximum per response.
- Be conversational and knowledgeable about cannabis.
- If asked about effects, explain relevant terpenes and cannabinoids.
- If a customer asks for something not in inventory, let them know and suggest the closest alternatives.
- When listing products, format them clearly with name, strain type, THC/CBD percentages, and price.
- If the customer wants to add something to their cart, confirm the product name and ask if they'd like anything else.

## Available Product Inventory (${productCatalog.length} in-stock items)
${JSON.stringify(productCatalog, null, 2)}${historySection}${customSection}`
}

async function generateAIResponse(
  anthropic: any,
  systemPrompt: string,
  sessionMessages: { role: string; content: string }[],
  temperature: number,
): Promise<string> {
  const messages = sessionMessages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    temperature,
    system: systemPrompt,
    messages,
  })

  // Extract text from response content blocks
  const textBlocks = response.content.filter((block: any) => block.type === 'text')
  return textBlocks.map((block: any) => block.text).join('') || 'I apologize, I was unable to generate a response. Could you rephrase your question?'
}

function extractRecommendedProductNames(responseText: string, products: any[]): any[] {
  // Match product names mentioned in the AI response against the catalog
  const matched: any[] = []
  for (const product of products) {
    if (responseText.toLowerCase().includes(product.name.toLowerCase())) {
      matched.push(product)
    }
  }
  return matched
}

// ============================================
// CONFIG
// ============================================

// Get AI budtender config
app.get('/config', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, enabled, personality, greeting, system_prompt, max_recommendations,
           enabled_channels, temperature, created_at, updated_at
    FROM ai_budtender_config
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const config = ((result as any).rows || result)?.[0]
  if (!config) {
    return c.json({
      configured: false,
      defaults: {
        enabled: false,
        personality: 'friendly',
        greeting: 'Welcome! I\'m your AI budtender. How can I help you find the perfect product today?',
        maxRecommendations: 5,
        enabledChannels: ['website', 'kiosk', 'mobile_app'],
        temperature: 0.7,
      },
    })
  }

  return c.json({ configured: true, ...config })
})

// Update AI budtender config
app.put('/config', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const configSchema = z.object({
    enabled: z.boolean().default(false),
    personality: z.enum(['friendly', 'professional', 'casual', 'educational']).default('friendly'),
    greeting: z.string().min(1).max(500),
    systemPrompt: z.string().max(2000).optional(),
    maxRecommendations: z.number().int().min(1).max(20).default(5),
    enabledChannels: z.array(z.enum(['website', 'kiosk', 'mobile_app', 'sms'])).min(1),
    temperature: z.number().min(0).max(1).default(0.7),
  })
  const data = configSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO ai_budtender_config(id, enabled, personality, greeting, system_prompt, max_recommendations, enabled_channels, temperature, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.enabled}, ${data.personality}, ${data.greeting}, ${data.systemPrompt || null}, ${data.maxRecommendations}, ${JSON.stringify(data.enabledChannels)}::jsonb, ${data.temperature}, ${currentUser.companyId}, NOW(), NOW())
    ON CONFLICT (company_id) DO UPDATE SET
      enabled = ${data.enabled},
      personality = ${data.personality},
      greeting = ${data.greeting},
      system_prompt = ${data.systemPrompt || null},
      max_recommendations = ${data.maxRecommendations},
      enabled_channels = ${JSON.stringify(data.enabledChannels)}::jsonb,
      temperature = ${data.temperature},
      updated_at = NOW()
    RETURNING id, enabled, personality, greeting, system_prompt, max_recommendations, enabled_channels, temperature, created_at, updated_at
  `)

  const config = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'ai_budtender_config',
    entityId: config?.id,
    entityName: 'AI Budtender Configuration',
    metadata: { enabled: data.enabled, personality: data.personality, channels: data.enabledChannels },
    req: c.req,
  })

  return c.json(config)
})

// ============================================
// SESSIONS
// ============================================

// Start new AI budtender session
app.post('/session', async (c) => {
  const currentUser = c.get('user') as any

  const sessionSchema = z.object({
    channel: z.enum(['website', 'kiosk', 'mobile_app', 'sms']),
    contactId: z.string().optional(),
  })
  const data = sessionSchema.parse(await c.req.json())

  // Get config
  const configResult = await db.execute(sql`
    SELECT enabled, greeting, enabled_channels, personality FROM ai_budtender_config
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]

  if (config && !config.enabled) {
    return c.json({ error: 'AI Budtender is not enabled' }, 400)
  }

  // Verify channel is enabled
  const enabledChannels = config?.enabled_channels || ['website', 'kiosk', 'mobile_app']
  if (Array.isArray(enabledChannels) && !enabledChannels.includes(data.channel)) {
    return c.json({ error: `Channel "${data.channel}" is not enabled` }, 400)
  }

  // Get company name for greeting
  const companyResult = await db.execute(sql`
    SELECT name FROM company WHERE id = ${currentUser.companyId} LIMIT 1
  `)
  const companyName = ((companyResult as any).rows || companyResult)?.[0]?.name || 'our dispensary'

  // Get customer name if contactId provided
  let customerName: string | null = null
  if (data.contactId) {
    const contactResult = await db.execute(sql`
      SELECT name FROM contact
      WHERE id = ${data.contactId} AND company_id = ${currentUser.companyId}
      LIMIT 1
    `)
    customerName = ((contactResult as any).rows || contactResult)?.[0]?.name || null
  }

  const sessionToken = crypto.randomBytes(24).toString('hex')
  const greetingMessage = config?.greeting || buildResponseMessage([], [], customerName, true, companyName)

  const initialMessages = JSON.stringify([
    { role: 'assistant', content: greetingMessage, timestamp: new Date().toISOString() },
  ])

  const result = await db.execute(sql`
    INSERT INTO ai_budtender_sessions(id, session_token, channel, contact_id, messages, recommended_product_ids, status, last_message_at, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${sessionToken}, ${data.channel}, ${data.contactId || null}, ${initialMessages}::jsonb, '[]'::jsonb, 'active', NOW(), ${currentUser.companyId}, NOW(), NOW())
    RETURNING id, session_token, channel, status, created_at
  `)

  const session = ((result as any).rows || result)?.[0]

  return c.json({
    sessionToken,
    sessionId: session?.id,
    greeting: greetingMessage,
  }, 201)
})

// ============================================
// CHAT
// ============================================

// Send message and get AI response
app.post('/chat', async (c) => {
  const currentUser = c.get('user') as any

  const chatSchema = z.object({
    sessionToken: z.string().min(1),
    message: z.string().min(1).max(1000),
  })
  const data = chatSchema.parse(await c.req.json())

  // Fetch session
  const sessionResult = await db.execute(sql`
    SELECT * FROM ai_budtender_sessions
    WHERE session_token = ${data.sessionToken}
      AND company_id = ${currentUser.companyId}
      AND status = 'active'
    LIMIT 1
  `)
  const session = ((sessionResult as any).rows || sessionResult)?.[0]
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)

  // Get company info
  const companyResult = await db.execute(sql`
    SELECT name FROM company WHERE id = ${currentUser.companyId} LIMIT 1
  `)
  const companyName = ((companyResult as any).rows || companyResult)?.[0]?.name || 'our dispensary'

  // Get AI config
  const configResult = await db.execute(sql`
    SELECT max_recommendations, personality, system_prompt, temperature FROM ai_budtender_config
    WHERE company_id = ${currentUser.companyId} LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  const maxRecs = config?.max_recommendations || 5

  // Check if we can use Claude API
  const anthropic = await getAnthropicClient()

  // Parse existing messages from session
  const existingMessages: { role: string; content: string; timestamp: string }[] =
    typeof session.messages === 'string'
      ? JSON.parse(session.messages)
      : (session.messages || [])

  if (anthropic) {
    // ============================================
    // CLAUDE AI PATH
    // ============================================

    // Fetch all in-stock products for the system prompt
    const allProductsResult = await db.execute(sql`
      SELECT p.id, p.name, p.category, p.strain_name, p.strain_type,
             p.thc_percent, p.cbd_percent, p.price, p.sale_price,
             p.description, p.effects, p.image_url, p.weight, p.unit,
             p.stock_quantity
      FROM products p
      WHERE p.company_id = ${currentUser.companyId}
        AND p.active = true
        AND p.in_stock = true
      ORDER BY p.total_sold DESC NULLS LAST
      LIMIT 200
    `)
    const allProducts = (allProductsResult as any).rows || allProductsResult

    // Fetch customer purchase history if contact is linked
    let purchaseHistory: any[] | null = null
    if (session.contact_id) {
      const historyResult = await db.execute(sql`
        SELECT p.name as product_name, p.category, o.created_at as purchased_at
        FROM orders o,
          LATERAL jsonb_array_elements(o.items) as item
        JOIN products p ON p.id = (item->>'productId')::uuid
        WHERE o.contact_id = ${session.contact_id}
          AND o.company_id = ${currentUser.companyId}
          AND o.status NOT IN ('cancelled', 'refunded')
        ORDER BY o.created_at DESC
        LIMIT 10
      `)
      const historyRows = (historyResult as any).rows || historyResult
      if (historyRows.length > 0) {
        purchaseHistory = historyRows
      }
    }

    // Build the system prompt with product catalog and history
    const systemPrompt = buildSystemPrompt(
      companyName,
      config?.personality || 'friendly',
      config?.system_prompt || null,
      allProducts,
      purchaseHistory,
    )

    // Prepare conversation messages for Claude (strip timestamps)
    const conversationMessages = [
      ...existingMessages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: data.message },
    ]

    // Call Claude API
    const temperature = parseFloat(config?.temperature || '0.7')
    let responseMessage: string

    try {
      responseMessage = await generateAIResponse(
        anthropic,
        systemPrompt,
        conversationMessages,
        temperature,
      )
    } catch (err: any) {
      console.error('Claude API error, falling back to keyword matching:', err.message)
      // Fall through to keyword fallback below
      return handleKeywordFallback(c, data, session, existingMessages, currentUser, companyName, maxRecs, config)
    }

    // Extract recommended products by matching names in AI response
    const recommendedProducts = extractRecommendedProductNames(responseMessage, allProducts)

    // Update session with new messages and recommended products
    existingMessages.push(
      { role: 'user', content: data.message, timestamp: new Date().toISOString() },
      { role: 'assistant', content: responseMessage, timestamp: new Date().toISOString() },
    )

    const recommendedIds = recommendedProducts.map((p: any) => p.id)
    const existingRecs = typeof session.recommended_product_ids === 'string'
      ? JSON.parse(session.recommended_product_ids)
      : (session.recommended_product_ids || [])
    const allRecs = [...new Set([...existingRecs, ...recommendedIds])]

    await db.execute(sql`
      UPDATE ai_budtender_sessions
      SET messages = ${JSON.stringify(existingMessages)}::jsonb,
          recommended_product_ids = ${JSON.stringify(allRecs)}::jsonb,
          last_message_at = NOW(),
          updated_at = NOW()
      WHERE id = ${session.id}
    `)

    return c.json({
      response: responseMessage,
      recommendedProducts: recommendedProducts.slice(0, maxRecs).map((p: any) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        strainName: p.strain_name,
        strainType: p.strain_type,
        thcPercentage: p.thc_percent,
        cbdPercentage: p.cbd_percent,
        price: p.price,
        salePrice: p.sale_price,
        imageUrl: p.image_url,
        description: p.description,
      })),
      suggestedCartItems: recommendedProducts.slice(0, 3).map((p: any) => ({
        productId: p.id,
        name: p.name,
        price: p.sale_price && Number(p.sale_price) < Number(p.price) ? p.sale_price : p.price,
        quantity: 1,
      })),
      source: 'claude',
    })
  }

  // ============================================
  // KEYWORD FALLBACK PATH (no API key)
  // ============================================
  return handleKeywordFallback(c, data, session, existingMessages, currentUser, companyName, maxRecs, config)
})

// Keyword-based fallback handler (extracted for reuse on API error)
async function handleKeywordFallback(
  c: any,
  data: { message: string; sessionToken: string },
  session: any,
  existingMessages: { role: string; content: string; timestamp: string }[],
  currentUser: any,
  companyName: string,
  maxRecs: number,
  config: any,
) {
  // Parse user intent from message
  const intents = parseUserIntent(data.message)

  // Build product query based on intents
  let products: any[] = []

  if (intents.length > 0) {
    const strainTypes = intents.map(i => i.strainType).filter(Boolean)
    const categories = intents.map(i => i.category).filter(Boolean)
    const effects = intents.flatMap(i => i.effects)
    const isBudget = intents.some(i => i.intent === 'budget')
    const isNewArrivals = intents.some(i => i.intent === 'new_arrivals')
    const isHighPotency = intents.some(i => i.intent === 'high_potency')
    const isHighCbd = intents.some(i => i.intent === 'high_cbd')

    // Build WHERE conditions
    let strainFilter = sql``
    if (strainTypes.length > 0) {
      strainFilter = sql`AND p.strain_type = ANY(${strainTypes}::text[])`
    }

    let categoryFilter = sql``
    if (categories.length > 0) {
      categoryFilter = sql`AND p.category = ANY(${categories}::text[])`
    }

    let potencyFilter = sql``
    if (isHighPotency) {
      potencyFilter = sql`AND p.thc_percent >= 25`
    }
    if (isHighCbd) {
      potencyFilter = sql`AND p.cbd_percent >= 10`
    }

    let orderClause = sql`ORDER BY p.total_sold DESC NULLS LAST`
    if (isBudget) {
      orderClause = sql`ORDER BY COALESCE(p.sale_price, p.price) ASC`
    }
    if (isNewArrivals) {
      orderClause = sql`ORDER BY p.created_at DESC`
    }

    const productsResult = await db.execute(sql`
      SELECT p.id, p.name, p.category, p.strain_name, p.strain_type,
             p.thc_percent, p.cbd_percent, p.price, p.sale_price,
             p.description, p.effects, p.image_url, p.weight, p.unit,
             COALESCE(p.total_sold, 0) as popularity,
             CASE WHEN p.sale_price IS NOT NULL AND p.sale_price < p.price THEN true ELSE false END as on_sale,
             CASE WHEN p.created_at >= NOW() - INTERVAL '14 days' THEN true ELSE false END as new_arrival
      FROM products p
      WHERE p.company_id = ${currentUser.companyId}
        AND p.active = true
        AND p.in_stock = true
        ${strainFilter}
        ${categoryFilter}
        ${potencyFilter}
      ${orderClause}
      LIMIT ${maxRecs * 2}
    `)
    const candidates = (productsResult as any).rows || productsResult

    // Score candidates based on intent match strength
    const scored = candidates.map((p: any) => {
      let score = 0

      // Strain type match
      if (strainTypes.includes(p.strain_type)) score += 3

      // Category match
      if (categories.includes(p.category)) score += 3

      // Effects match (check product effects JSON against intent effects)
      const productEffects = typeof p.effects === 'string' ? JSON.parse(p.effects || '[]') : (p.effects || [])
      const effectArray = Array.isArray(productEffects) ? productEffects : []
      for (const effect of effects) {
        if (effectArray.some((e: string) => e.toLowerCase().includes(effect.toLowerCase()))) {
          score += 2
        }
      }

      // Popularity bonus
      score += Math.min(Number(p.popularity) / 100, 1)

      // On sale bonus for budget intent
      if (isBudget && p.on_sale) score += 2

      // New arrival bonus
      if (isNewArrivals && p.new_arrival) score += 3

      // High potency bonus
      if (isHighPotency && Number(p.thc_percent) >= 28) score += 2

      // High CBD bonus
      if (isHighCbd && Number(p.cbd_percent) >= 15) score += 2

      return { ...p, score }
    })

    scored.sort((a: any, b: any) => b.score - a.score)
    products = scored.slice(0, maxRecs)
  }

  // If no intent matched, fetch popular products as suggestions
  if (!intents.length && session.contact_id) {
    const historyResult = await db.execute(sql`
      SELECT p.id, p.name, p.category, p.strain_name, p.strain_type,
             p.thc_percent, p.cbd_percent, p.price, p.sale_price,
             p.description, p.effects, p.image_url, p.weight, p.unit,
             COALESCE(p.total_sold, 0) as popularity
      FROM products p
      WHERE p.company_id = ${currentUser.companyId}
        AND p.active = true AND p.in_stock = true
      ORDER BY p.total_sold DESC NULLS LAST
      LIMIT ${maxRecs}
    `)
    products = (historyResult as any).rows || historyResult
  }

  // Build response message
  const responseMessage = buildResponseMessage(intents, products, null, false, companyName)

  // Update session with new messages and recommended products
  existingMessages.push(
    { role: 'user', content: data.message, timestamp: new Date().toISOString() },
    { role: 'assistant', content: responseMessage, timestamp: new Date().toISOString() },
  )

  const recommendedIds = products.map((p: any) => p.id)
  const existingRecs = typeof session.recommended_product_ids === 'string'
    ? JSON.parse(session.recommended_product_ids)
    : (session.recommended_product_ids || [])
  const allRecs = [...new Set([...existingRecs, ...recommendedIds])]

  await db.execute(sql`
    UPDATE ai_budtender_sessions
    SET messages = ${JSON.stringify(existingMessages)}::jsonb,
        recommended_product_ids = ${JSON.stringify(allRecs)}::jsonb,
        last_message_at = NOW(),
        updated_at = NOW()
    WHERE id = ${session.id}
  `)

  return c.json({
    response: responseMessage,
    recommendedProducts: products.map((p: any) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      strainName: p.strain_name,
      strainType: p.strain_type,
      thcPercentage: p.thc_percent,
      cbdPercentage: p.cbd_percent,
      price: p.price,
      salePrice: p.sale_price,
      imageUrl: p.image_url,
      description: p.description,
      score: p.score,
    })),
    suggestedCartItems: products.slice(0, 3).map((p: any) => ({
      productId: p.id,
      name: p.name,
      price: p.sale_price && Number(p.sale_price) < Number(p.price) ? p.sale_price : p.price,
      quantity: 1,
    })),
    intents: intents.map(i => i.intent),
    source: 'keyword',
  })
}

// ============================================
// CART & SESSION COMPLETION
// ============================================

// Add AI-recommended product to cart
app.post('/chat/:sessionToken/add-to-cart', async (c) => {
  const currentUser = c.get('user') as any
  const sessionToken = c.req.param('sessionToken')

  const cartSchema = z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).default(1),
  })
  const data = cartSchema.parse(await c.req.json())

  // Verify session
  const sessionResult = await db.execute(sql`
    SELECT id, contact_id FROM ai_budtender_sessions
    WHERE session_token = ${sessionToken}
      AND company_id = ${currentUser.companyId}
      AND status = 'active'
    LIMIT 1
  `)
  const session = ((sessionResult as any).rows || sessionResult)?.[0]
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)

  // Verify product exists and is in stock
  const productResult = await db.execute(sql`
    SELECT id, name, price, sale_price, in_stock FROM products
    WHERE id = ${data.productId}
      AND company_id = ${currentUser.companyId}
      AND active = true
    LIMIT 1
  `)
  const product = ((productResult as any).rows || productResult)?.[0]
  if (!product) return c.json({ error: 'Product not found' }, 404)
  if (!product.in_stock) return c.json({ error: 'Product is out of stock' }, 400)

  const unitPrice = product.sale_price && Number(product.sale_price) < Number(product.price)
    ? Number(product.sale_price)
    : Number(product.price)

  // Add to ai_budtender_sessions.cart_items JSON column
  const sessionCartResult = await db.execute(sql`
    SELECT cart_items FROM ai_budtender_sessions WHERE id = ${session.id}
  `)
  const sessionRow = ((sessionCartResult as any).rows || sessionCartResult)?.[0]
  const cartItems: any[] = Array.isArray(sessionRow?.cart_items) ? sessionRow.cart_items
    : (typeof sessionRow?.cart_items === 'string' ? JSON.parse(sessionRow.cart_items) : [])

  const existingIdx = cartItems.findIndex((ci: any) => ci.productId === data.productId)
  if (existingIdx !== -1) {
    cartItems[existingIdx].quantity += data.quantity
  } else {
    cartItems.push({
      id: `ci-${Date.now().toString(36)}`,
      productId: data.productId,
      quantity: data.quantity,
      unitPrice,
    })
  }

  await db.execute(sql`
    UPDATE ai_budtender_sessions
    SET cart_items = ${JSON.stringify(cartItems)}::jsonb, updated_at = NOW()
    WHERE id = ${session.id}
  `)

  const addedItem = existingIdx !== -1 ? cartItems[existingIdx] : cartItems[cartItems.length - 1]

  return c.json({
    added: true,
    cartItem: {
      id: addedItem.id,
      productId: data.productId,
      productName: product.name,
      quantity: addedItem.quantity,
      unitPrice,
      subtotal: addedItem.quantity * unitPrice,
    },
  })
})

// End session, optionally create order
app.post('/chat/:sessionToken/complete', async (c) => {
  const currentUser = c.get('user') as any
  const sessionToken = c.req.param('sessionToken')

  const completeSchema = z.object({
    satisfaction: z.number().int().min(1).max(5).optional(),
  })
  const data = completeSchema.parse(await c.req.json())

  // Get session
  const sessionResult = await db.execute(sql`
    SELECT * FROM ai_budtender_sessions
    WHERE session_token = ${sessionToken}
      AND company_id = ${currentUser.companyId}
      AND status = 'active'
    LIMIT 1
  `)
  const session = ((sessionResult as any).rows || sessionResult)?.[0]
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)

  // Get cart items from session's cart_items JSON column
  const rawCartItems: any[] = Array.isArray(session.cart_items) ? session.cart_items
    : (typeof session.cart_items === 'string' ? JSON.parse(session.cart_items) : [])

  // Resolve product names
  const cartItems: any[] = []
  for (const ci of rawCartItems) {
    const prodResult = await db.execute(sql`
      SELECT name FROM products WHERE id = ${ci.productId} LIMIT 1
    `)
    const prod = ((prodResult as any).rows || prodResult)?.[0]
    cartItems.push({
      product_id: ci.productId,
      product_name: prod?.name || ci.productId,
      quantity: ci.quantity,
      unit_price: ci.unitPrice,
    })
  }

  // Calculate cart total
  const cartTotal = cartItems.reduce((sum: number, item: any) =>
    sum + (Number(item.unit_price) * Number(item.quantity)), 0)

  // Create order if cart has items and customer is linked
  let orderId: string | null = null
  if (cartItems.length > 0 && session.contact_id) {
    const orderItems = cartItems.map((item: any) => ({
      productId: item.product_id,
      name: item.product_name,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      subtotal: Number(item.unit_price) * Number(item.quantity),
    }))

    const orderResult = await db.execute(sql`
      INSERT INTO orders(id, number, contact_id, type, status, items, subtotal, total, source, company_id, created_at, updated_at)
      VALUES (gen_random_uuid(), 'AI-' || LPAD(nextval('order_number_seq')::text, 6, '0'), ${session.contact_id}, 'walk_in', 'pending', ${JSON.stringify(orderItems)}::jsonb, ${cartTotal}, ${cartTotal}, 'ai_budtender', ${currentUser.companyId}, NOW(), NOW())
      RETURNING id, number
    `)
    const createdOrder = ((orderResult as any).rows || orderResult)?.[0]
    orderId = createdOrder?.id
  }

  // Close session
  const messages = typeof session.messages === 'string'
    ? JSON.parse(session.messages)
    : (session.messages || [])

  await db.execute(sql`
    UPDATE ai_budtender_sessions
    SET status = 'completed',
        satisfaction = ${data.satisfaction || null},
        order_id = ${orderId},
        message_count = ${messages.length},
        updated_at = NOW()
    WHERE id = ${session.id}
  `)

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'ai_budtender_session',
    entityId: session.id,
    entityName: `AI session ${session.channel}`,
    metadata: {
      satisfaction: data.satisfaction,
      messageCount: messages.length,
      cartItems: cartItems.length,
      cartTotal,
      orderId,
    },
    req: c.req,
  })

  return c.json({
    completed: true,
    sessionId: session.id,
    satisfaction: data.satisfaction,
    cart: {
      items: cartItems.length,
      total: cartTotal,
    },
    orderId,
  })
})

// ============================================
// MANAGEMENT
// ============================================

// List AI sessions (manager+)
app.get('/sessions', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit
  const status = c.req.query('status')
  const channel = c.req.query('channel')

  let statusFilter = sql``
  if (status) statusFilter = sql`AND abs.status = ${status}`

  let channelFilter = sql``
  if (channel) channelFilter = sql`AND abs.channel = ${channel}`

  const dataResult = await db.execute(sql`
    SELECT abs.id, abs.session_token, abs.channel, abs.status, abs.satisfaction,
           abs.message_count, abs.order_id, abs.last_message_at, abs.created_at,
           c.name as customer_name, c.email as customer_email
    FROM ai_budtender_sessions abs
    LEFT JOIN contact c ON c.id = abs.contact_id
    WHERE abs.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${channelFilter}
    ORDER BY abs.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM ai_budtender_sessions
    WHERE company_id = ${currentUser.companyId} ${statusFilter} ${channelFilter}
  `)

  const data = (dataResult as any).rows || dataResult
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// ============================================
// ANALYTICS
// ============================================

// AI budtender performance analytics
app.get('/analytics', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const days = +(c.req.query('days') || '30')

  // Overall stats
  const statsResult = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_sessions,
      COUNT(CASE WHEN order_id IS NOT NULL THEN 1 END)::int as sessions_with_orders,
      CASE WHEN COUNT(*) > 0
        THEN ROUND(COUNT(CASE WHEN order_id IS NOT NULL THEN 1 END)::numeric / COUNT(*) * 100, 2)
        ELSE 0
      END as conversion_rate,
      ROUND(AVG(satisfaction)::numeric, 2) as avg_satisfaction,
      ROUND(AVG(message_count)::numeric, 1) as avg_messages_per_session,
      COUNT(DISTINCT contact_id)::int as unique_customers
    FROM ai_budtender_sessions
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= NOW() - INTERVAL '1 day' * ${days}
  `)
  const stats = ((statsResult as any).rows || statsResult)?.[0]

  // Revenue attributed to AI budtender
  const revenueResult = await db.execute(sql`
    SELECT COALESCE(SUM(o.total::numeric), 0) as attributed_revenue
    FROM ai_budtender_sessions abs
    JOIN orders o ON o.id = abs.order_id
    WHERE abs.company_id = ${currentUser.companyId}
      AND abs.created_at >= NOW() - INTERVAL '1 day' * ${days}
      AND o.status NOT IN ('cancelled', 'refunded')
  `)
  const revenue = ((revenueResult as any).rows || revenueResult)?.[0]

  // Top recommended products
  const topProductsResult = await db.execute(sql`
    WITH rec_products AS (
      SELECT jsonb_array_elements_text(recommended_product_ids) as product_id
      FROM ai_budtender_sessions
      WHERE company_id = ${currentUser.companyId}
        AND created_at >= NOW() - INTERVAL '1 day' * ${days}
    )
    SELECT p.id, p.name, p.category, p.strain_type, p.price,
           COUNT(*)::int as times_recommended
    FROM rec_products rp
    JOIN products p ON p.id = rp.product_id::uuid
    GROUP BY p.id, p.name, p.category, p.strain_type, p.price
    ORDER BY times_recommended DESC
    LIMIT 10
  `)
  const topProducts = (topProductsResult as any).rows || topProductsResult

  // Sessions by channel
  const channelResult = await db.execute(sql`
    SELECT channel, COUNT(*)::int as count
    FROM ai_budtender_sessions
    WHERE company_id = ${currentUser.companyId}
      AND created_at >= NOW() - INTERVAL '1 day' * ${days}
    GROUP BY channel
    ORDER BY count DESC
  `)
  const byChannel = (channelResult as any).rows || channelResult

  // Satisfaction distribution
  const satisfactionResult = await db.execute(sql`
    SELECT satisfaction, COUNT(*)::int as count
    FROM ai_budtender_sessions
    WHERE company_id = ${currentUser.companyId}
      AND satisfaction IS NOT NULL
      AND created_at >= NOW() - INTERVAL '1 day' * ${days}
    GROUP BY satisfaction
    ORDER BY satisfaction
  `)
  const satisfactionDistribution = (satisfactionResult as any).rows || satisfactionResult

  return c.json({
    periodDays: days,
    totalSessions: Number(stats?.total_sessions || 0),
    sessionsWithOrders: Number(stats?.sessions_with_orders || 0),
    conversionRate: Number(stats?.conversion_rate || 0),
    avgSatisfaction: Number(stats?.avg_satisfaction || 0),
    avgMessagesPerSession: Number(stats?.avg_messages_per_session || 0),
    uniqueCustomers: Number(stats?.unique_customers || 0),
    attributedRevenue: Number(revenue?.attributed_revenue || 0),
    topRecommendedProducts: topProducts,
    sessionsByChannel: byChannel,
    satisfactionDistribution,
  })
})

export default app
