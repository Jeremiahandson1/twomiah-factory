import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getAllFeatureIds, PRESET_PACKAGES } from '../data/features';

interface BuilderConfig {
  companyName: string;
  companyLogo: string | null;
  primaryColor: string;
  enabledFeatures: string[];
  createdAt: string | null;
  isBuilt: boolean;
}

interface BuilderInstance extends BuilderConfig {
  id: string;
}

interface PresetPackage {
  id: string;
  features: string[] | 'all';
  [key: string]: unknown;
}

interface FeatureCategory {
  id: string;
  features: { id: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

const initialConfig: BuilderConfig = {
  companyName: '',
  companyLogo: null,
  primaryColor: '{{PRIMARY_COLOR}}', // brand-500
  enabledFeatures: [],
  createdAt: null,
  isBuilt: false,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useBuilderStore = create<any>()(
  persist(
    (set: Function, get: Function) => ({
      // Config state
      config: { ...initialConfig },
      
      // Built CRM instances
      instances: [],
      
      // Current active instance
      activeInstance: null,
      
      // Builder step
      step: 1,
      
      // Actions
      setCompanyName: (name: string) => set((state: any) => ({
        config: { ...state.config, companyName: name }
      })),
      
      setCompanyLogo: (logo: string | null) => set((state: any) => ({
        config: { ...state.config, companyLogo: logo }
      })),
      
      setPrimaryColor: (color: string) => set((state: any) => ({
        config: { ...state.config, primaryColor: color }
      })),
      
      toggleFeature: (featureId: string) => set((state: any) => {
        const config = state.config as BuilderConfig;
        const enabled = config.enabledFeatures;
        const newEnabled = enabled.includes(featureId)
          ? enabled.filter((id: string) => id !== featureId)
          : [...enabled, featureId];
        return { config: { ...config, enabledFeatures: newEnabled } };
      }),

      enableFeatures: (featureIds: string[]) => set((state: any) => {
        const config = state.config as BuilderConfig;
        const current = new Set(config.enabledFeatures);
        featureIds.forEach((id: string) => current.add(id));
        return { config: { ...config, enabledFeatures: Array.from(current) } };
      }),

      disableFeatures: (featureIds: string[]) => set((state: any) => {
        const config = state.config as BuilderConfig;
        const toRemove = new Set(featureIds);
        const newEnabled = config.enabledFeatures.filter((id: string) => !toRemove.has(id));
        return { config: { ...config, enabledFeatures: newEnabled } };
      }),

      enableAllFeatures: () => set((state: any) => ({
        config: { ...(state.config as BuilderConfig), enabledFeatures: getAllFeatureIds() }
      })),

      disableAllFeatures: () => set((state: any) => ({
        config: { ...(state.config as BuilderConfig), enabledFeatures: [] }
      })),

      applyPreset: (presetId: string) => set((state: any) => {
        const preset = (PRESET_PACKAGES as PresetPackage[]).find((p: PresetPackage) => p.id === presetId);
        if (!preset) return state;

        const features = preset.features === 'all'
          ? getAllFeatureIds()
          : preset.features;

        return { config: { ...(state.config as BuilderConfig), enabledFeatures: features } };
      }),

      setStep: (step: number) => set({ step }),
      
      nextStep: () => set((state: any) => ({ step: (state.step as number) + 1 })),

      prevStep: () => set((state: any) => ({ step: Math.max(1, (state.step as number) - 1) })),
      
      // Build the CRM instance
      buildCRM: () => {
        const state = get();
        const newInstance = {
          id: Date.now().toString(),
          ...state.config,
          createdAt: new Date().toISOString(),
          isBuilt: true,
        };
        
        set({
          instances: [...state.instances, newInstance],
          activeInstance: newInstance.id,
          config: { ...initialConfig },
          step: 1,
        });
        
        return newInstance;
      },
      
      // Load an existing instance
      loadInstance: (instanceId: string) => set((_state: Record<string, unknown>) => ({
        activeInstance: instanceId
      })),
      
      // Get current instance
      getCurrentInstance: () => {
        const state = get() as Record<string, unknown>;
        return (state.instances as BuilderInstance[]).find((i: BuilderInstance) => i.id === state.activeInstance);
      },

      // Delete an instance
      deleteInstance: (instanceId: string) => set((state: any) => ({
        instances: (state.instances as BuilderInstance[]).filter((i: BuilderInstance) => i.id !== instanceId),
        activeInstance: state.activeInstance === instanceId ? null : state.activeInstance,
      })),
      
      // Reset builder
      resetBuilder: () => set({
        config: { ...initialConfig },
        step: 1,
      }),
      
      // Check if feature is enabled
      isFeatureEnabled: (featureId: string) => {
        const state = get() as Record<string, unknown>;
        const getCurrentInstance = state.getCurrentInstance as () => BuilderInstance | undefined;
        const instance = getCurrentInstance();
        if (instance) {
          return instance.enabledFeatures.includes(featureId);
        }
        return (state.config as BuilderConfig).enabledFeatures.includes(featureId);
      },

      // Check if category has any enabled features
      isCategoryEnabled: (categoryId: string, categories: FeatureCategory[]) => {
        const state = get() as Record<string, unknown>;
        const getCurrentInstance = state.getCurrentInstance as () => BuilderInstance | undefined;
        const instance = getCurrentInstance();
        const enabled = instance ? instance.enabledFeatures : (state.config as BuilderConfig).enabledFeatures;
        const category = categories.find((c: FeatureCategory) => c.id === categoryId);
        if (!category) return false;
        return category.features.some((f: { id: string }) => enabled.includes(f.id));
      },
    }),
    {
      name: '{{COMPANY_SLUG}}-builder-storage',
    }
  )
);

// Demo data store for the CRM
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useCRMDataStore = create<any>()(
  persist(
    (set: Function, get: Function) => ({
      // Contacts
      contacts: [
        { id: '1', type: 'client', name: 'John Smith', email: 'john@example.com', phone: '555-0101', company: 'Smith Residence', address: '123 Main St', createdAt: '2024-01-15' },
        { id: '2', type: 'client', name: 'Sarah Johnson', email: 'sarah@techcorp.com', phone: '555-0102', company: 'TechCorp Inc', address: '456 Oak Ave', createdAt: '2024-01-20' },
        { id: '3', type: 'subcontractor', name: 'Mike\'s Electric', email: 'mike@mikeselectric.com', phone: '555-0103', company: 'Mike\'s Electric LLC', address: '789 Industrial Blvd', createdAt: '2024-01-10' },
        { id: '4', type: 'vendor', name: 'ABC Supply', email: 'orders@abcsupply.com', phone: '555-0104', company: 'ABC Supply Co', address: '321 Commerce Dr', createdAt: '2024-01-05' },
      ],
      
      // Projects
      projects: [
        { id: '1', name: 'Smith Kitchen Remodel', client: '1', status: 'in_progress', progress: 65, budget: 45000, spent: 28500, startDate: '2024-02-01', endDate: '2024-04-15' },
        { id: '2', name: 'TechCorp Office Build-out', client: '2', status: 'in_progress', progress: 30, budget: 250000, spent: 75000, startDate: '2024-01-15', endDate: '2024-06-30' },
        { id: '3', name: 'Residential HVAC Install', client: '1', status: 'scheduled', progress: 0, budget: 12000, spent: 0, startDate: '2024-03-01', endDate: '2024-03-05' },
      ],
      
      // Jobs
      jobs: [
        { id: '1', title: 'Cabinet Installation', projectId: '1', status: 'in_progress', assignee: 'Tom Wilson', scheduledDate: '2024-02-15', estimatedHours: 8 },
        { id: '2', title: 'Electrical Rough-in', projectId: '2', status: 'completed', assignee: 'Mike\'s Electric', scheduledDate: '2024-02-10', estimatedHours: 16 },
        { id: '3', title: 'Plumbing Inspection', projectId: '1', status: 'scheduled', assignee: 'City Inspector', scheduledDate: '2024-02-20', estimatedHours: 2 },
        { id: '4', title: 'HVAC Unit Delivery', projectId: '3', status: 'scheduled', assignee: 'ABC Supply', scheduledDate: '2024-03-01', estimatedHours: 1 },
      ],
      
      // Quotes
      quotes: [
        { id: '1', number: 'Q-2024-001', client: '1', title: 'Kitchen Remodel', amount: 45000, status: 'approved', createdAt: '2024-01-10' },
        { id: '2', number: 'Q-2024-002', client: '2', title: 'Office Build-out Phase 1', amount: 125000, status: 'approved', createdAt: '2024-01-05' },
        { id: '3', number: 'Q-2024-003', client: '1', title: 'HVAC System Replacement', amount: 12000, status: 'pending', createdAt: '2024-02-01' },
      ],
      
      // Invoices
      invoices: [
        { id: '1', number: 'INV-2024-001', client: '1', projectId: '1', amount: 15000, paid: 15000, status: 'paid', dueDate: '2024-02-15' },
        { id: '2', number: 'INV-2024-002', client: '2', projectId: '2', amount: 50000, paid: 50000, status: 'paid', dueDate: '2024-02-01' },
        { id: '3', number: 'INV-2024-003', client: '1', projectId: '1', amount: 13500, paid: 0, status: 'pending', dueDate: '2024-03-01' },
      ],
      
      // RFIs
      rfis: [
        { id: '1', number: 'RFI-001', projectId: '2', subject: 'Electrical outlet locations - Conference Room B', status: 'open', createdAt: '2024-02-05', dueDate: '2024-02-12' },
        { id: '2', number: 'RFI-002', projectId: '2', subject: 'HVAC duct routing conflict', status: 'responded', createdAt: '2024-02-08', dueDate: '2024-02-15' },
      ],
      
      // Change Orders
      changeOrders: [
        { id: '1', number: 'CO-001', projectId: '1', title: 'Upgrade to quartz countertops', amount: 3500, status: 'approved', createdAt: '2024-02-10' },
        { id: '2', number: 'CO-002', projectId: '2', title: 'Additional network drops', amount: 8500, status: 'pending', createdAt: '2024-02-12' },
      ],
      
      // Punch List Items
      punchListItems: [
        { id: '1', projectId: '1', description: 'Touch up paint on cabinet trim', status: 'open', assignee: 'Tom Wilson', createdAt: '2024-02-14' },
        { id: '2', projectId: '2', description: 'Replace scratched door hardware', status: 'completed', assignee: 'Tom Wilson', createdAt: '2024-02-10' },
      ],
      
      // Time entries
      timeEntries: [
        { id: '1', userId: '1', jobId: '1', date: '2024-02-15', hours: 8, description: 'Cabinet installation' },
        { id: '2', userId: '2', jobId: '2', date: '2024-02-10', hours: 10, description: 'Electrical rough-in' },
      ],
      
      // Team members
      teamMembers: [
        { id: '1', name: 'Tom Wilson', role: 'Lead Carpenter', email: 'tom@company.com', phone: '555-1001' },
        { id: '2', name: 'Jake Martinez', role: 'Electrician', email: 'jake@company.com', phone: '555-1002' },
        { id: '3', name: 'Lisa Chen', role: 'Project Manager', email: 'lisa@company.com', phone: '555-1003' },
      ],
      
      // CRUD operations
      addContact: (contact: Record<string, unknown>) => set((state: any) => ({
        contacts: [...state.contacts, { ...contact, id: Date.now().toString(), createdAt: new Date().toISOString() }]
      })),
      
      updateContact: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        contacts: (state.contacts as Record<string, unknown>[]).map((c: Record<string, unknown>) => c.id === id ? { ...c, ...updates } : c)
      })),

      deleteContact: (id: string) => set((state: any) => ({
        contacts: (state.contacts as Record<string, unknown>[]).filter((c: Record<string, unknown>) => c.id !== id)
      })),

      addProject: (project: Record<string, unknown>) => set((state: any) => ({
        projects: [...(state.projects as Record<string, unknown>[]), { ...project, id: Date.now().toString() }]
      })),

      updateProject: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        projects: (state.projects as Record<string, unknown>[]).map((p: Record<string, unknown>) => p.id === id ? { ...p, ...updates } : p)
      })),

