import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Plus, Minus, Trash2, User, CreditCard, Banknote, ShieldCheck, Gift, X, Check, AlertTriangle } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
// Offline POS: a sale the network lost is held locally and replayed, rather than lost. (T45 H17)
import { enqueue, pendingCount, isNetworkFailure, isOnline } from '../offline/queue';
import { OFFLINE_SYNC_EVENT } from '../offline/register';

interface CartItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  weight?: number;
  category: string;
  taxCategory?: string | null;
  strainType?: string;
}

// Values MUST match the backend product category enum (singular).
const categories = [
  { value: '', label: 'All' },
  { value: 'flower', label: 'Flower' },
  { value: 'edible', label: 'Edibles' },
  { value: 'concentrate', label: 'Concentrates' },
  { value: 'vape', label: 'Vapes' },
  { value: 'pre_roll', label: 'Pre-Rolls' },
  { value: 'topical', label: 'Topicals' },
  { value: 'accessory', label: 'Merch' },
];

// The per-transaction purchase limit comes from Settings (company.purchaseLimitOz), loaded below;
// this is only the fallback until it arrives. (go-live QA V-1)
const DEFAULT_WEIGHT_LIMIT_OZ = 1;

export default function POSPage() {
  const { user } = useAuth();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<any>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState<any[]>([]);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'debit'>('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [idVerified, setIdVerified] = useState(false);
  const [loyaltyApplied, setLoyaltyApplied] = useState(false);
  const [loyaltyDiscount, setLoyaltyDiscount] = useState(0);
  const [processing, setProcessing] = useState(false);
  // Whether this till can reach the network, and how many sales it is holding. (T45 H17)
  const [online, setOnline] = useState(isOnline());
  const [queued, setQueued] = useState(pendingCount());
  /**
   * A ticket that was raised but not settled.
   *
   * Checkout is two calls: create the order, then complete it. When the second fails — no drawer
   * open is the common one — the first had already succeeded, so the shop was left with a pending
   * order nobody wanted, and pressing Checkout again raised a SECOND one. Run T45 M6 produced
   * ORD-1414 and ORD-1415 that way, and the abandoned ticket then sat in the list looking like real
   * outstanding trade. Hold the id and settle THAT order on the retry. (T45 M6)
   */
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  /** The server's own flower-equivalent figure for this cart — see the weight meter below. (T45 M5) */
  const [serverWeight, setServerWeight] = useState<{ totalFlowerEquivalentOz: number; limitError: string | null; uncountableError: string | null } | null>(null);

  // Sales-tax rate from company Settings, so the register quotes what the operator
  // configured — not a hardcoded 15% that disagreed with both Settings and the
  // recorded order (the backend computes tax from company.taxRate too). (B3)
  const [taxRate, setTaxRate] = useState(0);
  // Cannabis excise rate (Settings → exciseTaxRate). The register showed a single "Tax" line
  // and no excise, so the quoted total disagreed with the recorded order. (QA F-01)
  const [exciseRate, setExciseRate] = useState(0.15);
  const [WEIGHT_LIMIT_OZ, setWeightLimitOz] = useState(DEFAULT_WEIGHT_LIMIT_OZ);

  // Loyalty reward redemption (go-live QA M-7): rewards come from Loyalty → Rewards; the
  // cashier picks one, the server prices it and charges its points. The old flow applied an
  // opaque "$1 per 100 pts" discount that never touched the catalog.
  const [rewards, setRewards] = useState<any[]>([]);
  const [memberPoints, setMemberPoints] = useState<number | null>(null);
  const [rewardPickerOpen, setRewardPickerOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<any>(null);

  useEffect(() => {
    loadProducts();
  }, [activeCategory]);

  useEffect(() => {
    api.get('/api/company').then((c: any) => {
      const co = c?.data || c;
      /**
       * THE RATE THE SERVER WILL CHARGE, not the column and not a default of our own. (T58)
       *
       * This read company.taxRate straight. `Number(null)` and `Number('')` are both a finite 0, so a
       * shop that had never typed a sales-tax rate was QUOTED 0% here while the server charged its
       * 8.75% fallback and recorded the order at that — the customer told one total and charged
       * another. The excise line had the same hole wearing a different guard: its default lived here
       * as 0.15, which only happened to match the server's.
       *
       * GET /api/company now resolves both through utils/tax.ts — the module that computes the charge
       * — so there is one answer. The raw columns stay as the fallback for a tenant whose API has not
       * been redeployed yet, so this screen is never worse than it was mid-rollout.
       */
      const resolved = (effective: any, column: any, fallback: number) => {
        const e = Number(effective);
        if (Number.isFinite(e)) return e / 100;
        const col = column != null && column !== '' ? Number(column) : NaN;
        return Number.isFinite(col) ? col / 100 : fallback;
      };
      setTaxRate(resolved(co?.effectiveTaxRate, co?.taxRate, 0));
      setExciseRate(resolved(co?.effectiveExciseTaxRate, co?.exciseTaxRate, 0.15));
      const lim = Number(co?.purchaseLimitOz);
      if (Number.isFinite(lim) && lim > 0) setWeightLimitOz(lim);
    }).catch(() => {});
    api.get('/api/loyalty/rewards').then((r: any) => {
      const list = Array.isArray(r) ? r : r?.data || [];
      setRewards(list.filter((x: any) => x.isActive !== false && x.active !== false));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (productSearch) loadProducts();
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  // Re-price the basket against the purchase limit whenever it changes, using the server's own
  // rules. Debounced, because it fires on every tap of a quantity button. A failure leaves the local
  // estimate showing rather than blanking the meter — an approximate number beats no number at a
  // till, and the server refuses the sale anyway if the estimate was wrong. (T45 M5)
  useEffect(() => {
    if (!cart.length) { setServerWeight(null); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      api.post('/api/equivalency/calculate', {
        items: cart.map(i => ({ productId: i.productId, quantity: i.quantity })),
      })
        .then((r: any) => { if (!cancelled) setServerWeight(r); })
        .catch(() => { if (!cancelled) setServerWeight(null); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [cart]);

  const loadProducts = async () => {
    setLoadingProducts(true);
    try {
      // Only what can actually be sold. An inactive product is one the shop has taken off the menu
      // — usually because it cannot be deleted, having been sold before — and the server refuses it
      // at the till anyway. Showing it on the grid means a budtender taps it in front of a customer
      // and gets a refusal for something that should never have been offered. (T47 P19)
      const params: any = { limit: 100, active: 'true' };
      if (productSearch) params.search = productSearch;
      if (activeCategory) params.category = activeCategory;
      const data = await api.get('/api/products', params);
      setProducts(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      setLoadingProducts(false);
    }
  };

  const searchCustomers = async (query: string) => {
    setCustomerSearch(query);
    if (query.length < 2) {
      setCustomerResults([]);
      return;
    }
    try {
      const data = await api.get('/api/contacts', { search: query, limit: 5 });
      setCustomerResults(Array.isArray(data) ? data : data?.data || []);
    } catch (err) {
      console.error('Customer search failed:', err);
    }
  };

  const selectCustomer = (c: any) => {
    setCustomer(c);
    setShowCustomerSearch(false);
    setCustomerSearch('');
    setCustomerResults([]);
    setLoyaltyApplied(false);
    setLoyaltyDiscount(0);
  };

  /**
   * THE CUSTOMER THE LINK CAME FROM. (T51)
   *
   * ContactDetailPage's "New Order" links to `/crm/orders/new?customerId=<id>`. The till ignored it
   * and opened with nobody attached, so the budtender had to search for the person whose record the
   * link had just been clicked on — and an order rung up without the customer attached is one that
   * never reaches their loyalty balance or their purchase history, which on a dispensary is also
   * the state-reporting trail.
   *
   * Fetched by id rather than trusting the URL to carry a name: the row has to come from the API
   * anyway for the loyalty balance and the medical-card check.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('customerId');
    if (!id) return;
    let cancelled = false;
    api.get(`/api/contacts/${id}`)
      .then((row: any) => { if (!cancelled && row?.id) selectCustomer(row?.data ?? row); })
      .catch(() => { /* a deleted or out-of-company id just leaves the till empty */ })
      .finally(() => {
        if (cancelled) return;
        const next = new URLSearchParams(searchParams); next.delete('customerId');
        setSearchParams(next, { replace: true });
      });
    return () => { cancelled = true };
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const addToCart = (product: any) => {
    const existingQty = cart.find(i => i.productId === product.id)?.quantity ?? 0;
    if (typeof product.stockQuantity === 'number' && existingQty + 1 > product.stockQuantity) {
      toast.error(`Only ${product.stockQuantity} of ${product.name} in stock`);
    }
    setCart(prev => {
      const existing = prev.find(i => i.productId === product.id);
      if (existing) {
        return prev.map(i =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          quantity: 1,
          // Per-unit weight in GRAMS. Seeded products carry weightGrams; older rows use
          // weight + weightUnit. Reading only weightOz/weight left this 0, so the limit
          // meter never moved. (retest#7)
          weight: Number(
            product.weightGrams != null && String(product.weightGrams) !== ''
              ? product.weightGrams
              : product.weight
                ? (product.weightUnit === 'oz' ? Number(product.weight) * 28.3495 : Number(product.weight))
                : 0
          ) || 0,
          category: product.category,
          taxCategory: product.taxCategory ?? null,
          strainType: product.strainType,
        },
      ];
    });
  };

  const updateQuantity = (itemId: string, delta: number) => {
    if (delta > 0) {
      const item = cart.find(i => i.id === itemId);
      const stock = item ? products.find(p => p.id === item.productId)?.stockQuantity : undefined;
      if (item && typeof stock === 'number' && item.quantity + delta > stock) {
        toast.error(`Only ${stock} of ${item.name} in stock`);
      }
    }
    setCart(prev =>
      prev
        .map(i => (i.id === itemId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i))
        .filter(i => i.quantity > 0)
    );
  };

  const removeItem = (itemId: string) => {
    setCart(prev => prev.filter(i => i.id !== itemId));
  };

  /**
   * An empty cart ends the sale, and the age check goes with it.
   *
   * T48 Q5: ID Verified was reset when a sale COMPLETED and nowhere else, so a cart emptied by
   * hand — the customer changes their mind, walks off, the budtender clears the items — left the
   * tick on. The next person's basket then started already verified, and the one control standing
   * between this shop and selling to a minor had been ticked for somebody else.
   *
   * On the empty-to-empty case nothing happens, because the effect keys on the LENGTH: a budtender
   * who ticks the box before scanning the first item keeps their tick.
   *
   * This is an effect rather than a line inside removeItem because there is more than one way to
   * empty a cart — remove the last item, decrement the last item to zero — and a rule about "the
   * sale is over" belongs where the state says so, not copied into each of them.
   */
  useEffect(() => {
    if (cart.length === 0) setIdVerified(false);
  }, [cart.length]);

  // Mirrors the backend math (orders.ts): excise on the cannabis share, sales tax on everything,
  // BOTH on the post-discount base (QA F-01 / F-07). The server's numbers are authoritative;
  // this only keeps the on-screen quote in step with what gets recorded.
  const CANNABIS_CATEGORIES = ['flower', 'pre_roll', 'preroll', 'edible', 'concentrate', 'vape', 'tincture'];
  const isCannabisItem = (i: CartItem) =>
    i.taxCategory === 'cannabis' || (i.taxCategory !== 'non_cannabis' && CANNABIS_CATEGORIES.includes(String(i.category || '').toLowerCase()));
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const cannabisSubtotal = cart.reduce((sum, i) => sum + (isCannabisItem(i) ? i.price * i.quantity : 0), 0);

  // Can this product be rung up at all? The server refuses a cannabis line whose weight in grams and
  // THC in milligrams are both unknown, because it cannot be counted against the purchase limit
  // (utils/cannabis.ts, uncountableCannabisLines). Ask the same question HERE so the refusal arrives
  // on the tile, not at the end of a basket. (Dispensary T31)
  const unitGramsOf = (p: any) => Number(
    p?.weightGrams != null && String(p.weightGrams) !== ''
      ? p.weightGrams
      : p?.weight ? (p.weightUnit === 'oz' ? Number(p.weight) * 28.3495 : Number(p.weight)) : 0
  ) || 0;
  const cannotBeSold = (p: any) =>
    (p?.taxCategory === 'cannabis' || (p?.taxCategory !== 'non_cannabis' && CANNABIS_CATEGORIES.includes(String(p?.category || '').toLowerCase())))
    && unitGramsOf(p) <= 0
    && !(Number(p?.thcMg) > 0);
  const discountAmount = loyaltyApplied ? Math.min(loyaltyDiscount, subtotal) : 0;
  const cannabisShare = subtotal > 0 ? cannabisSubtotal / subtotal : 0;
  const exciseAmount = round2(Math.max(0, cannabisSubtotal - discountAmount * cannabisShare) * exciseRate);
  const salesTaxAmount = round2(Math.max(0, subtotal - discountAmount) * taxRate);
  const taxAmount = round2(exciseAmount + salesTaxAmount);
  const total = round2(subtotal + taxAmount - discountAmount);
  const changeDue = paymentMethod === 'cash' && cashTendered ? parseFloat(cashTendered) - total : 0;

  // i.weight is per-unit GRAMS; the limit meter is in oz. Convert (g / 28.3495).
  // Categories must match the backend cannabis list or the meter under-counts.
  // The limit is written in FLOWER EQUIVALENT, and this summed raw grams — so a gram of concentrate
  // counted as one gram instead of the 2.5 the shop's own rules give it. The meter read 0.2 / 1 oz
  // while the server, which does apply the rules, refused the finished basket with "1.31oz exceeds
  // the 1oz maximum" — a refusal that arrives after the customer has been served. (T45 M5)
  //
  // Asked of the server rather than kept as a second copy of the rule engine: the rules are
  // per-tenant and per-category, and a copy in the browser is a copy that drifts. This local sum is
  // only what the meter shows until the first answer lands.
  const localWeightOz = cart.reduce((sum, i) => {
    if (['flower', 'pre_roll', 'edible', 'concentrate', 'vape', 'tincture'].includes(i.category)) {
      return sum + ((Number(i.weight) || 0) * i.quantity) / 28.3495;
    }
    return sum;
  }, 0);
  const totalWeightOz = serverWeight?.totalFlowerEquivalentOz ?? localWeightOz;
  const weightPercent = Math.min((totalWeightOz / WEIGHT_LIMIT_OZ) * 100, 100);
  const overWeight = totalWeightOz > WEIGHT_LIMIT_OZ;

  // Any cart line whose quantity exceeds the loaded product's stock. Blocks
  // Complete Sale so the cashier can't fire an order the server will reject
  // with a 400 "Insufficient stock" (the inline per-line warning shows which).
  const overStock = cart.some(i => {
    const stock = products.find(p => p.id === i.productId)?.stockQuantity;
    return typeof stock === 'number' && i.quantity > stock;
  });

  // Why Complete Sale is dead, in the cashier's words. The button greyed itself out and said
  // nothing: an over-limit basket turned the meter red and the sale simply stopped working, with
  // no title and no text anywhere on the panel. The server's refusal has always been clear —
  // it was just never reached, so nobody ever saw it. (T21 M5)
  const overStockLine = cart.find(i => {
    const stock = products.find(p => p.id === i.productId)?.stockQuantity;
    return typeof stock === 'number' && i.quantity > stock;
  });
  const blockReason = (() => {
    if (cart.length === 0) return '';
    // A line the rules cannot weigh is refused at completion by name; say so here instead of at the
    // end. (T45 M5)
    if (serverWeight?.uncountableError) return serverWeight.uncountableError;
    // The server's own wording when we have it, so the warning at the till and the refusal at
    // completion are the same sentence rather than two different numbers.
    if (overWeight) return serverWeight?.limitError
      || `Over the legal limit: ${Number(totalWeightOz).toFixed(2)} oz exceeds the ${WEIGHT_LIMIT_OZ} oz maximum. Remove items to continue.`;
    if (overStockLine) {
      const stock = products.find(p => p.id === overStockLine.productId)?.stockQuantity;
      return `Only ${stock} of ${overStockLine.name} in stock — the basket asks for ${overStockLine.quantity}.`;
    }
    if (!idVerified) return 'Check the customer’s ID and tick “ID Verified” to complete this sale.';
    return '';
  })();

  // Price a catalog reward against the current cart (mirrors the server — the server's number wins).
  const rewardValue = (r: any): { discount: number; problem?: string } => {
    const val = Number(r.discountValue || 0);
    const type = String(r.discountType || 'fixed');
    if (type === 'percent') {
      const cats: string[] = (Array.isArray(r.applicableCategories) ? r.applicableCategories : []).map((x: any) => String(x).toLowerCase());
      const base = cats.length
        ? cart.filter(i => cats.includes(String(i.category || '').toLowerCase())).reduce((s, i) => s + i.price * i.quantity, 0)
        : subtotal;
      if (cats.length && base <= 0) return { discount: 0, problem: `applies to ${cats.join('/')} items — none in cart` };
      return { discount: round2(base * val / 100) };
    }
    if (type === 'free_item') {
      const line = r.productId ? cart.find(i => i.productId === r.productId) : null;
      if (!line) return { discount: 0, problem: 'add the reward product to the cart first' };
      return { discount: round2(line.price) };
    }
    return { discount: round2(Math.min(val, subtotal)) };
  };

  const applyLoyalty = async () => {
    if (!customer) {
      toast.error('Select a customer first');
      return;
    }
    try {
      const data = await api.get('/api/loyalty/check', { phone: customer.phone || '' });
      if (!data.found) {
        toast.error('Customer is not enrolled in the loyalty program');
        return;
      }
      const balance = Number(data.points_balance || 0);
      setMemberPoints(balance);
      if (rewards.length > 0) {
        // Let the cashier pick from the configured Rewards catalog.
        if (!rewards.some(r => balance >= Number(r.pointsCost || r.pointsRequired || 0))) {
          const cheapest = Math.min(...rewards.map(r => Number(r.pointsCost || r.pointsRequired || 0)));
          toast.error(`No rewards available yet — ${balance} pts (cheapest reward is ${cheapest} pts)`);
          return;
        }
        setRewardPickerOpen(true);
        return;
      }
      // No catalog configured: fall back to the generic conversion ($1 per 100 pts, max 10% of subtotal).
      if (balance < 100) {
        toast.error('No rewards available (need at least 100 points)');
        return;
      }
      const maxDiscount = subtotal * 0.1;
      const pointsDiscount = Math.floor(balance / 100);
      const discount = Math.min(pointsDiscount, maxDiscount);
      setSelectedReward(null);
      setLoyaltyDiscount(discount);
      setLoyaltyApplied(true);
      toast.success(`Loyalty discount applied: $${Number(discount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${balance} pts)`);
    } catch (err: any) {
      toast.error(err.message || 'No rewards available');
    }
  };

  const chooseReward = (r: any) => {
    const cost = Number(r.pointsCost || r.pointsRequired || 0);
    if (memberPoints != null && memberPoints < cost) {
      toast.error(`Needs ${cost} pts — customer has ${memberPoints}`);
      return;
    }
    const { discount, problem } = rewardValue(r);
    if (problem) {
      toast.error(`${r.name}: ${problem}`);
      return;
    }
    setSelectedReward(r);
    setLoyaltyDiscount(discount);
    setLoyaltyApplied(true);
    setRewardPickerOpen(false);
    toast.success(`${r.name} applied: -$${discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} for ${cost} pts`);
  };

  const clearLoyalty = () => {
    setSelectedReward(null);
    setLoyaltyDiscount(0);
    setLoyaltyApplied(false);
    setRewardPickerOpen(false);
  };

  // Keep the banner honest. The queue is flushed by src/offline/register.ts on reconnect; this
  // only watches, so a cashier can see the count go down rather than wonder. (T45 H17)
  useEffect(() => {
    const sync = () => { setOnline(isOnline()); setQueued(pendingCount()); };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    const timer = window.setInterval(sync, 5000);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      clearInterval(timer);
    };
  }, []);

  // …and honest about what the sync actually did. A held sale is now re-run through the real
  // checkout when it reaches the server, so it can be refused — for an underage customer, an
  // over-limit basket, a closed drawer — or go through at the catalogue price rather than the one
  // taken at the till. Either way the cashier is told at the till; the manager sees it under
  // Offline Mode → Queue. It used to empty silently. (T46 N1)
  useEffect(() => {
    const onResult = (e: Event) => {
      const r = (e as CustomEvent).detail || {};
      for (const ref of r.refused || []) {
        toast.error(`A held sale was refused on sync: ${ref.reason}`, 15000);
      }
      for (const rp of r.repriced || []) {
        toast.error(`${rp.orderNumber} took $${rp.tookAtTill} at the till but rings up at $${rp.chargedOnSync}. Check the drawer.`, 15000);
      }
      setQueued(pendingCount());
    };
    window.addEventListener(OFFLINE_SYNC_EVENT, onResult);
    return () => window.removeEventListener(OFFLINE_SYNC_EVENT, onResult);
  }, [toast]);

  const completeOrder = async () => {
    if (!idVerified) {
      toast.error('ID must be verified before completing sale');
      return;
    }
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    if (overWeight) {
      toast.error('Order exceeds weight limit');
      return;
    }
    if (paymentMethod === 'cash' && parseFloat(cashTendered || '0') < total) {
      toast.error('Insufficient cash tendered');
      return;
    }

    setProcessing(true);
    try {
      // Reuse the held ticket rather than raising another one. (T45 M6)
      const created: any = pendingOrderId ? { id: pendingOrderId } : await api.post('/api/orders', {
        contactId: customer?.id || null,
        items: cart.map(i => ({
          productId: i.productId,
          quantity: i.quantity,
          priceOverride: i.price,
        })),
        type: 'walk_in',
        paymentMethod,
        idVerified,
        // The register's only discount is loyalty-funded and is expressed as the points
        // redeemed (server converts 100 pts = $1). Sending it AGAIN as discountAmount made
        // the server apply it twice (loyalty + "manager" discount). (QA discount audit)
        discountAmount: 0,
        // A catalog reward is redeemed by id (server prices it + charges its pointsCost);
        // the generic fallback still sends points at 100 pts = $1.
        loyaltyRewardId: loyaltyApplied && selectedReward ? selectedReward.id : undefined,
        loyaltyPointsRedeemed: loyaltyApplied
          ? (selectedReward ? Number(selectedReward.pointsCost || selectedReward.pointsRequired || 0) : Math.round(discountAmount * 100))
          : 0,
      });
      // Settle the sale immediately. Creating the order alone left it 'pending':
      // stock never decremented (B2), paymentStatus stayed pending (B6), the tender
      // lived only in a note (N2) and no loyalty was awarded (M5). /complete does all
      // four in one transaction.
      const orderId = created?.id || created?.data?.id;
      if (orderId) {
        // Held from here on: if /complete throws, the retry settles THIS order rather than raising
        // a second one beside it. (T45 M6)
        setPendingOrderId(orderId);
        await api.post(`/api/orders/${orderId}/complete`, {
          paymentMethod,
          cashTendered: paymentMethod === 'cash' ? parseFloat(cashTendered || '0') : undefined,
          idVerified,
        });
      }
      setPendingOrderId(null);
      toast.success('Order completed!');
      // The sale just moved the shelf. The tiles kept the counts loaded when the page opened, so
      // after selling 8 of 40 the grid still read "40 left" and the next customer was rung up
      // against a number that no longer existed. Re-read the catalog. (T21 M6)
      loadProducts();
      // Reset
      setCart([]);
      setCustomer(null);
      setCashTendered('');
      setIdVerified(false);
      setLoyaltyApplied(false);
      setLoyaltyDiscount(0);
      setSelectedReward(null);
      setMemberPoints(null);
      searchRef.current?.focus();
    } catch (err: any) {
      // A DROPPED CONNECTION is not a refused sale.
      //
      // The customer is standing there and the product is in their hand; refusing to record it
      // loses the money and loses a regulated transaction the state expects to see. So when the
      // network is what failed — and only then — the sale is held locally and replayed to
      // /api/offline/sync the moment the connection returns, where the server re-checks it
      // against live stock and limits before committing anything. A 400 means the sale is wrong
      // and is still refused here, exactly as before. (T45 H17)
      if (!pendingOrderId && isNetworkFailure(err)) {
        const held = enqueue({
          transactionType: 'order',
          locationId: (user as any)?.locationId || 'default',
          payload: {
            type: 'walk_in',
            status: 'completed',
            contactId: customer?.id || null,
            customerName: customer?.name || null,
            paymentMethod,
            paymentStatus: 'paid',
            idVerified,
            subtotal: subtotal.toFixed(2),
            exciseTax: exciseAmount.toFixed(2),
            salesTax: salesTaxAmount.toFixed(2),
            totalTax: taxAmount.toFixed(2),
            total: total.toFixed(2),
            items: cart.map(i => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.price })),
            notes: 'Rung up while offline',
          },
        });
        if (held) {
          setQueued(pendingCount());
          toast.success(`No connection — the sale is held and will be sent when you are back online (${pendingCount()} waiting)`);
          setCart([]);
          setCustomer(null);
          setCashTendered('');
          setIdVerified(false);
          setLoyaltyApplied(false);
          setLoyaltyDiscount(0);
          setSelectedReward(null);
          setMemberPoints(null);
          searchRef.current?.focus();
          return;
        }
        toast.error('No connection, and the offline queue is full. Write this sale down before clearing it.');
        return;
      }
      // Say which ticket is being held, or the operator cannot tell why the next press behaves
      // differently — and cannot find the order to void it.
      toast.error((err.message || 'Failed to complete order') + (pendingOrderId ? ' — the ticket is held; Checkout will finish this same order.' : ''));
    } finally {
      setProcessing(false);
    }
  };

  // The negative margin cancels the layout's own padding so the till runs edge to edge — but that
  // padding is `p-4 lg:p-6`, so a flat -m-6 pulled 8px past the viewport on both sides below lg.
  // Measured at 820px: scrollWidth 828 against a 820px viewport. The margin now matches. (T41)
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -m-4 lg:-m-6 gap-0">
      {/* A cashier has to be able to see that the till is off the network, and that sales are
          being held rather than sent. Without this the register looks normal right up until
          someone asks where the day's takings went. (T45 H17) */}
      {(!online || queued > 0) && (
        <div className={`px-4 py-2 text-sm font-medium flex items-center gap-2 ${online ? 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {online
            ? `Back online — sending ${queued} held ${queued === 1 ? 'sale' : 'sales'}…`
            : `No connection. Sales are being held on this till${queued > 0 ? ` (${queued} waiting)` : ''} and will be sent when you are back online.`}
        </div>
      )}
      {/* THE TILL WAS UNUSABLE ON A PHONE. (T41)
          "POS unusable at 390px (product panel about 14px wide)."
          The cart was a fixed w-96 — 384px — beside a flex-1 product panel, so on a 390px screen
          the cart took the whole width and the products got the 6px left over. Below lg the two
          panels now stack: products above with the space the cart does not need, cart below with
          its own scroll. */}
      <div className="flex flex-col lg:flex-row flex-1 gap-0 overflow-hidden">
      {/* LEFT: Product Grid */}
      <div className="flex-1 min-h-0 flex flex-col bg-gray-50 border-b lg:border-b-0 lg:border-r overflow-hidden dark:bg-slate-900">
        {/* Category Tabs */}
        <div className="flex gap-1 p-3 overflow-x-auto bg-white border-b dark:bg-slate-900">
          {categories.map(cat => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeCategory === cat.value
                  ? 'bg-green-700 text-white'
                  : 'text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="p-3 bg-white border-b dark:bg-slate-900">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search products..."
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 text-sm dark:border-slate-700 dark:text-slate-100"
            />
          </div>
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {loadingProducts ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {products.map(product => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={product.stockQuantity <= 0 || cannotBeSold(product)}
                  title={cannotBeSold(product) ? 'No weight or THC mg recorded, so this cannot be counted against the purchase limit. Set one in Products.' : undefined}
                  className={`p-3 rounded-lg text-left transition-all ${
                    product.stockQuantity <= 0 || cannotBeSold(product)
                      ? 'bg-gray-100 opacity-50 cursor-not-allowed dark:bg-slate-800'
                      : 'bg-white hover:shadow-md hover:border-green-300 border border-gray-200 dark:bg-slate-800 dark:border-slate-700'
                  }`}
                >
                  <p className="font-medium text-gray-900 text-sm truncate dark:text-slate-100">{product.name}</p>
                  {cannotBeSold(product) && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">Needs a weight or THC mg</p>
                  )}
                  <div className="flex items-center gap-1 mt-1">
                    {product.strainType && product.strainType !== 'na' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        product.strainType === 'sativa' ? 'bg-orange-100 text-orange-700 dark:text-orange-300 dark:bg-orange-950/40' :
                        product.strainType === 'indica' ? 'bg-purple-100 text-purple-700 dark:text-purple-300 dark:bg-purple-950/40' :
                        product.strainType === 'cbd' ? 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40' :
                        'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40'
                      }`}>
                        {product.strainType}
                      </span>
                    )}
                    {product.thcPercent != null && (
                      <span className="text-xs text-gray-500 dark:text-slate-400">{product.thcPercent}%</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-semibold text-green-700 dark:text-green-300">${Number(product.price).toFixed(2)}</span>
                    <span className={`text-xs ${product.stockQuantity <= 5 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-slate-400'}`}>
                      {product.stockQuantity} left
                    </span>
                  </div>
                </button>
              ))}
              {products.length === 0 && (
                <p className="col-span-full text-center text-gray-500 py-8 dark:text-slate-400">No products found</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Cart (BELOW the products on a phone — see the note on the split above) */}
      <div className="w-full lg:w-96 flex-shrink-0 max-h-[55%] overflow-y-auto lg:max-h-none lg:overflow-visible flex flex-col bg-white dark:bg-slate-900">
        {/* Customer */}
        <div className="p-4 border-b">
          {customer ? (
            <div className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2 dark:bg-green-950/30">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-green-700 dark:text-green-300" />
                <div>
                  <p className="font-medium text-gray-900 text-sm dark:text-slate-100">{customer.name}</p>
                  {/* The chip said the tier and stopped, so the one number a budtender needs at the till —
                      can this customer actually redeem anything — was not on the screen they are looking at.
                      The contacts list has enriched each row with loyaltyPoints since the Customers page
                      needed it; the register just never read it. (Dispensary T28 L-f)
                      green-600 on green-50 is 3.16:1, under the 4.5:1 this 12px label needs; green-700 is
                      4.80:1 on the same ground. The chip had no dark partner either. */}
                  {(customer.loyaltyTier || customer.loyaltyPoints != null) && (
                    <span className="text-xs text-green-700 dark:text-green-300">
                      {customer.loyaltyTier ? `${customer.loyaltyTier} member` : 'Member'}
                      {customer.loyaltyPoints != null && ` · ${Number(customer.loyaltyPoints).toLocaleString()} pts`}
                    </span>
                  )}
                </div>
              </div>
              <button aria-label="Clear customer" onClick={() => { setCustomer(null); setLoyaltyApplied(false); setLoyaltyDiscount(0); }} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowCustomerSearch(!showCustomerSearch)}
                className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-green-400 hover:text-green-600 dark:hover:text-green-300 flex items-center gap-2 dark:border-slate-700 dark:text-slate-400"
              >
                <User className="w-4 h-4" /> Add Customer (optional)
              </button>
              {showCustomerSearch && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-10 p-2 dark:bg-slate-900">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search by name or phone..."
                    value={customerSearch}
                    onChange={(e) => searchCustomers(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
                  />
                  {customerResults.length > 0 && (
                    <div className="mt-1 divide-y max-h-40 overflow-y-auto">
                      {customerResults.map(c => (
                        <button
                          key={c.id}
                          onClick={() => selectCustomer(c)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 text-sm"
                        >
                          <p className="font-medium text-gray-900 dark:text-slate-100">{c.name}</p>
                          <p className="text-xs text-gray-500 dark:text-slate-400">{c.phone || c.email || ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Weight Limit Bar */}
        <div className="px-4 py-2 border-b">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500 dark:text-slate-400">Weight Limit</span>
            <span className={`text-xs font-medium ${overWeight ? 'text-red-600 dark:text-red-300' : 'text-gray-700 dark:text-slate-200'}`}>
              {Number(totalWeightOz).toFixed(1)} / {WEIGHT_LIMIT_OZ} oz
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-slate-700 dark:text-slate-100">
            <div
              className={`h-2 rounded-full transition-all ${
                overWeight ? 'bg-red-500' : weightPercent > 80 ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(weightPercent, 100)}%` }}
            />
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {cart.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-slate-400 py-8 text-sm">Cart is empty</p>
          ) : (
            cart.map(item => {
              // Available stock for this line's product (looked up from the loaded
              // catalog — CartItem doesn't carry stock). When the cart quantity
              // exceeds it, flag the line so the cashier isn't blindsided by the
              // server rejecting the whole order at Complete Sale.
              const stock = products.find(p => p.id === item.productId)?.stockQuantity;
              const overStock = typeof stock === 'number' && item.quantity > stock;
              return (
              <div key={item.id} className="flex flex-wrap items-center gap-3 p-2 rounded-lg bg-gray-50 dark:bg-slate-900">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate dark:text-slate-100">{item.name}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">${Number(item.price).toFixed(2)} ea</p>
                </div>
                <div className="flex items-center gap-1">
                  <button aria-label="Decrease quantity"
                    onClick={() => updateQuantity(item.id, -1)}
                    className="w-7 h-7 rounded-full bg-white border flex items-center justify-center hover:bg-gray-100 dark:hover:bg-slate-800 dark:bg-slate-900"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-8 text-center font-medium text-sm">{item.quantity}</span>
                  <button aria-label="Increase quantity"
                    onClick={() => updateQuantity(item.id, 1)}
                    className="w-7 h-7 rounded-full bg-white border flex items-center justify-center hover:bg-gray-100 dark:hover:bg-slate-800 dark:bg-slate-900"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <span className="font-medium text-gray-900 text-sm w-16 text-right dark:text-slate-100">
                  ${Number(item.price * item.quantity).toFixed(2)}
                </span>
                <button aria-label="Remove from cart" onClick={() => removeItem(item.id)} className="text-gray-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-300">
                  <Trash2 className="w-4 h-4" />
                </button>
                {overStock && (
                  <p className="w-full text-xs font-medium text-red-700 dark:text-red-300">
                    Only {stock} in stock — exceeds available
                  </p>
                )}
              </div>
              );
            })
          )}
        </div>

        {/* Totals */}
        <div className="border-t p-4 space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-gray-600 dark:text-slate-400">
              <span>Subtotal</span>
              <span>${Number(subtotal).toFixed(2)}</span>
            </div>
            {loyaltyApplied && discountAmount > 0 && (
              <div className="flex justify-between text-green-700 dark:text-green-300">
                <span>
                  {selectedReward ? `${selectedReward.name} (${Number(selectedReward.pointsCost || selectedReward.pointsRequired || 0)} pts)` : 'Loyalty Discount'}
                  <button onClick={clearLoyalty} className="ml-2 text-xs text-gray-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-300" title="Remove reward">✕</button>
                </span>
                <span>-${Number(discountAmount).toFixed(2)}</span>
              </div>
            )}
            {cannabisSubtotal > 0 && (
              <div className="flex justify-between text-gray-600 dark:text-slate-400">
                <span>Excise Tax ({Number(exciseRate * 100).toFixed(exciseRate * 100 % 1 ? 1 : 0)}%)</span>
                <span>${Number(exciseAmount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-gray-600 dark:text-slate-400">
              <span>Sales Tax ({Number(taxRate * 100).toFixed(taxRate * 100 % 1 ? 1 : 0)}%)</span>
              <span>${Number(salesTaxAmount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg text-gray-900 pt-1 border-t dark:text-slate-100">
              <span>Total</span>
              <span>${Number(total).toFixed(2)}</span>
            </div>
          </div>

          {/* Loyalty */}
          {customer && !loyaltyApplied && !rewardPickerOpen && (
            <button
              onClick={applyLoyalty}
              className="w-full px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-sm font-medium hover:bg-amber-100 flex items-center justify-center gap-2 dark:text-amber-300 dark:bg-amber-950/40"
            >
              <Gift className="w-4 h-4" /> {rewards.length ? 'Redeem a Reward' : 'Apply Loyalty Reward'}
            </button>
          )}
          {rewardPickerOpen && (
            <div className="border border-amber-200 rounded-lg bg-amber-50 p-2 space-y-1 dark:bg-slate-800 dark:border-slate-700">
              <div className="flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 px-1">
                <span>Rewards · {memberPoints ?? 0} pts available</span>
                <button onClick={() => setRewardPickerOpen(false)} className="text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200">Cancel</button>
              </div>
              {rewards.map(r => {
                const cost = Number(r.pointsCost || r.pointsRequired || 0);
                const { discount, problem } = rewardValue(r);
                const affordable = memberPoints == null || memberPoints >= cost;
                const disabled = !affordable || !!problem;
                return (
                  <button
                    key={r.id}
                    onClick={() => chooseReward(r)}
                    disabled={disabled}
                    title={problem || (!affordable ? `Needs ${cost} pts` : '')}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between ${
                      disabled ? 'bg-white/60 text-gray-400 cursor-not-allowed dark:bg-slate-900/40' : 'bg-white hover:bg-amber-100 text-gray-900 dark:bg-slate-900 dark:text-slate-100'
                    }`}
                  >
                    <span>
                      <span className="font-medium">{r.name}</span>
                      <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">{cost} pts</span>
                      {problem && <span className="ml-2 text-xs text-red-500 dark:text-red-400">{problem}</span>}
                    </span>
                    <span className="text-green-700 font-medium dark:text-green-300">{problem ? '' : `-$${discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Payment Method */}
          <div className="flex gap-2">
            <button
              onClick={() => setPaymentMethod('cash')}
              className={`flex-1 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
                paymentMethod === 'cash'
                  ? 'bg-green-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <Banknote className="w-4 h-4" /> Cash
            </button>
            <button
              onClick={() => setPaymentMethod('debit')}
              className={`flex-1 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-colors ${
                paymentMethod === 'debit'
                  ? 'bg-green-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              <CreditCard className="w-4 h-4" /> Debit
            </button>
          </div>

          {/* Cash Tendered */}
          {paymentMethod === 'cash' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">Cash Tendered</label>
              <input
                type="number"
                step="0.01"
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:border-slate-700 dark:text-slate-100"
                placeholder="0.00"
              />
              {parseFloat(cashTendered || '0') >= total && total > 0 && (
                <p className="text-sm text-green-700 mt-1 font-medium dark:text-green-300">
                  Change: ${Number(changeDue).toFixed(2)}
                </p>
              )}
            </div>
          )}

          {/* ID Verified.

              T48 Q16: the <label> was a flex row with no width limit, so it spanned the whole cart
              panel and every stray tap in that band toggled the age check. The tester's withdrawn
              M6 was exactly this — a click aimed at a toast's close button landed on the row and
              cleared the tick, and it looked like the software had done it. `w-fit` means only the
              box and its own words are clickable. */}
          <label className="flex w-fit items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={idVerified}
              onChange={(e) => setIdVerified(e.target.checked)}
              className="w-4 h-4 text-green-700 border-gray-300 rounded focus:ring-green-500 dark:border-slate-700 dark:text-green-300"
            />
            <ShieldCheck className="w-4 h-4 text-gray-500 dark:text-slate-400" />
            <span className="text-sm text-gray-700 dark:text-slate-200">ID Verified (21+)</span>
          </label>

          {/* Why the sale cannot go through, said out loud rather than left to a grey button. (T21 M5) */}
          {blockReason && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 flex items-start gap-1.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{blockReason}</span>
            </p>
          )}

          {/* Complete */}
          <button
            onClick={completeOrder}
            title={blockReason || undefined}
            disabled={processing || cart.length === 0 || !idVerified || overWeight || overStock}
            className={`w-full py-3 rounded-lg font-bold text-lg flex items-center justify-center gap-2 transition-colors ${
              processing || cart.length === 0 || !idVerified || overWeight || overStock
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed dark:text-slate-300 dark:bg-slate-700'
                : 'bg-green-700 text-white hover:bg-green-800'
            } dark:text-slate-400`}
          >
            <Check className="w-5 h-5" />
            {processing ? 'Processing...' : 'Complete Sale'}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
