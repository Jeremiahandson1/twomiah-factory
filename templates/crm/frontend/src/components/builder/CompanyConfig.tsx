import React, { useRef } from 'react';
import { Building, Upload, Palette, X } from 'lucide-react';
import { useBuilderStore } from '../../stores/builderStore';
import { Input } from '../ui';

const colorPresets = [
  { name: 'Orange', value: '#ec7619' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#10b981' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Amber', value: '#f59e0b' },
];

export function CompanyConfig() {
  const { config, setCompanyName, setCompanyLogo, setPrimaryColor } = useBuilderStore();
  const fileInputRef = useRef(null);

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCompanyLogo(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeLogo = () => {
    setCompanyLogo(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-8">
      {/* Company Name */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Building className="w-5 h-5 text-brand-400" />
          <h3 className="text-lg font-semibold text-white">Company Details</h3>
        </div>
        
        <Input
          label="Company Name"
          placeholder="Enter your company name"
          value={config.companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          className="max-w-md"
        />
        <p className="text-xs text-slate-500 mt-2">
          This will appear in the CRM header and on all documents.
        </p>
      </div>

      {/* Company Logo */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-5 h-5 text-brand-400" />
          <h3 className="text-lg font-semibold text-white">Company Logo</h3>
        </div>
        
        <div className="flex items-start gap-6">
          {/* Logo Preview */}
          <div className="relative">
            {config.companyLogo ? (
              <div className="relative w-32 h-32 bg-slate-800 rounded-xl border-2 border-slate-700 flex items-center justify-center overflow-hidden">
                <img 
                  src={config.companyLogo} 
                  alt="Company logo" 
                  className="max-w-full max-h-full object-contain"
                />
                <button
                  onClick={removeLogo}
                  className="absolute top-1 right-1 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-32 h-32 bg-slate-800 rounded-xl border-2 border-dashed border-slate-600 flex flex-col items-center justify-center hover:border-brand-500 hover:bg-slate-800/50 transition-colors cursor-pointer"
              >
                <Upload className="w-8 h-8 text-slate-500 mb-2" />
                <span className="text-xs text-slate-500">Upload Logo</span>
              </button>
            )}
          </div>

          <div className="flex-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-secondary mb-3"
            >
              {config.companyLogo ? 'Change Logo' : 'Upload Logo'}
            </button>
            <p className="text-xs text-slate-500">
              Recommended: Square image, at least 256x256px. PNG or SVG preferred.
            </p>
          </div>
        </div>
      </div>

      {/* Brand Color */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Palette className="w-5 h-5 text-brand-400" />
          <h3 className="text-lg font-semibold text-white">Brand Color</h3>
        </div>
        
        <div className="space-y-4">
          {/* Color presets */}
          <div className="flex flex-wrap gap-3">
            {colorPresets.map((color) => (
              <button
                key={color.value}
                onClick={() => setPrimaryColor(color.value)}
                className={`
                  w-10 h-10 rounded-lg transition-all duration-200
                  ${config.primaryColor === color.value 
                    ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' 
                    : 'hover:scale-105'
                  }
                `}
                style={{ backgroundColor: color.value }}
                title={color.name}
              />
            ))}
          </div>

          {/* Custom color picker */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={config.primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent"
              />
              <span className="text-sm text-slate-400">Custom Color</span>
            </div>
            <Input
              value={config.primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              placeholder="#000000"
              className="w-32"
            />
          </div>
        </div>
      </div>

      {/* Preview Card */}
      <div className="p-6 bg-slate-800/50 rounded-xl border border-slate-700">
        <p className="text-sm text-slate-400 mb-4">Preview</p>
        <div 
          className="flex items-center gap-3 p-4 rounded-lg"
          style={{ backgroundColor: `${config.primaryColor}20` }}
        >
          {config.companyLogo ? (
            <img src={config.companyLogo} alt="" className="w-10 h-10 object-contain" />
          ) : (
            <div 
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: config.primaryColor }}
            >
              {config.companyName?.[0]?.toUpperCase() || 'C'}
            </div>
          )}
          <div>
            <h4 
              className="font-semibold"
              style={{ color: config.primaryColor }}
            >
              {config.companyName || 'Your Company Name'}
            </h4>
            <p className="text-xs text-slate-500">CRM Dashboard</p>
          </div>
        </div>
      </div>
    </div>
  );
}
