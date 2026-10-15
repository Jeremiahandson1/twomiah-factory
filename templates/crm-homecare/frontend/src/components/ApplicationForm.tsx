// The public caregiver application — no sign-in. Rendered by the careers page (/careers), for an
// opening or as a general application. Posts to /api/public/careers/apply with the fields CVHC's
// careers form sends (applicationsRoutes.js); the hidden botField is the honeypot.
import { useState } from 'react';
import { API_BASE_URL } from '../config';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHIFTS = ['Morning', 'Afternoon', 'Evening', 'Overnight', 'Weekends'];
const CERTS = ['CNA', 'HHA', 'CPR', 'First Aid', 'LPN', 'RN'];
const YES_NO: Array<[string, string]> = [['driversLicense', "I have a valid driver's license"], ['transportation', 'I have reliable transportation'], ['legalToWork', 'I am legally able to work in the US'], ['backgroundCheck', 'I am willing to complete a caregiver background check']];

const blank = {
  firstName: '', lastName: '', email: '', phone: '', address: '', city: '', state: '{{STATE}}', zip: '', dob: '',
  driversLicense: '', transportation: '', legalToWork: '', backgroundCheck: '', felony: '', felonyExplanation: '',
  yearsExperience: '', cnaLicense: '', certifications: [] as string[], previousEmployer: '', reasonForLeaving: '',
  availability: [] as string[], shifts: [] as string[], hoursDesired: '', startDate: '',
  ref1Name: '', ref1Relationship: '', ref1Phone: '', ref1Email: '',
  ref2Name: '', ref2Relationship: '', ref2Phone: '', ref2Email: '',
  whyInterested: '', additionalInfo: '', botField: '',
};

const label = 'block text-sm font-semibold text-gray-800 dark:text-slate-100 mb-1';
const input = 'w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500';
const card = 'rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 mb-4';
const h3 = 'text-lg font-bold text-gray-900 dark:text-slate-100 mb-3';
const chip = (on: boolean) => `px-3 py-1.5 rounded-full border text-sm font-semibold ${on
  ? 'bg-primary-600 border-primary-600 text-white'
  : 'bg-white dark:bg-slate-900 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200'}`;