      deleteProject: (id: string) => set((state: any) => ({
        projects: (state.projects as Record<string, unknown>[]).filter((p: Record<string, unknown>) => p.id !== id)
      })),

      addJob: (job: Record<string, unknown>) => set((state: any) => ({
        jobs: [...(state.jobs as Record<string, unknown>[]), { ...job, id: Date.now().toString() }]
      })),

      updateJob: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        jobs: (state.jobs as Record<string, unknown>[]).map((j: Record<string, unknown>) => j.id === id ? { ...j, ...updates } : j)
      })),

      deleteJob: (id: string) => set((state: any) => ({
        jobs: (state.jobs as Record<string, unknown>[]).filter((j: Record<string, unknown>) => j.id !== id)
      })),

      addQuote: (quote: Record<string, unknown>) => set((state: any) => ({
        quotes: [...(state.quotes as Record<string, unknown>[]), { ...quote, id: Date.now().toString(), number: `Q-2024-${String((state.quotes as Record<string, unknown>[]).length + 1).padStart(3, '0')}` }]
      })),

      updateQuote: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        quotes: (state.quotes as Record<string, unknown>[]).map((q: Record<string, unknown>) => q.id === id ? { ...q, ...updates } : q)
      })),

      deleteQuote: (id: string) => set((state: any) => ({
        quotes: (state.quotes as Record<string, unknown>[]).filter((q: Record<string, unknown>) => q.id !== id)
      })),

      addInvoice: (invoice: Record<string, unknown>) => set((state: any) => ({
        invoices: [...(state.invoices as Record<string, unknown>[]), { ...invoice, id: Date.now().toString(), number: `INV-2024-${String((state.invoices as Record<string, unknown>[]).length + 1).padStart(3, '0')}` }]
      })),

      updateInvoice: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        invoices: (state.invoices as Record<string, unknown>[]).map((i: Record<string, unknown>) => i.id === id ? { ...i, ...updates } : i)
      })),

      deleteInvoice: (id: string) => set((state: any) => ({
        invoices: (state.invoices as Record<string, unknown>[]).filter((i: Record<string, unknown>) => i.id !== id)
      })),

      addRFI: (rfi: Record<string, unknown>) => set((state: any) => ({
        rfis: [...(state.rfis as Record<string, unknown>[]), { ...rfi, id: Date.now().toString(), number: `RFI-${String((state.rfis as Record<string, unknown>[]).length + 1).padStart(3, '0')}` }]
      })),

      updateRFI: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        rfis: (state.rfis as Record<string, unknown>[]).map((r: Record<string, unknown>) => r.id === id ? { ...r, ...updates } : r)
      })),

      deleteRFI: (id: string) => set((state: any) => ({
        rfis: (state.rfis as Record<string, unknown>[]).filter((r: Record<string, unknown>) => r.id !== id)
      })),

      addChangeOrder: (co: Record<string, unknown>) => set((state: any) => ({
        changeOrders: [...(state.changeOrders as Record<string, unknown>[]), { ...co, id: Date.now().toString(), number: `CO-${String((state.changeOrders as Record<string, unknown>[]).length + 1).padStart(3, '0')}` }]
      })),

      updateChangeOrder: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        changeOrders: (state.changeOrders as Record<string, unknown>[]).map((c: Record<string, unknown>) => c.id === id ? { ...c, ...updates } : c)
      })),

      deleteChangeOrder: (id: string) => set((state: any) => ({
        changeOrders: (state.changeOrders as Record<string, unknown>[]).filter((c: Record<string, unknown>) => c.id !== id)
      })),

      addPunchListItem: (item: Record<string, unknown>) => set((state: any) => ({
        punchListItems: [...(state.punchListItems as Record<string, unknown>[]), { ...item, id: Date.now().toString() }]
      })),

      updatePunchListItem: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        punchListItems: (state.punchListItems as Record<string, unknown>[]).map((p: Record<string, unknown>) => p.id === id ? { ...p, ...updates } : p)
      })),

      deletePunchListItem: (id: string) => set((state: any) => ({
        punchListItems: (state.punchListItems as Record<string, unknown>[]).filter((p: Record<string, unknown>) => p.id !== id)
      })),

      addTimeEntry: (entry: Record<string, unknown>) => set((state: any) => ({
        timeEntries: [...(state.timeEntries as Record<string, unknown>[]), { ...entry, id: Date.now().toString() }]
      })),

      updateTimeEntry: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        timeEntries: (state.timeEntries as Record<string, unknown>[]).map((t: Record<string, unknown>) => t.id === id ? { ...t, ...updates } : t)
      })),

      deleteTimeEntry: (id: string) => set((state: any) => ({
        timeEntries: (state.timeEntries as Record<string, unknown>[]).filter((t: Record<string, unknown>) => t.id !== id)
      })),

      // Daily logs
      dailyLogs: [],

      addDailyLog: (log: Record<string, unknown>) => set((state: any) => ({
        dailyLogs: [...((state.dailyLogs as Record<string, unknown>[]) || []), { ...log, id: Date.now().toString() }]
      })),

      updateDailyLog: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        dailyLogs: ((state.dailyLogs as Record<string, unknown>[]) || []).map((l: Record<string, unknown>) => l.id === id ? { ...l, ...updates } : l)
      })),

      deleteDailyLog: (id: string) => set((state: any) => ({
        dailyLogs: ((state.dailyLogs as Record<string, unknown>[]) || []).filter((l: Record<string, unknown>) => l.id !== id)
      })),

      // Expenses
      expenses: [],

      addExpense: (expense: Record<string, unknown>) => set((state: any) => ({
        expenses: [...((state.expenses as Record<string, unknown>[]) || []), { ...expense, id: Date.now().toString() }]
      })),

      updateExpense: (id: string, updates: Record<string, unknown>) => set((state: any) => ({
        expenses: ((state.expenses as Record<string, unknown>[]) || []).map((e: Record<string, unknown>) => e.id === id ? { ...e, ...updates } : e)
      })),

      deleteExpense: (id: string) => set((state: any) => ({
        expenses: ((state.expenses as Record<string, unknown>[]) || []).filter((e: Record<string, unknown>) => e.id !== id)
      })),

      // ========== QUALITY & SAFETY ==========
      inspections: [],
      addInspection: (item: Record<string, unknown>) => set((state: any) => ({ inspections: [...((state.inspections as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateInspection: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ inspections: ((state.inspections as Record<string, unknown>[]) || []).map((i: Record<string, unknown>) => i.id === id ? { ...i, ...updates } : i) })),
      deleteInspection: (id: string) => set((state: any) => ({ inspections: ((state.inspections as Record<string, unknown>[]) || []).filter((i: Record<string, unknown>) => i.id !== id) })),

      observations: [],
      addObservation: (item: Record<string, unknown>) => set((state: any) => ({ observations: [...((state.observations as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateObservation: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ observations: ((state.observations as Record<string, unknown>[]) || []).map((o: Record<string, unknown>) => o.id === id ? { ...o, ...updates } : o) })),
      deleteObservation: (id: string) => set((state: any) => ({ observations: ((state.observations as Record<string, unknown>[]) || []).filter((o: Record<string, unknown>) => o.id !== id) })),

      incidents: [],
      addIncident: (item: Record<string, unknown>) => set((state: any) => ({ incidents: [...((state.incidents as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateIncident: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ incidents: ((state.incidents as Record<string, unknown>[]) || []).map((i: Record<string, unknown>) => i.id === id ? { ...i, ...updates } : i) })),
      deleteIncident: (id: string) => set((state: any) => ({ incidents: ((state.incidents as Record<string, unknown>[]) || []).filter((i: Record<string, unknown>) => i.id !== id) })),

      // ========== BIDDING ==========
      bids: [],
      addBid: (item: Record<string, unknown>) => set((state: any) => ({ bids: [...((state.bids as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateBid: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ bids: ((state.bids as Record<string, unknown>[]) || []).map((b: Record<string, unknown>) => b.id === id ? { ...b, ...updates } : b) })),
      deleteBid: (id: string) => set((state: any) => ({ bids: ((state.bids as Record<string, unknown>[]) || []).filter((b: Record<string, unknown>) => b.id !== id) })),

      // ========== MARKETING ==========
      campaigns: [],
      addCampaign: (item: Record<string, unknown>) => set((state: any) => ({ campaigns: [...((state.campaigns as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateCampaign: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ campaigns: ((state.campaigns as Record<string, unknown>[]) || []).map((c: Record<string, unknown>) => c.id === id ? { ...c, ...updates } : c) })),
      deleteCampaign: (id: string) => set((state: any) => ({ campaigns: ((state.campaigns as Record<string, unknown>[]) || []).filter((c: Record<string, unknown>) => c.id !== id) })),

      reviewRequests: [],
      addReviewRequest: (item: Record<string, unknown>) => set((state: any) => ({ reviewRequests: [...((state.reviewRequests as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateReviewRequest: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ reviewRequests: ((state.reviewRequests as Record<string, unknown>[]) || []).map((r: Record<string, unknown>) => r.id === id ? { ...r, ...updates } : r) })),
      deleteReviewRequest: (id: string) => set((state: any) => ({ reviewRequests: ((state.reviewRequests as Record<string, unknown>[]) || []).filter((r: Record<string, unknown>) => r.id !== id) })),

      referrals: [],
      addReferral: (item: Record<string, unknown>) => set((state: any) => ({ referrals: [...((state.referrals as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateReferral: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ referrals: ((state.referrals as Record<string, unknown>[]) || []).map((r: Record<string, unknown>) => r.id === id ? { ...r, ...updates } : r) })),
      deleteReferral: (id: string) => set((state: any) => ({ referrals: ((state.referrals as Record<string, unknown>[]) || []).filter((r: Record<string, unknown>) => r.id !== id) })),

      // ========== COMMUNICATION ==========
      messages: [],
      addMessage: (item: Record<string, unknown>) => set((state: any) => ({ messages: [...((state.messages as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateMessage: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ messages: ((state.messages as Record<string, unknown>[]) || []).map((m: Record<string, unknown>) => m.id === id ? { ...m, ...updates } : m) })),
      deleteMessage: (id: string) => set((state: any) => ({ messages: ((state.messages as Record<string, unknown>[]) || []).filter((m: Record<string, unknown>) => m.id !== id) })),

      templates: [],
      addTemplate: (item: Record<string, unknown>) => set((state: any) => ({ templates: [...((state.templates as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateTemplate: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ templates: ((state.templates as Record<string, unknown>[]) || []).map((t: Record<string, unknown>) => t.id === id ? { ...t, ...updates } : t) })),
      deleteTemplate: (id: string) => set((state: any) => ({ templates: ((state.templates as Record<string, unknown>[]) || []).filter((t: Record<string, unknown>) => t.id !== id) })),

      // ========== WEBSITE BUILDER ==========
      websitePages: [],
      addWebsitePage: (item: Record<string, unknown>) => set((state: any) => ({ websitePages: [...((state.websitePages as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateWebsitePage: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ websitePages: ((state.websitePages as Record<string, unknown>[]) || []).map((p: Record<string, unknown>) => p.id === id ? { ...p, ...updates } : p) })),
      deleteWebsitePage: (id: string) => set((state: any) => ({ websitePages: ((state.websitePages as Record<string, unknown>[]) || []).filter((p: Record<string, unknown>) => p.id !== id) })),
      websiteSettings: {},
      updateWebsiteSettings: (settings: Record<string, unknown>) => set((state: any) => ({ websiteSettings: { ...(state.websiteSettings as Record<string, unknown>), ...settings } })),

      // ========== AI RECEPTIONIST ==========
      aiReceptionistRules: [],
      addAIReceptionistRule: (item: Record<string, unknown>) => set((state: any) => ({ aiReceptionistRules: [...((state.aiReceptionistRules as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateAIReceptionistRule: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ aiReceptionistRules: ((state.aiReceptionistRules as Record<string, unknown>[]) || []).map((r: Record<string, unknown>) => r.id === id ? { ...r, ...updates } : r) })),
      deleteAIReceptionistRule: (id: string) => set((state: any) => ({ aiReceptionistRules: ((state.aiReceptionistRules as Record<string, unknown>[]) || []).filter((r: Record<string, unknown>) => r.id !== id) })),
      aiReceptionistSettings: { enabled: false, businessHours: { start: '09:00', end: '17:00' }, greeting: '' },
      updateAIReceptionistSettings: (settings: Record<string, unknown>) => set((state: any) => ({ aiReceptionistSettings: { ...(state.aiReceptionistSettings as Record<string, unknown>), ...settings } })),
      callLog: [],

      // ========== CONSUMER FINANCING ==========
      financingApplications: [],
      addFinancingApplication: (item: Record<string, unknown>) => set((state: any) => ({ financingApplications: [...((state.financingApplications as Record<string, unknown>[]) || []), { ...item, id: Date.now().toString() }] })),
      updateFinancingApplication: (id: string, updates: Record<string, unknown>) => set((state: any) => ({ financingApplications: ((state.financingApplications as Record<string, unknown>[]) || []).map((a: Record<string, unknown>) => a.id === id ? { ...a, ...updates } : a) })),
      deleteFinancingApplication: (id: string) => set((state: any) => ({ financingApplications: ((state.financingApplications as Record<string, unknown>[]) || []).filter((a: Record<string, unknown>) => a.id !== id) })),
      financingSettings: {},
    }),
    {
      name: '{{COMPANY_SLUG}}-crm-data',
    }
  )
);
