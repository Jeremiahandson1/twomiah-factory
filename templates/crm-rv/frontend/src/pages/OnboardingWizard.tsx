import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building, Phone, Mail, MapPin, Image,
  Calendar, Receipt, Globe, MapPinned,
  ChevronRight, ChevronLeft, Check, Rocket,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const STEPS = ['Welcome', 'Company Profile', 'Quick Setup', 'Ready!'];

const FEATURES = [
  {
    id: 'scheduling',
    label: 'Scheduling',
    description: 'Manage appointments, assign jobs to team members, and keep your calendar organized.',
    icon: Calendar,
    enabledFeatures: [],
  },
  {
    id: 'invoicing',
    label: 'Invoicing',
    description: 'Create professional invoices, track payments, and manage your cash flow.',
    icon: Receipt,
    enabledFeatures: [],
  },
  {
    id: 'customer_portal',
    label: 'Customer Portal',
    description: 'Give customers a branded portal to view projects, approve quotes, and pay invoices.',
    icon: Globe,
    enabledFeatures: [],
  },
  {
    id: 'gps_tracking',
    label: 'GPS Tracking',
    description: 'Track field crew locations in real time and optimize route planning.',
    icon: MapPinned,
    enabledFeatures: ['fleet'],
  },
];

export default function OnboardingWizard() {
  const navigate = useNavigate();
  const { company, updateCompany } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Company profile form state
  const [profile, setProfile] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    website: '',
    logo: '',
  });

  // Feature toggles
  const [enabledSetup, setEnabledSetup] = useState<Record<string, boolean>>({
    scheduling: true,
    invoicing: true,
    customer_portal: false,
    gps_tracking: false,
  });

  // Pre-fill from existing company data
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

  const toggleFeature = (featureId: string) => {
    setEnabledSetup(prev => ({ ...prev, [featureId]: !prev[featureId] }));
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    try {
      // Save company profile updates
      const profileUpdate: Record<string, any> = {
        name: profile.name,
        phone: profile.phone,
        email: profile.email,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        zip: profile.zip,
      };
      if (profile.website) profileUpdate.website = profile.website;
      if (profile.logo) profileUpdate.logo = profile.logo;

      // Merge onboarding settings into existing settings
      const currentSettings = (company?.settings && typeof company.settings === 'object') ? company.settings : {};
      profileUpdate.settings = {
        ...currentSettings,
        onboardingComplete: true,
        onboardingFeatures: enabledSetup,
      };

      const updated = await api.company.update(profileUpdate);

      // Enable any feature-gated modules from the quick setup
      const featuresToEnable = FEATURES
        .filter(f => enabledSetup[f.id] && f.enabledFeatures.length > 0)
        .flatMap(f => f.enabledFeatures);

      if (featuresToEnable.length > 0) {
        const currentFeatures = Array.isArray(company?.enabledFeatures) ? company.enabledFeatures : [];
        const merged = [...new Set([...currentFeatures, ...featuresToEnable])];
        await api.company.updateFeatures(merged);
        updateCompany({ enabledFeatures: merged });
      }

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
                <div
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                    ${idx < currentStep
                      ? 'bg-orange-500 text-white'
                      : idx === currentStep
                        ? 'bg-orange-500 text-white ring-4 ring-orange-200 dark:ring-orange-500/30'
                        : 'bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-slate-400'
                    }
                  `}
                >
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
          {currentStep === 0 && <StepWelcome companyName={company?.name} />}
          {currentStep === 1 && <StepProfile profile={profile} onChange={handleProfileChange} />}
          {currentStep === 2 && <StepQuickSetup features={enabledSetup} onToggle={toggleFeature} />}
          {currentStep === 3 && <StepReady profile={profile} features={enabledSetup} />}
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="border-t dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-4">
        <div className="max-w-2xl mx-auto flex justify-between">
          {currentStep > 0 ? (
            <button
              onClick={handleBack}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
          ) : (
            <div />
          )}

          {currentStep < STEPS.length - 1 ? (
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors shadow-sm"
            >
              Continue
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleComplete}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Go to Dashboard
                  <Rocket className="w-4 h-4" />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Step Components ---------- */

function StepWelcome({ companyName }: { companyName?: string }) {
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 bg-orange-100 dark:bg-orange-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Sparkles className="w-10 h-10 text-orange-500" />
      </div>
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">
        Welcome to {companyName || 'your CRM'}!
      </h1>
      <p className="text-lg text-gray-600 dark:text-slate-400 mb-8 max-w-md mx-auto">
        Let's get your workspace set up in just a few steps. This will only take a minute.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto text-left">
        {[
          { icon: Building, text: 'Set up your company profile' },
          { icon: Calendar, text: 'Choose the features you need' },
          { icon: Rocket, text: 'Start managing your business' },
        ].map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-start gap-3 p-3 rounded-lg bg-white dark:bg-slate-800 border dark:border-slate-700">
            <Icon className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
            <span className="text-sm text-gray-700 dark:text-slate-300">{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepProfile({ profile, onChange }: { profile: any; onChange: (field: string, value: string) => void }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Company Profile</h2>
      <p className="text-gray-600 dark:text-slate-400 mb-6">Tell us about your business. You can update these later in Settings.</p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
            <Building className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            Company Name
          </label>
          <input
            type="text"
            value={profile.name}
            onChange={e => onChange('name', e.target.value)}
            className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            placeholder="Acme Contractors"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              <Phone className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Phone
            </label>
            <input
              type="tel"
              value={profile.phone}
              onChange={e => onChange('phone', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              <Mail className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Email
            </label>
            <input
              type="email"
              value={profile.email}
              onChange={e => onChange('email', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
              placeholder="info@company.com"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
            <MapPin className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            Street Address
          </label>
          <input
            type="text"
            value={profile.address}
            onChange={e => onChange('address', e.target.value)}
            className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            placeholder="123 Main St"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">City</label>
            <input
              type="text"
              value={profile.city}
              onChange={e => onChange('city', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
              placeholder="City"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">State</label>
            <input
              type="text"
              value={profile.state}
              onChange={e => onChange('state', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
              placeholder="State"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">ZIP</label>
            <input
              type="text"
              value={profile.zip}
              onChange={e => onChange('zip', e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
              placeholder="12345"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
            <Globe className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            Website
          </label>
          <input
            type="url"
            value={profile.website}
            onChange={e => onChange('website', e.target.value)}
            className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            placeholder="https://yourcompany.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
            <Image className="w-4 h-4 inline mr-1.5 -mt-0.5" />
            Logo URL
          </label>
          <input
            type="url"
            value={profile.logo}
            onChange={e => onChange('logo', e.target.value)}
            className="w-full px-3 py-2.5 border dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
            placeholder="https://example.com/logo.png"
          />
          {profile.logo && (
            <div className="mt-2 p-3 border dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-800/50 inline-block">
              <img src={profile.logo} alt="Company logo preview" className="h-12 max-w-[200px] object-contain" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StepQuickSetup({ features, onToggle }: { features: Record<string, boolean>; onToggle: (id: string) => void }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Quick Setup</h2>
      <p className="text-gray-600 dark:text-slate-400 mb-6">
        Enable the features you need. Don't worry, you can always change these in Settings later.
      </p>

      <div className="space-y-3">
        {FEATURES.map(feature => {
          const Icon = feature.icon;
          const enabled = features[feature.id];
          return (
            <button
              key={feature.id}
              onClick={() => onToggle(feature.id)}
              className={`
                w-full flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all
                ${enabled
                  ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10 dark:border-orange-500'
                  : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-600'
                }
              `}
            >
              <div className={`
                w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                ${enabled ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-slate-400'}
              `}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${enabled ? 'text-orange-700 dark:text-orange-400' : 'text-gray-900 dark:text-white'}`}>
                    {feature.label}
                  </span>
                  <div className={`
                    w-10 h-6 rounded-full flex items-center transition-colors p-0.5
                    ${enabled ? 'bg-orange-500 justify-end' : 'bg-gray-300 dark:bg-slate-600 justify-start'}
                  `}>
                    <div className="w-5 h-5 bg-white rounded-full shadow-sm" />
                  </div>
                </div>
                <p className="text-sm text-gray-600 dark:text-slate-400 mt-0.5">{feature.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepReady({ profile, features }: { profile: any; features: Record<string, boolean> }) {
  const enabledFeatures = FEATURES.filter(f => features[f.id]);

  return (
    <div className="text-center py-4">
      <div className="w-20 h-20 bg-green-100 dark:bg-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Check className="w-10 h-10 text-green-600 dark:text-green-400" />
      </div>
      <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">You're all set!</h2>
      <p className="text-lg text-gray-600 dark:text-slate-400 mb-8">
        Here's a summary of your setup. Click "Go to Dashboard" to get started.
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
          {profile.website && <p className="text-sm text-gray-600 dark:text-slate-400">{profile.website}</p>}
        </div>

        <hr className="dark:border-slate-700" />

        <div>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
            Enabled Features ({enabledFeatures.length})
          </h3>
          {enabledFeatures.length > 0 ? (
            <div className="space-y-1.5">
              {enabledFeatures.map(f => {
                const Icon = f.icon;
                return (
                  <div key={f.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                    <Icon className="w-4 h-4 text-orange-500" />
                    {f.label}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-slate-400">No optional features enabled. You can enable them later in Settings.</p>
          )}
        </div>
      </div>
    </div>
  );
}
