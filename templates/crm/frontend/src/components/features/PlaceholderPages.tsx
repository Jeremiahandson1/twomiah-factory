// Remaining Pages - Financials, Advanced, Settings
import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card, CardHeader, CardBody, Button, Input, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { PieChart, Sparkles, DollarSign, TrendingUp, BarChart3, Users, FileText, Key, Globe, Zap } from 'lucide-react';
import { useCRMDataStore } from '../../stores/builderStore';

// FINANCIALS PAGE - displays calculated data from invoices/expenses
export function FinancialsPage() {
  const { instance } = useOutletContext();
  const { projects, invoices, expenses = [] } = useCRMDataStore();
  const [activeTab, setActiveTab] = useState('overview');
  const primaryColor = instance.primaryColor || '#ec7619';

  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.paid, 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const profit = totalRevenue - totalExpenses;

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-white">Financials</h1><p className="text-slate-400 mt-1">Job costing and financial management</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Revenue', value: '$' + totalRevenue.toLocaleString(), icon: DollarSign, color: 'text-emerald-400' },
          { label: 'Expenses', value: '$' + totalExpenses.toLocaleString(), icon: TrendingUp, color: 'text-red-400' },
          { label: 'Profit', value: '$' + profit.toLocaleString(), icon: BarChart3, color: profit >= 0 ? 'text-emerald-400' : 'text-red-400' },
          { label: 'Margin', value: totalRevenue > 0 ? Math.round(profit / totalRevenue * 100) + '%' : '0%', icon: PieChart, color: 'text-blue-400' },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`text-xl font-bold ${s.color}`}>{s.value}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>
      <Tabs value={activeTab} onChange={setActiveTab}>
        <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="job-costing">Job Costing</TabsTrigger><TabsTrigger value="reports">Reports</TabsTrigger></TabsList>
        <TabsContent value="overview">
          <Card><CardHeader title="Profit by Project" /><CardBody>
            <div className="space-y-4">
              {projects.map(p => {
                const margin = p.budget > 0 ? Math.round((p.budget - p.spent) / p.budget * 100) : 0;
                return (
                  <div key={p.id} className="p-4 bg-slate-800/50 rounded-lg">
                    <div className="flex justify-between mb-2"><span className="font-medium text-white">{p.name}</span><span className={margin >= 0 ? 'text-emerald-400' : 'text-red-400'}>{margin}% margin</span></div>
                    <div className="flex gap-4 text-sm"><span className="text-slate-400">Budget: ${p.budget?.toLocaleString()}</span><span className="text-slate-400">Spent: ${p.spent?.toLocaleString()}</span><span className={margin >= 0 ? 'text-emerald-400' : 'text-red-400'}>Profit: ${(p.budget - p.spent)?.toLocaleString()}</span></div>
                    <div className="h-2 bg-slate-700 rounded-full mt-2"><div className="h-full rounded-full" style={{ width: `${Math.min(100, p.spent / p.budget * 100)}%`, backgroundColor: p.spent > p.budget ? '#ef4444' : primaryColor }} /></div>
                  </div>
                );
              })}
              {projects.length === 0 && <p className="text-slate-500 text-center py-8">No projects to display</p>}
            </div>
          </CardBody></Card>
        </TabsContent>
        <TabsContent value="job-costing"><Card><CardBody className="py-12 text-center text-slate-400">Detailed job costing breakdown by labor, materials, and subcontractors. Data pulled from time entries and expenses.</CardBody></Card></TabsContent>
        <TabsContent value="reports"><Card><CardBody className="py-12 text-center text-slate-400">Generate P&L, cash flow, and aging reports from your financial data.</CardBody></Card></TabsContent>
      </Tabs>
    </div>
  );
}

