import { Ruler } from 'lucide-react';

export default function EstimatorTrialPage() {
  return (
    <div className="max-w-2xl mx-auto py-16 px-4 text-center">
      <div className="w-16 h-16 bg-sky-100 dark:bg-sky-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
        <Ruler className="w-8 h-8 text-sky-600 dark:text-sky-400" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
        Instant Roof Estimator — Coming Soon
      </h2>
      <p className="text-gray-600 dark:text-slate-400">
        This feature is in development and not yet available. Contact support if you'd like to be notified when it launches.
      </p>
    </div>
  );
}
