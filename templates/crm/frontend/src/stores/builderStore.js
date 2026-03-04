import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getAllFeatureIds, PRESET_PACKAGES } from '../data/features';

const initialConfig = {
  companyName: '',
  companyLogo: null,
  primaryColor: '#ec7619', // brand-500
  enabledFeatures: [],
  createdAt: null,
  isBuilt: false,
};

export const useBuilderStore = create(
  persist(
    (set, get) => ({
      // Config state
      config: { ...initialConfig },
      
      // Built CRM instances
      instances: [],
      
      // Current active instance
      activeInstance: null,
      
      // Builder step
      step: 1,
      
      // Actions
      setCompanyName: (name) => set((state) => ({
        config: { ...state.config, companyName: name }
      })),
      
      setCompanyLogo: (logo) => set((state) => ({
        config: { ...state.config, companyLogo: logo }
      })),
      
      setPrimaryColor: (color) => set((state) => ({
        config: { ...state.config, primaryColor: color }
      })),
      
      toggleFeature: (featureId) => set((state) => {
        const enabled = state.config.enabledFeatures;
        const newEnabled = enabled.includes(featureId)
          ? enabled.filter(id => id !== featureId)
          : [...enabled, featureId];
        return { config: { ...state.config, enabledFeatures: newEnabled } };
      }),
      
      enableFeatures: (featureIds) => set((state) => {
        const current = new Set(state.config.enabledFeatures);
        featureIds.forEach(id => current.add(id));
        return { config: { ...state.config, enabledFeatures: Array.from(current) } };
      }),
      
      disableFeatures: (featureIds) => set((state) => {
        const toRemove = new Set(featureIds);
        const newEnabled = state.config.enabledFeatures.filter(id => !toRemove.has(id));
        return { config: { ...state.config, enabledFeatures: newEnabled } };
      }),
      
      enableAllFeatures: () => set((state) => ({
        config: { ...state.config, enabledFeatures: getAllFeatureIds() }
      })),
      
      disableAllFeatures: () => set((state) => ({
        config: { ...state.config, enabledFeatures: [] }
      })),
      
      applyPreset: (presetId) => set((state) => {
        const preset = PRESET_PACKAGES.find(p => p.id === presetId);
        if (!preset) return state;
        
        const features = preset.features === 'all' 
          ? getAllFeatureIds() 
          : preset.features;
        
        return { config: { ...state.config, enabledFeatures: features } };
      }),
      
      setStep: (step) => set({ step }),
      
      nextStep: () => set((state) => ({ step: state.step + 1 })),
      
      prevStep: () => set((state) => ({ step: Math.max(1, state.step - 1) })),
      
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
      loadInstance: (instanceId) => set((state) => ({
        activeInstance: instanceId
      })),
      
      // Get current instance
      getCurrentInstance: () => {
        const state = get();
        return state.instances.find(i => i.id === state.activeInstance);
      },
      
      // Delete an instance
      deleteInstance: (instanceId) => set((state) => ({
        instances: state.instances.filter(i => i.id !== instanceId),
        activeInstance: state.activeInstance === instanceId ? null : state.activeInstance,
      })),
      
      // Reset builder
      resetBuilder: () => set({
        config: { ...initialConfig },
        step: 1,
      }),
      
      // Check if feature is enabled
      isFeatureEnabled: (featureId) => {
        const state = get();
        const instance = state.getCurrentInstance();
        if (instance) {
          return instance.enabledFeatures.includes(featureId);
        }
        return state.config.enabledFeatures.includes(featureId);
      },
      
      // Check if category has any enabled features
      isCategoryEnabled: (categoryId, categories) => {
        const state = get();
        const instance = state.getCurrentInstance();
        const enabled = instance ? instance.enabledFeatures : state.config.enabledFeatures;
        const category = categories.find(c => c.id === categoryId);
        if (!category) return false;
        return category.features.some(f => enabled.includes(f.id));
      },
    }),
    {
      name: 'twomiah-build-builder-storage',
    }
  )
);

