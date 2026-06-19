import { ExternalLink } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function VisualizerPage() {
  const { company, hasFeature } = useAuth();

  if (!hasFeature('visualizer')) {
    return (
      <div className="flex items-center justify-center h-64 flex-col gap-4">
        <p className="text-gray-500">This feature is not included in your plan.</p>
        <a href="https://twomiah.com/vision" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1">
          Learn more <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    );
  }

  const visionUrl = (company as any)?.visionUrl;

  if (!visionUrl) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
          Visualizer Not Configured
        </h2>
        <p className="text-gray-500 dark:text-slate-400">
          Your Exterior Visualizer add-on is enabled but hasn't been deployed yet.
          Contact support to complete setup.
        </p>
      </div>
    );
  }

  const embedUrl = `${visionUrl}/embed?tenant=${company?.slug || ''}`;

  return (
    <div className="-m-4 lg:-m-6" style={{ height: 'calc(100vh - 4rem)' }}>
      <iframe
        src={embedUrl}
        className="w-full h-full border-0"
        allow="camera"
        title="Exterior Visualizer"
      />
    </div>
  );
}
