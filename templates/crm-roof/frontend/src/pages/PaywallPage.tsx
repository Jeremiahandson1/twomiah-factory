import { Link } from 'react-router-dom';
import { Lock, Shield, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Hard-lock paywall page shown when a tenant's 30-day trial has expired and
 * no paying subscription exists. Every protected route redirects here until
 * the customer upgrades (via /crm/settings/billing which remains accessible).
 */
export default function PaywallPage() {
  const { company, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="bg-gradient-to-br from-red-600 to-orange-600 px-8 py-10 text-white text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-4">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Your free trial has ended</h1>
          <p className="text-white/90">
            {company?.name ? `${company.name}'s CRM ` : 'Your CRM '}is locked until you upgrade.
          </p>
        </div>

        <div className="p-8 space-y-6">
          <div className="flex gap-3 bg-green-50 border border-green-200 rounded-lg p-4">
            <Shield className="w-5 h-5 text-green-700 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-900">Your data is safe</p>
              <p className="text-sm text-green-800 mt-1">
                Every contact, job, quote, invoice, document, and file you created
                during your trial is still here. Upgrade at any time and everything
                unlocks exactly as you left it.
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm text-gray-600 mb-4">
              Pick a plan that fits your team and you&apos;re back in business in
              under a minute.
            </p>
            <Link
              to="/crm/billing/pricing"
              className="flex items-center justify-center gap-2 w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              Upgrade to unlock
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="pt-4 border-t border-gray-100 text-center">
            <p className="text-xs text-gray-500">
              Questions?{' '}
              <a href="mailto:support@twomiah.com" className="text-orange-600 hover:underline">
                Contact support
              </a>
              {' '}or{' '}
              <button onClick={logout} className="text-orange-600 hover:underline">
                sign out
              </button>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
