import { useState, useEffect } from 'react';
import { X, Check, Loader2, ChevronDown, ChevronRight, Package } from 'lucide-react';
import api from '../../services/api';

/**
 * Edit Customer Features Modal
 * 
 * Simple checkbox interface to add/remove features for an existing customer.
 */
export default function CustomerFeaturesModal({ customer, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [featureRegistry, setFeatureRegistry] = useState(null);
  const [packages, setPackages] = useState(null);
  const [enabledFeatures, setEnabledFeatures] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [featuresData, customerData] = await Promise.all([
        api.get('/api/agency/features'),
        api.get(`/api/agency/customers/${customer.id}`),
      ]);
      
      setFeatureRegistry(featuresData.registry);
      setPackages(featuresData.packages);
      setEnabledFeatures(customerData.enabledFeatures || []);
      setSelectedPackage(customerData.settings?.packageId || null);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFeatureToggle = (featureId) => {
    setEnabledFeatures(prev => {
      const updated = prev.includes(featureId)
        ? prev.filter(id => id !== featureId)
        : [...prev, featureId];
      return updated;
    });
    setSelectedPackage(null); // Clear package when manually changing
  };

  const handlePackageSelect = (packageId) => {
    const pkg = packages[packageId];
    if (!pkg) return;
    
    const features = pkg.features === 'all' 
      ? getAllFeatureIds() 
      : [...getCoreFeatureIds(), ...pkg.features];
    
    setSelectedPackage(packageId);
    setEnabledFeatures(features);
  };

  const getAllFeatureIds = () => {
    if (!featureRegistry) return [];
    const ids = [];
    for (const category of Object.values(featureRegistry)) {
      for (const feature of Object.values(category.features)) {
        ids.push(feature.id);
      }
    }
    return ids;
  };

  const getCoreFeatureIds = () => {
    if (!featureRegistry?.core) return [];
    return Object.values(featureRegistry.core.features).map(f => f.id);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/api/agency/customers/${customer.id}/features`, {
        enabledFeatures: enabledFeatures.filter(f => !getCoreFeatureIds().includes(f)),
        packageId: selectedPackage,
      });
      onSaved();
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to save features');
    } finally {
      setSaving(false);
    }
  };

  // Calculate what changed
  const originalFeatures = new Set(customer.enabledFeatures || []);
  const currentFeatures = new Set(enabledFeatures);
  const added = enabledFeatures.filter(f => !originalFeatures.has(f));
  const removed = (customer.enabledFeatures || []).filter(f => !currentFeatures.has(f));
  const hasChanges = added.length > 0 || removed.length > 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Edit Features</h2>
              <p className="text-sm text-gray-500">{customer.name}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Quick Package Selection */}
                {packages && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-3">Quick Packages</h3>
                    <div className="grid grid-cols-3 gap-2">
                      {Object.values(packages).map(pkg => (
                        <button
                          key={pkg.id}
                          onClick={() => handlePackageSelect(pkg.id)}
                          className={`p-3 border rounded-lg text-left text-sm transition-all ${
                            selectedPackage === pkg.id
                              ? 'border-orange-500 bg-orange-50'
                              : 'hover:border-gray-300'
                          }`}
                        >
                          <div className="font-medium text-gray-900">{pkg.name}</div>
                          <div className="text-xs text-gray-500">{pkg.price}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Feature Categories */}
                {featureRegistry && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium text-gray-900">All Features</h3>
                      <span className="text-sm text-gray-500">
                        {enabledFeatures.length} enabled
                      </span>
                    </div>

                    {Object.entries(featureRegistry).map(([key, category]) => (
                      <FeatureCategorySection
                        key={key}
                        category={category}
                        enabledFeatures={enabledFeatures}
                        onToggle={handleFeatureToggle}
                      />
                    ))}
                  </div>
                )}

                {/* Changes Summary */}
                {hasChanges && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <h4 className="font-medium text-amber-800 mb-2">Pending Changes</h4>
                    {added.length > 0 && (
                      <div className="text-sm text-green-700">
                        <span className="font-medium">Adding:</span> {added.join(', ')}
                      </div>
                    )}
                    {removed.length > 0 && (
                      <div className="text-sm text-red-700">
                        <span className="font-medium">Removing:</span> {removed.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 border rounded-lg hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCategorySection({ category, enabledFeatures, onToggle }) {
  const [expanded, setExpanded] = useState(true);
  const features = Object.values(category.features);
  const enabledCount = features.filter(f => enabledFeatures.includes(f.id)).length;

  const toggleAll = () => {
    if (category.alwaysEnabled) return;
    
    const allEnabled = features.every(f => enabledFeatures.includes(f.id));
    features.forEach(f => {
      if (allEnabled && enabledFeatures.includes(f.id)) {
        onToggle(f.id);
      } else if (!allEnabled && !enabledFeatures.includes(f.id)) {
        onToggle(f.id);
      }
    });
  };

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between bg-gray-50">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
          <span className="font-medium text-gray-900">{category.name}</span>
          {category.alwaysEnabled && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
              Core
            </span>
          )}
        </button>
        
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {enabledCount}/{features.length}
          </span>
          {!category.alwaysEnabled && (
            <button
              onClick={toggleAll}
              className="text-xs text-orange-600 hover:text-orange-700"
            >
              {enabledCount === features.length ? 'Deselect All' : 'Select All'}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="p-3 grid grid-cols-2 gap-2">
          {features.map(feature => (
            <label
              key={feature.id}
              className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-all ${
                enabledFeatures.includes(feature.id)
                  ? 'bg-orange-50'
                  : 'hover:bg-gray-50'
              } ${category.alwaysEnabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                checked={enabledFeatures.includes(feature.id) || category.alwaysEnabled}
                onChange={() => !category.alwaysEnabled && onToggle(feature.id)}
                disabled={category.alwaysEnabled}
                className="w-4 h-4 text-orange-500 rounded border-gray-300 focus:ring-orange-500"
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm truncate">{feature.name}</p>
                <p className="text-xs text-gray-500 truncate">{feature.description}</p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
