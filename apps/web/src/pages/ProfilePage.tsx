import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';
import type { ProfileResponse } from '@teacheros/contracts';

type ProfileForm = {
  fullName: string;
  preferredName: string;
  workEmail: string;
  phone: string;
  role: 'teacher' | 'department_head' | 'admin';
  schoolName: string;
  district: string;
  state: string;
  subjects: string;
  grades: string;
  defaultClassLength: string;
  prepStyle: 'simple' | 'balanced' | 'advanced';
  teachingStyle: string;
  planningNotes: string;
  emailDigest: boolean;
  showAdvancedTools: boolean;
  saveCarryOverReminder: boolean;
};

const PROFILE_STORAGE_KEY = 'teacheros_profile_draft_v1';

const defaultProfile: ProfileForm = {
  fullName: '',
  preferredName: '',
  workEmail: '',
  phone: '',
  role: 'teacher',
  schoolName: '',
  district: '',
  state: '',
  subjects: '',
  grades: '',
  defaultClassLength: '45',
  prepStyle: 'simple',
  teachingStyle: '',
  planningNotes: '',
  emailDigest: true,
  showAdvancedTools: false,
  saveCarryOverReminder: true
};

function loadDraft(email: string | null): ProfileForm {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<ProfileForm>) : {};
    return {
      ...defaultProfile,
      workEmail: email ?? '',
      ...saved
    };
  } catch {
    return {
      ...defaultProfile,
      workEmail: email ?? ''
    };
  }
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function completionScore(form: ProfileForm): number {
  const checks = [
    form.fullName,
    form.workEmail,
    form.schoolName,
    form.subjects,
    form.grades,
    form.defaultClassLength,
    form.teachingStyle,
    form.planningNotes
  ];
  const complete = checks.filter((value) => value.trim().length > 0).length;
  return Math.round((complete / checks.length) * 100);
}

function roleLabel(role: ProfileForm['role']) {
  if (role === 'department_head') return 'Department head';
  if (role === 'admin') return 'Admin';
  return 'Teacher';
}

function mergeApiProfile(current: ProfileForm, profile: ProfileResponse): ProfileForm {
  return {
    ...current,
    fullName: profile.user.fullName ?? current.fullName,
    workEmail: profile.profile?.workEmail ?? profile.user.email ?? current.workEmail,
    phone: profile.profile?.phone ?? current.phone,
    role: profile.profile?.role ?? current.role,
    schoolName: profile.school?.name ?? current.schoolName,
    district: profile.school?.district ?? current.district,
    state: profile.school?.state ?? current.state,
    subjects: profile.profile?.subjects.join(', ') ?? current.subjects,
    grades: profile.profile?.grades.join(', ') ?? current.grades
  };
}

