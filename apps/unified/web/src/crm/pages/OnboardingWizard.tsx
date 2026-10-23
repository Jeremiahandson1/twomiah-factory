// Moved from templates/crm/frontend/src/pages/OnboardingWizard.tsx.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building, Phone, Mail, MapPin, Image, Globe,
  ChevronRight, ChevronLeft, Check, Rocket,
  Sparkles, Link2, ExternalLink, HelpCircle,
  CreditCard, Wrench, ArrowRight, SkipForward,
} from 'lucide-react';
import { EmailAliasesStep, useAuth, useToast, leadSourceGuides } from '../../shared'
import { api } from '../../api'
import { verticalScreens } from '../vertical'

const STEPS = ['Verify Info', 'Integrations', 'Branded Email', 'Need Help?', 'All Set!'];

/* ─── Integration definitions ──────────────────────────────────────────────── */
interface Integration {
  id: string;
  label: string;
  description: string;
  category: 'lead_sources' | 'accounting' | 'dns' | 'communication' | 'payments';
  guideSteps: string[];
  externalUrl?: string;
  /** A page of this app that does it, opened in a new tab so the wizard keeps its place (a store's Payments and its
   *  product editor — templates/crm-store OnboardingWizard.tsx). */
  open?: { to: string; label: string };
  fields?: { key: string; label: string; placeholder: string; type?: string }[];
}

/** A lead platform's steps as the Lead Sources page gives them (forward its emails to your inbound address) — the wizard
 *  said "Click Connect Angi and enter your Angi Pro credentials", a button no page has. */
const platformSteps = (id: string) => leadSourceGuides().find((g) => g.id === id)?.steps ?? []
/** Integrations a switch (Settings › Features) governs: their setup guide shows only while it is on. */
const SWITCHED: Record<string, string> = { quickbooks: 'quickbooks', stripe: 'online_payments' }

const INTEGRATIONS: Integration[] = [
  {
    // The Domain page connects it (crm/pages/DomainPage.tsx): a CNAME at the registrar is not how this app is reached.
    id: 'dns',
    label: 'Your web address (domain)',
    description: 'Put your website on your own address, like yourbusiness.com.',
    category: 'dns',
    guideSteps: [
      'Open the Domain page',
      'Buy a new address there — you see the first-year price and the yearly renewal before you pay, and we set it up',
      'Or type in one you already own: the page shows the nameservers to set where you bought it',
    ],
    open: { to: '/crm/domain', label: 'Open the Domain page' },
  },
  {
    id: 'quickbooks',
    label: 'QuickBooks',
    // QuickBooks Online only (Intuit's sign-in); the page has Sync Now and an Auto-sync switch, no "choose what to sync".
    description: 'Send your invoices and customers to QuickBooks Online.',
    category: 'accounting',
    guideSteps: [
      'Open Settings › Integrations',
      'Click Connect QuickBooks and sign in to QuickBooks Online (QuickBooks Desktop is not supported)',
      'Pick your company and allow the connection',
      'Press Sync Now, or turn on Auto-sync so each new invoice and customer is sent across',
    ],
    open: { to: '/crm/settings/integrations', label: 'Open Integrations' },
  },
  {
    id: 'jobber',
    label: 'Jobber',
    description: 'Import existing jobs, clients, and quotes from Jobber.',
    category: 'accounting',
    guideSteps: [
      'Export your data from Jobber (Clients, Jobs, Quotes as CSV)',
      'Go to Settings > Import in your CRM',
      'Upload each CSV file and map the columns',
      'Review the import preview and confirm',
    ],
  },
  {
    id: 'angi',
    label: "Angi's List / HomeAdvisor",
    description: 'Forward Angi lead emails into your Lead Inbox.',
    category: 'lead_sources',
    guideSteps: platformSteps('angi'),
    open: { to: '/crm/lead-sources', label: 'Open Lead Sources' },
  },
  {
    id: 'thumbtack',
    label: 'Thumbtack',
    description: 'Forward Thumbtack lead emails into your Lead Inbox.',
    category: 'lead_sources',
    guideSteps: platformSteps('thumbtack'),
    open: { to: '/crm/lead-sources', label: 'Open Lead Sources' },
  },
  {
    id: 'google_lsa',
    label: 'Google Local Services',
    description: 'Forward Google Local Services lead emails into your Lead Inbox.',
    category: 'lead_sources',
    guideSteps: platformSteps('google_lsa'),
    open: { to: '/crm/lead-sources', label: 'Open Lead Sources' },
  },
  {
    id: 'stripe',
    label: 'Stripe Payments',
    description: 'Accept credit card payments on invoices and through the customer portal.',
    category: 'payments',
    guideSteps: [
      'Open Settings › Integrations and click Connect Stripe',
      'Sign in to Stripe, or create a free account — it asks for your business details and the bank account to pay you into (about 10 minutes)',
      'Back in Integrations the Stripe card says "Ready to accept payments"; customers can then pay invoices by card from the invoice email',
    ],
    open: { to: '/crm/settings/integrations', label: 'Open Integrations' },
  },
  {
    // Texting is the business's own registered number, set up in Settings › Texting (crm/pages/TextingPage.tsx) — no
    // Twilio account of its own. The template asked for the owner's Twilio SID and token, which this app never reads.
    id: 'twilio',
    label: 'Two-Way Texting',
    description: 'Send and receive texts with customers from your own business number.',
    category: 'communication',
    guideSteps: [
      'Go to Settings > Texting',
      'Enter your business details — the carriers register a local number in your business’s name',
      'Approval can take several days; Settings > Texting shows where it stands',
      'Once approved, you can text customers from any contact page and the Messages inbox',
    ],
    open: { to: '/crm/settings/texting', label: 'Open Texting settings' },
  },
];

