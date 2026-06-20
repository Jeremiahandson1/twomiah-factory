import { useState } from 'react';
import { BookOpen, Check, ArrowRight, Sparkles, DollarSign, Zap, BarChart3 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';

const FEATURES = [
  { icon: DollarSign, title: 'Standardized Pricing', desc: 'Set fixed prices for every service so your whole team quotes consistently.' },
  { icon: Zap, title: 'Faster Estimates', desc: 'Build quotes in seconds by selecting from your catalog instead of typing prices.' },
  { icon: BarChart3, title: 'Margin Tracking', desc: 'Set cost vs. sell price to track margins and identify your most profitable services.' },
];

const BENEFITS = [
  'Eliminate pricing inconsistency across your team',
  'New hires can quote accurately from day one',
  'Auto-populate line items on quotes and invoices',
  'Track markup and margins per service category',
];

export default function PricebookTrialPage() {
  const { company } = useAuth();
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');

  const handleStartTrial = async () => {
    setStarting(true);
    setError('');
    try {
      await api.post('/api/support/tickets', {
        subject: 'Pricebook — 30-Day Free Trial Request',
        description: `${company?.name || 'Customer'} is requesting a 30-day free trial of the Pricebook add-on.`,
        category: 'feature_request',
        priority: 'normal',
      });
      setStarted(true);
    } catch {
      setError('Something went wrong. Please try again or contact support.');
    } finally {
      setStarting(false);
    }
  };

  if (started) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
          <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
          Trial Request Submitted!
        </h2>
        <p className="text-gray-600 dark:text-slate-400 text-lg mb-2">
          Our team will activate your 30-day free trial within 24 hours.
        </p>
        <p className="text-gray-500 dark:text-slate-500 text-sm">
          You'll receive an email at <strong>{company?.email}</strong> when it's ready.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 px-4 py-1.5 rounded-full text-sm font-semibold mb-4">
          <Sparkles className="w-4 h-4" />
          30-Day Free Trial
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
          Pricebook
        </h1>
        <p className="text-lg text-gray-600 dark:text-slate-400 max-w-2xl mx-auto">
          A standardized pricing catalog your whole team can use — consistent quotes,
          faster estimates, and better margin tracking.
        </p>
      </div>

      {/* Feature Cards */}
      <div className="grid md:grid-cols-3 gap-6 mb-12">
        {FEATURES.map((f) => (
          <div key={f.title} className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-lg flex items-center justify-center mb-4">
              <f.icon className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{f.title}</h3>
            <p className="text-sm text-gray-600 dark:text-slate-400">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* Benefits + CTA */}
      <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/10 rounded-2xl border border-amber-200 dark:border-amber-500/20 p-8 md:p-10">
        <div className="md:flex md:items-center md:gap-10">
          <div className="flex-1 mb-8 md:mb-0">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Why contractors love it
            </h2>
            <ul className="space-y-3">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <span className="text-gray-700 dark:text-slate-300 text-sm">{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex-shrink-0 text-center md:text-left">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-amber-200 dark:border-amber-500/30 p-6 shadow-sm">
              <BookOpen className="w-10 h-10 text-amber-600 dark:text-amber-400 mx-auto md:mx-0 mb-3" />
              <p className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Free for 30 days</p>
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">No credit card required</p>
              {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
              <button
                onClick={handleStartTrial}
                disabled={starting}
                className="w-full inline-flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors disabled:opacity-50"
              >
                {starting ? 'Submitting...' : 'Start Free Trial'}
                {!starting && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
