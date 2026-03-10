import { useState, useCallback, useEffect } from 'react';
import * as Crypto from 'expo-crypto';
import { insert, update, getById, query } from '@/lib/db';

interface LineItem {
  id: string;
  product_id: string;
  product_name: string;
  measurement: number;
  measurement_unit: string;
  tier: string;
  base_price: number;
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

interface Quote {
  id: string;
  local_id: string;
  customer: CustomerInfo;
  mode: string;
  lines: LineItem[];
  selected_tier: string;
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

interface UseQuoteReturn {
  quote: Quote | null;
  loading: boolean;
  createQuote: (mode: string) => Promise<string>;
  loadQuote: (id: string) => void;
  setCustomer: (info: Partial<CustomerInfo>) => void;
  addLine: (line: Omit<LineItem, 'id'>) => void;
  removeLine: (lineId: string) => void;
  updateLine: (lineId: string, updates: Partial<LineItem>) => void;
  selectTier: (tier: string) => void;
  setDiscount: (amount: number) => void;
  setNotes: (notes: string) => void;
  setSignature: (data: string) => void;
  setRepSignature: (data: string) => void;
  setStatus: (status: string) => void;
  calculateTotals: () => void;
  save: () => void;
}

export function useQuote(): UseQuoteReturn {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);

  const generateId = async (): Promise<string> => {
    const randomBytes = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${Date.now()}-${Math.random()}`
    );
    return randomBytes.substring(0, 24);
  };

  const save = useCallback(() => {
    if (!quote) return;

    const now = new Date().toISOString();
    const dbData = {
      id: quote.id,
      local_id: quote.local_id,
      server_synced: 0,
      customer_name: quote.customer.name,
      customer_email: quote.customer.email,
      customer_phone: quote.customer.phone,
      address: quote.customer.address,
      customer_state: quote.customer.state,
      referral_source: quote.customer.referral_source,
      referral_name: quote.customer.referral_name,
      status: quote.status,
      mode: quote.mode,
      line_items: JSON.stringify(quote.lines),
      selected_tier: quote.selected_tier,
      subtotal: quote.subtotal,
      discount_amount: quote.discount_amount,
      total_price: quote.total_price,
      signature_data: quote.signature_data,
      rep_signature_data: quote.rep_signature_data,
      contract_hash: quote.contract_hash,
      notes: quote.notes,
      created_at: quote.created_at,
      updated_at: now,
    };

    const existing = getById('quotes', quote.id);
    if (existing) {
      update('quotes', quote.id, dbData);
    } else {
      insert('quotes', dbData);
    }
  }, [quote]);

  useEffect(() => {
    if (quote) save();
  }, [quote, save]);

  const createQuote = useCallback(async (mode: string): Promise<string> => {
    const id = await generateId();
    const localId = `local_${id}`;
    const now = new Date().toISOString();

    const newQuote: Quote = {
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
      mode,
      lines: [],
      selected_tier: 'best',
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

    setQuote(newQuote);
    return id;
  }, []);

  const loadQuote = useCallback((id: string) => {
    setLoading(true);
    const row = getById('quotes', id);
    if (row) {
      setQuote({
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
        mode: row.mode,
        lines: row.line_items ? JSON.parse(row.line_items) : [],
        selected_tier: row.selected_tier || 'best',
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
    setQuote((prev) => {
      if (!prev) return prev;
      return { ...prev, customer: { ...prev.customer, ...info } };
    });
  }, []);

  const addLine = useCallback(async (line: Omit<LineItem, 'id'>) => {
    const id = await generateId();
    setQuote((prev) => {
      if (!prev) return prev;
      const newLine: LineItem = { ...line, id };
      const lines = [...prev.lines, newLine];
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      const total_price = subtotal - prev.discount_amount;
      return { ...prev, lines, subtotal, total_price };
    });
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setQuote((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.filter((l) => l.id !== lineId);
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      const total_price = subtotal - prev.discount_amount;
      return { ...prev, lines, subtotal, total_price };
    });
  }, []);

  const updateLine = useCallback((lineId: string, updates: Partial<LineItem>) => {
    setQuote((prev) => {
      if (!prev) return prev;
      const lines = prev.lines.map((l) =>
        l.id === lineId ? { ...l, ...updates } : l
      );
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      const total_price = subtotal - prev.discount_amount;
      return { ...prev, lines, subtotal, total_price };
    });
  }, []);

  const selectTier = useCallback((tier: string) => {
    setQuote((prev) => {
      if (!prev) return prev;
      return { ...prev, selected_tier: tier };
    });
  }, []);

  const setDiscount = useCallback((amount: number) => {
    setQuote((prev) => {
      if (!prev) return prev;
      const total_price = prev.subtotal - amount;
      return { ...prev, discount_amount: amount, total_price };
    });
  }, []);

  const setNotes = useCallback((notes: string) => {
    setQuote((prev) => (prev ? { ...prev, notes } : prev));
  }, []);

  const setSignature = useCallback((data: string) => {
    setQuote((prev) => (prev ? { ...prev, signature_data: data } : prev));
  }, []);

  const setRepSignature = useCallback((data: string) => {
    setQuote((prev) => (prev ? { ...prev, rep_signature_data: data } : prev));
  }, []);

  const setStatus = useCallback((status: string) => {
    setQuote((prev) => (prev ? { ...prev, status } : prev));
  }, []);

  const calculateTotals = useCallback(() => {
    setQuote((prev) => {
      if (!prev) return prev;
      const subtotal = prev.lines.reduce((sum, l) => sum + l.line_total, 0);
      const total_price = subtotal - prev.discount_amount;
      return { ...prev, subtotal, total_price };
    });
  }, []);

  return {
    quote,
    loading,
    createQuote,
    loadQuote,
    setCustomer,
    addLine,
    removeLine,
    updateLine,
    selectTier,
    setDiscount,
    setNotes,
    setSignature,
    setRepSignature,
    setStatus,
    calculateTotals,
    save,
  };
}
