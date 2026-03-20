import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building, Phone, Mail, MapPin, Image, Globe,
  ChevronRight, ChevronLeft, Check, Rocket,
  Sparkles, Link2, ExternalLink, HelpCircle,
  CreditCard, Wrench, ArrowRight, SkipForward,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const STEPS = ['Verify Info', 'Integrations', 'Need Help?', 'All Set!'];

/* ─── Integration definitions ──────────────────────────────────────────────── */
interface Integration {
  id: string;
  label: string;
  description: string;
  category: 'data_import' | 'accounting' | 'dns' | 'communication' | 'payments' | 'compliance';
  guideSteps: string[];
  externalUrl?: string;
  fields?: { key: string; label: string; placeholder: string; type?: string }[];
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'dns',
    label: 'Custom Domain (DNS)',
    description: 'Point your domain to your CRM so clients and caregivers see your brand.',
    category: 'dns',
    guideSteps: [
      'Log into your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.)',
      'Go to DNS settings for your domain',
      'Add a CNAME record pointing your subdomain (e.g. crm.yourdomain.com) to your CRM URL',
      'Save changes — DNS propagation can take up to 24 hours',
    ],
  },
  {
    id: 'caresmartz360',
    label: 'CareSmartz360 Import',
    description: 'Import your existing client and caregiver data from CareSmartz360.',
    category: 'data_import',
    guideSteps: [
      'Log into your CareSmartz360 account and navigate to Reports',
      'Export your client list, caregiver list, and schedule data as CSV files',
      'Go to Settings > Import in your CRM',
      'Upload each CSV file, map the columns to matching fields, and confirm the import',
    ],
  },
  {
    id: 'hhaexchange',
    label: 'HHAeXchange Import',
    description: 'Import your existing client and caregiver data from HHAeXchange.',
    category: 'data_import',
    guideSteps: [
      'Log into your HHAeXchange account and go to the Reports section',
      'Export your client roster, caregiver roster, and authorization data as CSV files',
      'Go to Settings > Import in your CRM',
      'Upload each CSV file, map the columns to matching fields, and confirm the import',
    ],
  },
  {
    id: 'quickbooks',
    label: 'QuickBooks',
    description: 'Sync invoices, payments, and expenses with QuickBooks Online or Desktop.',
    category: 'accounting',
    guideSteps: [
      'Go to Settings > Integrations in your CRM after onboarding',
      'Click "Connect QuickBooks" and sign in to your QuickBooks account',
      'Authorize access to sync invoices, customers, and payments',
      'Choose which data to sync (invoices, expenses, or both)',
    ],
  },
  {
    id: 'stripe',
    label: 'Stripe Payments',
    description: 'Accept credit card payments on invoices and through the family portal.',
    category: 'payments',
    guideSteps: [
      'Go to Settings > Payments in your CRM',
      'Click "Connect Stripe" to create or link your Stripe account',
      'Complete the Stripe onboarding (takes 5-10 minutes)',
      'Once connected, clients and families can pay invoices online',
    ],
  },
  {
    id: 'twilio',
    label: 'Two-Way Texting (Twilio)',
    description: 'Send and receive SMS with clients and caregivers directly from your CRM.',
    category: 'communication',
    guideSteps: [
      'Go to Settings > Integrations > Texting',
      'Enter your Twilio Account SID, Auth Token, and phone number',
      'If you don\'t have Twilio, create an account at twilio.com',
      'Once connected, you can text clients and caregivers from any contact page',
    ],
  },
  {
    id: 'hipaa_compliance',
    label: 'HIPAA Compliance',
    description: 'Ensure your team is trained on HIPAA requirements and audit logging is enabled.',
    category: 'compliance',
    guideSteps: [
      'Go to Settings > Compliance and enable HIPAA audit logging',
      'Review the Business Associate Agreement (BAA) and confirm acceptance',
      'Ensure all team members with system access have completed HIPAA training',
      'Configure automatic session timeout and password complexity requirements',
    ],
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  dns: 'Domain Setup',
  data_import: 'Data Import',
  accounting: 'Accounting',
  payments: 'Payments',
  communication: 'Communication',
  compliance: 'Compliance',
};

const CATEGORY_ORDER = ['dns', 'data_import', 'accounting', 'payments', 'communication', 'compliance'];

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
      console.error('Failed to complete onboarding:', err);
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
                    : 'bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400'}
                `}>
                  {idx < currentStep ? <Check className="w-4 h-4" /> : idx + 1}
                </div>
                <span className={`text-xs hidden sm:block ${idx <= currentStep ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-400 dark:text-slate-500'}`}>
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
          {currentStep === 2 && <StepSetupHelp choice={setupChoice} onChoose={setSetupChoice} />}
          {currentStep === 3 && (
            <StepReady
              profile={profile}
              completedIntegrations={completedIntegrations}
              skippedIntegrations={skippedIntegrations}
              setupChoice={setupChoice}
            />
          )}
        </div>
      </div>

      {/* Navigation */}
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
          <Sparkles className="w-8 h-8 text-orange-500" />
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
          <Check className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
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
  const grouped = CATEGORY_ORDER.map(cat => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    integrations: INTEGRATIONS.filter(i => i.category === cat),
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
                        isDone ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                      }`}>
                        {isDone ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 dark:text-white">{integration.label}</span>
                        {isSkipped && <span className="ml-2 text-xs text-gray-400">(skipped)</span>}
                        {isDone && <span className="ml-2 text-xs text-green-600 dark:text-green-400">(marked done)</span>}
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
                                <span className="w-5 h-5 rounded-full bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 flex items-center justify-center flex-shrink-0 text-xs font-semibold mt-0.5">
                                  {idx + 1}
                                </span>
                                {step}
                              </li>
                            ))}
                          </ol>
                        </div>

                        <div className="flex items-center gap-3 mt-4 pt-3 border-t dark:border-slate-700">
                          <button
                            onClick={() => onDone(integration.id)}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
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
                selected ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
              }`}>
                <Icon className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${selected ? 'text-orange-700 dark:text-orange-400' : 'text-gray-900 dark:text-white'}`}>
                    {option.label}
                  </span>
                  {option.price && (
                    <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${
                      option.price === 'Free'
                        ? 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400'
                        : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400'
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
  const totalIntegrations = INTEGRATIONS.length;
  const setupLabel = SETUP_OPTIONS.find(o => o.id === setupChoice)?.label || "I'll set it up myself";

  return (
    <div className="text-center py-4">
      <div className="w-20 h-20 bg-green-100 dark:bg-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Check className="w-10 h-10 text-green-600 dark:text-green-400" />
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
              <span className="text-green-600 dark:text-green-400 font-medium">{doneCount} connected</span>
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
