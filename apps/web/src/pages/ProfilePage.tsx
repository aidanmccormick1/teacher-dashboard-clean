import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { ProfileResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';

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
};

const PROFILE_STORAGE_KEY = 'teacheros_profile_draft_v1';
const emptyProfile: ProfileForm = {
  fullName: '',
  preferredName: '',
  workEmail: '',
  phone: '',
  role: 'teacher',
  schoolName: '',
  district: '',
  state: '',
  subjects: '',
  grades: ''
};

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
function roleLabel(role: ProfileForm['role']) {
  return role === 'department_head'
    ? 'Department head'
    : role === 'admin'
      ? 'Administrator'
      : 'Teacher';
}
function loadDraft(email: string | null): ProfileForm {
  try {
    return {
      ...emptyProfile,
      workEmail: email ?? '',
      ...(JSON.parse(
        window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? '{}'
      ) as Partial<ProfileForm>)
    };
  } catch {
    return { ...emptyProfile, workEmail: email ?? '' };
  }
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
  const navigate = useNavigate();
  const [form, setForm] = useState<ProfileForm>(() => loadDraft(auth.email));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(form));
  }, [form]);
  useEffect(() => {
    let cancelled = false;
    void api
      .getProfile()
      .then((profile) => {
        if (!cancelled) setForm((current) => mergeApiProfile(current, profile));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);

  const update = <TKey extends keyof ProfileForm>(key: TKey, value: ProfileForm[TKey]) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const subjects = useMemo(() => splitList(form.subjects), [form.subjects]);
  const grades = useMemo(() => splitList(form.grades), [form.grades]);
  const schoolLine = [form.district, form.state].filter(Boolean).join(' · ');
  const canSave = Boolean(
    form.fullName.trim() &&
    form.schoolName.trim() &&
    (!form.workEmail || form.workEmail.includes('@'))
  );
  const save = useCallback(async () => {
    if (!canSave) return;
    try {
      setSaving(true);
      setError(null);
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
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }, [api, canSave, form, grades, subjects]);

  useEffect(() => {
    if (!canSave) return;

    const timer = window.setTimeout(() => {
      void save();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [canSave, save]);

  const resetAccount = async () => {
    const confirmation = window.prompt(
      'This permanently erases your classes, plans, calendar, notes, and settings. Your sign-in account will remain. Type RESET to continue.'
    );
    if (confirmation !== 'RESET') return;

    try {
      setResetting(true);
      setError(null);
      await api.resetAccount();
      // Retain the active sign-in session, but remove all account-specific
      // browser drafts and UI state before beginning onboarding again.
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith('teacheros_') && key !== 'teacheros_dev_session') {
          window.localStorage.removeItem(key);
        }
      }
      navigate('/onboarding', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your account.');
      setResetting(false);
    }
  };

  return (
    <div className="profile-page stack">
      <section className="paper-hero profile-hero">
        <div>
          <p className="eyebrow">Your profile</p>
          <h1>Your school & teaching profile</h1>
          <p>Keep the details that shape your teaching experience in one place.</p>
        </div>
      </section>
      {error ? <p className="notice warning">{error}</p> : null}
      {saved ? <p className="notice success">Profile saved.</p> : null}
      <section className="profile-grid">
        <article className="card profile-overview-card">
          <div>
            <p className="eyebrow">At a glance</p>
            <h2>{form.schoolName || 'Your school'}</h2>
            <p>{schoolLine || 'Add your district and state'}</p>
          </div>
          <div className="profile-overview-details">
            <strong>{form.preferredName || form.fullName || 'Your name'}</strong>
            <span>{roleLabel(form.role)}</span>
            {subjects.length ? <span>{subjects.join(' · ')}</span> : <span>Add your subjects</span>}
          </div>
        </article>
        <article className="card stack profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">You</p>
              <h2>Teacher details</h2>
              <p>How your school and teaching role appear in the platform.</p>
            </div>
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
                placeholder=""
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
              Phone <span className="field-optional">Optional</span>
              <input
                className="input"
                value={form.phone}
                onChange={(event) => update('phone', event.target.value)}
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
                <option value="admin">Administrator</option>
              </select>
            </label>
          </div>
        </article>
        <article className="card stack profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">School</p>
              <h2>Your teaching location</h2>
              <p>This is the shared school context used for your calendar and planning.</p>
            </div>
            <Link to="/school">School calendar</Link>
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
              District <span className="field-optional">Optional</span>
              <input
                className="input"
                value={form.district}
                onChange={(event) => update('district', event.target.value)}
              />
            </label>
            <label>
              State
              <input
                className="input"
                value={form.state}
                onChange={(event) => update('state', event.target.value)}
                placeholder="CA"
              />
            </label>
          </div>
        </article>
        <article className="card stack profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Teaching</p>
              <h2>What you teach</h2>
              <p>Use commas to add more than one subject or grade.</p>
            </div>
            <Link to="/courses">Courses</Link>
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
              Grade levels
              <input
                className="input"
                value={form.grades}
                onChange={(event) => update('grades', event.target.value)}
                placeholder="8, 9, 10"
              />
            </label>
          </div>
          {subjects.length || grades.length ? (
            <div className="tag-list">
              {[...subjects, ...grades.map((grade) => `Grade ${grade}`)].map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          ) : null}
        </article>
        <footer className="profile-save-bar">
          <div>
            <strong>
              {saving
                ? 'Saving changes…'
                : saved
                  ? 'All changes saved'
                  : 'Changes save automatically'}
            </strong>
            <span>Your school and teaching details are saved after you pause typing.</span>
          </div>
          <button type="button" disabled={!canSave || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save now'}
          </button>
        </footer>
        <article className="card stack profile-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Danger zone</p>
              <h2>Start over</h2>
              <p>
                Permanently erase your classes, curriculum, schedule, school calendar, notes, AI
                history, and settings. Your sign-in account stays active.
              </p>
            </div>
            <button type="button" disabled={resetting} onClick={() => void resetAccount()}>
              {resetting ? 'Resetting…' : 'Reset all data'}
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
