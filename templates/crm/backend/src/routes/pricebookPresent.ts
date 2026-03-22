/**
 * Pricebook Presentation Mode — Public, no auth required.
 *
 * GET /:itemId — Full-screen HTML page showing Good/Better/Best tiers
 * for a pricebook item.  Designed to be shown to homeowners on a tablet
 * at the kitchen table.  No nav, no admin chrome — just the presentation.
 */

import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { pricebookItem, pricebookCategory, company } from '../../db/schema.ts'
import { eq, and, sql } from 'drizzle-orm'

const app = new Hono()

app.get('/:itemId', async (c) => {
  const itemId = c.req.param('itemId')

  // Fetch the item
  const [result] = await db.select()
    .from(pricebookItem)
    .leftJoin(pricebookCategory, eq(pricebookItem.categoryId, pricebookCategory.id))
    .where(eq(pricebookItem.id, itemId))

  if (!result) {
    return c.html('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui"><h1>Item not found</h1></body></html>', 404)
  }

  const item = result.pricebook_item
  const category = result.pricebook_category

  // Fetch company info for logo
  const [comp] = await db.select({
    name: company.name,
    logo: company.logo,
    phone: company.phone,
  }).from(company).where(eq(company.id, item.companyId)).limit(1)

  // Fetch Good/Better/Best tiers
  const gbbResult = await db.execute(sql`
    SELECT * FROM pricebook_good_better_best
    WHERE pricebook_item_id = ${itemId}
    ORDER BY
      CASE tier
        WHEN 'best' THEN 1
        WHEN 'better' THEN 2
        WHEN 'good' THEN 3
        ELSE 4
      END
  `)
  const tiers = (gbbResult.rows ?? gbbResult) as any[]

  // Determine recommended tier — default to "best" (sign today, best price)
  const recommended = tiers.find(t => t.recommended) || tiers.find(t => t.tier === 'best') || tiers[0]

  // Format price
  const fmt = (n: any) => {
    const num = Number(n)
    if (isNaN(num)) return '$0'
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  // Parse features (stored as JSON)
  const parseFeatures = (f: any): string[] => {
    if (!f) return []
    if (Array.isArray(f)) return f
    try { return JSON.parse(f) } catch { return [] }
  }

  // Urgency-based pricing: Best = sign today (lowest), Good = 1 year (highest)
  const tierColors: Record<string, { bg: string; border: string; badge: string; icon: string }> = {
    best: { bg: '#ecfdf5', border: '#10b981', badge: '#059669', icon: '🔥' },
    better: { bg: '#eff6ff', border: '#3b82f6', badge: '#2563eb', icon: '📅' },
    good: { bg: '#f8fafc', border: '#e2e8f0', badge: '#64748b', icon: '📋' },
  }

  const tierLabels: Record<string, string> = {
    best: 'Sign Today',
    better: 'Within 30 Days',
    good: 'Valid 1 Year',
  }

  // Build tier cards HTML
  const tierCardsHtml = tiers.map(tier => {
    const isRec = recommended && tier.id === recommended.id
    const colors = tierColors[tier.tier] || tierColors.better
    const features = parseFeatures(tier.features)
    const label = tier.name || tierLabels[tier.tier] || tier.tier

    return `
      <div class="tier-card ${isRec ? 'recommended' : ''}" data-tier="${tier.tier}" data-price="${tier.price}" data-name="${label}" style="
        background: ${colors.bg};
        border: 2px solid ${isRec ? colors.border : '#e5e7eb'};
        ${isRec ? `box-shadow: 0 8px 32px ${colors.border}33;` : ''}
      ">
        ${isRec ? `<div class="rec-badge" style="background: ${colors.badge}">Recommended</div>` : ''}
        <div class="tier-icon">${colors.icon}</div>
        <h2 class="tier-label">${label}</h2>
        <div class="tier-price">${fmt(tier.price)}</div>
        ${tier.description ? `<p class="tier-desc">${tier.description}</p>` : ''}
        ${features.length > 0 ? `
          <ul class="tier-features">
            ${features.map(f => `<li><span class="check">✓</span> ${f}</li>`).join('')}
          </ul>
        ` : ''}
        <button class="select-btn" onclick="selectTier(this)" style="
          background: ${isRec ? colors.badge : '#374151'};
        ">Select This Package</button>
      </div>
    `
  }).join('')

  // If no tiers, show the single item as a card
  const singleItemHtml = tiers.length === 0 ? `
    <div class="single-item">
      ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}" class="item-image" />` : ''}
      <h2>${item.name}</h2>
      ${item.customerDescription || item.description ? `<p class="item-desc">${item.customerDescription || item.description}</p>` : ''}
      <div class="tier-price">${fmt(item.price)}</div>
      <button class="select-btn" style="background:#2563eb;margin-top:32px" onclick="window.location.href='/crm/quotes?newFromPricebook=${item.id}'">
        Build Your Quote
      </button>
    </div>
  ` : ''

  const logoUrl = comp?.logo || ''
  const companyName = comp?.name || ''

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${item.name} — ${companyName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow-x: hidden; }
    body {
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
      background: #ffffff;
      color: #111827;
      -webkit-font-smoothing: antialiased;
      font-size: 18px;
      line-height: 1.6;
    }

    /* Header */
    .header {
      padding: 24px 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #f3f4f6;
    }
    .header-logo { height: 48px; max-width: 200px; object-fit: contain; }
    .header-company { font-size: 20px; font-weight: 700; color: #374151; }
    .header-right { font-size: 14px; color: #9ca3af; }

    /* Hero */
    .hero {
      text-align: center;
      padding: 48px 48px 24px;
    }
    .hero-category {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #9ca3af;
      margin-bottom: 8px;
    }
    .hero h1 {
      font-size: clamp(28px, 4vw, 42px);
      font-weight: 800;
      color: #111827;
      margin-bottom: 12px;
    }
    .hero-desc {
      font-size: 18px;
      color: #6b7280;
      max-width: 600px;
      margin: 0 auto;
    }
    .item-image {
      width: 100%;
      max-width: 800px;
      max-height: 300px;
      object-fit: cover;
      border-radius: 16px;
      margin: 24px auto;
      display: block;
    }

    /* Tiers grid */
    .tiers {
      display: grid;
      grid-template-columns: repeat(${tiers.length || 1}, 1fr);
      gap: 24px;
      padding: 24px 48px 48px;
      max-width: 1200px;
      margin: 0 auto;
      align-items: start;
    }

    .tier-card {
      border-radius: 20px;
      padding: 40px 32px;
      text-align: center;
      position: relative;
      transition: transform 0.2s, box-shadow 0.2s;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .tier-card.selected {
      transform: scale(1.03);
      box-shadow: 0 12px 40px rgba(37, 99, 235, 0.2) !important;
      border-color: #2563eb !important;
    }

    .rec-badge {
      position: absolute;
      top: -14px;
      left: 50%;
      transform: translateX(-50%);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 6px 20px;
      border-radius: 20px;
      white-space: nowrap;
    }

    .tier-icon {
      font-size: 28px;
      margin-bottom: 16px;
      margin-top: 8px;
    }
    .tier-label {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #111827;
    }
    .tier-price {
      font-size: 48px;
      font-weight: 800;
      color: #111827;
      margin-bottom: 16px;
      line-height: 1;
    }
    .tier-desc {
      font-size: 16px;
      color: #6b7280;
      margin-bottom: 24px;
      line-height: 1.6;
    }

    .tier-features {
      list-style: none;
      text-align: left;
      width: 100%;
      margin-bottom: 32px;
    }
    .tier-features li {
      padding: 10px 0;
      border-bottom: 1px solid #f3f4f6;
      font-size: 16px;
      color: #374151;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .tier-features li:last-child { border-bottom: none; }
    .check {
      color: #22c55e;
      font-weight: 700;
      font-size: 18px;
      flex-shrink: 0;
    }

    .select-btn {
      width: 100%;
      padding: 18px 32px;
      border: none;
      border-radius: 12px;
      color: #fff;
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
      min-height: 56px;
      margin-top: auto;
    }
    .select-btn:active { transform: scale(0.97); }

    /* Single item (no GBB) */
    .single-item {
      text-align: center;
      max-width: 600px;
      margin: 0 auto;
      padding: 48px;
    }
    .single-item h2 { font-size: 32px; font-weight: 800; margin-bottom: 16px; }
    .item-desc { font-size: 18px; color: #6b7280; margin-bottom: 24px; }

    /* Continue bar */
    .continue-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #111827;
      padding: 20px 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 100;
    }
    .continue-bar.visible { transform: translateY(0); }
    .continue-bar .selected-info {
      color: #fff;
      font-size: 18px;
      font-weight: 600;
    }
    .continue-bar .selected-info span {
      color: #60a5fa;
    }
    .continue-btn {
      background: #2563eb;
      color: #fff;
      border: none;
      padding: 16px 40px;
      border-radius: 12px;
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      min-height: 56px;
      transition: background 0.2s;
    }
    .continue-btn:active { background: #1d4ed8; }

    /* Tablet landscape */
    @media (max-width: 1024px) {
      .header { padding: 20px 24px; }
      .hero { padding: 32px 24px 16px; }
      .tiers { padding: 16px 24px 100px; gap: 16px; }
      .tier-card { padding: 28px 20px; }
      .tier-price { font-size: 40px; }
      .continue-bar { padding: 16px 24px; }
    }

    /* Portrait / phone */
    @media (max-width: 768px) {
      .tiers { grid-template-columns: 1fr; max-width: 480px; }
      .tier-card { padding: 32px 24px; }
    }
  </style>
</head>
<body>

  <div class="header">
    ${logoUrl
      ? `<img src="${logoUrl}" alt="${companyName}" class="header-logo" />`
      : `<div class="header-company">${companyName}</div>`
    }
    <div class="header-right">${category?.name || ''}</div>
  </div>

  <div class="hero">
    ${category ? `<div class="hero-category">${category.name}</div>` : ''}
    <h1>${item.name}</h1>
    ${item.customerDescription || item.description ? `<p class="hero-desc">${item.customerDescription || item.description}</p>` : ''}
    ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${item.name}" class="item-image" />` : ''}
  </div>

  <div class="tiers">
    ${tiers.length > 0 ? tierCardsHtml : singleItemHtml}
  </div>

  <div class="continue-bar" id="continueBar">
    <div class="selected-info">Selected: <span id="selectedName">—</span> · <span id="selectedPrice">—</span></div>
    <button class="continue-btn" onclick="buildQuote()">Build Your Quote →</button>
  </div>

  <script>
    let selectedTier = null;

    function selectTier(btn) {
      // Deselect all
      document.querySelectorAll('.tier-card').forEach(c => c.classList.remove('selected'));
      // Select this one
      const card = btn.closest('.tier-card');
      card.classList.add('selected');
      selectedTier = {
        tier: card.dataset.tier,
        price: card.dataset.price,
        name: card.dataset.name,
      };
      // Show continue bar
      document.getElementById('continueBar').classList.add('visible');
      document.getElementById('selectedName').textContent = selectedTier.name;
      document.getElementById('selectedPrice').textContent = '$' + Number(selectedTier.price).toLocaleString();
      // Scroll to show the bar
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }

    function buildQuote() {
      if (!selectedTier) return;
      window.location.href = '/crm/quotes?newFromPricebook=${item.id}&tier=' + selectedTier.tier;
    }
  </script>

</body>
</html>`

  return c.html(html)
})

export default app
