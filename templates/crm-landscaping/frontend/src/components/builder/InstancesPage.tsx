import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Plus, Trash2, ExternalLink, Calendar, Layers, 
  Building, Settings, Search
} from 'lucide-react';
import { format } from 'date-fns';
import { useBuilderStore } from '../../stores/builderStore';
import { Button, Card, CardBody, ConfirmDialog, EmptyState } from '../ui';

export function InstancesPage() {
  const navigate = useNavigate();
  const { instances, deleteInstance, loadInstance } = useBuilderStore();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredInstances = instances.filter(i => 
    i.companyName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleOpen = (instance) => {
    loadInstance(instance.id);
    navigate(`/crm/${instance.id}`);
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-brand-500 to-amber-500 rounded-xl flex items-center justify-center">
                <Layers className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">My CRM Instances</h1>
                <p className="text-xs text-slate-500">{instances.length} configured</p>
              </div>
            </div>
            
            <Button onClick={() => navigate('/')} icon={Plus}>
              Create New
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {instances.length > 0 ? (
          <>
            {/* Search */}
            <div className="mb-6">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search instances..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input pl-11"
                />
              </div>
            </div>

            {/* Instances Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredInstances.map((instance) => (
                <Card 
                  key={instance.id}
                  className="group hover:border-slate-700 transition-colors cursor-pointer"
                  onClick={() => handleOpen(instance)}
                >
                  <CardBody className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        {instance.companyLogo ? (
                          <img 
                            src={instance.companyLogo} 
                            alt="" 
                            className="w-12 h-12 object-contain rounded-lg bg-slate-800"
                          />
                        ) : (
                          <div 
                            className="w-12 h-12 rounded-lg flex items-center justify-center text-white text-lg font-bold"
                            style={{ backgroundColor: instance.primaryColor }}
                          >
                            {instance.companyName?.[0]?.toUpperCase() || 'C'}
                          </div>
                        )}
                        <div>
                          <h3 className="font-semibold text-white group-hover:text-brand-400 transition-colors">
                            {instance.companyName || 'Unnamed CRM'}
                          </h3>
                          <p className="text-xs text-slate-500">
                            {instance.enabledFeatures.length} features
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>
                        Created {format(new Date(instance.createdAt), 'MMM d, yyyy')}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button 
                        size="sm" 
                        variant="secondary"
                        icon={ExternalLink}
                        onClick={(e) => { e.stopPropagation(); handleOpen(instance); }}
                        className="flex-1"
                      >
                        Open
                      </Button>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        icon={Trash2}
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(instance); }}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      />
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>

            {filteredInstances.length === 0 && searchQuery && (
              <EmptyState
                icon={Search}
                title="No matches found"
                description="Try a different search term"
              />
            )}
          </>
        ) : (
          <Card>
            <CardBody>
              <EmptyState
                icon={Building}
                title="No CRM Instances Yet"
                description="Create your first custom CRM to get started"
                action={
                  <Button onClick={() => navigate('/')} icon={Plus}>
                    Create CRM
                  </Button>
                }
              />
            </CardBody>
          </Card>
        )}
      </main>

      {/* Delete Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteInstance(deleteTarget?.id)}
        title="Delete CRM Instance"
        message={`Are you sure you want to delete "${deleteTarget?.companyName || 'this CRM'}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
