import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY'
];

const REFERRAL_SOURCES = [
  { value: 'google', label: 'Google' },
  { value: 'referral', label: 'Referral' },
  { value: 'door_knock', label: 'Door Knock' },
  { value: 'home_show', label: 'Home Show' },
  { value: 'other', label: 'Other' },
];

interface FormData {
  customer_name: string;
  phone: string;
  email: string;
  address: string;
  state: string;
  referral_source: string;
  referral_name: string;
}

export default function QuoteNewPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<FormData>({
    customer_name: '',
    phone: '',
    email: '',
    address: '',
    state: '',
    referral_source: '',
    referral_name: '',
  });

  const update = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.customer_name.trim()) errs.customer_name = 'Customer name is required';
    if (!form.phone.trim()) errs.phone = 'Phone number is required';
    if (form.referral_source === 'referral' && !form.referral_name.trim()) {
      errs.referral_name = 'Referral name is required';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await api.post('/api/quotes', {
        customer_name: form.customer_name,
        phone: form.phone,
        email: form.email || undefined,
        address: form.address || undefined,
        state: form.state || undefined,
        referral_source: form.referral_source || undefined,
        referral_name: form.referral_source === 'referral' ? form.referral_name : undefined,
        status: 'draft',
      });
      navigate(`/quote/${res.data.id}`);
    } catch (err) {
      console.error('Failed to create quote', err);
      setErrors({ _form: 'Failed to create quote. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = (field: string) =>
    `w-full px-4 py-4 text-lg rounded-lg border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
      errors[field] ? 'border-red-500 bg-red-50' : 'border-gray-300 bg-white'
    }`;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Step indicator */}
      <div className="max-w-2xl mx-auto mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-600 text-white font-bold text-lg">
            1
          </div>
          <div className="flex-1 h-1 bg-gray-300 rounded" />
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-300 text-gray-500 font-bold text-lg">
            2
          </div>
          <div className="flex-1 h-1 bg-gray-300 rounded" />
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-300 text-gray-500 font-bold text-lg">
            3
          </div>
        </div>
        <p className="text-sm text-gray-500 font-medium">Step 1 of 3 — Customer Information</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-5">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">New Quote</h1>

        {errors._form && (
          <div className="p-4 bg-red-100 text-red-800 rounded-lg text-lg font-medium">
            {errors._form}
          </div>
        )}

        {/* Customer Name */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Customer Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className={inputClass('customer_name')}
            placeholder="Full name"
            value={form.customer_name}
            onChange={(e) => update('customer_name', e.target.value)}
          />
          {errors.customer_name && <p className="mt-1 text-sm text-red-600">{errors.customer_name}</p>}
        </div>

        {/* Phone */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            Phone <span className="text-red-500">*</span>
          </label>
          <input
            type="tel"
            className={inputClass('phone')}
            placeholder="(555) 555-5555"
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
          />
          {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone}</p>}
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
          <input
            type="email"
            className={inputClass('email')}
            placeholder="customer@email.com"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
          />
        </div>

        {/* Address */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Address</label>
          <input
            type="text"
            className={inputClass('address')}
            placeholder="Street address"
            value={form.address}
            onChange={(e) => update('address', e.target.value)}
          />
        </div>

        {/* State */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">State</label>
          <select
            className={inputClass('state')}
            value={form.state}
            onChange={(e) => update('state', e.target.value)}
          >
            <option value="">Select state...</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Referral Source */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Referral Source</label>
          <select
            className={inputClass('referral_source')}
            value={form.referral_source}
            onChange={(e) => update('referral_source', e.target.value)}
          >
            <option value="">Select source...</option>
            {REFERRAL_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Referral Name - conditional */}
        {form.referral_source === 'referral' && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Referral Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className={inputClass('referral_name')}
              placeholder="Who referred them?"
              value={form.referral_name}
              onChange={(e) => update('referral_name', e.target.value)}
            />
            {errors.referral_name && <p className="mt-1 text-sm text-red-600">{errors.referral_name}</p>}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-5 px-8 text-xl font-bold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:bg-blue-400 rounded-xl transition-colors min-h-[60px]"
        >
          {submitting ? 'Creating...' : 'Next: Select Products'}
        </button>
      </form>
    </div>
  );
}
