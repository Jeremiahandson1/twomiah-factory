import { create } from 'zustand';

interface SelectedAddon {
  addon_id: string;
  name: string;
  price: number;
  quantity: number;
}

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

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  address: string;
  state: string;
  referral_source: string;
  referral_name: string;
}

interface QuoteState {
  quoteId: string | null;
  customer: CustomerInfo;
  mode: string;
  lines: LineItem[];
  selectedTier: string;
  subtotal: number;
  discountAmount: number;
  totalPrice: number;
  notes: string;
  step: number;

  setQuoteId: (id: string) => void;
  setCustomer: (info: Partial<CustomerInfo>) => void;
  setMode: (mode: string) => void;
  addLine: (line: LineItem) => void;
  removeLine: (lineId: string) => void;
  updateLine: (lineId: string, updates: Partial<LineItem>) => void;
  selectTier: (tier: string) => void;
  setAddons: (lineId: string, addons: SelectedAddon[]) => void;
  setDiscount: (amount: number) => void;
  setNotes: (notes: string) => void;
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  recalculate: () => void;
  reset: () => void;
}

const initialCustomer: CustomerInfo = {
  name: '',
  email: '',
  phone: '',
  address: '',
  state: '',
  referral_source: '',
  referral_name: '',
};

export const useQuoteStore = create<QuoteState>((set, get) => ({
  quoteId: null,
  customer: { ...initialCustomer },
  mode: 'menu',
  lines: [],
  selectedTier: 'best',
  subtotal: 0,
  discountAmount: 0,
  totalPrice: 0,
  notes: '',
  step: 0,

  setQuoteId: (id) => set({ quoteId: id }),

  setCustomer: (info) =>
    set((state) => ({
      customer: { ...state.customer, ...info },
    })),

  setMode: (mode) => set({ mode }),

  addLine: (line) =>
    set((state) => {
      const lines = [...state.lines, line];
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      return {
        lines,
        subtotal,
        totalPrice: subtotal - state.discountAmount,
      };
    }),

  removeLine: (lineId) =>
    set((state) => {
      const lines = state.lines.filter((l) => l.id !== lineId);
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      return {
        lines,
        subtotal,
        totalPrice: subtotal - state.discountAmount,
      };
    }),

  updateLine: (lineId, updates) =>
    set((state) => {
      const lines = state.lines.map((l) =>
        l.id === lineId ? { ...l, ...updates } : l
      );
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      return {
        lines,
        subtotal,
        totalPrice: subtotal - state.discountAmount,
      };
    }),

  selectTier: (tier) => set({ selectedTier: tier }),

  setAddons: (lineId, addons) =>
    set((state) => {
      const lines = state.lines.map((l) => {
        if (l.id !== lineId) return l;
        const addonTotal = addons.reduce((sum, a) => sum + a.price * a.quantity, 0);
        const lineTotal = l.base_price * l.measurement + addonTotal;
        return { ...l, addons, line_total: lineTotal };
      });
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      return {
        lines,
        subtotal,
        totalPrice: subtotal - state.discountAmount,
      };
    }),

  setDiscount: (amount) =>
    set((state) => ({
      discountAmount: amount,
      totalPrice: state.subtotal - amount,
    })),

  setNotes: (notes) => set({ notes }),

  setStep: (step) => set({ step }),

  nextStep: () => set((state) => ({ step: state.step + 1 })),

  prevStep: () => set((state) => ({ step: Math.max(0, state.step - 1) })),

  recalculate: () =>
    set((state) => {
      const subtotal = state.lines.reduce((sum, l) => sum + l.line_total, 0);
      return {
        subtotal,
        totalPrice: subtotal - state.discountAmount,
      };
    }),

  reset: () =>
    set({
      quoteId: null,
      customer: { ...initialCustomer },
      mode: 'menu',
      lines: [],
      selectedTier: 'best',
      subtotal: 0,
      discountAmount: 0,
      totalPrice: 0,
      notes: '',
      step: 0,
    }),
}));