// Demo data store for the CRM
export const useCRMDataStore = create(
  persist(
    (set, get) => ({
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
      addContact: (contact) => set((state) => ({
        contacts: [...state.contacts, { ...contact, id: Date.now().toString(), createdAt: new Date().toISOString() }]
      })),
      
      updateContact: (id, updates) => set((state) => ({
        contacts: state.contacts.map(c => c.id === id ? { ...c, ...updates } : c)
      })),
      
      deleteContact: (id) => set((state) => ({
        contacts: state.contacts.filter(c => c.id !== id)
      })),
      
      addProject: (project) => set((state) => ({
        projects: [...state.projects, { ...project, id: Date.now().toString() }]
      })),
      
      updateProject: (id, updates) => set((state) => ({
        projects: state.projects.map(p => p.id === id ? { ...p, ...updates } : p)
      })),
      
      deleteProject: (id) => set((state) => ({
        projects: state.projects.filter(p => p.id !== id)
      })),
      
      addJob: (job) => set((state) => ({
        jobs: [...state.jobs, { ...job, id: Date.now().toString() }]
      })),
      
      updateJob: (id, updates) => set((state) => ({
        jobs: state.jobs.map(j => j.id === id ? { ...j, ...updates } : j)
      })),
      
      deleteJob: (id) => set((state) => ({
        jobs: state.jobs.filter(j => j.id !== id)
      })),
      
      addQuote: (quote) => set((state) => ({
        quotes: [...state.quotes, { ...quote, id: Date.now().toString(), number: `Q-2024-${String(state.quotes.length + 1).padStart(3, '0')}` }]
      })),
      
      updateQuote: (id, updates) => set((state) => ({
        quotes: state.quotes.map(q => q.id === id ? { ...q, ...updates } : q)
      })),
      
      deleteQuote: (id) => set((state) => ({
        quotes: state.quotes.filter(q => q.id !== id)
      })),
      
      addInvoice: (invoice) => set((state) => ({
        invoices: [...state.invoices, { ...invoice, id: Date.now().toString(), number: `INV-2024-${String(state.invoices.length + 1).padStart(3, '0')}` }]
      })),
      
      updateInvoice: (id, updates) => set((state) => ({
        invoices: state.invoices.map(i => i.id === id ? { ...i, ...updates } : i)
      })),
      
      deleteInvoice: (id) => set((state) => ({
        invoices: state.invoices.filter(i => i.id !== id)
      })),
      
      addRFI: (rfi) => set((state) => ({
        rfis: [...state.rfis, { ...rfi, id: Date.now().toString(), number: `RFI-${String(state.rfis.length + 1).padStart(3, '0')}` }]
      })),
      
      updateRFI: (id, updates) => set((state) => ({
        rfis: state.rfis.map(r => r.id === id ? { ...r, ...updates } : r)
      })),
      
      deleteRFI: (id) => set((state) => ({
        rfis: state.rfis.filter(r => r.id !== id)
      })),
      
      addChangeOrder: (co) => set((state) => ({
        changeOrders: [...state.changeOrders, { ...co, id: Date.now().toString(), number: `CO-${String(state.changeOrders.length + 1).padStart(3, '0')}` }]
      })),
      
      updateChangeOrder: (id, updates) => set((state) => ({
        changeOrders: state.changeOrders.map(c => c.id === id ? { ...c, ...updates } : c)
      })),
      
      deleteChangeOrder: (id) => set((state) => ({
        changeOrders: state.changeOrders.filter(c => c.id !== id)
      })),
      
      addPunchListItem: (item) => set((state) => ({
        punchListItems: [...state.punchListItems, { ...item, id: Date.now().toString() }]
      })),
      
      updatePunchListItem: (id, updates) => set((state) => ({
        punchListItems: state.punchListItems.map(p => p.id === id ? { ...p, ...updates } : p)
      })),
      
      deletePunchListItem: (id) => set((state) => ({
        punchListItems: state.punchListItems.filter(p => p.id !== id)
      })),
      
      addTimeEntry: (entry) => set((state) => ({
        timeEntries: [...state.timeEntries, { ...entry, id: Date.now().toString() }]
      })),
      
      updateTimeEntry: (id, updates) => set((state) => ({
        timeEntries: state.timeEntries.map(t => t.id === id ? { ...t, ...updates } : t)
      })),
      
      deleteTimeEntry: (id) => set((state) => ({
        timeEntries: state.timeEntries.filter(t => t.id !== id)
      })),
      
      // Daily logs
      dailyLogs: [],
      
      addDailyLog: (log) => set((state) => ({
        dailyLogs: [...(state.dailyLogs || []), { ...log, id: Date.now().toString() }]
      })),
      
      updateDailyLog: (id, updates) => set((state) => ({
        dailyLogs: (state.dailyLogs || []).map(l => l.id === id ? { ...l, ...updates } : l)
      })),
      
      deleteDailyLog: (id) => set((state) => ({
        dailyLogs: (state.dailyLogs || []).filter(l => l.id !== id)
      })),
      
      // Expenses
      expenses: [],
      
      addExpense: (expense) => set((state) => ({
        expenses: [...(state.expenses || []), { ...expense, id: Date.now().toString() }]
      })),
      
      updateExpense: (id, updates) => set((state) => ({
        expenses: (state.expenses || []).map(e => e.id === id ? { ...e, ...updates } : e)
      })),
      
      deleteExpense: (id) => set((state) => ({
        expenses: (state.expenses || []).filter(e => e.id !== id)
      })),

      // ========== QUALITY & SAFETY ==========
      inspections: [],
      addInspection: (item) => set((state) => ({ inspections: [...(state.inspections || []), { ...item, id: Date.now().toString() }] })),
      updateInspection: (id, updates) => set((state) => ({ inspections: (state.inspections || []).map(i => i.id === id ? { ...i, ...updates } : i) })),
      deleteInspection: (id) => set((state) => ({ inspections: (state.inspections || []).filter(i => i.id !== id) })),

      observations: [],
      addObservation: (item) => set((state) => ({ observations: [...(state.observations || []), { ...item, id: Date.now().toString() }] })),
      updateObservation: (id, updates) => set((state) => ({ observations: (state.observations || []).map(o => o.id === id ? { ...o, ...updates } : o) })),
      deleteObservation: (id) => set((state) => ({ observations: (state.observations || []).filter(o => o.id !== id) })),

      incidents: [],
      addIncident: (item) => set((state) => ({ incidents: [...(state.incidents || []), { ...item, id: Date.now().toString() }] })),
      updateIncident: (id, updates) => set((state) => ({ incidents: (state.incidents || []).map(i => i.id === id ? { ...i, ...updates } : i) })),
      deleteIncident: (id) => set((state) => ({ incidents: (state.incidents || []).filter(i => i.id !== id) })),

      // ========== BIDDING ==========
      bids: [],
      addBid: (item) => set((state) => ({ bids: [...(state.bids || []), { ...item, id: Date.now().toString() }] })),
      updateBid: (id, updates) => set((state) => ({ bids: (state.bids || []).map(b => b.id === id ? { ...b, ...updates } : b) })),
      deleteBid: (id) => set((state) => ({ bids: (state.bids || []).filter(b => b.id !== id) })),

      // ========== MARKETING ==========
      campaigns: [],
      addCampaign: (item) => set((state) => ({ campaigns: [...(state.campaigns || []), { ...item, id: Date.now().toString() }] })),
      updateCampaign: (id, updates) => set((state) => ({ campaigns: (state.campaigns || []).map(c => c.id === id ? { ...c, ...updates } : c) })),
      deleteCampaign: (id) => set((state) => ({ campaigns: (state.campaigns || []).filter(c => c.id !== id) })),

      reviewRequests: [],
      addReviewRequest: (item) => set((state) => ({ reviewRequests: [...(state.reviewRequests || []), { ...item, id: Date.now().toString() }] })),
      updateReviewRequest: (id, updates) => set((state) => ({ reviewRequests: (state.reviewRequests || []).map(r => r.id === id ? { ...r, ...updates } : r) })),
      deleteReviewRequest: (id) => set((state) => ({ reviewRequests: (state.reviewRequests || []).filter(r => r.id !== id) })),

      referrals: [],
      addReferral: (item) => set((state) => ({ referrals: [...(state.referrals || []), { ...item, id: Date.now().toString() }] })),
      updateReferral: (id, updates) => set((state) => ({ referrals: (state.referrals || []).map(r => r.id === id ? { ...r, ...updates } : r) })),
      deleteReferral: (id) => set((state) => ({ referrals: (state.referrals || []).filter(r => r.id !== id) })),

      // ========== COMMUNICATION ==========
      messages: [],
      addMessage: (item) => set((state) => ({ messages: [...(state.messages || []), { ...item, id: Date.now().toString() }] })),
      updateMessage: (id, updates) => set((state) => ({ messages: (state.messages || []).map(m => m.id === id ? { ...m, ...updates } : m) })),
      deleteMessage: (id) => set((state) => ({ messages: (state.messages || []).filter(m => m.id !== id) })),

      templates: [],
      addTemplate: (item) => set((state) => ({ templates: [...(state.templates || []), { ...item, id: Date.now().toString() }] })),
      updateTemplate: (id, updates) => set((state) => ({ templates: (state.templates || []).map(t => t.id === id ? { ...t, ...updates } : t) })),
      deleteTemplate: (id) => set((state) => ({ templates: (state.templates || []).filter(t => t.id !== id) })),

      // ========== WEBSITE BUILDER ==========
      websitePages: [],
      addWebsitePage: (item) => set((state) => ({ websitePages: [...(state.websitePages || []), { ...item, id: Date.now().toString() }] })),
      updateWebsitePage: (id, updates) => set((state) => ({ websitePages: (state.websitePages || []).map(p => p.id === id ? { ...p, ...updates } : p) })),
      deleteWebsitePage: (id) => set((state) => ({ websitePages: (state.websitePages || []).filter(p => p.id !== id) })),
      websiteSettings: {},
      updateWebsiteSettings: (settings) => set((state) => ({ websiteSettings: { ...state.websiteSettings, ...settings } })),

      // ========== AI RECEPTIONIST ==========
      aiReceptionistRules: [],
      addAIReceptionistRule: (item) => set((state) => ({ aiReceptionistRules: [...(state.aiReceptionistRules || []), { ...item, id: Date.now().toString() }] })),
      updateAIReceptionistRule: (id, updates) => set((state) => ({ aiReceptionistRules: (state.aiReceptionistRules || []).map(r => r.id === id ? { ...r, ...updates } : r) })),
      deleteAIReceptionistRule: (id) => set((state) => ({ aiReceptionistRules: (state.aiReceptionistRules || []).filter(r => r.id !== id) })),
      aiReceptionistSettings: { enabled: false, businessHours: { start: '09:00', end: '17:00' }, greeting: '' },
      updateAIReceptionistSettings: (settings) => set((state) => ({ aiReceptionistSettings: { ...state.aiReceptionistSettings, ...settings } })),
      callLog: [],

      // ========== CONSUMER FINANCING ==========
      financingApplications: [],
      addFinancingApplication: (item) => set((state) => ({ financingApplications: [...(state.financingApplications || []), { ...item, id: Date.now().toString() }] })),
      updateFinancingApplication: (id, updates) => set((state) => ({ financingApplications: (state.financingApplications || []).map(a => a.id === id ? { ...a, ...updates } : a) })),
      deleteFinancingApplication: (id) => set((state) => ({ financingApplications: (state.financingApplications || []).filter(a => a.id !== id) })),
      financingSettings: {},
    }),
    {
      name: 'twomiah-build-crm-data',
    }
  )
);
