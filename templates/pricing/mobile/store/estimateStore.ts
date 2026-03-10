import { create } from 'zustand';

interface Measurement {
  length: number;
  width: number;
  area: number;
  pitch: string;
  waste_factor: number;
}

interface SelectedAddon {
  addon_id: string;
  name: string;
  price: number;
  quantity: number;
}

interface EstimateLine {
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

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  address: string;
  state: string;
  referral_source: string;
  referral_name: string;
}

interface TierResult {
  tier: string;
  material_cost: number;
  labor_cost: number;
  addon_cost: number;
  setup_fee: number;
  total: number;
}

interface EstimateState {
  estimateId: string | null;
  customer: CustomerInfo;
  lines: EstimateLine[];
  selectedTier: string;
  tierResults: TierResult[];
  subtotal: number;
  discountAmount: number;
  totalPrice: number;
  notes: string;
  step: number;

  setEstimateId: (id: string) => void;
  setCustomer: (info: Partial<CustomerInfo>) => void;
  addLine: (line: EstimateLine) => void;
  removeLine: (lineId: string) => void;
  updateLine: (lineId: string, updates: Partial<EstimateLine>) => void;
  updateMeasurement: (lineId: string, measurement: Partial<Measurement>) => void;
  selectTier: (tier: string) => void;
  setAddons: (lineId: string, addons: SelectedAddon[]) => void;
  setDiscount: (amount: number) => void;
  setNotes: (notes: string) => void;
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  calculateAll: (pitchMultipliers: Record<string, number>) => void;
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

export const useEstimateStore = create<EstimateState>((set, get) => ({
  estimateId: null,
  customer: { ...initialCustomer },
  lines: [],
  selectedTier: 'best',
  tierResults: [],
  subtotal: 0,
  discountAmount: 0,
  totalPrice: 0,
  notes: '',
  step: 0,

  setEstimateId: (id) => set({ estimateId: id }),

  setCustomer: (info) =>
    set((state) => ({
      customer: { ...state.customer, ...info },
    })),

  addLine: (line) =>
    set((state) => {
      const lines = [...state.lines, line];
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      return { lines, subtotal, totalPrice: subtotal - state.discountAmount };
    }),

  removeLine: (lineId) =>
    set((state) => {
      const lines = state.lines.filter((l) => l.id !== lineId);
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      return { lines, subtotal, totalPrice: subtotal - state.discountAmount };
    }),

  updateLine: (lineId, updates) =>
    set((state) => {
      const lines = state.lines.map((l) =>
        l.id === lineId ? { ...l, ...updates } : l
      );
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
      return { lines, subtotal, totalPrice: subtotal - state.discountAmount };
    }),

  updateMeasurement: (lineId, measurement) =>
    set((state) => {
      const lines = state.lines.map((l) => {
        if (l.id !== lineId) return l;
        const updated = { ...l.measurement, ...measurement };
        if (measurement.length !== undefined || measurement.width !== undefined) {
          updated.area =
            (measurement.length ?? l.measurement.length) *
            (measurement.width ?? l.measurement.width);
        }
        return { ...l, measurement: updated };
      });
      return { lines };
    }),

  selectTier: (tier) => set({ selectedTier: tier }),

  setAddons: (lineId, addons) =>
    set((state) => {
      const lines = state.lines.map((l) => {
        if (l.id !== lineId) return l;
        return { ...l, addons };
      });
      return { lines };
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

  calculateAll: (pitchMultipliers) =>
    set((state) => {
      const lines = state.lines.map((line) => {
        const pm = pitchMultipliers[line.measurement.pitch] || 1.0;
        const effectiveArea =
          line.measurement.area * (1 + line.measurement.waste_factor / 100) * pm;
        const addonTotal = line.addons.reduce(
          (sum, a) => sum + a.price * a.quantity,
          0
        );
        const lineTotal =
          line.material_cost * effectiveArea +
          line.labor_cost * effectiveArea +
          line.setup_fee +
          addonTotal;
        return { ...line, line_total: lineTotal };
      });

      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);

      const tierNames = ['good', 'better', 'best'];
      const tierResults: TierResult[] = tierNames.map((tierName) => {
        let materialCost = 0;
        let laborCost = 0;
        let addonCost = 0;
        let setupFee = 0;
        for (const line of lines) {
          const pm = pitchMultipliers[line.measurement.pitch] || 1.0;
          const effectiveArea =
            line.measurement.area * (1 + line.measurement.waste_factor / 100) * pm;
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

      return {
        lines,
        subtotal,
        totalPrice: subtotal - state.discountAmount,
        tierResults,
      };
    }),

  reset: () =>
    set({
      estimateId: null,
      customer: { ...initialCustomer },
      lines: [],
      selectedTier: 'best',
      tierResults: [],
      subtotal: 0,
      discountAmount: 0,
      totalPrice: 0,
      notes: '',
      step: 0,
    }),
}));