/**
 * The ones this vertical offers (screens.onboarding.integrations; absent, all). A gym or a food truck has no Jobber
 * export and no Angi account, so templates/crm-basic offered only the domain, QuickBooks, Stripe and texting (T41).
 * A category left with none is not shown.
 */
const offeredIntegrations = (): Integration[] => {
  const { integrations: ids, extra } = verticalScreens().onboarding
  // A vertical's own entries, as plain data (screens.onboarding.extra): a dealership's DMS import and its marketplaces
  // (templates/crm-rv OnboardingWizard.tsx), in place of Jobber, Angi, Thumbtack and Google LSA.
  const all = [...INTEGRATIONS, ...(Array.isArray(extra) ? (extra as Integration[]) : [])]
  return ids ? all.filter((i) => ids.includes(i.id)) : all
}

const CATEGORY_LABELS: Record<string, string> = {
  dns: 'Domain Setup',
  lead_sources: 'Lead Sources',
  accounting: 'Accounting & Import',
  payments: 'Payments',
  communication: 'Communication',
  // A vertical's own (screens.onboarding.extra): home care's HIPAA checklist; a store's first product.
  compliance: 'Compliance',
  catalog: 'Products',
};

const CATEGORY_ORDER = ['dns', 'lead_sources', 'accounting', 'payments', 'catalog', 'communication', 'compliance'];

/* ─── Setup service options ────────────────────────────────────────────────── */
const SETUP_OPTIONS = [
  {
    id: 'diy',
    label: "I'll set it up myself",
    description: "You can configure everything from Settings. We'll always be here if you get stuck.",
    price: null,
    icon: Wrench,
  },
  {
    id: 'assisted',
    label: 'Guided Setup Call',
    description: "We'll hop on a 30-minute call and walk you through everything step by step.",
    price: 'Free',
    icon: HelpCircle,
  },
  {
    id: 'done_for_you',
    label: 'Done-For-You Setup',
    description: "We handle everything — integrations, data import, team accounts, and a training walkthrough.",
    price: 'Contact for pricing',
    icon: Sparkles,
  },
];

