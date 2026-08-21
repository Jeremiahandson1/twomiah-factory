import React, { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Search, Users, Mail, Phone, Edit2, Trash2, UserCog } from 'lucide-react';
import { Card, CardBody, Button, Input, Modal, Table, TableHead, TableBody, TableRow, TableHeader, TableCell, EmptyState, ConfirmDialog } from '../ui';
import { useCRMDataStore } from '../../stores/builderStore';

interface OutletContextType {
  instance: Record<string, unknown>;
}

interface TeamFormData {
  name: string;
  role: string;
  email: string;
  phone: string;
}

interface TeamFormProps {
  member: Record<string, unknown> | null;
  onSave: (data: TeamFormData) => void;
  onClose: () => void;
}

function TeamForm({ member, onSave, onClose }: TeamFormProps) {
  const [form, setForm] = useState<TeamFormData>((member as unknown as TeamFormData) || { name: '', role: '', email: '', phone: '' });
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSave(form); onClose(); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input label="Name" value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })} required />
      <Input label="Role" value={form.role} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, role: e.target.value })} placeholder="e.g. Project Manager" />
      <Input label="Email" type="email" value={form.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, email: e.target.value })} />
      <Input label="Phone" value={form.phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, phone: e.target.value })} />
      <div className="flex justify-end gap-3 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{member ? 'Update' : 'Add'} Team Member</Button></div>
    </form>
  );
}

export function TeamPage() {
  const { instance } = useOutletContext<OutletContextType>();
  const { teamMembers } = useCRMDataStore() as { teamMembers: Record<string, unknown>[] };
  const [search, setSearch] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [editMember, setEditMember] = useState<Record<string, unknown> | null>(null);
  const primaryColor = (instance.primaryColor as string) || '{{PRIMARY_COLOR}}';

  const filtered = teamMembers.filter((m: Record<string, unknown>) => !search || (m.name as string).toLowerCase().includes(search.toLowerCase()) || (m.role as string)?.toLowerCase().includes(search.toLowerCase()));
  const handleSave = () => { setEditMember(null); setShowForm(false); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Team</h1><p className="text-slate-400 mt-1">{teamMembers.length} team members</p></div>
        <Button onClick={() => setShowForm(true)} icon={Plus}>Add Member</Button>
      </div>
      <Card><CardBody className="p-4"><div className="relative max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" /><input type="text" placeholder="Search team..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="input pl-11" /></div></CardBody></Card>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((member: Record<string, unknown>) => (
          <Card key={member.id as string} className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg" style={{ backgroundColor: primaryColor }}>{(member.name as string)?.[0]?.toUpperCase()}</div>
              <div className="flex-1">
                <h3 className="font-semibold text-white">{member.name as string}</h3>
                <p className="text-sm text-slate-400">{(member.role as string) || 'Team Member'}</p>
                <div className="mt-3 space-y-1 text-sm">
                  {!!member.email && <div className="flex items-center gap-2 text-slate-400"><Mail className="w-4 h-4" />{String(member.email)}</div>}
                  {!!member.phone && <div className="flex items-center gap-2 text-slate-400"><Phone className="w-4 h-4" />{String(member.phone)}</div>}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {filtered.length === 0 && <Card><CardBody><EmptyState icon={Users} title="No team members found" description="Add your first team member" action={<Button onClick={() => setShowForm(true)} icon={Plus}>Add Member</Button>} /></CardBody></Card>}
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditMember(null); }} title={editMember ? 'Edit Team Member' : 'Add Team Member'}><TeamForm member={editMember} onSave={handleSave} onClose={() => { setShowForm(false); setEditMember(null); }} /></Modal>
    </div>
  );
}
