import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError, useApiClient } from '../lib/api.js';

type OnboardingForm = {
  fullName: string;
  workEmail: string;
  phone: string;
  role: 'teacher' | 'department_head' | 'admin';
  schoolName: string;
  district: string;
  state: string;
  subjects: string;
  grades: string;
};

const ONBOARDING_DRAFT_KEY = 'teacheros_onboarding_draft_v1';

const defaultForm: OnboardingForm = {
  fullName: '',
  workEmail: '',
  phone: '',
  role: 'teacher',
  schoolName: '',
  district: '',
  state: '',
  subjects: '',
  grades: ''
};

function loadOnboardingDraft(): OnboardingForm {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY);
    return raw ? { ...defaultForm, ...(JSON.parse(raw) as Partial<OnboardingForm>) } : defaultForm;
  } catch {
    return defaultForm;
  }
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildOnboardingSummary(form: OnboardingForm): string {
  return [
    'Teacher onboarding',
    `Name: ${form.fullName || 'Not set'}`,
    `Email: ${form.workEmail || 'Not set'}`,
    `Phone: ${form.phone || 'Not set'}`,
    `Role: ${form.role}`,
    '',
    'School',
    `School: ${form.schoolName || 'Not set'}`,
    `District: ${form.district || 'Not set'}`,
    `State: ${form.state || 'Not set'}`,
    '',
    'Teaching',
    `Subjects: ${form.subjects || 'Not set'}`,
    `Grades: ${form.grades || 'Not set'}`
  ].join('\n');
}

export function OnboardingPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [form, setForm] = useState<OnboardingForm>(() => loadOnboardingDraft());

  useEffect(() => {
    window.localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(form));
  }, [form]);

  const update = <TKey extends keyof OnboardingForm>(key: TKey, value: OnboardingForm[TKey]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const canSubmit = form.fullName.trim().length > 0 && form.schoolName.trim().length > 0;

  const saveDraft = () => {
    window.localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(form));
    setSavedAt(new Date().toLocaleTimeString());
    setError(null);
  };

  const copySummary = async () => {
    await navigator.clipboard?.writeText(buildOnboardingSummary(form)).catch(() => undefined);
    setCopyStatus('Onboarding summary copied.');
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  return (
    <div className="onboarding-page stack">
      <section className="paper-hero">
        <div>
          <p className="eyebrow">Welcome</p>
          <h1>Set up your teacher profile.</h1>
        </div>
        <Link className="button-link secondary" to="/login">
          Back to login
        </Link>
      </section>

      {error ? <p className="notice warning">{error}</p> : null}
      {savedAt ? <p className="notice success">Draft saved at {savedAt}.</p> : null}
      {copyStatus ? <p className="notice success">{copyStatus}</p> : null}

      <section className="card stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Teacher card</p>
            <h2>Your details</h2>
          </div>
        </div>

        <div className="profile-form-grid">
          <label>
            Full name
            <input className="input" value={form.fullName} onChange={(event) => update('fullName', event.target.value)} />
          </label>
          <label>
            Work email
            <input className="input" type="email" value={form.workEmail} onChange={(event) => update('workEmail', event.target.value)} />
          </label>
          <label>
            Phone
            <input className="input" value={form.phone} onChange={(event) => update('phone', event.target.value)} />
          </label>
          <label>
            Role
            <select className="input" value={form.role} onChange={(event) => update('role', event.target.value as OnboardingForm['role'])}>
              <option value="teacher">Teacher</option>
              <option value="department_head">Department head</option>
              <option value="admin">Admin</option>
            </select>
          </label>
        </div>
      </section>

      <section className="card stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">School</p>
            <h2>Where you teach</h2>
          </div>
        </div>
        <div className="profile-form-grid">
          <label>
            School name
            <input className="input" value={form.schoolName} onChange={(event) => update('schoolName', event.target.value)} />
          </label>
          <label>
            District
            <input className="input" value={form.district} onChange={(event) => update('district', event.target.value)} />
          </label>
          <label>
            State
            <input className="input" value={form.state} onChange={(event) => update('state', event.target.value)} />
          </label>
        </div>
      </section>

      <section className="card stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Classes</p>
            <h2>What you teach</h2>
          </div>
        </div>
        <div className="profile-form-grid">
          <label>
            Subjects
            <input className="input" value={form.subjects} onChange={(event) => update('subjects', event.target.value)} placeholder="Math, Algebra, Advisory" />
          </label>
          <label>
            Grades
            <input className="input" value={form.grades} onChange={(event) => update('grades', event.target.value)} placeholder="8, 9, 10" />
          </label>
        </div>
      </section>

      <section className="card stack">
        <div className="profile-actions">
          <button type="button" onClick={saveDraft}>
            Save draft
          </button>
          <button className="secondary" type="button" onClick={() => void copySummary()}>
            Copy summary
          </button>
          <button
            className="secondary"
            type="button"
            disabled={saving || !canSubmit}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await api.onboarding({
                  fullName: form.fullName.trim(),
                  phone: form.phone.trim() || null,
                  workEmail: form.workEmail.trim() || null,
                  role: form.role,
                  schoolName: form.schoolName.trim(),
                  district: form.district.trim() || null,
                  state: form.state.trim() || null,
                  subjects: splitList(form.subjects),
                  grades: splitList(form.grades)
                });
                window.localStorage.removeItem(ONBOARDING_DRAFT_KEY);
                navigate('/');
              } catch (err) {
                setError(err instanceof ApiError ? err.message : 'Failed to save onboarding data');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Saving...' : 'Complete setup'}
          </button>
        </div>
        {!canSubmit ? <p className="muted">Add at least your full name and school name to finish setup.</p> : null}
      </section>
    </div>
  );
}
