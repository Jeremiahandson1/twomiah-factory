import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FolderKanban, MapPin, Calendar, Loader2, ArrowRight } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

const STATUS_STYLES = {
  planning: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  on_hold: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function PortalProjects() {
  const { token } = useParams();
  const { fetch: portalFetch } = usePortal();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProjects() {
      try {
        const data = await portalFetch('/projects');
        setProjects(data);
      } catch (error) {
        console.error('Failed to load projects:', error);
      } finally {
        setLoading(false);
      }
    }
    loadProjects();
  }, [portalFetch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const activeProjects = projects.filter(p => p.status === 'active');
  const otherProjects = projects.filter(p => p.status !== 'active');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
        <p className="text-gray-600">Track the progress of your projects.</p>
      </div>

      {projects.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FolderKanban className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No projects yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active projects */}
          {activeProjects.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">
                Active Projects ({activeProjects.length})
              </h2>
              <div className="grid gap-4">
                {activeProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} token={token} />
                ))}
              </div>
            </div>
          )}

          {/* Other projects */}
          {otherProjects.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Other Projects</h2>
              <div className="grid gap-4">
                {otherProjects.map((project) => (
                  <ProjectCard key={project.id} project={project} token={token} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, token }) {
  const address = [project.address, project.city, project.state].filter(Boolean).join(', ');

  return (
    <Link
      to={`/portal/${token}/projects/${project.id}`}
      className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-purple-100 rounded-lg">
            <FolderKanban className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{project.name}</h3>
            <p className="text-sm text-gray-500">{project.number}</p>
            {address && (
              <p className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                <MapPin className="w-3 h-3" />
                {address}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${STATUS_STYLES[project.status] || STATUS_STYLES.planning}`}>
            {project.status?.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {project.progress !== null && project.progress !== undefined && (
        <div className="mt-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Progress</span>
            <span className="font-medium">{project.progress}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all"
              style={{ width: `${project.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Dates */}
      {(project.startDate || project.endDate) && (
        <div className="flex items-center gap-4 mt-4 text-sm text-gray-500">
          <Calendar className="w-4 h-4" />
          {project.startDate && (
            <span>Started: {new Date(project.startDate).toLocaleDateString()}</span>
          )}
          {project.endDate && (
            <span>Est. completion: {new Date(project.endDate).toLocaleDateString()}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-end mt-4 text-orange-600 text-sm font-medium">
        View details <ArrowRight className="w-4 h-4 ml-1" />
      </div>
    </Link>
  );
}

// Project detail page
export function PortalProjectDetail() {
  const { token, projectId } = useParams();
  const { fetch: portalFetch } = usePortal();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProject() {
      try {
        const data = await portalFetch(`/projects/${projectId}`);
        setProject(data);
      } catch (error) {
        console.error('Failed to load project:', error);
      } finally {
        setLoading(false);
      }
    }
    loadProject();
  }, [portalFetch, projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!project) {
    return <div className="text-center py-12 text-gray-500">Project not found.</div>;
  }

  const address = [project.address, project.city, project.state, project.zip].filter(Boolean).join(', ');

  return (
    <div>
      <Link to={`/portal/${token}/projects`} className="text-orange-600 hover:underline text-sm mb-4 inline-block">
        ← Back to Projects
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
              <p className="text-gray-500">{project.number}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[project.status] || STATUS_STYLES.planning}`}>
              {project.status?.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Progress */}
        {project.progress !== null && (
          <div className="p-6 border-b">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">Project Progress</span>
              <span className="font-bold text-lg">{project.progress}%</span>
            </div>
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 transition-all"
                style={{ width: `${project.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Details */}
        <div className="p-6 border-b">
          <h3 className="font-semibold text-gray-900 mb-4">Project Details</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {address && (
              <div>
                <dt className="text-sm text-gray-500">Location</dt>
                <dd className="mt-1 text-gray-900">{address}</dd>
              </div>
            )}
            {project.startDate && (
              <div>
                <dt className="text-sm text-gray-500">Start Date</dt>
                <dd className="mt-1 text-gray-900">{new Date(project.startDate).toLocaleDateString()}</dd>
              </div>
            )}
            {project.endDate && (
              <div>
                <dt className="text-sm text-gray-500">Estimated Completion</dt>
                <dd className="mt-1 text-gray-900">{new Date(project.endDate).toLocaleDateString()}</dd>
              </div>
            )}
            {project.description && (
              <div className="sm:col-span-2">
                <dt className="text-sm text-gray-500">Description</dt>
                <dd className="mt-1 text-gray-900">{project.description}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Recent Jobs */}
        {project.jobs?.length > 0 && (
          <div className="p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Recent Work</h3>
            <div className="space-y-3">
              {project.jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium text-gray-900">{job.title}</p>
                    <p className="text-sm text-gray-500">{job.number}</p>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      job.status === 'completed' ? 'bg-green-100 text-green-700' :
                      job.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {job.status?.replace('_', ' ')}
                    </span>
                    {job.scheduledDate && (
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(job.scheduledDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
