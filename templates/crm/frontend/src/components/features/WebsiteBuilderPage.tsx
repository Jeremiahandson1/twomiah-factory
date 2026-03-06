import React, { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Globe, Layout, FileText, Eye, Edit2, Trash2, Check, ExternalLink, Palette, Type, Image } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardHeader, CardBody, Button, Input, Select, Modal, Textarea, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, StatusBadge, EmptyState, ConfirmDialog, Tabs, TabsList, TabsTrigger, TabsContent } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

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

// PAGE FORM
function PageForm({ item, onSave, onClose }) {
  const [form, setForm] = useState(item || { 
    title: '', slug: '', type: 'custom', content: '', metaTitle: '', metaDescription: '', 
    published: false, showInNav: true 
  });
  const handleSubmit = (e) => { 
    e.preventDefault(); 
    const slug = form.slug || form.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    onSave({ ...form, slug, updatedAt: new Date().toISOString(), createdAt: item?.createdAt || new Date().toISOString() }); 
    onClose(); 
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Page Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Our Services" required />
        <Select label="Page Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={pageTypeOptions} />
      </div>
      <Input label="URL Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto-generated-from-title" />
      <Textarea label="Content" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="Page content (supports basic HTML)..." rows={6} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="SEO Title" value={form.metaTitle} onChange={(e) => setForm({ ...form, metaTitle: e.target.value })} placeholder="Title for search engines" />
        <Input label="SEO Description" value={form.metaDescription} onChange={(e) => setForm({ ...form, metaDescription: e.target.value })} placeholder="Description for search engines" />
      </div>
      <div className="flex gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
          <span className="text-sm text-slate-300">Published</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.showInNav} onChange={(e) => setForm({ ...form, showInNav: e.target.checked })} className="w-4 h-4 rounded border-slate-600 bg-slate-800" />
          <span className="text-sm text-slate-300">Show in Navigation</span>
        </label>
      </div>
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{item ? 'Update' : 'Create'} Page</Button></div>
    </form>
  );
}

// SITE SETTINGS FORM
function SiteSettingsForm({ settings, onSave, onClose }) {
  const [form, setForm] = useState(settings || { 
    siteName: '', tagline: '', domain: '', primaryColor: '#ec7619', 
    logo: '', favicon: '', googleAnalytics: '', footerText: '' 
  });
  const handleSubmit = (e) => { e.preventDefault(); onSave(form); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input label="Site Name" value={form.siteName} onChange={(e) => setForm({ ...form, siteName: e.target.value })} placeholder="Your Company Name" />
        <Input label="Tagline" value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="Your company slogan" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Custom Domain" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="www.yourcompany.com" />
        <div>
          <label className="block text-sm text-slate-400 mb-1">Primary Color</label>
          <div className="flex gap-2">
            <input type="color" value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} className="w-12 h-10 rounded cursor-pointer" />
            <Input value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} className="flex-1" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Logo URL" value={form.logo} onChange={(e) => setForm({ ...form, logo: e.target.value })} placeholder="https://..." />
        <Input label="Favicon URL" value={form.favicon} onChange={(e) => setForm({ ...form, favicon: e.target.value })} placeholder="https://..." />
      </div>
      <Input label="Google Analytics ID" value={form.googleAnalytics} onChange={(e) => setForm({ ...form, googleAnalytics: e.target.value })} placeholder="G-XXXXXXXXXX" />
      <Textarea label="Footer Text" value={form.footerText} onChange={(e) => setForm({ ...form, footerText: e.target.value })} placeholder="© 2025 Your Company. All rights reserved." rows={2} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">Save Settings</Button></div>
    </form>
  );
}

