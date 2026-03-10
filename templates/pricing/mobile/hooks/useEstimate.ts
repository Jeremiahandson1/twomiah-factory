import { useState, useCallback, useEffect } from 'react';
import * as Crypto from 'expo-crypto';
import { insert, update, getById, query } from '@/lib/db';

interface Measurement {
  length: number;
  width: number;
  area: number;
  pitch: string;
  waste_factor: number;
}

interface EstimateLineItem {
  id: string;
  product_id: string;
  product_name: string;
  measurement: Measurement;
  tier: string;
  material_cost: number;
  labor_cost: number;
  setup_fee: number;
  addons: SelectedAddon[];
  line_total: number;
}

interface SelectedAddon {
  addon_id: string;
  name: string;
  price: number;
  quantity: number;
}

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  address: string;
  state: string;
  referral_source: string;
  referral_name: string;
}

interface TierBreakdown {
  tier: string;
  material_cost: number;
  labor_cost: number;
  addon_cost: number;
  setup_fee: number;
  total: number;
}

interface Estimate {
  id: string;
  local_id: string;
  customer: CustomerInfo;
  mode: string;
  lines: EstimateLineItem[];
  selected_tier: string;
  tier_breakdowns: TierBreakdown[];
  subtotal: number;
  discount_amount: number;
  total_price: number;
  status: string;
  notes: string;
  signature_data: string | null;
  rep_signature_data: string | null;
  contract_hash: string | null;
  created_at: string;
  updated_at: string;
}

interface UseEstimateReturn {
  estimate: Estimate | null;
  loading: boolean;
  createEstimate: () => Promise<string>;
  loadEstimate: (id: string) => void;
  setCustomer: (info: Partial<CustomerInfo>) => void;
  addLine: (line: Omit<EstimateLineItem, 'id'>) => void;
  removeLine: (lineId: string) => void;
  updateLine: (lineId: string, updates: Partial<EstimateLineItem>) => void;
  updateMeasurement: (lineId: string, measurement: Partial<Measurement>) => void;
  selectTier: (tier: string) => void;
  setDiscount: (amount: number) => void;
  setNotes: (notes: string) => void;
  setSignature: (data: string) => void;
  setRepSignature: (data: string) => void;
  setStatus: (status: string) => void;
  calculateEstimate: () => void;
  save: () => void;
}