export function ProfilePage() {
  const auth = useAppAuth();
  const api = useApiClient();
  const [form, setForm] = useState<ProfileForm>(() => loadDraft(auth.email));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loadedFromApi, setLoadedFromApi] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(form));
  }, [form]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const profile = await api.getProfile();
        if (cancelled) return;
        setForm((current) => mergeApiProfile(current, profile));
        setLoadedFromApi(Boolean(profile.profile));
      } catch {
        if (!cancelled) setLoadedFromApi(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api]);

  const score = useMemo(() => completionScore(form), [form]);
  const subjects = splitList(form.subjects);
  const grades = splitList(form.grades);

  const update = <TKey extends keyof ProfileForm>(key: TKey, value: ProfileForm[TKey]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const canSync =
    form.fullName.trim().length > 0 &&
    form.schoolName.trim().length > 0 &&
    (!form.workEmail.trim() || form.workEmail.includes('@'));

  return (
    <div className="profile-page stack">
      <section className="paper-hero profile-hero">
        <div>
          <p className="eyebrow">Profile</p>
          <h1>Teacher settings</h1>
        </div>
        <div className="guide-progress-card">
          <span>{score}%</span>
          <progress max={100} value={score} />
          <p className="muted">Profile completeness</p>
        </div>
      </section>

      {error ? <p className="notice warning">{error}</p> : null}
      {savedAt ? <p className="notice success">Saved profile draft at {savedAt}.</p> : null}

      <section className="profile-grid">
        <div className="card stack profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Teacher card</p>
              <h2>Your details</h2>
            </div>
            <span className="status-pill upcoming">{auth.mode === 'dev' ? 'Dev login' : 'Clerk login'}</span>
          </div>

          <div className="profile-form-grid">
            <label>
              Full name
              <input
                className="input"
                value={form.fullName}
                onChange={(event) => update('fullName', event.target.value)}
                placeholder="Aidan McCormick"
              />
            </label>
            <label>
              Preferred name
              <input
                className="input"
                value={form.preferredName}
                onChange={(event) => update('preferredName', event.target.value)}
                placeholder="Mr. McCormick"
              />
            </label>
            <label>
              Work email
              <input
                className="input"
                type="email"
                value={form.workEmail}
                onChange={(event) => update('workEmail', event.target.value)}
                placeholder="teacher@school.edu"
              />
            </label>
            <label>
              Phone
              <input
                className="input"
                value={form.phone}
                onChange={(event) => update('phone', event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              Role
              <select
                className="input"
                value={form.role}
                onChange={(event) => update('role', event.target.value as ProfileForm['role'])}
              >
                <option value="teacher">Teacher</option>
                <option value="department_head">Department head</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
        </div>

        <aside className="card profile-account-card">
          <div>
            <p className="eyebrow">Account</p>
            <h2>Login status</h2>
          </div>
          <div className="profile-summary-card">
            <strong>{form.preferredName || form.fullName || 'Unnamed teacher'}</strong>
            <span>{form.workEmail || auth.email || 'No email saved'}</span>
            <span>{roleLabel(form.role)}</span>
          </div>
          <div className="identity-list">
            <div>
              <span>User ID</span>
              <code>{auth.userId ?? 'Not available'}</code>
            </div>
            <div>
              <span>Auth mode</span>
              <code>{auth.mode}</code>
            </div>
          </div>
          <div className="profile-sync-row">
            <span>{loadedFromApi ? 'Backend profile loaded' : 'Local draft'}</span>
            <span>{canSync ? 'Ready to sync' : 'Needs name + school'}</span>
          </div>
        </aside>

        <div className="card stack profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">School</p>
              <h2>Teaching location</h2>
            </div>
            <Link to="/school">School page</Link>
          </div>
          <div className="profile-form-grid">
            <label>
              School name
              <input
                className="input"
                value={form.schoolName}
                onChange={(event) => update('schoolName', event.target.value)}
                placeholder="School name"
              />
            </label>
            <label>
              District
              <input
                className="input"
                value={form.district}
                onChange={(event) => update('district', event.target.value)}
                placeholder="Optional"
              />
            </label>
            <label>
              State
              <input
                className="input"
                value={form.state}
                onChange={(event) => update('state', event.target.value)}
                placeholder="NC, CA, NY..."
              />
            </label>
          </div>
        </div>

        <div className="card stack profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Classes</p>
              <h2>Subjects and grade levels</h2>
            </div>
            <Link to="/curriculum">Curriculum</Link>
          </div>
          <div className="profile-form-grid">
            <label>
              Subjects
              <input
                className="input"
                value={form.subjects}
                onChange={(event) => update('subjects', event.target.value)}
                placeholder="Math, Algebra, Advisory"
              />
            </label>
            <label>
              Grades
              <input
                className="input"
                value={form.grades}
                onChange={(event) => update('grades', event.target.value)}
                placeholder="8, 9, 10"
              />
            </label>
            <label>
              Default class length
              <input
                className="input"
                value={form.defaultClassLength}
                onChange={(event) => update('defaultClassLength', event.target.value)}
                placeholder="45"
              />
            </label>
          </div>
          <div className="tag-list">
            {[...subjects, ...grades.map((grade) => `Grade ${grade}`)].map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
            {subjects.length + grades.length === 0 ? <span>No tags yet</span> : null}
          </div>
        </div>

        <div className="card stack wide-card profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Preferences</p>
              <h2>How the app should behave</h2>
            </div>
          </div>

          <div className="profile-form-grid">
            <label>
              Prep style
              <select
                className="input"
                value={form.prepStyle}
                onChange={(event) => update('prepStyle', event.target.value as ProfileForm['prepStyle'])}
              >
                <option value="simple">Keep it simple</option>
                <option value="balanced">Balanced guidance</option>
                <option value="advanced">Show advanced controls</option>
              </select>
            </label>
            <label>
              Teaching style
              <input
                className="input"
                value={form.teachingStyle}
                onChange={(event) => update('teachingStyle', event.target.value)}
                placeholder="Direct instruction, workshop, inquiry, project-based..."
              />
            </label>
          </div>

          <textarea
            rows={5}
            value={form.planningNotes}
            onChange={(event) => update('planningNotes', event.target.value)}
            placeholder="What should the platform remember when helping you plan? Example: keep instructions short, include checks for understanding, prefer low-prep activities..."
          />

          <div className="preference-list">
            <label>
              <input
                type="checkbox"
                checked={form.emailDigest}
                onChange={(event) => update('emailDigest', event.target.checked)}
              />
              Send a daily teaching digest when email is connected
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.saveCarryOverReminder}
                onChange={(event) => update('saveCarryOverReminder', event.target.checked)}
              />
              Remind me to save a carry-over note before ending class
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.showAdvancedTools}
                onChange={(event) => update('showAdvancedTools', event.target.checked)}
              />
              Show advanced tools by default
            </label>
          </div>
        </div>

        <div className="card stack wide-card profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Save changes</p>
              <h2>Draft locally or sync profile</h2>
            </div>
            <button
              className="secondary"
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              {advancedOpen ? 'Hide advanced' : 'Show advanced'}
            </button>
          </div>

          <div className="profile-actions">
            <button
              type="button"
              onClick={() => {
                window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(form));
                setSavedAt(new Date().toLocaleTimeString());
                setError(null);
              }}
            >
              Save draft
            </button>
            <button
              className="secondary"
              type="button"
              disabled={!canSync || saving}
              onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  await api.updateProfile({
                    fullName: form.fullName.trim(),
                    phone: form.phone.trim() || null,
                    workEmail: form.workEmail.trim() || null,
                    role: form.role,
                    schoolName: form.schoolName.trim(),
                    district: form.district.trim() || null,
                    state: form.state.trim() || null,
                    subjects,
                    grades
                  });
                  setSavedAt(new Date().toLocaleTimeString());
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Failed to sync profile');
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Syncing...' : 'Sync teacher profile'}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                const confirmReset = window.confirm('Reset this local profile draft?');
                if (!confirmReset) return;
                window.localStorage.removeItem(PROFILE_STORAGE_KEY);
                setForm(loadDraft(auth.email));
                setSavedAt(null);
              }}
            >
              Reset draft
            </button>
          </div>

          {!canSync ? (
            <p className="muted">
              To sync with the backend, add at least a full name and school name. Email must include
              an @ if you enter one.
            </p>
          ) : null}

          {advancedOpen ? (
            <div className="advanced-profile-panel">
              <h3>What syncs now, and what is still local?</h3>
              <p>
                Core teacher and school details sync through the profile API. Personal planning
                preferences stay as a local draft for now so teachers can safely experiment before
                those settings become account-wide.
              </p>
              <ul>
                <li>Synced: name, email, phone, role, school, district, state, subjects, and grades.</li>
                <li>Local draft: prep style, planning notes, notifications, and advanced-tool defaults.</li>
                <li>Next production step: store those preference fields per account in Postgres.</li>
              </ul>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
