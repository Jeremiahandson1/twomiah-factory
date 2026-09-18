/* ────────────────────────────────────────────────────────────────────────
   {{COMPANY_NAME}} — dependency-free storefront cart
   Persists to localStorage, renders the cart page, wires add-to-cart /
   variant switching / product gallery / checkout. Loaded site-wide (defer).
   ──────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // Factory replaces {{COMPANY_SLUG}} at generation time. Leave literal.
  var CART_KEY = '{{COMPANY_SLUG}}-cart';

  // ── storage ─────────────────────────────────────────────────────────────
  function readCart() {
    try {
      var raw = localStorage.getItem(CART_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (i) { return i && i.sku; }) : [];
    } catch (e) { return []; }
  }

  function writeCart(cart) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {}
    updateCartCount();
  }

  function cartQtyTotal(cart) {
    return (cart || readCart()).reduce(function (n, i) { return n + (Number(i.qty) || 0); }, 0);
  }

  function cartSubtotalCents(cart) {
    return (cart || readCart()).reduce(function (n, i) {
      return n + (Number(i.unitPriceCents) || 0) * (Number(i.qty) || 0);
    }, 0);
  }

  // ── formatting ───────────────────────────────────────────────────────────
  function formatMoney(cents) {
    var n = (Number(cents) || 0) / 100;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    } catch (e) { return '$' + n.toFixed(2); }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // maxQty: '' / null / undefined => unlimited. 0 => sold out.
  function normalizeMax(v) {
    if (v === '' || v === null || typeof v === 'undefined') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function clampQty(qty, maxQty) {
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    if (maxQty !== null && maxQty >= 0) qty = Math.min(qty, Math.max(0, maxQty));
    return qty;
  }

  // ── public-ish API ───────────────────────────────────────────────────────
  function addToCart(item) {
    if (!item || !item.sku) return;
    var maxQty = normalizeMax(item.maxQty);
    if (maxQty === 0) return; // sold out
    var addQty = Math.max(1, Math.floor(Number(item.qty) || 1));

    var cart = readCart();
    var existing = null;
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].sku === item.sku) { existing = cart[i]; break; }
    }

    if (existing) {
      existing.qty = clampQty((Number(existing.qty) || 0) + addQty, maxQty);
      existing.unitPriceCents = Number(item.unitPriceCents) || existing.unitPriceCents;
      if (item.name) existing.name = item.name;
      existing.variantName = item.variantName || existing.variantName || '';
      if (item.imageUrl) existing.imageUrl = item.imageUrl;
      existing.maxQty = maxQty;
    } else {
      cart.push({
        sku: item.sku,
        name: item.name || item.sku,
        variantName: item.variantName || '',
        unitPriceCents: Number(item.unitPriceCents) || 0,
        imageUrl: item.imageUrl || '',
        qty: clampQty(addQty, maxQty),
        maxQty: maxQty
      });
    }
    writeCart(cart);
    flashCartCount();
  }

  function setQty(sku, qty) {
    var cart = readCart();
    for (var i = 0; i < cart.length; i++) {
      if (cart[i].sku === sku) {
        cart[i].qty = clampQty(qty, normalizeMax(cart[i].maxQty));
        break;
      }
    }
    writeCart(cart);
    renderCartPage();
  }

  function removeItem(sku) {
    var cart = readCart().filter(function (i) { return i.sku !== sku; });
    writeCart(cart);
    renderCartPage();
  }

  // ── cart-count badge ─────────────────────────────────────────────────────
  function updateCartCount() {
    var total = cartQtyTotal();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = String(total);
      el.setAttribute('data-count', String(total));
      // Optional: hide zero-count badges that opt in with [data-cart-count-hide-empty]
      if (el.hasAttribute('data-cart-count-hide-empty')) {
        el.style.display = total > 0 ? '' : 'none';
      }
    });
  }

  function flashCartCount() {
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.classList.remove('cart-count--bump');
      // reflow to restart the animation
      void el.offsetWidth;
      el.classList.add('cart-count--bump');
    });
  }

  // ── add-to-cart wiring ───────────────────────────────────────────────────
  function readAddData(el) {
    return {
      sku: el.getAttribute('data-sku') || '',
      name: el.getAttribute('data-name') || '',
      variantName: el.getAttribute('data-variant') || '',
      unitPriceCents: Number(el.getAttribute('data-price')) || 0,
      imageUrl: el.getAttribute('data-image') || '',
      maxQty: el.getAttribute('data-max')
    };
  }

  function wireAddToCart() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-add-to-cart]');
      if (!btn || btn.disabled) return;
      e.preventDefault();       // do not follow a wrapping card link
      e.stopPropagation();

      var data = readAddData(btn);

      // On the product page, honour the quantity stepper.
      var qty = 1;
      if (btn.hasAttribute('data-product-add')) {
        var qtyInput = document.querySelector('[data-qty-input]');
        if (qtyInput) qty = Number(qtyInput.value) || 1;
      }
      data.qty = qty;

      addToCart(data);

      // Micro-feedback on the button itself.
      var label = btn.querySelector('[data-add-label]');
      var target = label || btn;
      var prev = target.textContent;
      target.textContent = 'Added ✓';
      btn.classList.add('is-added');
      setTimeout(function () {
        target.textContent = prev;
        btn.classList.remove('is-added');
      }, 1200);
    });
  }

  // ── product page: quantity stepper ───────────────────────────────────────
  function wireQtyStepper() {
    var stepper = document.querySelector('[data-qty-stepper]');
    if (!stepper) return;
    var input = stepper.querySelector('[data-qty-input]');
    if (!input) return;

    function currentMax() {
      var addBtn = document.querySelector('[data-product-add]');
      return addBtn ? normalizeMax(addBtn.getAttribute('data-max')) : null;
    }
    function commit(v) {
      input.value = clampQty(v, currentMax());
    }
    stepper.querySelector('[data-qty-dec]').addEventListener('click', function () {
      commit((Number(input.value) || 1) - 1);
    });
    stepper.querySelector('[data-qty-inc]').addEventListener('click', function () {
      commit((Number(input.value) || 1) + 1);
    });
    input.addEventListener('change', function () { commit(input.value); });
  }

  // ── product page: variant switching ──────────────────────────────────────
  function wireVariants() {
    var opts = document.querySelectorAll('[data-variant-option]');
    if (!opts.length) return;
    var addBtn = document.querySelector('[data-product-add]');
    var priceDisplay = document.querySelector('[data-price-display]');
    var compareDisplay = document.querySelector('[data-compare-display]');
    var soldoutMsg = document.querySelector('[data-soldout-msg]');
    var addLabel = addBtn ? addBtn.querySelector('[data-add-label]') : null;

    opts.forEach(function (opt) {
      opt.addEventListener('click', function () {
        opts.forEach(function (o) { o.classList.remove('is-selected'); });
        opt.classList.add('is-selected');

        var soldOut = opt.getAttribute('data-soldout') === '1';
        var price = opt.getAttribute('data-price') || '0';
        var priceStr = opt.getAttribute('data-price-display') || formatMoney(price);
        var compareStr = opt.getAttribute('data-compare') || '';
        var max = opt.getAttribute('data-max');

        if (priceDisplay) priceDisplay.textContent = priceStr;
        if (compareDisplay) {
          if (compareStr) { compareDisplay.textContent = compareStr; compareDisplay.style.display = ''; }
          else { compareDisplay.style.display = 'none'; }
        }
        if (soldoutMsg) soldoutMsg.style.display = soldOut ? '' : 'none';

        if (addBtn) {
          addBtn.setAttribute('data-sku', opt.getAttribute('data-sku') || '');
          addBtn.setAttribute('data-name', addBtn.getAttribute('data-name') || '');
          addBtn.setAttribute('data-variant', opt.getAttribute('data-name') || '');
          addBtn.setAttribute('data-price', price);
          addBtn.setAttribute('data-max', max === null ? '' : max);
          addBtn.disabled = soldOut;
          if (addLabel) addLabel.textContent = soldOut ? 'Sold out' : 'Add to Cart';

          // Re-clamp quantity to the new variant's stock.
          var qtyInput = document.querySelector('[data-qty-input]');
          if (qtyInput) qtyInput.value = clampQty(qtyInput.value, normalizeMax(max));
        }
      });
    });
  }

  // ── product page: image gallery ──────────────────────────────────────────
  function wireGallery() {
    var main = document.querySelector('[data-gallery-main]');
    var thumbs = document.querySelectorAll('[data-gallery-thumb]');
    if (!main || !thumbs.length) return;
    thumbs.forEach(function (thumb) {
      thumb.addEventListener('click', function () {
        var full = thumb.getAttribute('data-full');
        if (!full) return;
        main.setAttribute('src', full);
        main.setAttribute('alt', thumb.getAttribute('data-alt') || '');
        thumbs.forEach(function (t) { t.classList.remove('is-active'); });
        thumb.classList.add('is-active');
      });
    });
  }

  // ── cart page render ─────────────────────────────────────────────────────
  function renderCartPage() {
    var root = document.getElementById('cart-root');
    if (!root) return;
    var cart = readCart();

    if (!cart.length) {
      root.innerHTML =
        '<div class="cart-empty">' +
          '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
            '<circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle>' +
            '<path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>' +
          '</svg>' +
          '<h3>Your cart is empty</h3>' +
          '<p>Looks like you haven’t added anything yet.</p>' +
          '<a href="/shop" class="btn btn-primary">Continue Shopping</a>' +
        '</div>';
      return;
    }

    var lines = cart.map(function (i) {
      var max = normalizeMax(i.maxQty);
      var atMax = max !== null && i.qty >= max;
      var img = i.imageUrl
        ? '<img src="' + esc(i.imageUrl) + '" alt="' + esc(i.name) + '" width="90" height="90">'
        : '<div class="product-card__noimg" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg></div>';
      return (
        '<div class="cart-line" data-sku="' + esc(i.sku) + '">' +
          '<div class="cart-line__media">' + img + '</div>' +
          '<div class="cart-line__info">' +
            '<span class="cart-line__name">' + esc(i.name) + '</span>' +
            (i.variantName ? '<span class="cart-line__variant">' + esc(i.variantName) + '</span>' : '') +
            '<span class="cart-line__unit">' + formatMoney(i.unitPriceCents) + ' each</span>' +
            '<button type="button" class="cart-line__remove" data-remove aria-label="Remove ' + esc(i.name) + '">Remove</button>' +
          '</div>' +
          '<div class="cart-line__qty">' +
            '<div class="qty-stepper qty-stepper--sm">' +
              '<button type="button" class="qty-stepper__btn" data-line-dec aria-label="Decrease quantity">−</button>' +
              '<input type="number" class="qty-stepper__input" data-line-qty value="' + i.qty + '" min="1" step="1" inputmode="numeric" aria-label="Quantity">' +
              '<button type="button" class="qty-stepper__btn" data-line-inc' + (atMax ? ' disabled' : '') + ' aria-label="Increase quantity">+</button>' +
            '</div>' +
          '</div>' +
          '<div class="cart-line__total">' + formatMoney(i.unitPriceCents * i.qty) + '</div>' +
        '</div>'
      );
    }).join('');

    root.innerHTML =
      '<div class="cart-layout">' +
        '<div class="cart-lines">' + lines + '</div>' +
        '<aside class="cart-summary">' +
          '<h2 class="cart-summary__title">Order Summary</h2>' +
          '<div class="cart-summary__row">' +
            '<span>Subtotal</span><span data-cart-subtotal>' + formatMoney(cartSubtotalCents(cart)) + '</span>' +
          '</div>' +
          '<p class="cart-summary__note">Shipping &amp; tax calculated at checkout.</p>' +
          '<button type="button" class="btn btn-primary btn-lg btn-block" data-checkout>Checkout</button>' +
          '<div class="cart-summary__error" data-checkout-error style="display:none"></div>' +
          '<a href="/shop" class="cart-summary__continue">Continue shopping</a>' +
        '</aside>' +
      '</div>';
  }

  // Delegated events for the (dynamically rendered) cart page.
  function wireCartPageEvents() {
    var root = document.getElementById('cart-root');
    if (!root) return;

    root.addEventListener('click', function (e) {
      var line = e.target.closest('.cart-line');
      var sku = line ? line.getAttribute('data-sku') : null;

      if (e.target.closest('[data-remove]') && sku) { removeItem(sku); return; }
      if (e.target.closest('[data-line-dec]') && sku) {
        var inp = line.querySelector('[data-line-qty]');
        setQty(sku, (Number(inp.value) || 1) - 1);
        return;
      }
      if (e.target.closest('[data-line-inc]') && sku) {
        var inp2 = line.querySelector('[data-line-qty]');
        setQty(sku, (Number(inp2.value) || 1) + 1);
        return;
      }
      if (e.target.closest('[data-checkout]')) { doCheckout(e.target.closest('[data-checkout]')); }
    });

    root.addEventListener('change', function (e) {
      var qtyInput = e.target.closest('[data-line-qty]');
      if (!qtyInput) return;
      var line = qtyInput.closest('.cart-line');
      if (line) setQty(line.getAttribute('data-sku'), qtyInput.value);
    });
  }

  // ── checkout ─────────────────────────────────────────────────────────────
  function doCheckout(btn) {
    var cart = readCart();
    if (!cart.length) return;
    var errBox = document.querySelector('[data-checkout-error]');
    if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }

    var original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Redirecting…';

    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items: cart.map(function (i) { return { sku: i.sku, quantity: i.qty }; }) })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (r) {
        if (r.ok && r.data && r.data.url) {
          window.location.href = r.data.url;
          return;
        }
        throw new Error((r.data && r.data.error) || 'Checkout is unavailable right now. Please try again.');
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = original;
        if (errBox) {
          errBox.textContent = err.message || 'Something went wrong. Please try again.';
          errBox.style.display = 'block';
        }
      });
  }

  // ── init ─────────────────────────────────────────────────────────────────
  function init() {
    updateCartCount();
    wireAddToCart();
    wireQtyStepper();
    wireVariants();
    wireGallery();
    renderCartPage();
    wireCartPageEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Keep the badge in sync across tabs.
  window.addEventListener('storage', function (e) {
    if (e.key === CART_KEY) { updateCartCount(); renderCartPage(); }
  });

  // Expose a tiny namespace for any inline usage.
  window.StoreCart = { add: addToCart, read: readCart, count: cartQtyTotal };
})();