export function WebsiteBuilderPage() {
  const { instance } = useOutletContext();
  const { websitePages = [], websiteSettings = {}, addWebsitePage, updateWebsitePage, deleteWebsitePage, updateWebsiteSettings } = useCRMDataStore();
  const [activeTab, setActiveTab] = useState('pages');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const primaryColor = instance.primaryColor || '#ec7619';

  const filteredPages = useMemo(() => (websitePages || []).filter(p => !search || p.title?.toLowerCase().includes(search.toLowerCase())), [websitePages, search]);
  const publishedCount = websitePages.filter(p => p.published).length;

  const handleSave = (data) => { editItem ? updateWebsitePage?.(editItem.id, data) : addWebsitePage?.(data); setEditItem(null); setShowForm(false); };
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
          <Card key={i} className="p-4"><div className="flex items-center justify-between"><div><p className={`${s.small ? 'text-sm' : 'text-xl font-bold'} ${s.color || 'text-white'}`}>{s.value}</p><p className="text-sm text-slate-400">{s.label}</p></div><s.icon className="w-8 h-8" style={{ color: primaryColor }} /></div></Card>
        ))}
      </div>

      <Tabs value={activeTab} onChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="pages">Pages ({websitePages.length})</TabsTrigger>
          <TabsTrigger value="seo">SEO Tools</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="pages">
          <Card><CardBody className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search pages..." value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-11" /></div></CardBody></Card>
          <Card className="mt-4">
            {filteredPages.length > 0 ? (
              <Table><TableHead><TableRow><TableHeader>Page</TableHeader><TableHeader>Type</TableHeader><TableHeader>URL</TableHeader><TableHeader>Updated</TableHeader><TableHeader>Status</TableHeader><TableHeader>Actions</TableHeader></TableRow></TableHead><TableBody>
                {filteredPages.map((page) => (
                  <TableRow key={page.id}>
                    <TableCell className="font-medium text-white">{page.title}</TableCell>
                    <TableCell className="text-slate-400">{page.type}</TableCell>
                    <TableCell className="text-slate-400 text-sm">/{page.slug}</TableCell>
                    <TableCell className="text-slate-400 text-sm">{page.updatedAt ? format(new Date(page.updatedAt), 'MMM d') : '-'}</TableCell>
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
              {websitePages.map(page => (
                <div key={page.id} className="p-4 bg-slate-800/50 rounded-lg">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-white">{page.title}</p>
                      <p className="text-sm text-blue-400">/{page.slug}</p>
                    </div>
                    <div className="text-right">
                      {page.metaTitle ? <Check className="w-4 h-4 text-emerald-400 inline" /> : <span className="text-amber-400 text-xs">Missing title</span>}
                      {page.metaDescription ? <Check className="w-4 h-4 text-emerald-400 inline ml-2" /> : <span className="text-amber-400 text-xs ml-2">Missing description</span>}
                    </div>
                  </div>
                  {page.metaTitle && <p className="text-sm text-slate-400 mt-2">Title: {page.metaTitle}</p>}
                  {page.metaDescription && <p className="text-sm text-slate-500 mt-1 line-clamp-1">Desc: {page.metaDescription}</p>}
                </div>
              ))}
              {websitePages.length === 0 && <p className="text-slate-500 text-center py-8">Create pages to see SEO overview</p>}
            </div>
          </CardBody></Card>
        </TabsContent>

        <TabsContent value="analytics">
          <Card><CardBody className="py-12 text-center">
            {websiteSettings?.googleAnalytics ? (
              <div><Check className="w-12 h-12 mx-auto mb-3 text-emerald-400" /><p className="text-white font-medium">Google Analytics Connected</p><p className="text-slate-400 text-sm mt-1">ID: {websiteSettings.googleAnalytics}</p></div>
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
        <SiteSettingsForm settings={websiteSettings} onSave={(s) => updateWebsiteSettings?.(s)} onClose={() => setShowSettings(false)} />
      </Modal>

      <ConfirmDialog isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Page" message={`Delete "${deleteTarget?.title}"? This cannot be undone.`} confirmText="Delete" variant="danger" />
    </div>
  );
}
