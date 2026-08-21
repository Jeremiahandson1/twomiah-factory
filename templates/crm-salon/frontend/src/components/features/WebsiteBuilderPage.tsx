import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Globe, Layout, FileText, Eye, Edit2, Trash2, Check, ExternalLink, Palette, Type, Image } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

const pageTypeOptions = [
  { value: 'home', label: 'Home Page' },
  { value: 'about', label: 'About Us' },
  { value: 'services', label: 'Services' },
  { value: 'gallery', label: 'Gallery/Portfolio' },
  { value: 'contact', label: 'Contact' },
  { value: 'testimonials', label: 'Testimonials' },
  { value: 'faq', label: 'FAQ' },
  { value: 'blog', label: 'Blog Post' },
  { value: 'landing', label: 'Landing Page' },
  { value: 'custom', label: 'Custom Page' },
];

interface PageFormData {
  title: string;
  slug: string;
  type: string;
  content: string;
  metaTitle: string;
  metaDescription: string;
  published: boolean;
  showInNav: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface PageFormProps {
  item: Record<string, unknown> | null;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}

// PAGE FORM
function PageForm({ item, onSave, onClose }: PageFormProps) {
  const [form, setForm] = useState<PageFormData>((item as unknown as PageFormData) || {
    title: '', slug: '', type: 'custom', content: '', metaTitle: '', metaDescription: '',
    published: false, showInNav: true
  });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = form.slug || form.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    onSave({ ...form, slug, updatedAt: new Date().toISOString(), createdAt: item?.createdAt || new Date().toISOString() });
    onClose();
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Page Title" value={form.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Our Services" required />
        <Select label="Page Type" value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, type: e.target.value })} options={pageTypeOptions} />
      </div>
      <Input label="URL Slug" value={form.slug} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, slug: e.target.value })} placeholder="auto-generated-from-title" />
      <Textarea label="Content" value={form.content} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, content: e.target.value })} placeholder="Page content (supports basic HTML)..." rows={6} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="SEO Title" value={form.metaTitle} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, metaTitle: e.target.value })} placeholder="Title for search engines" />
        <Input label="SEO Description" value={form.metaDescription} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, metaDescription: e.target.value })} placeholder="Description for search engines" />
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.published} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, published: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
          <span className="text-sm text-slate-300">Published</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.showInNav} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, showInNav: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
          <span className="text-sm text-slate-300">Show in Navigation</span>
        </label>
      </div>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'} Page</Button></div>
    </form>
  );
}

interface SiteSettingsFormData {
  siteName: string;
  tagline: string;
  domain: string;
  primaryColor: string;
  logo: string;
  favicon: string;
  googleAnalytics: string;
  footerText: string;
}

interface SiteSettingsFormProps {
  settings: Record<string, unknown>;
  onSave: (data: SiteSettingsFormData) => void;
  onClose: () => void;
}

// SITE SETTINGS FORM
function SiteSettingsForm({ settings, onSave, onClose }: SiteSettingsFormProps) {
  const [form, setForm] = useState<SiteSettingsFormData>((settings as unknown as SiteSettingsFormData) || {
    siteName: '', tagline: '', domain: '', primaryColor: '{{PRIMARY_COLOR}}',
    logo: '', favicon: '', googleAnalytics: '', footerText: ''
  });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave(form); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Site Name" value={form.siteName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, siteName: e.target.value })} placeholder="Your Company Name" />
        <Input label="Tagline" value={form.tagline} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, tagline: e.target.value })} placeholder="Your company slogan" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Custom Domain" value={form.domain} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, domain: e.target.value })} placeholder="www.yourcompany.com" />
        <div>
          <label className="block text-sm text-slate-400 mb-1">Primary Color</label>
          <div className="flex gap-2">
            <input type="color" value={form.primaryColor} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, primaryColor: e.target.value })} className="w-12 h-10 rounded cursor-pointer" />
            <Input value={form.primaryColor} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, primaryColor: e.target.value })} className="flex-1" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Logo URL" value={form.logo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, logo: e.target.value })} placeholder="https://..." />
        <Input label="Favicon URL" value={form.favicon} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, favicon: e.target.value })} placeholder="https://..." />
      </div>
      <Input label="Google Analytics ID" value={form.googleAnalytics} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, googleAnalytics: e.target.value })} placeholder="G-XXXXXXXXXX" />
      <Textarea label="Footer Text" value={form.footerText} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, footerText: e.target.value })} placeholder="© 2025 Your Company. All rights reserved." rows={2} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">Save Settings</Button></div>
    </form>
  );
}