/* ─── Main Component ───────────────────────────────────────────────────────── */
export default function OnboardingWizard() {
  const navigate = useNavigate();
  const toast = useToast();
  const { company, updateCompany } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Company profile form state — pre-filled from factory data
  const [profile, setProfile] = useState({
    name: '', phone: '', email: '', address: '', city: '', state: '', zip: '', website: '', logo: '',
  });

  // Integration walkthrough state
  const [expandedIntegration, setExpandedIntegration] = useState<string | null>(null);
  const [completedIntegrations, setCompletedIntegrations] = useState<Set<string>>(new Set());
  const [skippedIntegrations, setSkippedIntegrations] = useState<Set<string>>(new Set());

  // Setup choice
  const [setupChoice, setSetupChoice] = useState<string | null>('diy');

  // Pre-fill from existing company data (populated by factory)
  useEffect(() => {
    if (company) {
      setProfile({
        name: company.name || '',
        phone: company.phone || '',
        email: company.email || '',
        address: company.address || '',
        city: company.city || '',
        state: company.state || '',
        zip: company.zip || '',
        website: company.website || '',
        logo: company.logo || '',
      });
    }
  }, [company]);

  const handleProfileChange = (field: string, value: string) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const toggleIntegration = (id: string) => {
    setExpandedIntegration(prev => prev === id ? null : id);
  };

  const markIntegrationDone = (id: string) => {
    setCompletedIntegrations(prev => new Set([...prev, id]));
    setExpandedIntegration(null);
  };

  const skipIntegration = (id: string) => {
    setSkippedIntegrations(prev => new Set([...prev, id]));
    setExpandedIntegration(null);
  };

  const handleNext = () => {
    // Step 0 collects the company name; advancing with it blank later PUT an
    // empty name to /api/company and wiped the company name.
    if (currentStep === 0 && !profile.name?.trim()) {
      toast.error('Company name is required');
      return;
    }
    // A malformed email otherwise poisons the final save (a 400) and loses every edit made on the way
    // (templates/crm-restaurant OnboardingWizard.tsx, ONB-01; taken for every vertical).
    if (currentStep === 0 && profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email).trim())) {
      toast.error('Please enter a valid email address (or leave it blank).');
      return;
    }
    if (currentStep < STEPS.length - 1) setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      const profileUpdate: Record<string, any> = {
        name: profile.name, phone: profile.phone, email: profile.email,
        address: profile.address, city: profile.city, state: profile.state, zip: profile.zip,
      };
      if (profile.website) profileUpdate.website = profile.website;
      if (profile.logo) profileUpdate.logo = profile.logo;

      const currentSettings = (company?.settings && typeof company.settings === 'object') ? company.settings : {};
      profileUpdate.settings = {
        ...currentSettings,
        onboardingComplete: true,
        onboardingCompletedAt: new Date().toISOString(),
        setupChoice: setupChoice || 'diy',
        completedIntegrations: [...completedIntegrations],
        skippedIntegrations: [...skippedIntegrations],
      };

      const updated = await api.company.update(profileUpdate);
      updateCompany(updated);
      navigate('/crm', { replace: true });
    } catch (err) {
      // The template only logged this, so a refused save left the button spinning back to "Go to Dashboard"
      // with nothing said.
      console.error('Failed to complete onboarding:', err);
      toast.error(err instanceof Error ? err.message : 'Your details could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  /**
   * A way out of the wizard at any step: setup is marked complete and the person lands in the CRM; branded email and the
   * rest can be finished from Settings. A step that can't be finished (the Branded Email step on its defaults, which has
   * no Skip of its own) otherwise dead-ends a new customer (templates/crm-restaurant OnboardingWizard.tsx, B-03; taken for
   * every vertical).
   */
  const handleSkip = async () => {
    setSaving(true);
    try {
      const currentSettings = (company?.settings && typeof company.settings === 'object') ? company.settings : {};
      const updated = await api.company.update({
        settings: { ...currentSettings, onboardingComplete: true, onboardingSkipped: true, onboardingCompletedAt: new Date().toISOString() },
      });
      updateCompany(updated);
      navigate('/crm', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Setup could not be skipped. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const progressPercent = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-orange-50 dark:from-slate-950 dark:to-slate-900 flex flex-col">
      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-slate-800 h-1.5">
        <div
          className="h-full bg-orange-500 transition-all duration-500 ease-out rounded-r-full"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="flex justify-end px-4 pt-3">
        <button onClick={handleSkip} disabled={saving} className="text-sm text-gray-600 hover:text-gray-800 dark:text-slate-300 dark:hover:text-slate-100 underline">
          Skip setup for now
        </button>
      </div>

      {/* Step indicators */}
      <div className="flex justify-center pt-8 pb-4 px-4">
        <div className="flex items-center gap-2 sm:gap-4">
          {STEPS.map((label, idx) => (
            <div key={label} className="flex items-center gap-2 sm:gap-4">
              <div className="flex flex-col items-center gap-1">
                <div className={`
                  w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                  ${idx < currentStep ? 'bg-orange-500 text-white'
                    : idx === currentStep ? 'bg-orange-500 text-white ring-4 ring-orange-200 dark:ring-orange-500/30'
                    : 'bg-gray-200 dark:bg-slate-700 text-gray-600 dark:text-slate-300'}
                `}>
                  {idx < currentStep ? <Check className="w-4 h-4" /> : idx + 1}
                </div>
                <span className={`text-xs hidden sm:block ${idx <= currentStep ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-slate-400'}`}>
                  {label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`w-8 sm:w-16 h-0.5 ${idx < currentStep ? 'bg-orange-500' : 'bg-gray-200 dark:bg-slate-700'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl">
          {currentStep === 0 && <StepVerifyInfo profile={profile} onChange={handleProfileChange} companyName={company?.name} />}
          {currentStep === 1 && (
            <StepIntegrations
              expanded={expandedIntegration}
              completed={completedIntegrations}
              skipped={skippedIntegrations}
              onToggle={toggleIntegration}
              onDone={markIntegrationDone}
              onSkip={skipIntegration}
            />
          )}
          {currentStep === 2 && <EmailAliasesStep productId={verticalScreens().onboarding.emailProduct || 'crm'} defaultForwardTo={profile.email} onBack={handleBack} onNext={handleNext} />}
          {currentStep === 3 && <StepSetupHelp choice={setupChoice} onChoose={setSetupChoice} />}
          {currentStep === 4 && (
            <StepReady
              profile={profile}
              completedIntegrations={completedIntegrations}
              skippedIntegrations={skippedIntegrations}
              setupChoice={setupChoice}
            />
          )}
        </div>
      </div>

      {/* Navigation — hidden on the Branded Email step, which ships its own Back/Save controls */}
      {currentStep !== 2 && (
      <div className="border-t dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-4">
        <div className="max-w-2xl mx-auto flex justify-between">
          {currentStep > 0 ? (
            <button onClick={handleBack} className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          ) : <div />}

          <div className="flex items-center gap-3">
            {currentStep === 1 && (
              <button
                onClick={handleNext}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <SkipForward className="w-4 h-4" /> Skip All For Now
              </button>
            )}

            {currentStep < STEPS.length - 1 ? (
              <button onClick={handleNext} className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors shadow-sm">
                {currentStep === 0 ? 'Looks Good' : 'Continue'} <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleComplete}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
              >
                {saving ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving...</>
                ) : (
                  <>Go to Dashboard <Rocket className="w-4 h-4" /></>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

/* ─── Step 1: Verify Info ──────────────────────────────────────────────────── */
function StepVerifyInfo({ profile, onChange, companyName }: { profile: any; onChange: (field: string, value: string) => void; companyName?: string }) {
  const allFilled = profile.name && profile.phone && profile.email && profile.city && profile.state;

  return (
    <div>
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-orange-100 dark:bg-orange-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-8 h-8 text-orange-500 dark:text-orange-200" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Welcome, {companyName || 'there'}!
        </h1>
        <p className="text-gray-600 dark:text-slate-400">
          We've pre-filled your info from setup. Double-check everything looks right, then we'll get you connected.
        </p>
      </div>

      {allFilled && (
        <div className="mb-6 flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30">
          <Check className="w-5 h-5 text-green-700 dark:text-green-400 flex-shrink-0" />
          <span className="text-sm text-green-700 dark:text-green-400">Everything looks pre-filled. Make any corrections below, or hit "Looks Good" to continue.</span>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
            <Building className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Company Name
          </label>
          <input type="text" value={profile.name} onChange={e => onChange('name', e.target.value)}
            className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              <Phone className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Phone
            </label>
            <input type="tel" value={profile.phone} onChange={e => onChange('phone', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              <Mail className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Email
            </label>
            <input type="email" value={profile.email} onChange={e => onChange('email', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
            <MapPin className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Street Address
          </label>
          <input type="text" value={profile.address} onChange={e => onChange('address', e.target.value)}
            className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">City</label>
            <input type="text" value={profile.city} onChange={e => onChange('city', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">State</label>
            <input type="text" value={profile.state} onChange={e => onChange('state', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">ZIP</label>
            <input type="text" value={profile.zip} onChange={e => onChange('zip', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              <Globe className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Website
            </label>
            <input type="url" value={profile.website} onChange={e => onChange('website', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              <Image className="w-4 h-4 inline mr-1.5 -mt-0.5" /> Logo URL
            </label>
            <input type="url" value={profile.logo} onChange={e => onChange('logo', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            />
          </div>
        </div>

        {profile.logo && (
          <div className="p-3 border dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800/50 inline-block">
            <img src={profile.logo} alt="Logo preview" className="h-12 max-w-[200px] object-contain" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Step 2: Integrations ─────────────────────────────────────────────────── */
function StepIntegrations({
  expanded, completed, skipped, onToggle, onDone, onSkip,
}: {
  expanded: string | null;
  completed: Set<string>;
  skipped: Set<string>;
  onToggle: (id: string) => void;
  onDone: (id: string) => void;
  onSkip: (id: string) => void;
}) {
  // A guide to connect QuickBooks or Stripe only where that switch is on: its card in Integrations is shown only then.
  const { hasFeature } = useAuth();
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    integrations: offeredIntegrations().filter(i => i.category === cat && (!SWITCHED[i.id] || hasFeature(SWITCHED[i.id]))),
  })).filter(g => g.integrations.length > 0);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Connect Your Integrations</h2>
      <p className="text-gray-600 dark:text-slate-400 mb-6">
        Set up the tools you use now, or skip any for later. Everything can be configured in Settings at any time.
      </p>

      <div className="space-y-6">
        {grouped.map(group => (
          <div key={group.category}>
            <h3 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">{group.label}</h3>
            <div className="space-y-2">
              {group.integrations.map(integration => {
                const isDone = completed.has(integration.id);
                const isSkipped = skipped.has(integration.id);
                const isExpanded = expanded === integration.id;

                return (
                  <div key={integration.id} className={`border rounded-xl overflow-hidden transition-all ${
                    isDone ? 'border-green-300 dark:border-green-500/40 bg-green-50/50 dark:bg-green-500/5'
                    : isSkipped ? 'border-gray-200 dark:border-slate-700 opacity-60'
                    : isExpanded ? 'border-orange-300 dark:border-orange-500/40 bg-orange-50/30 dark:bg-orange-500/5'
                    : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                  }`}>
                    <button
                      onClick={() => onToggle(integration.id)}
                      className="w-full flex items-center gap-3 p-4 text-left"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isDone ? 'bg-green-700 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'
                      }`}>
                        {isDone ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 dark:text-white">{integration.label}</span>
                        {isSkipped && <span className="ml-2 text-xs text-gray-500 dark:text-slate-400">(skipped)</span>}
                        {isDone && <span className="ml-2 text-xs text-green-700 dark:text-green-400">(marked done)</span>}
                        <p className="text-sm text-gray-500 dark:text-slate-400">{integration.description}</p>
                      </div>
                      <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t dark:border-slate-700">
                        <div className="mt-4 space-y-3">
                          <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300">How to set up:</h4>
                          <ol className="space-y-2">
                            {integration.guideSteps.map((step, idx) => (
                              <li key={idx} className="flex items-start gap-3 text-sm text-gray-600 dark:text-slate-400">
                                <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-200 flex items-center justify-center flex-shrink-0 text-xs font-semibold mt-0.5">
                                  {idx + 1}
                                </span>
                                {step}
                              </li>
                            ))}
                          </ol>
                          {integration.open && (
                            <a href={integration.open.to} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg dark:text-orange-200 dark:bg-orange-500/10 dark:border-orange-500/30 dark:hover:bg-orange-500/20">
                              {integration.open.label} <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>

                        <div className="flex items-center gap-3 mt-4 pt-3 border-t dark:border-slate-700">
                          <button
                            onClick={() => onDone(integration.id)}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-700 hover:bg-green-800 rounded-lg transition-colors"
                          >
                            <Check className="w-4 h-4" /> I've Done This
                          </button>
                          <button
                            onClick={() => onSkip(integration.id)}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                          >
                            Skip For Now
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Step 3: Need Help? ───────────────────────────────────────────────────── */
function StepSetupHelp({ choice, onChoose }: { choice: string | null; onChoose: (id: string) => void }) {
  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Want us to handle the setup?</h2>
        <p className="text-gray-600 dark:text-slate-400">
          You can set everything up yourself, or we can do it for you. Pick what works best.
        </p>
      </div>

      <div className="space-y-3">
        {SETUP_OPTIONS.map(option => {
          const Icon = option.icon;
          const selected = choice === option.id;
          return (
            <button
              key={option.id}
              onClick={() => onChoose(option.id)}
              className={`w-full flex items-start gap-4 p-5 rounded-xl border-2 text-left transition-all ${
                selected
                  ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10 dark:border-orange-500'
                  : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-600'
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                selected ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'
              }`}>
                <Icon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${selected ? 'text-orange-700 dark:text-orange-200' : 'text-gray-900 dark:text-white'}`}>
                    {option.label}
                  </span>
                  {option.price && (
                    <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${
                      option.price === 'Free'
                        ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'
                    }`}>
                      {option.price}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">{option.description}</p>
              </div>
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-1 ${
                selected ? 'border-orange-500 bg-orange-500' : 'border-gray-300 dark:border-slate-600'
              }`}>
                {selected && <Check className="w-3 h-3 text-white" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Step 4: All Set ──────────────────────────────────────────────────────── */
function StepReady({
  profile, completedIntegrations, skippedIntegrations, setupChoice,
}: {
  profile: any;
  completedIntegrations: Set<string>;
  skippedIntegrations: Set<string>;
  setupChoice: string | null;
}) {
  const doneCount = completedIntegrations.size;
  const totalIntegrations = offeredIntegrations().length;
  const setupLabel = SETUP_OPTIONS.find(o => o.id === setupChoice)?.label || "I'll set it up myself";

  return (
    <div className="text-center py-4">
      <div className="w-20 h-20 bg-green-100 dark:bg-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Check className="w-10 h-10 text-green-700 dark:text-green-400" />
      </div>
      <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">You're all set!</h2>
      <p className="text-lg text-gray-600 dark:text-slate-400 mb-8">
        Your CRM is ready to go. Here's a summary of your onboarding.
      </p>

      <div className="bg-white dark:bg-slate-800 border dark:border-slate-700 rounded-xl p-6 text-left max-w-md mx-auto space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Company</h3>
          <p className="text-gray-900 dark:text-white font-medium">{profile.name || 'Not set'}</p>
          {profile.email && <p className="text-sm text-gray-600 dark:text-slate-400">{profile.email}</p>}
          {profile.phone && <p className="text-sm text-gray-600 dark:text-slate-400">{profile.phone}</p>}
          {(profile.address || profile.city) && (
            <p className="text-sm text-gray-600 dark:text-slate-400">
              {[profile.address, profile.city, profile.state, profile.zip].filter(Boolean).join(', ')}
            </p>
          )}
        </div>

        <hr className="dark:border-slate-700" />

        <div>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Integrations</h3>
          {doneCount > 0 ? (
            <p className="text-sm text-gray-700 dark:text-slate-300">
              <span className="text-green-700 dark:text-green-400 font-medium">{doneCount} connected</span>
              {skippedIntegrations.size > 0 && <>, {skippedIntegrations.size} skipped</>}
              {(totalIntegrations - doneCount - skippedIntegrations.size) > 0 && <>, {totalIntegrations - doneCount - skippedIntegrations.size} remaining</>}
            </p>
          ) : (
            <p className="text-sm text-gray-500 dark:text-slate-400">No integrations set up yet. You can connect them anytime from Settings.</p>
          )}
        </div>

        <hr className="dark:border-slate-700" />

        <div>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">Setup Preference</h3>
          <p className="text-sm text-gray-700 dark:text-slate-300">{setupLabel}</p>
        </div>
      </div>
    </div>
  );
}
