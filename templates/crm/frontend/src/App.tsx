import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { SocketProvider } from './contexts/SocketContext';
import { PermissionsProvider } from './contexts/PermissionsContext';
import { ProtectedRoute, PublicRoute } from './components/auth/ProtectedRoute';
import ErrorBoundary from './components/common/ErrorBoundary';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import CustomerPortal from './pages/CustomerPortal';
import PricingPage from './pages/public/PricingPage';
import SignupPage from './pages/public/SignupPage';
import SignupSuccessPage from './pages/public/SignupSuccessPage';
import SelfHostedPurchasePage from './pages/public/SelfHostedPurchasePage';
import BillingSettingsPage from './pages/settings/BillingSettingsPage';
import IntegrationsPage from './pages/settings/IntegrationsPage';
import DashboardPage from './pages/DashboardPage';
import ContactsPage from './pages/ContactsPage';
import ProjectsPage from './pages/ProjectsPage';
import JobsPage from './pages/JobsPage';
import QuotesPage from './pages/QuotesPage';
import InvoicesPage from './pages/InvoicesPage';
import SchedulePage from './pages/SchedulePage';
import TimePage from './pages/TimePage';
import ExpensesPage from './pages/ExpensesPage';
import TeamPage from './pages/TeamPage';
import RFIsPage from './pages/RFIsPage';
import ChangeOrdersPage from './pages/ChangeOrdersPage';
import PunchListsPage from './pages/PunchListsPage';
import DailyLogsPage from './pages/DailyLogsPage';
import InspectionsPage from './pages/InspectionsPage';
import BidsPage from './pages/BidsPage';
import SettingsPage from './pages/SettingsPage';
import DocumentsPage from './pages/DocumentsPage';

// Feature pages
import FleetPage from './pages/fleet/FleetPage';
import InventoryPage from './pages/inventory/InventoryPage';
import EquipmentPage from './pages/equipment/EquipmentPage';
import MarketingPage from './pages/marketing/MarketingPage';
import PricebookPage from './pages/pricebook/PricebookPage';
import AgreementsPage from './pages/agreements/AgreementsPage';
import WarrantiesPage from './pages/warranties/WarrantiesPage';
import CallTrackingPage from './pages/calltracking/CallTrackingPage';
import { RecurringList as RecurringListPage } from './pages/recurring';
import TakeoffsPage from './pages/takeoffs/TakeoffsPage';
import TasksPage from './pages/tasks/TasksPage';
import MessagesPage from './pages/messages/MessagesPage';
import ReportsDashboard from './pages/reports/ReportsDashboard';
import SelectionsPage from './pages/selections/SelectionsPage';

// Detail Pages
import ContactDetailPage from './components/detail/ContactDetailPage';
import ProjectDetailPage from './components/detail/ProjectDetailPage';
import JobDetailPage from './components/detail/JobDetailPage';
import QuoteDetailPage from './components/detail/QuoteDetailPage';
import InvoiceDetailPage from './components/detail/InvoiceDetailPage';

// Layout
import AppLayout from './components/layout/AppLayout';


function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <PermissionsProvider>
            <ToastProvider>
              <SocketProvider>
                <Routes>
                  {/* Public marketing pages */}
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/signup" element={<SignupPage />} />
                  <Route path="/signup/success" element={<SignupSuccessPage />} />
                  <Route path="/self-hosted" element={<SelfHostedPurchasePage />} />

                  {/* Public auth routes */}
                  <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                  <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
                  <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
                  <Route path="/reset-password" element={<PublicRoute><ResetPasswordPage /></PublicRoute>} />

                  {/* Customer Portal — unified hub after login */}
                  <Route path="/" element={<ProtectedRoute><CustomerPortal /></ProtectedRoute>} />

                  {/* CRM — full business management interface */}
                  <Route path="/crm" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                    <Route index element={<DashboardPage />} />
                    <Route path="contacts" element={<ContactsPage />} />
                    <Route path="contacts/:id" element={<ContactDetailPage />} />
                    <Route path="projects" element={<ProjectsPage />} />
                    <Route path="projects/:id" element={<ProjectDetailPage />} />
                    <Route path="jobs" element={<JobsPage />} />
                    <Route path="jobs/:id" element={<JobDetailPage />} />
                    <Route path="quotes" element={<QuotesPage />} />
                    <Route path="quotes/:id" element={<QuoteDetailPage />} />
                    <Route path="invoices" element={<InvoicesPage />} />
                    <Route path="invoices/:id" element={<InvoiceDetailPage />} />
                    <Route path="schedule" element={<SchedulePage />} />
                    <Route path="time" element={<TimePage />} />
                    <Route path="expenses" element={<ExpensesPage />} />
                    <Route path="documents" element={<DocumentsPage />} />
                    <Route path="team" element={<TeamPage />} />
                    <Route path="rfis" element={<RFIsPage />} />
                    <Route path="change-orders" element={<ChangeOrdersPage />} />
                    <Route path="punch-lists" element={<PunchListsPage />} />
                    <Route path="daily-logs" element={<DailyLogsPage />} />
                    <Route path="inspections" element={<InspectionsPage />} />
                    <Route path="bids" element={<BidsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="settings/billing" element={<BillingSettingsPage />} />
                    <Route path="settings/integrations" element={<IntegrationsPage />} />
                    <Route path="fleet" element={<FleetPage />} />
                    <Route path="inventory" element={<InventoryPage />} />
                    <Route path="equipment" element={<EquipmentPage />} />
                    <Route path="marketing" element={<MarketingPage />} />
                    <Route path="pricebook" element={<PricebookPage />} />
                    <Route path="agreements" element={<AgreementsPage />} />
                    <Route path="warranties" element={<WarrantiesPage />} />
                    <Route path="call-tracking" element={<CallTrackingPage />} />
                    <Route path="recurring" element={<RecurringListPage />} />
                    <Route path="takeoffs" element={<TakeoffsPage />} />
                    <Route path="tasks" element={<TasksPage />} />
                    <Route path="messages" element={<MessagesPage />} />
                    <Route path="reports" element={<ReportsDashboard />} />
                    <Route path="selections" element={<SelectionsPage />} />
                  </Route>

                  {/* Catch all */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </SocketProvider>
            </ToastProvider>
          </PermissionsProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
