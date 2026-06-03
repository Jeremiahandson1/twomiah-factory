import React from 'react';
import { Package, Check, Zap, Building2, Rocket, Crown } from 'lucide-react';
import clsx from 'clsx';
import { useBuilderStore } from '../../stores/builderStore';
import { PRESET_PACKAGES, getAllFeatureIds } from '../../data/features';

const presetIcons = {
  service_starter: Zap,
  project_pro: Building2,
  contractor_suite: Rocket,
  enterprise: Crown,
};

const presetColors = {
  service_starter: 'from-blue-500 to-cyan-500',
  project_pro: 'from-brand-500 to-amber-500',
  contractor_suite: 'from-purple-500 to-pink-500',
  enterprise: 'from-amber-500 to-yellow-400',
};

export function PresetSelector() {
  const { config, applyPreset } = useBuilderStore();
  
  const getFeatureCount = (preset) => {
    if (preset.features === 'all') return getAllFeatureIds().length;
    return preset.features.length;
  };

  const isPresetSelected = (preset) => {
    const presetFeatures = preset.features === 'all' 
      ? getAllFeatureIds() 
      : preset.features;
    
    if (config.enabledFeatures.length !== presetFeatures.length) return false;
    return presetFeatures.every(f => config.enabledFeatures.includes(f));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Package className="w-5 h-5 text-brand-400" />
        <h3 className="text-lg font-semibold text-white">Quick Start Presets</h3>
      </div>
      
      <p className="text-sm text-slate-400 mb-6">
        Choose a preset package to quickly configure your CRM, or customize features individually below.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {PRESET_PACKAGES.map((preset) => {
          const Icon = presetIcons[preset.id] || Package;
          const isSelected = isPresetSelected(preset);
          const colorClass = presetColors[preset.id];
          
          return (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              className={clsx(
                'relative p-5 rounded-xl border-2 text-left transition-all duration-200',
                'hover:scale-[1.02] active:scale-[0.98]',
                isSelected 
                  ? 'border-brand-500 bg-brand-500/10' 
                  : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
              )}
            >
              {isSelected && (
                <div className="absolute top-3 right-3 w-6 h-6 bg-brand-500 rounded-full flex items-center justify-center">
                  <Check className="w-4 h-4 text-white" />
                </div>
              )}
              
              <div className={clsx(
                'w-10 h-10 rounded-lg flex items-center justify-center mb-3',
                'bg-gradient-to-br',
                colorClass
              )}>
                <Icon className="w-5 h-5 text-white" />
              </div>
              
              <h4 className="text-base font-semibold text-white mb-1">
                {preset.name}
              </h4>
              
              <p className="text-sm text-slate-400 mb-3">
                {preset.description}
              </p>
              
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">
                  {getFeatureCount(preset)} features
                </span>
                <span className={clsx(
                  'text-xs font-bold',
                  preset.id === 'enterprise' ? 'text-amber-400' : 'text-brand-400'
                )}>
                  {preset.price}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