export function WebsiteBuilderPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const store = useCRMDataStore();
  const websitePages = (store.websitePages || []) as Record<string, unknown>[];
  const websiteSettings = (store.websiteSettings || {}) as Record<string, unknown>;
  const addWebsitePage = store.addWebsitePage as ((data: Record<string, unknown>) => void) | undefined;
  const updateWebsitePage = store.updateWebsitePage as ((id: unknown, data: Record<string, unknown>) => void) | undefined;
  const deleteWebsitePage = store.deleteWebsitePage as ((id: unknown) => void) | undefined;
  const updateWebsiteSettings = store.updateWebsiteSettings as ((data: Record<string, unknown>) => void) | undefined;
  const [activeTab, setActiveTab] = useState<string>('pages');
  const [search, setSearch] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [editItem, setEditItem] = useState<Record<string, unknown> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filteredPages = useMemo(() => (websitePages || []).filter((p: Record<string, unknown>) => !search || (p.title as string)?.toLowerCase().includes(search.toLowerCase())), [websitePages, search]);
  const publishedCount = websitePages.filter((p: Record<string, unknown>) => p.published).length;

  const handleSave = (data: Record<string, unknown>) => { editItem ? updateWebsitePage?.(editItem.id, data) : addWebsitePage?.(data); setEditItem(null); setShowForm(false); };
  const handleDelete = () => { deleteWebsitePage?.(deleteTarget?.id); setDeleteTarget(null); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Website Builder</h1><p className="text-slate-400 mt-1">Build and manage your business website</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowSettings(true)} icon={Palette}>Site Settings</Button>
          <Button onClick={() => { setEditItem(null); setShowForm(true); }} icon={Plus}>New Page</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Pages', value: websitePages.length, icon: FileText },
          { label: 'Published', value: publishedCount, icon: Globe, color: 'text-emerald-400' },
          { label: 'Drafts', value: websitePages.length - publishedCount, icon: Edit2 },
          { label: 'Domain', value: websiteSettings?.domain || 'Not set', icon: ExternalLink, small: true },
        ].map((s, i) => (
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`${s.small ? 'text-sm' : 'text-xl font-bold'} ${s.color || 'text-white'}`}>{s.value as string | number}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pages">Pages ({websitePages.length})</TabsTrigger>
          <TabsTrigger value="seo">SEO Tools</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="pages">
          <Card><CardBody className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search pages..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div></CardBody></Card>
          <Card className="mt-4">
            {filteredPages.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Page</TableHeader><TableHeader>Type</TableHeader><TableHeader>URL</TableHeader><TableHeader>Updated</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredPages.map((page: Record<string, unknown>) => (
                  <TableRow key={page.id as string}>
                    <TableCell className="font-medium text-white">{page.title as string}</TableCell>
                    <TableCell className="text-slate-400">{page.type as string}</TableCell>
                    <TableCell className="text-slate-400 text-sm">/{page.slug as string}</TableCell>
                    <TableCell className="text-slate-400 text-sm">{page.updatedAt ? format(new Date(page.updatedAt as string), 'MMM d') : '-'}</TableCell>
                    <TableCell>{page.published ? <span className="text-emerald-400 text-sm">Published</span> : <span className="text-slate-500 text-sm">Draft</span>}</TableCell>
                    <TableCell><div className="flex gap-1">
                      <button onClick={() => updateWebsitePage?.(page.id, { published: !page.published })} className={`p-1.5 hover:bg-slate-700 rounded ${page.published ? 'text-emerald-400' : 'text-slate-500'}`} title={page.published ? 'Unpublish' : 'Publish'}><Globe className="w-4 h-4" /></button>
                      <button onClick={() => { setEditItem(page); setShowForm(true); }} className="p-1.5 hover:bg-slate-700 rounded"><Edit2 className="w-4 h-4 text-slate-400" /></button>
                      <button onClick={() => setDeleteTarget(page)} className="p-1.5 hover:bg-red-500/20 rounded"><Trash2 className="w-4 h-4 text-red-400" /></button>
                    </div></TableCell>
                  </TableRow>
                ))}
              </TableBody></Table>
            ) : (<CardBody><EmptyState icon={Layout} title="No pages yet" description="Create your first page to get started" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Create Page</Button>} /></CardBody>)}
          </Card>
        </TabsContent>

        <TabsContent value="seo">
          <Card><CardHeader title="SEO Overview" /><CardBody>
            <div className="space-y-4">
              {websitePages.map((page: Record<string, unknown>) => (
                <div key={page.id as string} className="p-4 bg-slate-800/50 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-white">{page.title as string}</p>
                      <p className="text-sm text-blue-400">/{page.slug as string}</p>
                    </div>
                    <div className="text-right">
                      {page.metaTitle ? <Check className="w-4 h-4 text-emerald-400 inline" /> : <span className="text-amber-400 text-xs">Missing title</span>}
                      {page.metaDescription ? <Check className="w-4 h-4 text-emerald-400 inline ml-2" /> : <span className="text-amber-400 text-xs ml-2">Missing description</span>}
                    </div>
                  </div>
                  {page.metaTitle ? <p className="text-sm text-slate-400 mt-2">Title: {page.metaTitle as string}</p> : null}
                  {page.metaDescription ? <p className="text-sm text-slate-500 mt-1 line-clamp-1">Desc: {page.metaDescription as string}</p> : null}
                </div>
              ))}
              {websitePages.length === 0 && <p className="text-slate-500 text-center py-8">Create pages to see SEO overview</p>}
            </div>
          </CardBody></Card>
        </TabsContent>

        <TabsContent value="analytics">
          <Card><CardBody className="py-12 text-center">
            {websiteSettings?.googleAnalytics ? (
              <div><Check className="w-12 h-12 mx-auto mb-3 text-emerald-400" /><p className="text-white font-medium">Google Analytics Connected</p><p className="text-slate-400 text-sm mt-1">ID: {websiteSettings.googleAnalytics as string}</p></div>
            ) : (
              <div><Globe className="w-12 h-12 mx-auto mb-3 text-slate-500" /><p className="text-slate-400">No analytics configured</p><Button className="mt-4" variant="secondary" onClick={() => setShowSettings(true)}>Configure Analytics</Button></div>
            )}
          </CardBody></Card>
        </TabsContent>
      </Tabs>

      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditItem(null); }} title={editItem ? 'Edit Page' : 'Create Page'} size="lg">
        <PageForm item={editItem} onSave={handleSave} onClose={() => { setShowForm(false); setEditItem(null); }} />
      </Modal>

      <Modal isOpen={showSettings} onClose={() => setShowSettings(false)} title="Site Settings" size="lg">
        <SiteSettingsForm settings={websiteSettings} onSave={(s: SiteSettingsFormData) => updateWebsiteSettings?.(s as unknown as Record<string, unknown>)} onClose={() => setShowSettings(false)} />
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Page" message={`Delete "${deleteTarget?.title}"? This cannot be undone.`} confirmText="Delete" variant="danger" />
    </div>
  );
}