export function useEstimate(): UseEstimateReturn {
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [loading, setLoading] = useState(false);

  const generateId = async (): Promise<string> => {
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${Date.now()}-${Math.random()}`
    );
    return hash.substring(0, 24);
  };

  const save = useCallback(() => {
    if (!estimate) return;

    const now = new Date().toISOString();
    const dbData = {
      id: estimate.id,
      local_id: estimate.local_id,
      server_synced: 0,
      customer_name: estimate.customer.name,
      customer_email: estimate.customer.email,
      customer_phone: estimate.customer.phone,
      address: estimate.customer.address,
      customer_state: estimate.customer.state,
      referral_source: estimate.customer.referral_source,
      referral_name: estimate.customer.referral_name,
      status: estimate.status,
      mode: 'estimator',
      line_items: JSON.stringify(estimate.lines),
      selected_tier: estimate.selected_tier,
      subtotal: estimate.subtotal,
      discount_amount: estimate.discount_amount,
      total_price: estimate.total_price,
      signature_data: estimate.signature_data,
      rep_signature_data: estimate.rep_signature_data,
      contract_hash: estimate.contract_hash,
      notes: estimate.notes,
      created_at: estimate.created_at,
      updated_at: now,
    };

    const existing = getById('quotes', estimate.id);
    if (existing) {
      update('quotes', estimate.id, dbData);
    } else {
      insert('quotes', dbData);
    }
  }, [estimate]);

  useEffect(() => {
    if (estimate) save();
  }, [estimate, save]);

  const getPitchMultiplier = (pitch: string): number => {
    const results = query('SELECT multiplier FROM pitch_multipliers WHERE pitch = ?', [pitch]);
    return results.length > 0 ? results[0].multiplier : 1.0;
  };

  const calculateLineTotal = (line: EstimateLineItem): number => {
    const pitchMultiplier = getPitchMultiplier(line.measurement.pitch);
    const effectiveArea =
      line.measurement.area * (1 + line.measurement.waste_factor / 100) * pitchMultiplier;
    const addonTotal = line.addons.reduce((sum, a) => sum + a.price * a.quantity, 0);
    return line.material_cost * effectiveArea + line.labor_cost * effectiveArea + line.setup_fee + addonTotal;
  };

  const createEstimate = useCallback(async (): Promise<string> => {
    const id = await generateId();
    const localId = `local_${id}`;
    const now = new Date().toISOString();

    const newEstimate: Estimate = {
      id,
      local_id: localId,
      customer: {
        name: '',
        email: '',
        phone: '',
        address: '',
        state: '',
        referral_source: '',
        referral_name: '',
      },
      mode: 'estimator',
      lines: [],
      selected_tier: 'best',
      tier_breakdowns: [],
      subtotal: 0,
      discount_amount: 0,
      total_price: 0,
      status: 'draft',
      notes: '',
      signature_data: null,
      rep_signature_data: null,
      contract_hash: null,
      created_at: now,
      updated_at: now,
    };

    setEstimate(newEstimate);
    return id;
  }, []);

  const loadEstimate = useCallback((id: string) => {
    setLoading(true);
    const row = getById('quotes', id);
    if (row) {
      setEstimate({
        id: row.id,
        local_id: row.local_id,
        customer: {
          name: row.customer_name || '',
          email: row.customer_email || '',
          phone: row.customer_phone || '',
          address: row.address || '',
          state: row.customer_state || '',
          referral_source: row.referral_source || '',
          referral_name: row.referral_name || '',
        },
        mode: 'estimator',
        lines: row.line_items ? JSON.parse(row.line_items) : [],
        selected_tier: row.selected_tier || 'best',
        tier_breakdowns: [],
        subtotal: row.subtotal || 0,
        discount_amount: row.discount_amount || 0,
        total_price: row.total_price || 0,
        status: row.status || 'draft',
        notes: row.notes || '',
        signature_data: row.signature_data,
        rep_signature_data: row.rep_signature_data,
        contract_hash: row.contract_hash,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }
    setLoading(false);
  }, []);

  const setCustomer = useCallback((info: Partial<CustomerInfo>) => {
    setEstimate((prev) => {
      if (!prev) return prev;
      return { ...prev, customer: { ...prev.customer, ...info } };
    });
  }, []);

  const addLine = useCallback(async (line: Omit<EstimateLineItem, 'id'>) => {
    const id = await generateId();
    setEstimate((prev) => {
      if (!prev) return prev;
      const newLine: EstimateLineItem = { ...line, id };
      newLine.line_total = calculateLineTotal(newLine);
      const lines = [...prev.lines, newLine];
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      const total_price = subtotal - prev.discount_amount;
      return { ...prev, lines, subtotal, total_price };
    });
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setEstimate((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.filter((l) => l.id !== lineId);
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      const total_price = subtotal - prev.discount_amount;
      return { ...prev, lines, subtotal, total_price };
    });
  }, []);

  const updateLine = useCallback((lineId: string, updates: Partial<EstimateLineItem>) => {
    setEstimate((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l) => {
        if (l.id !== lineId) return l;
        const updated = { ...l, ...updates };
        updated.line_total = calculateLineTotal(updated);
        return updated;
      });
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      const total_price = subtotal - prev.discount_amount;
      return { ...prev, lines, subtotal, total_price };
    });
  }, []);

  const updateMeasurement = useCallback(
    (lineId: string, measurement: Partial<Measurement>) => {
      setEstimate((prev) => {
        if (!prev) return prev;
        const lines = prev.lines.map((l) => {
          if (l.id !== lineId) return l;
          const updatedMeasurement = { ...l.measurement, ...measurement };
          if (measurement.length !== undefined || measurement.width !== undefined) {
            updatedMeasurement.area =
              (measurement.length ?? l.measurement.length) *
              (measurement.width ?? l.measurement.width);
          }
          const updated = { ...l, measurement: updatedMeasurement };
          updated.line_total = calculateLineTotal(updated);
          return updated;
        });
        const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
        const total_price = subtotal - prev.discount_amount;
        return { ...prev, lines, subtotal, total_price };
      });
    },
    []
  );

  const selectTier = useCallback((tier: string) => {
    setEstimate((prev) => (prev ? { ...prev, selected_tier: tier } : prev));
  }, []);

  const setDiscount = useCallback((amount: number) => {
    setEstimate((prev) => {
      if (!prev) return prev;
      return { ...prev, discount_amount: amount, total_price: prev.subtotal - amount };
    });
  }, []);

  const setNotes = useCallback((notes: string) => {
    setEstimate((prev) => (prev ? { ...prev, notes } : prev));
  }, []);

  const setSignature = useCallback((data: string) => {
    setEstimate((prev) => (prev ? { ...prev, signature_data: data } : prev));
  }, []);

  const setRepSignature = useCallback((data: string) => {
    setEstimate((prev) => (prev ? { ...prev, rep_signature_data: data } : prev));
  }, []);

  const setStatus = useCallback((status: string) => {
    setEstimate((prev) => (prev ? { ...prev, status } : prev));
  }, []);

  const calculateEstimate = useCallback(() => {
    setEstimate((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l) => ({
        ...l,
        line_total: calculateLineTotal(l),
      }));
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      const total_price = subtotal - prev.discount_amount;

      const tierNames = ['good', 'better', 'best'];
      const tier_breakdowns: TierBreakdown[] = tierNames.map((tierName) => {
        let materialCost = 0;
        let laborCost = 0;
        let addonCost = 0;
        let setupFee = 0;
        for (const line of lines) {
          const pitchMultiplier = getPitchMultiplier(line.measurement.pitch);
          const effectiveArea =
            line.measurement.area *
            (1 + line.measurement.waste_factor / 100) *
            pitchMultiplier;
          materialCost += line.material_cost * effectiveArea;
          laborCost += line.labor_cost * effectiveArea;
          addonCost += line.addons.reduce((sum, a) => sum + a.price * a.quantity, 0);
          setupFee += line.setup_fee;
        }
        return {
          tier: tierName,
          material_cost: materialCost,
          labor_cost: laborCost,
          addon_cost: addonCost,
          setup_fee: setupFee,
          total: materialCost + laborCost + addonCost + setupFee,
        };
      });

      return { ...prev, lines, subtotal, total_price, tier_breakdowns };
    });
  }, []);

  return {
    estimate,
    loading,
    createEstimate,
    loadEstimate,
    setCustomer,
    addLine,
    removeLine,
    updateLine,
    updateMeasurement,
    selectTier,
    setDiscount,
    setNotes,
    setSignature,
    setRepSignature,
    setStatus,
    calculateEstimate,
    save,
  };
}