// ADVANCED PAGE - feature showcase
export function AdvancedPage() {
  const { instance } = useOutletContext();
  const primaryColor = instance.primaryColor || '#ec7619';

  const features = [
    { name: 'AI Assistant', desc: 'Get help with estimates, scheduling, and more', icon: Sparkles, id: 'ai_assistant' },
    { name: 'Custom Dashboards', desc: 'Build personalized dashboard views', icon: BarChart3, id: 'custom_dashboards' },
    { name: 'Portfolio Analytics', desc: 'Analyze performance across all projects', icon: PieChart, id: 'portfolio_analytics' },
    { name: 'BIM Viewer', desc: 'View 3D building models', icon: FileText, id: 'bim_viewer' },
    { name: 'Training Center', desc: 'Team training and certifications', icon: Users, id: 'training_lms' },
  ];

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-white">Advanced Features</h1><p className="text-slate-400 mt-1">AI tools and advanced capabilities</p></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map((f, i) => {
          const enabled = instance.enabledFeatures.includes(f.id);
          return (
            <Card key={i} className={`p-5 ${!enabled && 'opacity-50'}`}>
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl" style={{ backgroundColor: `${primaryColor}20` }}><f.icon className="w-6 h-6" style={{ color: primaryColor }} /></div>
                <div><h3 className="font-semibold text-white">{f.name}</h3><p className="text-sm text-slate-400 mt-1">{f.desc}</p>{!enabled && <span className="text-xs text-slate-500 mt-2 block">Not enabled</span>}</div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// SETTINGS PAGE
export function SettingsPage() {
  const { instance } = useOutletContext();
  const [activeTab, setActiveTab] = useState('general');
  const primaryColor = instance.primaryColor || '#ec7619';

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-white">Settings</h1><p className="text-slate-400 mt-1">Platform configuration</p></div>
      <Tabs value={activeTab} onChange={setActiveTab}>
        <TabsList><TabsTrigger value="general">General</TabsTrigger><TabsTrigger value="integrations">Integrations</TabsTrigger><TabsTrigger value="api">API</TabsTrigger><TabsTrigger value="billing">Billing</TabsTrigger></TabsList>
        <TabsContent value="general">
          <Card><CardHeader title="Company Settings" /><CardBody className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-slate-800/50 rounded-lg">
              {instance.companyLogo ? <img src={instance.companyLogo} alt="" className="w-16 h-16 object-contain rounded-lg" /> : <div className="w-16 h-16 rounded-lg flex items-center justify-center text-white text-2xl font-bold" style={{ backgroundColor: primaryColor }}>{instance.companyName?.[0]}</div>}
              <div><p className="font-semibold text-white">{instance.companyName || 'My Company'}</p><p className="text-sm text-slate-400">{instance.enabledFeatures.length} features enabled</p></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm text-slate-400 mb-1">Company Name</label><Input value={instance.companyName} disabled /></div>
              <div><label className="block text-sm text-slate-400 mb-1">Primary Color</label><div className="flex items-center gap-2"><div className="w-10 h-10 rounded-lg" style={{ backgroundColor: primaryColor }} /><Input value={primaryColor} disabled className="flex-1" /></div></div>
            </div>
          </CardBody></Card>
        </TabsContent>
        <TabsContent value="integrations">
          <Card><CardHeader title="Integrations" /><CardBody>
            <div className="space-y-3">
              {[{ name: 'QuickBooks', desc: 'Sync invoices and expenses', connected: instance.enabledFeatures.includes('quickbooks'), icon: DollarSign },
                { name: 'Zapier', desc: 'Connect to 5000+ apps', connected: instance.enabledFeatures.includes('zapier'), icon: Zap },
                { name: 'Google Calendar', desc: 'Sync schedules', connected: false, icon: Globe }].map((int, i) => (
                <div key={i} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg">
                  <div className="flex items-center gap-3"><int.icon className="w-8 h-8" style={{ color: primaryColor }} /><div><p className="font-medium text-white">{int.name}</p><p className="text-xs text-slate-500">{int.desc}</p></div></div>
                  <Button size="sm" variant={int.connected ? 'ghost' : 'secondary'}>{int.connected ? 'Connected' : 'Connect'}</Button>
                </div>
              ))}
            </div>
          </CardBody></Card>
        </TabsContent>
        <TabsContent value="api">
          <Card><CardHeader title="API Access" /><CardBody>
            {instance.enabledFeatures.includes('api_access') ? (
              <div className="space-y-4">
                <div><label className="block text-sm text-slate-400 mb-1">API Key</label><div className="flex gap-2"><Input value="bp_live_xxxxxxxxxxxxxxxxxxxx" type="password" className="flex-1" /><Button variant="secondary" icon={Key}>Regenerate</Button></div></div>
                <p className="text-sm text-slate-400">Use this key to authenticate API requests. Keep it secret!</p>
              </div>
            ) : <p className="text-slate-400">API access is not enabled for this instance.</p>}
          </CardBody></Card>
        </TabsContent>
        <TabsContent value="billing"><Card><CardBody className="py-12 text-center text-slate-400">Manage subscription and billing settings.</CardBody></Card></TabsContent>
      </Tabs>
    </div>
  );
}
