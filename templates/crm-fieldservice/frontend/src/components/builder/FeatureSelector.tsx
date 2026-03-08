import React, { useState, useMemo } from 'react';
import { 
  ChevronDown, ChevronRight, Search, CheckCircle2, Circle,
  Megaphone, Calculator, Calendar, Wrench, Building2, ShieldCheck,
  Gavel, Users, MessageSquare, CreditCard, PieChart, Sparkles,
  UserCog, Server
} from 'lucide-react';
import clsx from 'clsx';
import { useBuilderStore } from '../../stores/builderStore';
import { FEATURE_CATEGORIES } from '../../data/features';
import { Checkbox } from '../ui';

const iconMap = {
  Megaphone,
  Calculator,
  Calendar,
  Wrench,
  Building2,
  ShieldCheck,
  Gavel,
  Users,
  MessageSquare,
  CreditCard,
  PieChart,
  Sparkles,
  UserCog,
  Server,
};

function CategorySection({ category, isExpanded, onToggle }) {
  const { config, toggleFeature, enableFeatures, disableFeatures } = useBuilderStore();
  const enabledInCategory = category.features.filter(f => 
    config.enabledFeatures.includes(f.id)
  ).length;
  const totalInCategory = category.features.length;
  const allEnabled = enabledInCategory === totalInCategory;
  const someEnabled = enabledInCategory > 0 && !allEnabled;
  
  const Icon = iconMap[category.icon] || Circle;

  const handleCategoryToggle = () => {
    if (allEnabled) {
      disableFeatures(category.features.map(f => f.id));
    } else {
      enableFeatures(category.features.map(f => f.id));
    }
  };

  return (
    <div className="border border-slate-800 rounded-lg overflow-hidden">
      <div 
        className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 cursor-pointer hover:bg-slate-800 transition-colors"
        onClick={onToggle}
      >
        <button 
          onClick={(e) => { e.stopPropagation(); handleCategoryToggle(); }}
          className={clsx(
            'w-6 h-6 rounded flex items-center justify-center transition-colors',
            allEnabled ? 'bg-brand-500 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
          )}
        >
          {allEnabled && <CheckCircle2 className="w-4 h-4" />}
          {someEnabled && <div className="w-2 h-2 bg-brand-400 rounded-sm" />}
        </button>
        
        <div className="p-1.5 bg-slate-700 rounded">
          <Icon className="w-4 h-4 text-brand-400" />
        </div>
        
        <div className="flex-1">
          <h4 className="text-sm font-medium text-white">{category.name}</h4>
          <p className="text-xs text-slate-500">{enabledInCategory} of {totalInCategory} features</p>
        </div>
        
        <div className="flex items-center gap-2">
          <span className={clsx(
            'text-xs font-medium px-2 py-0.5 rounded',
            enabledInCategory > 0 ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-700 text-slate-500'
          )}>
            {enabledInCategory}/{totalInCategory}
          </span>
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronRight className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </div>
      
      {isExpanded && (
        <div className="px-4 py-3 space-y-2 bg-slate-900/50">
          {category.features.map((feature) => (
            <Checkbox
              key={feature.id}
              checked={config.enabledFeatures.includes(feature.id)}
              onChange={() => toggleFeature(feature.id)}
              label={feature.name}
              description={feature.description}
              className="py-2 px-3 rounded-lg hover:bg-slate-800/50 transition-colors"
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FeatureSelector() {
  const { config, enableAllFeatures, disableAllFeatures } = useBuilderStore();
  const [expandedCategories, setExpandedCategories] = useState(new Set(['crm']));
  const [searchQuery, setSearchQuery] = useState('');

  const toggleCategory = (categoryId) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return FEATURE_CATEGORIES;
    
    const query = searchQuery.toLowerCase();
    return FEATURE_CATEGORIES.map(cat => ({
      ...cat,
      features: cat.features.filter(f => 
        f.name.toLowerCase().includes(query) ||
        f.description.toLowerCase().includes(query)
      )
    })).filter(cat => cat.features.length > 0);
  }, [searchQuery]);

  const totalFeatures = FEATURE_CATEGORIES.reduce((sum, cat) => sum + cat.features.length, 0);
  const enabledCount = config.enabledFeatures.length;

  return (
    <div className="space-y-4">
      {/* Header with search and bulk actions */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            placeholder="Search features..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-11"
          />
        </div>
        <div className="flex gap-2">
          <button 
            onClick={enableAllFeatures}
            className="btn btn-secondary text-xs"
          >
            Select All
          </button>
          <button 
            onClick={disableAllFeatures}
            className="btn btn-ghost text-xs"
          >
            Clear All
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="p-4 bg-slate-800/50 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-slate-300">Features Selected</span>
          <span className="text-sm font-bold text-brand-400">{enabledCount} / {totalFeatures}</span>
        </div>
        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-brand-500 to-amber-500 transition-all duration-300"
            style={{ width: `${(enabledCount / totalFeatures) * 100}%` }}
          />
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-3">
        {filteredCategories.map((category) => (
          <CategorySection
            key={category.id}
            category={category}
            isExpanded={expandedCategories.has(category.id) || searchQuery.trim()}
            onToggle={() => toggleCategory(category.id)}
          />
        ))}
      </div>

      {filteredCategories.length === 0 && (
        <div className="text-center py-8">
          <p className="text-slate-400">No features match your search</p>
        </div>
      )}
    </div>
  );
}
