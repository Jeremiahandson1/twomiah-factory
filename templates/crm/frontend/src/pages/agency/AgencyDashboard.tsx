import { useState, useEffect } from 'react';
import { 
  Building2, Users, Briefcase, Plus, Search,
  Settings, Trash2, MoreVertical, ExternalLink,
  CheckCircle, Package
} from 'lucide-react';
import api from '../../services/api';
import CreateCustomerModal from './CreateCustomerModal';
import CustomerFeaturesModal from './CustomerFeaturesModal';

/**
 * Agency Admin Dashboard
 * 
 * The control center for managing customer CRM deployments.
 */
export default function AgencyDashboard() {
  const [stats, setStats] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showFeaturesModal, setShowFeaturesModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, customersData] = await Promise.all([
        api.get('/api/agency/stats'),
        api.get('/api/agency/customers'),
      ]);
      setStats(statsData);
      setCustomers(customersData.data || []);
    } catch (error) {
      console.error('Failed to load agency data:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleCustomerCreated = () => {
    setShowCreateModal(false);
    loadData();
  };

  const handleEditFeatures = (customer) => {
    setSelectedCustomer(customer);
    setShowFeaturesModal(true);
  };

  const handleFeaturesUpdated = () => {
    setShowFeaturesModal(false);
    setSelectedCustomer(null);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agency Dashboard</h1>
          <p className="text-gray-500">Manage your customer CRM deployments</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600"
        >
          <Plus className="w-5 h-5" />
          New Customer
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard
            icon={Building2}
            label="Total Customers"
            value={stats.totalCustomers}
            color="blue"
          />
          <StatCard
            icon={Users}
            label="Total Users"
            value={stats.totalUsers}
            color="green"
          />
          <StatCard
            icon={Briefcase}
            label="Total Jobs"
            value={stats.totalJobs}
            color="purple"
          />
        </div>
      )}

      {/* Customers List */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Customers</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 border rounded-lg text-sm w-64"
            />
          </div>
        </div>

        {filteredCustomers.length > 0 ? (
          <div className="divide-y">
            {filteredCustomers.map((customer) => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                onEditFeatures={() => handleEditFeatures(customer)}
                onRefresh={loadData}
              />
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <Building2 className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">No customers yet</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 text-orange-600 hover:text-orange-700 font-medium"
            >
              Create your first customer
            </button>
          </div>
        )}
      </div>

      {/* Create Customer Modal */}
      {showCreateModal && (
        <CreateCustomerModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCustomerCreated}
        />
      )}

      {/* Edit Features Modal */}
      {showFeaturesModal && selectedCustomer && (
        <CustomerFeaturesModal
          customer={selectedCustomer}
          onClose={() => {
            setShowFeaturesModal(false);
            setSelectedCustomer(null);
          }}
          onSaved={handleFeaturesUpdated}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    purple: 'bg-purple-100 text-purple-600',
    orange: 'bg-orange-100 text-orange-600',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg ${colors[color]} flex items-center justify-center`}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
          <p className="text-sm text-gray-500">{label}</p>
        </div>
      </div>
    </div>
  );
}

function CustomerRow({ customer, onEditFeatures, onRefresh }) {
  const [showMenu, setShowMenu] = useState(false);

  const handleDelete = async () => {
    const slug = prompt(`Type "${customer.slug}" to confirm deletion:`);
    if (slug !== customer.slug) {
      alert('Deletion cancelled - slug did not match');
      return;
    }

    try {
      await api.delete(`/api/agency/customers/${customer.id}`, {
        data: { confirmDelete: customer.slug },
      });
      onRefresh();
    } catch (error) {
      alert('Failed to delete customer');
    }
  };

  return (
    <div className="p-4 flex items-center hover:bg-gray-50">
      {/* Logo/Avatar */}
      <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center mr-4 overflow-hidden">
        {customer.logo ? (
          <img src={customer.logo} alt="" className="w-full h-full object-cover" />
        ) : (
          <Building2 className="w-6 h-6 text-gray-400" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-gray-900">{customer.name}</h3>
          <span className="text-xs text-gray-400">/{customer.slug}</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span>{customer.email}</span>
          <span className="flex items-center gap-1">
            <Package className="w-3 h-3" />
            {customer.featureCount} features
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 mr-4 text-sm">
        <div className="text-center">
          <p className="font-semibold text-gray-900">{customer.stats?.users || 0}</p>
          <p className="text-gray-500">Users</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-gray-900">{customer.stats?.contacts || 0}</p>
          <p className="text-gray-500">Contacts</p>
        </div>
        <div className="text-center">
          <p className="font-semibold text-gray-900">{customer.stats?.jobs || 0}</p>
          <p className="text-gray-500">Jobs</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onEditFeatures}
          className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"
          title="Edit Features"
        >
          <Settings className="w-5 h-5" />
        </button>
        <a
          href={`/${customer.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
          title="Open CRM"
        >
          <ExternalLink className="w-5 h-5" />
        </a>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border z-20">
                <button
                  onClick={() => {
                    setShowMenu(false);
                    handleDelete();
                  }}
                  className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Customer
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
