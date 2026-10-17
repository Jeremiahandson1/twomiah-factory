// The public careers page: /careers lists the open postings, /careers/:slug is one opening with
// its application form. No sign-in. With nothing published it shows CVHC's evergreen copy and a
// general application, so the agency can always take applicants.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';
import ApplicationForm from '../components/ApplicationForm';
import { usePageTitle } from '../hooks/usePageTitle';

const pay = (p: any) => (p.pay_range_min
  ? `$${p.pay_range_min}${p.pay_range_max && p.pay_range_max !== p.pay_range_min ? `–$${p.pay_range_max}` : ''}/${p.pay_rate_unit}`
  : '');
const lines = (s?: string | null) => (s ? s.split('\n').map((l) => l.trim()).filter(Boolean) : []);

export default function CareersPage() {
  const { slug } = useParams();
  const [postings, setPostings] = useState<any[] | null>(null);
  const [posting, setPosting] = useState<any>(null);
  const [notFound, setNotFound] = useState(false);
  const [general, setGeneral] = useState(false);
  // The tab names the agency and the opening — not "<agency> CRM", which is index.html's title for the office.
  // (Template literals: the generator pastes the name in raw, and an apostrophe would end a quoted string.)
  usePageTitle(slug && posting?.title ? `${posting.title} — Careers at {{COMPANY_NAME}}` : `Careers — {{COMPANY_NAME}}`);

  useEffect(() => {
    setNotFound(false);
    if (slug) {
      fetch(`${API_BASE_URL}/api/public/careers/job-postings/${encodeURIComponent(slug)}`)
        .then(async (r) => { if (!r.ok) { setNotFound(true); return; } setPosting(await r.json()); })
        .catch(() => setNotFound(true));
    } else {
      fetch(`${API_BASE_URL}/api/public/careers/job-postings`)
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setPostings(Array.isArray(d) ? d : []))
        .catch(() => setPostings([]));
    }
  }, [slug]);

  return (
    <div className="min-h-screen w-full bg-gray-50 dark:bg-slate-900 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-extrabold text-gray-900 dark:text-slate-100">Careers at {'{{COMPANY_NAME}}'}</h1>
          <p className="mt-1 text-gray-700 dark:text-slate-200">We're hiring compassionate caregivers.</p>
        </header>

        {slug ? (
          notFound ? (
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
              <p className="text-gray-800 dark:text-slate-100">This opening is no longer available.</p>
              <Link to="/careers" className="inline-block mt-2 underline text-primary-700 dark:text-primary-200">See current openings</Link>
            </div>
          ) : !posting ? (
            <div className="p-8 text-center text-gray-600 dark:text-slate-300">Loading…</div>
          ) : (
            <>
              <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 mb-6">
                <Link to="/careers" className="text-sm underline text-primary-700 dark:text-primary-200">← All openings</Link>
                <h2 className="mt-2 text-2xl font-extrabold text-gray-900 dark:text-slate-100">{posting.title}</h2>
                <div className="text-sm text-gray-600 dark:text-slate-300 mt-1">
                  {String(posting.employment_type || '').replace('_', ' ')}{posting.location ? ` · ${posting.location}` : ''}{pay(posting) ? ` · ${pay(posting)}` : ''}
                </div>
                <p className="mt-4 whitespace-pre-wrap text-gray-800 dark:text-slate-100">{posting.description}</p>
                {lines(posting.responsibilities).length > 0 && (
                  <>
                    <h3 className="mt-4 font-bold text-gray-900 dark:text-slate-100">Responsibilities</h3>
                    <ul className="list-disc pl-5 text-gray-800 dark:text-slate-100">{lines(posting.responsibilities).map((l) => <li key={l}>{l}</li>)}</ul>
                  </>
                )}
                {lines(posting.qualifications).length > 0 && (
                  <>
                    <h3 className="mt-4 font-bold text-gray-900 dark:text-slate-100">Qualifications</h3>
                    <ul className="list-disc pl-5 text-gray-800 dark:text-slate-100">{lines(posting.qualifications).map((l) => <li key={l}>{l}</li>)}</ul>
                  </>
                )}
              </div>
              <ApplicationForm posting={{ id: posting.id, title: posting.title }} />
            </>
          )
        ) : postings === null ? (
          <div className="p-8 text-center text-gray-600 dark:text-slate-300">Loading…</div>
        ) : (
          <>
            {postings.length === 0 ? (
              <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 mb-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">We're always building our caregiver pool</h2>
                <p className="mt-2 text-gray-700 dark:text-slate-200">There are no specific openings posted right now, but we're always glad to hear from caring, reliable people. Send us an application and we'll reach out when a position fits.</p>
              </div>
            ) : (
              <div className="mb-6">
                {postings.map((p) => (
                  <Link key={p.id} to={`/careers/${p.slug}`} className="block rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 mb-3 hover:border-primary-500">
                    <div className="font-extrabold text-gray-900 dark:text-slate-100">{p.title}</div>
                    <div className="text-sm text-gray-600 dark:text-slate-300 mt-0.5">
                      {String(p.employment_type || '').replace('_', ' ')}{p.location ? ` · ${p.location}` : ''}{pay(p) ? ` · ${pay(p)}` : ''}
                    </div>
                    {p.summary && <div className="text-sm text-gray-700 dark:text-slate-200 mt-1.5">{p.summary}</div>}
                    <div className="text-sm font-bold text-primary-700 dark:text-primary-200 mt-2">View &amp; apply →</div>
                  </Link>
                ))}
              </div>
            )}
            {postings.length > 0 && !general ? (
              <button onClick={() => setGeneral(true)} className="underline text-primary-700 dark:text-primary-200">Don't see the right opening? Send a general application</button>
            ) : (
              <ApplicationForm posting={null} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
