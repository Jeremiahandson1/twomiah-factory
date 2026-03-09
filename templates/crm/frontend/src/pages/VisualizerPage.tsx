import { useAuth } from '../contexts/AuthContext';

export default function VisualizerPage() {
  const { company, hasFeature } = useAuth();

  if (!hasFeature('visualizer')) {
    // Redirect to Twomiah Vision marketing page
    window.location.href = 'https://twomiah.com/vision';
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Redirecting...</p>
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
          Your Home Visualizer add-on is enabled but hasn't been deployed yet.
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
        title="Home Visualizer"
      />
    </div>
  );
}
