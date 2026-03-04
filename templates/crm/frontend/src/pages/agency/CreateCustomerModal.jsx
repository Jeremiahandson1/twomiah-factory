import { useState, useEffect } from 'react';
import { 
  X, Building2, User, Mail, Phone, MapPin, Palette,
  Package, Check, ChevronDown, ChevronRight, Loader2,
  Copy, CheckCircle
} from 'lucide-react';
import api from '../../services/api';

/**
 * Create Customer Modal
 * 
 * Step 1: Company Info + Logo + Colors
 * Step 2: Select Features (checkboxes by category)
 * Step 3: Admin Account
 * Step 4: Confirm & Create
 */
export default function CreateCustomerModal({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [featureRegistry, setFeatureRegistry] = useState(null);
  const [packages, setPackages] = useState(null);
  const [created, setCreated] = useState(null);
  
  // Form data
  const [form, setForm] = useState({
    // Company
    name: '',
    slug: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    
    // Branding
    logo: '',
    primaryColor: '#f97316',
    secondaryColor: '#1e293b',
    
    // Features
    selectedPackage: null,
    enabledFeatures: [],
    
    // Admin
    adminFirstName: '',
    adminLastName: '',
    adminEmail: '',
    adminPassword: '',
  });

  // Load feature registry on mount
  useEffect(() => {
    loadFeatures();
  }, []);

  const loadFeatures = async () => {
    try {
      const data = await api.get('/api/agency/features');
      setFeatureRegistry(data.registry);
      setPackages(data.packages);
    } catch (error) {
      console.error('Failed to load features:', error);
    }
  };

  // Auto-generate slug from name
  useEffect(() => {
    if (form.name && !form.slug) {
      const slug = form.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      setForm(f => ({ ...f, slug }));
    }
  }, [form.name]);

  const handleFeatureToggle = (featureId) => {
    setForm(f => {
      const features = f.enabledFeatures.includes(featureId)
        ? f.enabledFeatures.filter(id => id !== featureId)
        : [...f.enabledFeatures, featureId];
      return { ...f, enabledFeatures: features, selectedPackage: null };
    });
  };

  const handlePackageSelect = (packageId) => {
    const pkg = packages[packageId];
    if (!pkg) return;
    
    const features = pkg.features === 'all' 
      ? getAllFeatureIds() 
      : pkg.features;
    
    setForm(f => ({
      ...f,
      selectedPackage: packageId,
      enabledFeatures: features,
    }));
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

  const handleCreate = async () => {
    setLoading(true);
    try {
      const result = await api.post('/api/agency/customers', {
        name: form.name,
        slug: form.slug,
        email: form.email,
        phone: form.phone,
        address: form.address,
        city: form.city,
        state: form.state,
        zip: form.zip,
        logo: form.logo || undefined,
        primaryColor: form.primaryColor,
        secondaryColor: form.secondaryColor,
        enabledFeatures: form.enabledFeatures,
        adminFirstName: form.adminFirstName,
        adminLastName: form.adminLastName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword || undefined,
      });
      
      setCreated(result);
      setStep(5); // Success step
    } catch (error) {
      alert(error.response?.data?.error || 'Failed to create customer');
    } finally {
      setLoading(false);
    }
  };

  const isStepValid = () => {
    switch (step) {
      case 1:
        return form.name && form.email;
      case 2:
        return form.enabledFeatures.length > 0;
      case 3:
        return form.adminFirstName && form.adminLastName && form.adminEmail;
      default:
        return true;
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b flex items-center justify-between bg-gray-50">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Create New Customer</h2>
              <p className="text-sm text-gray-500">
                {step === 1 && 'Company Information'}
                {step === 2 && 'Select Features'}
                {step === 3 && 'Admin Account'}
                {step === 4 && 'Review & Create'}
                {step === 5 && 'Customer Created!'}
              </p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Progress */}
          {step < 5 && (
            <div className="px-6 py-3 border-b bg-gray-50">
              <div className="flex gap-2">
                {[1, 2, 3, 4].map(s => (
                  <div
                    key={s}
                    className={`flex-1 h-2 rounded-full ${
                      s <= step ? 'bg-orange-500' : 'bg-gray-200'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Step 1: Company Info */}
            {step === 1 && (
              <div className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Company Name *
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value, slug: '' })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="ABC Plumbing"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      URL Slug
                    </label>
                    <div className="flex items-center">
                      <span className="text-gray-400 text-sm mr-1">app.twomiah-build.com/</span>
                      <input
                        type="text"
                        value={form.slug}
                        onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                        className="flex-1 px-3 py-2 border rounded-lg text-sm"
                        placeholder="abc-plumbing"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="info@abcplumbing.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>

                {/* Address */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Address
                  </label>
                  <input
                    type="text"
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg mb-2"
                    placeholder="123 Main St"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })}
                      className="px-4 py-2 border rounded-lg"
                      placeholder="City"
                    />
                    <input
                      type="text"
                      value={form.state}
                      onChange={(e) => setForm({ ...form, state: e.target.value })}
                      className="px-4 py-2 border rounded-lg"
                      placeholder="State"
                    />
                    <input
                      type="text"
                      value={form.zip}
                      onChange={(e) => setForm({ ...form, zip: e.target.value })}
                      className="px-4 py-2 border rounded-lg"
                      placeholder="ZIP"
                    />
                  </div>
                </div>

                {/* Branding */}
                <div>
                  <h3 className="font-medium text-gray-900 mb-3">Branding</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Logo URL
                      </label>
                      <input
                        type="url"
                        value={form.logo}
                        onChange={(e) => setForm({ ...form, logo: e.target.value })}
                        className="w-full px-4 py-2 border rounded-lg text-sm"
                        placeholder="https://..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Primary Color
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.primaryColor}
                          onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                          className="w-10 h-10 rounded border cursor-pointer"
                        />
                        <input
                          type="text"
                          value={form.primaryColor}
                          onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
                          className="flex-1 px-3 py-2 border rounded-lg text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Secondary Color
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={form.secondaryColor}
                          onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                          className="w-10 h-10 rounded border cursor-pointer"
                        />
                        <input
                          type="text"
                          value={form.secondaryColor}
                          onChange={(e) => setForm({ ...form, secondaryColor: e.target.value })}
                          className="flex-1 px-3 py-2 border rounded-lg text-sm"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Features */}
            {step === 2 && featureRegistry && (
              <div className="space-y-6">
                {/* Package Presets */}
                {packages && (
                  <div>
                    <h3 className="font-medium text-gray-900 mb-3">Quick Start Packages</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {Object.values(packages).map(pkg => (
                        <button
                          key={pkg.id}
                          onClick={() => handlePackageSelect(pkg.id)}
                          className={`p-4 border rounded-xl text-left transition-all ${
                            form.selectedPackage === pkg.id
                              ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200'
                              : 'hover:border-gray-300'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium text-gray-900">{pkg.name}</span>
                            {form.selectedPackage === pkg.id && (
                              <CheckCircle className="w-5 h-5 text-orange-500" />
                            )}
                          </div>
                          <p className="text-sm text-gray-500">{pkg.description}</p>
                          <p className="text-sm font-medium text-orange-600 mt-2">{pkg.price}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Individual Features */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-medium text-gray-900">Or Select Individual Features</h3>
                    <span className="text-sm text-gray-500">
                      {form.enabledFeatures.length} selected
                    </span>
                  </div>

                  <div className="space-y-4">
                    {Object.entries(featureRegistry).map(([categoryKey, category]) => (
                      <FeatureCategory
                        key={categoryKey}
                        category={category}
                        enabledFeatures={form.enabledFeatures}
                        onToggle={handleFeatureToggle}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Admin Account */}
            {step === 3 && (
              <div className="space-y-4">
                <p className="text-gray-600 mb-4">
                  Create an admin account for this customer. They'll use this to log in.
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      First Name *
                    </label>
                    <input
                      type="text"
                      value={form.adminFirstName}
                      onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Last Name *
                    </label>
                    <input
                      type="text"
                      value={form.adminLastName}
                      onChange={(e) => setForm({ ...form, adminLastName: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    value={form.adminEmail}
                    onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                    placeholder="owner@abcplumbing.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password (optional - will auto-generate if blank)
                  </label>
                  <input
                    type="text"
                    value={form.adminPassword}
                    onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                    placeholder="Leave blank to auto-generate"
                  />
                </div>
              </div>
            )}

            {/* Step 4: Review */}
            {step === 4 && (
              <div className="space-y-6">
                <div className="bg-gray-50 rounded-xl p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Company</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-gray-500">Name:</span> {form.name}</div>
                    <div><span className="text-gray-500">Slug:</span> /{form.slug}</div>
                    <div><span className="text-gray-500">Email:</span> {form.email}</div>
                    <div><span className="text-gray-500">Phone:</span> {form.phone || '-'}</div>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4">
                  <h4 className="font-medium text-gray-900 mb-3">
                    Features ({form.enabledFeatures.length} enabled)
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {form.enabledFeatures.slice(0, 10).map(id => (
                      <span key={id} className="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded-full">
                        {id}
                      </span>
                    ))}
                    {form.enabledFeatures.length > 10 && (
                      <span className="px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded-full">
                        +{form.enabledFeatures.length - 10} more
                      </span>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4">
                  <h4 className="font-medium text-gray-900 mb-3">Admin Account</h4>
                  <div className="text-sm">
                    <div><span className="text-gray-500">Name:</span> {form.adminFirstName} {form.adminLastName}</div>
                    <div><span className="text-gray-500">Email:</span> {form.adminEmail}</div>
                    <div><span className="text-gray-500">Password:</span> {form.adminPassword || '(auto-generated)'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 5: Success */}
            {step === 5 && created && (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Customer Created!</h3>
                <p className="text-gray-600 mb-6">
                  {created.company.name} is ready to use.
                </p>

                <div className="bg-gray-50 rounded-xl p-4 text-left mb-6">
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm text-gray-500">Login URL</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-white border rounded text-sm">
                          {created.loginUrl}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(created.loginUrl)}
                          className="p-2 hover:bg-gray-200 rounded"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="text-sm text-gray-500">Admin Email</label>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 px-3 py-2 bg-white border rounded text-sm">
                          {created.adminUser.email}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(created.adminUser.email)}
                          className="p-2 hover:bg-gray-200 rounded"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {created.generatedPassword && (
                      <div>
                        <label className="text-sm text-gray-500">Generated Password (save this!)</label>
                        <div className="flex items-center gap-2">
                          <code className="flex-1 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded text-sm font-mono">
                            {created.generatedPassword}
                          </code>
                          <button
                            onClick={() => navigator.clipboard.writeText(created.generatedPassword)}
                            className="p-2 hover:bg-gray-200 rounded"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={onCreated}
                  className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
                >
                  Done
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          {step < 5 && (
            <div className="px-6 py-4 border-t bg-gray-50 flex justify-between">
              <button
                onClick={() => step > 1 ? setStep(step - 1) : onClose()}
                className="px-4 py-2 border rounded-lg hover:bg-gray-100"
              >
                {step === 1 ? 'Cancel' : 'Back'}
              </button>

              {step < 4 ? (
                <button
                  onClick={() => setStep(step + 1)}
                  disabled={!isStepValid()}
                  className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={loading}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create Customer
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FeatureCategory({ category, enabledFeatures, onToggle }) {
  const [expanded, setExpanded] = useState(!category.alwaysEnabled);

  const features = Object.values(category.features);
  const enabledCount = features.filter(f => enabledFeatures.includes(f.id)).length;

  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100"
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
          <span className="font-medium text-gray-900">{category.name}</span>
          {category.alwaysEnabled && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
              Always included
            </span>
          )}
        </div>
        <span className="text-sm text-gray-500">
          {enabledCount}/{features.length}
        </span>
      </button>

      {expanded && (
        <div className="p-4 grid grid-cols-2 gap-3">
          {features.map(feature => (
            <label
              key={feature.id}
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                enabledFeatures.includes(feature.id)
                  ? 'border-orange-300 bg-orange-50'
                  : 'hover:border-gray-300'
              } ${category.alwaysEnabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                checked={enabledFeatures.includes(feature.id) || category.alwaysEnabled}
                onChange={() => !category.alwaysEnabled && onToggle(feature.id)}
                disabled={category.alwaysEnabled}
                className="mt-1 w-4 h-4 text-orange-500 rounded border-gray-300 focus:ring-orange-500"
              />
              <div>
                <p className="font-medium text-gray-900 text-sm">{feature.name}</p>
                <p className="text-xs text-gray-500">{feature.description}</p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
