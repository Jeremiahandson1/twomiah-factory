import React from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Hammer, ChevronRight, ChevronLeft, Check, Sparkles,
  AlertCircle
} from 'lucide-react';
import clsx from 'clsx';
import { useBuilderStore } from '../../stores/builderStore';
import { Button, Card, CardBody } from '../ui';
import { PresetSelector } from './PresetSelector';
import { FeatureSelector } from './FeatureSelector';
import { CompanyConfig } from './CompanyConfig';

const steps = [
  { id: 1, name: 'Company', description: 'Set up your company details' },
  { id: 2, name: 'Presets', description: 'Choose a starting point' },
  { id: 3, name: 'Features', description: 'Customize your features' },
  { id: 4, name: 'Review', description: 'Confirm and create' },
];

function StepIndicator({ currentStep }) {
  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((step, index) => (
        <React.Fragment key={step.id}>
          <div className="flex items-center">
            <div className={clsx(
              'w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm transition-colors',
              currentStep > step.id && 'bg-emerald-500 text-white',
              currentStep === step.id && 'bg-brand-500 text-white',
              currentStep < step.id && 'bg-slate-800 text-slate-500'
            )}>
              {currentStep > step.id ? (
                <Check className="w-5 h-5" />
              ) : (
                step.id
              )}
            </div>
            <div className="hidden sm:block ml-3">
              <p className={clsx(
                'text-sm font-medium',
                currentStep >= step.id ? 'text-white' : 'text-slate-500'
              )}>
                {step.name}
              </p>
              <p className="text-xs text-slate-500">{step.description}</p>
            </div>
          </div>
          {index < steps.length - 1 && (
            <div className={clsx(
              'w-12 sm:w-24 h-0.5 mx-3',
              currentStep > step.id ? 'bg-emerald-500' : 'bg-slate-700'
            )} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function ReviewStep() {
  const { config } = useBuilderStore();
  
  // Group enabled features by category
  const enabledByCategory = {};
  import('../../data/features').then(({ FEATURE_CATEGORIES }) => {
    FEATURE_CATEGORIES.forEach(cat => {
      const enabled = cat.features.filter(f => config.enabledFeatures.includes(f.id));
      if (enabled.length > 0) {
        enabledByCategory[cat.name] = enabled;
      }
    });
  });

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-brand-500 to-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Ready to Build!</h2>
        <p className="text-slate-400">Review your configuration before creating your CRM</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Company Info */}
        <Card>
          <CardBody>
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
              Company Details
            </h4>
            <div className="flex items-center gap-4">
              {config.companyLogo ? (
                <img src={config.companyLogo} alt="" className="w-14 h-14 object-contain rounded-lg bg-slate-800" />
              ) : (
                <div 
                  className="w-14 h-14 rounded-lg flex items-center justify-center text-white text-xl font-bold"
                  style={{ backgroundColor: config.primaryColor }}
                >
                  {config.companyName?.[0]?.toUpperCase() || '?'}
                </div>
              )}
              <div>
                <p className="text-lg font-semibold text-white">
                  {config.companyName || 'Unnamed Company'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <div 
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: config.primaryColor }}
                  />
                  <span className="text-sm text-slate-400">{config.primaryColor}</span>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Feature Count */}
        <Card>
          <CardBody>
            <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">
              Features Selected
            </h4>
            <p className="text-4xl font-bold text-brand-400 mb-2">
              {config.enabledFeatures.length}
            </p>
            <p className="text-sm text-slate-400">
              features will be enabled in your CRM
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Validation */}
      {!config.companyName && (
        <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-200">
            We recommend adding a company name for a personalized experience.
          </p>
        </div>
      )}

      {config.enabledFeatures.length === 0 && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-200">
            Please select at least one feature to include in your CRM.
          </p>
        </div>
      )}
    </div>
  );
}

export function BuilderPage() {
  const navigate = useNavigate();
  const { step, setStep, nextStep, prevStep, config, buildCRM } = useBuilderStore();

  const canProceed = () => {
    if (step === 4) return config.enabledFeatures.length > 0;
    return true;
  };

  const handleCreate = () => {
    const instance = buildCRM();
    navigate(`/crm/${instance.id}`);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-amber-500 rounded-xl flex items-center justify-center">
                <Hammer className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">{{COMPANY_NAME}} Builder</h1>
                <p className="text-xs text-slate-500">Create your custom CRM</p>
              </div>
            </div>
            
            <button 
              onClick={() => navigate('/instances')}
              className="btn btn-ghost text-sm"
            >
              View My CRMs
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <StepIndicator currentStep={step} />

        <Card className="mb-6">
          <CardBody className="p-8">
            {step === 1 && <CompanyConfig />}
            {step === 2 && <PresetSelector />}
            {step === 3 && <FeatureSelector />}
            {step === 4 && <ReviewStep />}
          </CardBody>
        </Card>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={prevStep}
            disabled={step === 1}
            icon={ChevronLeft}
          >
            Previous
          </Button>

          {step < 4 ? (
            <Button
              onClick={nextStep}
              icon={ChevronRight}
              iconRight
            >
              Continue
            </Button>
          ) : (
            <Button
              onClick={handleCreate}
              disabled={!canProceed()}
              icon={Sparkles}
              className="glow-brand"
            >
              Create CRM
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
