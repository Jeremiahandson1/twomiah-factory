import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Building, Check, Server, Download, Shield, Loader2, ArrowRight } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function SelfHostedPurchasePage() {
  const [licenses, setLicenses] = useState([]);
  const [addons, setAddons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState('');

  const [selectedLicense, setSelectedLicense] = useState('pro');
  const [selectedAddons, setSelectedAddons] = useState([]);
  const [formData, setFormData] = useState({
    email: '',
    companyName: '',
  });

  useEffect(() => {
    loadPricing();
  }, []);

  const loadPricing = async () => {
    try {
      const response = await fetch(`${API_URL}/api/billing/self-hosted/pricing`);
      const data = await response.json();
      setLicenses(data.licenses || []);
      setAddons(data.addons || []);
    } catch (err) {
      setError('Failed to load pricing');
    } finally {
      setLoading(false);
    }
  };

  const toggleAddon = (addonId) => {
    setSelectedAddons(prev =>
      prev.includes(addonId)
        ? prev.filter(id => id !== addonId)
        : [...prev, addonId]
    );
  };

  const calculateTotal = () => {
    const license = licenses.find(l => l.id === selectedLicense);
    const licensePrice = license?.price || 0;
    const addonsPrice = selectedAddons.reduce((sum, id) => {
      const addon = addons.find(a => a.id === id);
      return sum + (addon?.price || 0);
    }, 0);
    return licensePrice + addonsPrice;
  };

  const handlePurchase = async () => {
    if (!formData.email || !formData.companyName) {
      setError('Please fill in all fields');
      return;
    }

    setPurchasing(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/billing/self-hosted/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseId: selectedLicense,
          addons: selectedAddons,
          email: formData.email,
          companyName: formData.companyName,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process purchase');
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
      </div>
    );
  }

  const selectedLicenseData = licenses.find(l => l.id === selectedLicense);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center">
                <Building className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold text-gray-900">{{COMPANY_NAME}}</span>
            </Link>
            <Link to="/pricing" className="text-gray-600 hover:text-gray-900">
              ← Back to Pricing
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Self-Hosted License</h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Own {{COMPANY_NAME}} forever. Deploy on your own servers with full control over your data.
          </p>
        </div>

        {error && (
          <div className="mb-8 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg max-w-2xl mx-auto">
            {error}
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-8">
          {/* License Selection */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Select License</h2>
              <div className="space-y-3">
                {licenses.map((license) => (
                  <button
                    key={license.id}
                    onClick={() => setSelectedLicense(license.id)}
                    className={`w-full p-4 rounded-lg border-2 text-left transition ${
                      selectedLicense === license.id
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-gray-900">{license.name}</span>
                        <p className="text-sm text-gray-500 mt-1">Perpetual license · Unlimited installs</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold text-gray-900">
                          ${license.price.toLocaleString()}
                        </span>
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          selectedLicense === license.id ? 'border-orange-500 bg-orange-500' : 'border-gray-300'
                        }`}>
                          {selectedLicense === license.id && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Add-ons */}
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Optional Services</h2>
              <div className="space-y-3">
                {addons.map((addon) => (
                  <button
                    key={addon.id}
                    onClick={() => toggleAddon(addon.id)}
                    className={`w-full p-4 rounded-lg border-2 text-left transition ${
                      selectedAddons.includes(addon.id)
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-gray-900">{addon.name}</span>
                        {addon.recurring && (
                          <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                            {addon.id === 'updates' ? 'Annual' : 'Monthly'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-gray-900">
                          ${addon.price.toLocaleString()}
                          {addon.recurring && <span className="text-gray-500 font-normal">/{addon.id === 'updates' ? 'yr' : 'mo'}</span>}
                        </span>
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                          selectedAddons.includes(addon.id) ? 'border-orange-500 bg-orange-500' : 'border-gray-300'
                        }`}>
                          {selectedAddons.includes(addon.id) && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Your Info */}
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Information</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
                    placeholder="you@company.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Name *</label>
                  <input
                    type="text"
                    value={formData.companyName}
                    onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900"
                    placeholder="Your Company"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Order Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border p-6 sticky top-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Order Summary</h2>
              
              <div className="space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-gray-600">{selectedLicenseData?.name}</span>
                  <span className="font-medium">${selectedLicenseData?.price.toLocaleString()}</span>
                </div>
                
                {selectedAddons.map((addonId) => {
                  const addon = addons.find(a => a.id === addonId);
                  return (
                    <div key={addonId} className="flex justify-between text-sm">
                      <span className="text-gray-600">{addon?.name}</span>
                      <span>${addon?.price.toLocaleString()}</span>
                    </div>
                  );
                })}
                
                <hr />
                
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>${calculateTotal().toLocaleString()}</span>
                </div>
              </div>

              <button
                onClick={handlePurchase}
                disabled={purchasing}
                className="w-full bg-orange-500 text-white py-4 rounded-lg font-semibold hover:bg-orange-600 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {purchasing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    Purchase License
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              {/* Benefits */}
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <Server className="w-5 h-5 text-green-500" />
                  <span>Deploy on your own servers</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <Shield className="w-5 h-5 text-green-500" />
                  <span>Full data ownership & control</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <Download className="w-5 h-5 text-green-500" />
                  <span>Instant download after purchase</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <Check className="w-5 h-5 text-green-500" />
                  <span>Perpetual license · No recurring fees</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
