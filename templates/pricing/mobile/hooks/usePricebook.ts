import { useState, useEffect, useCallback } from 'react';
import { query } from '@/lib/db';
import { apiFetch } from '@/lib/api';
import NetInfo from '@react-native-community/netinfo';

interface Category {
  id: string;
  name: string;
  icon: string | null;
  sort_order: number;
  mode: string;
}

interface Product {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  mode: string;
  measurement_type: string | null;
  measurement_unit: string | null;
  default_waste_factor: number | null;
  labor_rate: number | null;
  labor_unit: string | null;
  setup_fee: number | null;
  minimum_charge: number | null;
  pitch_adjustable: number;
  image_url: string | null;
  sort_order: number;
  active: number;
}

interface Tier {
  id: string;
  product_id: string;
  tier: string;
  base_price: number | null;
  material_name: string | null;
  material_cost_per_unit: number | null;
  warranty_years: number | null;
  features: string | null;
}

interface PriceRange {
  id: string;
  product_id: string;
  min_value: number;
  max_value: number;
  par_price: number;
  retail_price: number;
  yr1_markup_pct: number;
  day30_markup_pct: number;
  today_discount_pct: number;
}

interface Addon {
  id: string;
  product_id: string;
  group_name: string | null;
  name: string;
  description: string | null;
  pricing_type: string;
  price: number;
  unit: string | null;
  required: number;
  default_selected: number;
  sort_order: number;
  image_url: string | null;
  depends_on_addon_id: string | null;
}

interface UsePricebookReturn {
  categories: Category[];
  products: Product[];
  tiers: Tier[];
  priceRanges: PriceRange[];
  addons: Addon[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  getProductsByCategory: (categoryId: string) => Product[];
  getProductsByMode: (mode: string) => Product[];
  getTiersByProduct: (productId: string) => Tier[];
  getPriceRangesForProduct: (productId: string) => PriceRange[];
  getAddonsForProduct: (productId: string) => Addon[];
}

export function usePricebook(mode?: string): UsePricebookReturn {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [priceRanges, setPriceRanges] = useState<PriceRange[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFromSQLite = useCallback(() => {
    try {
      const modeFilter = mode ? ` WHERE mode = '${mode}'` : '';
      setCategories(query(`SELECT * FROM categories${modeFilter} ORDER BY sort_order`));
      setProducts(
        query(
          `SELECT * FROM products WHERE active = 1${mode ? ` AND mode = '${mode}'` : ''} ORDER BY sort_order`
        )
      );
      setTiers(query('SELECT * FROM tiers'));
      setPriceRanges(query('SELECT * FROM price_ranges'));
      setAddons(query('SELECT * FROM addons ORDER BY sort_order'));
    } catch {
      // Tables may not exist yet
    }
  }, [mode]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Load from local first
    loadFromSQLite();

    // Then try to refresh from API
    const netState = await NetInfo.fetch();
    if (netState.isConnected && netState.isInternetReachable) {
      try {
        const [catData, prodData, tierData, prData, addonData] = await Promise.all([
          apiFetch<Category[]>('/api/categories'),
          apiFetch<Product[]>('/api/products'),
          apiFetch<Tier[]>('/api/tiers'),
          apiFetch<PriceRange[]>('/api/price-ranges'),
          apiFetch<Addon[]>('/api/addons'),
        ]);

        if (Array.isArray(catData)) setCategories(mode ? catData.filter((c) => c.mode === mode) : catData);
        if (Array.isArray(prodData)) setProducts(mode ? prodData.filter((p) => p.mode === mode && p.active) : prodData.filter((p) => p.active));
        if (Array.isArray(tierData)) setTiers(tierData);
        if (Array.isArray(prData)) setPriceRanges(prData);
        if (Array.isArray(addonData)) setAddons(addonData);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to refresh';
        setError(msg);
      }
    }

    setLoading(false);
  }, [mode, loadFromSQLite]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const getProductsByCategory = useCallback(
    (categoryId: string) => products.filter((p) => p.category_id === categoryId),
    [products]
  );

  const getProductsByMode = useCallback(
    (m: string) => products.filter((p) => p.mode === m),
    [products]
  );

  const getTiersByProduct = useCallback(
    (productId: string) => tiers.filter((t) => t.product_id === productId),
    [tiers]
  );

  const getPriceRangesForProduct = useCallback(
    (productId: string) => priceRanges.filter((pr) => pr.product_id === productId),
    [priceRanges]
  );

  const getAddonsForProduct = useCallback(
    (productId: string) => addons.filter((a) => a.product_id === productId),
    [addons]
  );

  return {
    categories,
    products,
    tiers,
    priceRanges,
    addons,
    loading,
    error,
    refresh,
    getProductsByCategory,
    getProductsByMode,
    getTiersByProduct,
    getPriceRangesForProduct,
    getAddonsForProduct,
  };
}