export default function ApplicationForm({ posting }: { posting?: { id: string; title: string } | null }) {
  const [form, setForm] = useState<any>(blank);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const toggle = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x: string) => x !== v) : [...f[k], v] }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.firstName.trim() || !form.lastName.trim()) { setError('Please enter your first and last name.'); return; }
    if (!form.email.trim() && !form.phone.trim()) { setError('Please give us an email or phone number so we can follow up.'); return; }
    // Typed as text, checked here on submit.
    if (form.yearsExperience.trim() !== '' && !/^\d{1,2}$/.test(form.yearsExperience.trim())) { setError('Years of experience must be a whole number.'); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/public/careers/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, postingId: posting?.id || undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to submit application. Please try again.');
      setSubmitted(true);
      setForm(blank);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30 p-6 text-center">
        <h2 className="text-xl font-bold text-green-900 dark:text-green-100">✅ Application Submitted Successfully!</h2>
        <p className="mt-2 text-green-900 dark:text-green-100">Thank you for applying to {'{{COMPANY_NAME}}'}.</p>
        <p className="mt-1 text-green-900 dark:text-green-100">We will review your application and contact you soon.</p>
      </div>
    );
  }

  const yesNo = (k: string) => (
    <div className="flex gap-2">
      {['yes', 'no'].map((v) => (
        <button type="button" key={v} className={chip(form[k] === v)} onClick={() => set(k, v)}>{v === 'yes' ? 'Yes' : 'No'}</button>
      ))}
    </div>
  );

  return (
    <form onSubmit={submit}>
      {posting && <p className="mb-4 text-gray-700 dark:text-slate-200">Applying for <strong>{posting.title}</strong></p>}
      {/* Honeypot: hidden from people, filled by bots. */}
      <input type="text" name="botField" value={form.botField} onChange={(e) => set('botField', e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <div className={card}>
        <h3 className={h3}>About you</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={label}>First Name *</label><input className={input} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></div>
          <div><label className={label}>Last Name *</label><input className={input} value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></div>
          <div><label className={label}>Email</label><input className={input} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div><label className={label}>Phone</label><input className={input} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
          <div className="sm:col-span-2"><label className={label}>Street Address</label><input className={input} value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
          <div><label className={label}>City</label><input className={input} value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={label}>State</label><input className={input} maxLength={2} value={form.state} onChange={(e) => set('state', e.target.value.toUpperCase())} /></div>
            <div><label className={label}>ZIP</label><input className={input} maxLength={10} value={form.zip} onChange={(e) => set('zip', e.target.value)} /></div>
          </div>
          <div><label className={label}>Date of Birth</label><input className={input} type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} /></div>
        </div>
      </div>

      <div className={card}>
        <h3 className={h3}>Eligibility</h3>
        {YES_NO.map(([k, text]) => (
          <div key={k} className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-gray-100 dark:border-slate-700">
            <span className="text-gray-800 dark:text-slate-100">{text}</span>{yesNo(k)}
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="text-gray-800 dark:text-slate-100">Have you ever been convicted of a felony?</span>{yesNo('felony')}
        </div>
        {form.felony === 'yes' && (
          <div className="mt-2"><label className={label}>Please explain</label><textarea className={input} rows={3} value={form.felonyExplanation} onChange={(e) => set('felonyExplanation', e.target.value)} /></div>
        )}
      </div>

      <div className={card}>
        <h3 className={h3}>Experience</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={label}>Years of caregiving experience</label><input className={input} inputMode="numeric" value={form.yearsExperience} onChange={(e) => set('yearsExperience', e.target.value)} /></div>
          <div><label className={label}>CNA license number (if any)</label><input className={input} value={form.cnaLicense} onChange={(e) => set('cnaLicense', e.target.value)} /></div>
          <div><label className={label}>Most recent employer</label><input className={input} value={form.previousEmployer} onChange={(e) => set('previousEmployer', e.target.value)} /></div>
          <div><label className={label}>Reason for leaving</label><input className={input} value={form.reasonForLeaving} onChange={(e) => set('reasonForLeaving', e.target.value)} /></div>
        </div>
        <div className="mt-3">
          <span className={label}>Certifications</span>
          <div className="flex flex-wrap gap-2">{CERTS.map((c) => <button type="button" key={c} className={chip(form.certifications.includes(c))} onClick={() => toggle('certifications', c)}>{c}</button>)}</div>
        </div>
      </div>

      <div className={card}>
        <h3 className={h3}>Availability</h3>
        <span className={label}>Days</span>
        <div className="flex flex-wrap gap-2 mb-3">{DAYS.map((d) => <button type="button" key={d} className={chip(form.availability.includes(d))} onClick={() => toggle('availability', d)}>{d}</button>)}</div>
        <span className={label}>Shifts</span>
        <div className="flex flex-wrap gap-2 mb-3">{SHIFTS.map((s) => <button type="button" key={s} className={chip(form.shifts.includes(s))} onClick={() => toggle('shifts', s)}>{s}</button>)}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={label}>Hours per week you'd like</label><input className={input} value={form.hoursDesired} onChange={(e) => set('hoursDesired', e.target.value)} placeholder="e.g. 20–30" /></div>
          <div><label className={label}>Earliest start date</label><input className={input} type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
        </div>
      </div>

      <div className={card}>
        <h3 className={h3}>References</h3>
        {[1, 2].map((n) => (
          <div key={n} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-3">
            <input className={input} placeholder={`Reference ${n} name`} value={form[`ref${n}Name`]} onChange={(e) => set(`ref${n}Name`, e.target.value)} />
            <input className={input} placeholder="Relationship" value={form[`ref${n}Relationship`]} onChange={(e) => set(`ref${n}Relationship`, e.target.value)} />
            <input className={input} placeholder="Phone" type="tel" value={form[`ref${n}Phone`]} onChange={(e) => set(`ref${n}Phone`, e.target.value)} />
            <input className={input} placeholder="Email" type="email" value={form[`ref${n}Email`]} onChange={(e) => set(`ref${n}Email`, e.target.value)} />
          </div>
        ))}
      </div>

      <div className={card}>
        <h3 className={h3}>Tell us about yourself</h3>
        <div className="mb-3"><label className={label}>Why are you interested in caregiving with us?</label><textarea className={input} rows={3} value={form.whyInterested} onChange={(e) => set('whyInterested', e.target.value)} /></div>
        <div><label className={label}>Anything else we should know?</label><textarea className={input} rows={3} value={form.additionalInfo} onChange={(e) => set('additionalInfo', e.target.value)} /></div>
      </div>

      {error && <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-100 px-4 py-3 mb-4">{error}</div>}
      <button type="submit" disabled={loading} className="w-full sm:w-auto px-6 py-3 rounded-lg bg-primary-600 hover:bg-primary-700 text-white font-bold disabled:opacity-60">
        {loading ? 'Submitting…' : 'Submit Application'}
      </button>
    </form>
  );
}
