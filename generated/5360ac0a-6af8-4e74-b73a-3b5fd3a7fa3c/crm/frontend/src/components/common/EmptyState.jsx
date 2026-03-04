import { 
  Inbox, FileText, Users, FolderKanban, Briefcase, Receipt, 
  Clock, DollarSign, FileQuestion, ClipboardList, Search,
  Plus, AlertCircle
} from 'lucide-react';

const icons = {
  default: Inbox,
  contacts: Users,
  projects: FolderKanban,
  jobs: Briefcase,
  quotes: FileText,
  invoices: Receipt,
  time: Clock,
  expenses: DollarSign,
  rfis: FileQuestion,
  punchLists: ClipboardList,
  search: Search,
  error: AlertCircle,
};

export function EmptyState({
  icon: Icon,
  iconType = 'default',
  title = 'No data found',
  description = 'There are no items to display.',
  action,
  actionLabel = 'Create New',
  onAction,
  className = '',
}) {
  const IconComponent = Icon || icons[iconType] || icons.default;

  return (
    <div className={`flex flex-col items-center justify-center py-12 px-4 ${className}`}>
      <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <IconComponent className="w-8 h-8 text-gray-400" />
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-1">{title}</h3>
      <p className="text-gray-500 text-center max-w-sm mb-6">{description}</p>
      {(action || onAction) && (
        action || (
          <button
            onClick={onAction}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {actionLabel}
          </button>
        )
      )}
    </div>
  );
}

// Pre-configured empty states for common entities
export function EmptyContacts({ onAction }) {
  return (
    <EmptyState
      iconType="contacts"
      title="No contacts yet"
      description="Start by adding your first contact, lead, or client."
      actionLabel="Add Contact"
      onAction={onAction}
    />
  );
}

export function EmptyProjects({ onAction }) {
  return (
    <EmptyState
      iconType="projects"
      title="No projects yet"
      description="Create your first project to start tracking work."
      actionLabel="Create Project"
      onAction={onAction}
    />
  );
}

export function EmptyJobs({ onAction }) {
  return (
    <EmptyState
      iconType="jobs"
      title="No jobs scheduled"
      description="Schedule a new job or work order."
      actionLabel="Create Job"
      onAction={onAction}
    />
  );
}

export function EmptyQuotes({ onAction }) {
  return (
    <EmptyState
      iconType="quotes"
      title="No quotes yet"
      description="Create your first quote for a client."
      actionLabel="Create Quote"
      onAction={onAction}
    />
  );
}

export function EmptyInvoices({ onAction }) {
  return (
    <EmptyState
      iconType="invoices"
      title="No invoices yet"
      description="Create your first invoice to start billing."
      actionLabel="Create Invoice"
      onAction={onAction}
    />
  );
}

export function EmptyTimeEntries({ onAction }) {
  return (
    <EmptyState
      iconType="time"
      title="No time entries"
      description="Log your first time entry."
      actionLabel="Log Time"
      onAction={onAction}
    />
  );
}

export function EmptyExpenses({ onAction }) {
  return (
    <EmptyState
      iconType="expenses"
      title="No expenses recorded"
      description="Add your first expense."
      actionLabel="Add Expense"
      onAction={onAction}
    />
  );
}

export function EmptyRFIs({ onAction }) {
  return (
    <EmptyState
      iconType="rfis"
      title="No RFIs"
      description="Create an RFI to request information."
      actionLabel="Create RFI"
      onAction={onAction}
    />
  );
}

export function EmptyPunchList({ onAction }) {
  return (
    <EmptyState
      iconType="punchLists"
      title="No punch list items"
      description="Add items to the punch list."
      actionLabel="Add Item"
      onAction={onAction}
    />
  );
}

export function EmptySearch({ query }) {
  return (
    <EmptyState
      iconType="search"
      title="No results found"
      description={query ? `No results for "${query}". Try a different search.` : 'Try searching for something.'}
    />
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <EmptyState
      iconType="error"
      title="Something went wrong"
      description={message || 'Unable to load data. Please try again.'}
      actionLabel="Try Again"
      onAction={onRetry}
    />
  );
}

// Table empty state (smaller version)
export function TableEmptyState({ message = 'No data available', colSpan = 5 }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12">
        <div className="text-center">
          <Inbox className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{message}</p>
        </div>
      </td>
    </tr>
  );
}

export default EmptyState;
