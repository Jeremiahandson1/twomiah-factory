import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC'
];

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',
  IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',
  ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
  MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',
  TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',
  WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia'
};

interface FormData {
  customerName: string;
  phone: string;
  email: string;
  address: string;
  state: string;
  referralSource: string;
  referralName: string;
}

const REFERRAL_SOURCES = [
  'Door Knock', 'Referral', 'Social Media', 'Google', 'Yard Sign',
  'Home Show', 'Radio/TV', 'Direct Mail', 'Other'
];

export default function EstimatorNewPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormData>({
    customerName: '',
    phone: '',
    email: '',
    address: '',
    state: '',
    referralSource: '',
    referralName: '',
  });
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const update = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const validate = (): boolean => {
    const errs: Partial<Record<keyof FormData, string>> = {};
    if (!form.customerName.trim()) errs.customerName = 'Customer name is required';
    if (!form.phone.trim()) errs.phone = 'Phone number is required';
    else if (form.phone.replace(/\D/g, '').length < 10) errs.phone = 'Enter a valid 10-digit phone number';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Enter a valid email address';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await api.post('/api/estimator/estimates', {
        customerName: form.customerName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        state: form.state || undefined,
        referralSource: form.referralSource || undefined,
        referralName: form.referralName.trim() || undefined,
      });
      navigate(`/estimator/${res.data.id}`);
    } catch (err: any) {
      setErrors({ customerName: err?.response?.data?.message || 'Failed to create estimate. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = (field: keyof FormData) =>
    `w-full h-[56px] px-4 text-lg rounded-xl border-2 transition-colors outline-none
     ${errors[field]
       ? 'border-red-500 bg-red-50 focus:border-red-600'
       : 'border-gray-300 bg-white focus:border-blue-600'}`;

  const labelClass = 'block text-sm font-semibold text-gray-700 mb-1.5';

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">New Estimate</h1>
          <p className="text-lg text-gray-500 mt-1">Enter customer information to begin</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-5">
          {/* Customer Name */}
          <div>
            <label className={labelClass}>
              Customer Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.customerName}
              onChange={e => update('customerName', e.target.value)}
              placeholder="Full name"
              className={inputClass('customerName')}
              autoFocus
            />
            {errors.customerName && (
              <p className="text-red-600 text-sm mt-1 font-medium">{errors.customerName}</p>
            )}
          </div>

          {/* Phone */}
          <div>
            <label className={labelClass}>
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              inputMode="numeric"
              value={form.phone}
              onChange={e => update('phone', formatPhone(e.target.value))}
              placeholder="(555) 123-4567"
              className={inputClass('phone')}
            />
            {errors.phone && (
              <p className="text-red-600 text-sm mt-1 font-medium">{errors.phone}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label className={labelClass}>Email</label>
            <input
              type="email"
              inputMode="email"
              value={form.email}
              onChange={e => update('email', e.target.value)}
              placeholder="customer@email.com"
              className={inputClass('email')}
            />
            {errors.email && (
              <p className="text-red-600 text-sm mt-1 font-medium">{errors.email}</p>
            )}
          </div>

          {/* Address */}
          <div>
            <label className={labelClass}>Address</label>
            <input
              type="text"
              value={form.address}
              onChange={e => update('address', e.target.value)}
              placeholder="Street address"
              className={inputClass('address')}
            />
          </div>

          {/* State */}
          <div>
            <label className={labelClass}>State</label>
            <select
              value={form.state}
              onChange={e => update('state', e.target.value)}
              className={`${inputClass('state')} appearance-none bg-no-repeat bg-right pr-10`}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20' fill='%236b7280'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E")`,
                backgroundPosition: 'right 12px center',
              }}
            >
              <option value="">Select state</option>
              {US_STATES.map(s => (
                <option key={s} value={s}>{STATE_NAMES[s]} ({s})</option>
              ))}
            </select>
          </div>

          {/* Referral Source */}
          <div>
            <label className={labelClass}>Referral Source</label>
            <select
              value={form.referralSource}
              onChange={e => update('referralSource', e.target.value)}
              className={`${inputClass('referralSource')} appearance-none bg-no-repeat bg-right pr-10`}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20' fill='%236b7280'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z'/%3E%3C/svg%3E")`,
                backgroundPosition: 'right 12px center',
              }}
            >
              <option value="">Select source</option>
              {REFERRAL_SOURCES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Referral Name */}
          <div>
            <label className={labelClass}>Referral Name</label>
            <input
              type="text"
              value={form.referralName}
              onChange={e => update('referralName', e.target.value)}
              placeholder="Who referred them?"
              className={inputClass('referralName')}
            />
          </div>
        </div>

        {/* Submit Button */}
        <div className="mt-8">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full h-[56px] bg-blue-600 hover:bg-blue-700 active:bg-blue-800
                       disabled:bg-blue-400 disabled:cursor-not-allowed
                       text-white text-lg font-bold rounded-xl shadow-lg
                       transition-colors flex items-center justify-center gap-3"
          >
            {submitting ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating Estimate...
              </>
            ) : (
              <>
                Next: Select Products
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
