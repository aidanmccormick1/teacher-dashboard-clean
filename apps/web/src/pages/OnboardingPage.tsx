import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';

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

type OnboardingStep = 1 | 2 | 3;

const ONBOARDING_DRAFT_KEY = 'teacheros_onboarding_draft_v1';
const ONBOARDING_STEP_KEY = 'teacheros_onboarding_step_v1';

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

const steps: Array<{ number: OnboardingStep; label: string; description: string }> = [
  { number: 1, label: 'About you', description: 'Your name and role' },
  { number: 2, label: 'Your school', description: 'Where you teach' },
  { number: 3, label: 'Your classes', description: 'What you teach' }
];

function loadOnboardingDraft(): OnboardingForm {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY);
    return raw ? { ...defaultForm, ...(JSON.parse(raw) as Partial<OnboardingForm>) } : defaultForm;
  } catch {
    return defaultForm;
  }
}

function loadOnboardingStep(): OnboardingStep {
  const saved = Number(window.localStorage.getItem(ONBOARDING_STEP_KEY));
  return saved === 2 || saved === 3 ? saved : 1;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function OnboardingPage() {
  const auth = useAppAuth();
  const api = useApiClient();
  const navigate = useNavigate();
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<OnboardingStep>(loadOnboardingStep);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<OnboardingForm>(() => loadOnboardingDraft());

  useEffect(() => {
    window.localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(form));
  }, [form]);

  useEffect(() => {
    window.localStorage.setItem(ONBOARDING_STEP_KEY, String(step));
    window.setTimeout(() => stepHeadingRef.current?.focus(), 0);
  }, [step]);

  useEffect(() => {
    if (!auth.email) return;
    setForm((current) =>
      current.workEmail.trim() ? current : { ...current, workEmail: auth.email as string }
    );
  }, [auth.email]);

  const update = <TKey extends keyof OnboardingForm>(key: TKey, value: OnboardingForm[TKey]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setError(null);
  };

  const stepIsReady =
    step === 1
      ? Boolean(form.fullName.trim() && validEmail(form.workEmail))
      : step === 2
        ? Boolean(form.schoolName.trim())
        : true;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!stepIsReady) {
      setError(
        step === 1
          ? 'Add your name and a valid work email to continue.'
          : 'Add your school name to continue.'
      );
      return;
    }

    if (step !== 3) {
      setStep((current) => (current + 1) as OnboardingStep);
      return;
    }

    setSaving(true);
    try {
      await api.onboarding({
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
        workEmail: form.workEmail.trim(),
        role: form.role,
        schoolName: form.schoolName.trim(),
        district: form.district.trim() || null,
        state: form.state.trim() || null,
        subjects: splitList(form.subjects),
        grades: splitList(form.grades)
      });
      await api
        .updatePreferences({
          setupStep: 'schedule',
          walkthroughDismissed: false,
          returnPath: '/guide'
        })
        .catch(() => undefined);
      window.localStorage.removeItem(ONBOARDING_DRAFT_KEY);
      window.localStorage.removeItem(ONBOARDING_STEP_KEY);
      navigate('/guide', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="onboarding-page page-entry">
      <header className="onboarding-header">
        <div className="onboarding-brand" aria-label="TeacherDesk">
          <span className="brand-mark" aria-hidden="true">
            TD
          </span>
          <span>TeacherDesk</span>
        </div>
        <Link className="button-link secondary" to="/login">
          Back to login
        </Link>
      </header>

      <section className="onboarding-intro">
        <div>
          <p className="eyebrow">Welcome to TeacherDesk</p>
          <h1>Let’s set up your teaching workspace.</h1>
          <p>
            A few details now will make your schedules and plans fit your school from the first day.
          </p>
        </div>
        <div className="onboarding-intro-art" aria-hidden="true">
          <span className="onboarding-art-sun" />
          <span className="onboarding-art-line onboarding-art-line-one" />
          <span className="onboarding-art-line onboarding-art-line-two" />
          <span className="onboarding-art-card onboarding-art-card-one">01</span>
          <span className="onboarding-art-card onboarding-art-card-two">02</span>
          <span className="onboarding-art-card onboarding-art-card-three">03</span>
        </div>
      </section>

      <div className="onboarding-layout">
        <nav className="onboarding-progress" aria-label="Profile setup progress">
          {steps.map((item) => (
            <div
              className={`onboarding-progress-step${item.number === step ? ' active' : ''}${item.number < step ? ' complete' : ''}`}
              aria-current={item.number === step ? 'step' : undefined}
              key={item.number}
            >
              <span aria-hidden="true">{item.number < step ? '✓' : item.number}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </div>
            </div>
          ))}
        </nav>

        <form className="card onboarding-form-card" onSubmit={(event) => void submit(event)}>
          <div className="onboarding-form-heading">
            <p className="eyebrow">
              Step {step} of {steps.length}
            </p>
            <h2 ref={stepHeadingRef} tabIndex={-1}>
              {steps[step - 1]?.label}
            </h2>
            <p className="muted">
              {step === 1
                ? 'Tell us who will use this workspace.'
                : step === 2
                  ? 'This school context shapes your calendar and collaboration.'
                  : 'These can be broad. You can refine courses after setup.'}
            </p>
          </div>

          {error ? (
            <p className="notice warning" role="alert">
              {error}
            </p>
          ) : null}

          {step === 1 ? (
            <div className="onboarding-fields">
              <label>
                Full name <span className="field-required">Required</span>
                <input
                  className="input"
                  autoComplete="name"
                  autoFocus
                  value={form.fullName}
                  onChange={(event) => update('fullName', event.target.value)}
                  placeholder="Aidan McCormick"
                  required
                />
              </label>
              <label>
                Work email <span className="field-required">Required</span>
                <input
                  className="input"
                  type="email"
                  autoComplete="email"
                  value={form.workEmail}
                  onChange={(event) => update('workEmail', event.target.value)}
                  placeholder="teacher@school.edu"
                  required
                />
                <span className="field-help">
                  Collaborators use this address when they share curriculum with you.
                </span>
              </label>
              <div className="onboarding-two-col">
                <label>
                  Role
                  <select
                    className="input"
                    value={form.role}
                    onChange={(event) =>
                      update('role', event.target.value as OnboardingForm['role'])
                    }
                  >
                    <option value="teacher">Teacher</option>
                    <option value="department_head">Department head</option>
                    <option value="admin">Administrator</option>
                  </select>
                </label>
                <label>
                  Phone <span className="field-optional">Optional</span>
                  <input
                    className="input"
                    type="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={(event) => update('phone', event.target.value)}
                  />
                </label>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onboarding-fields">
              <label>
                School name <span className="field-required">Required</span>
                <input
                  className="input"
                  autoComplete="organization"
                  autoFocus
                  value={form.schoolName}
                  onChange={(event) => update('schoolName', event.target.value)}
                  placeholder="School name"
                  required
                />
              </label>
              <div className="onboarding-two-col">
                <label>
                  District <span className="field-optional">Optional</span>
                  <input
                    className="input"
                    value={form.district}
                    onChange={(event) => update('district', event.target.value)}
                  />
                </label>
                <label>
                  State <span className="field-optional">Optional</span>
                  <input
                    className="input"
                    autoComplete="address-level1"
                    value={form.state}
                    onChange={(event) => update('state', event.target.value)}
                    placeholder="CA"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="onboarding-fields">
              <label>
                Subjects <span className="field-optional">Optional</span>
                <input
                  className="input"
                  autoFocus
                  value={form.subjects}
                  onChange={(event) => update('subjects', event.target.value)}
                  placeholder="Math, Algebra, Advisory"
                />
                <span className="field-help">Separate more than one with commas.</span>
              </label>
              <label>
                Grade levels <span className="field-optional">Optional</span>
                <input
                  className="input"
                  value={form.grades}
                  onChange={(event) => update('grades', event.target.value)}
                  placeholder="8, 9, 10"
                />
                <span className="field-help">You can update these later from your profile.</span>
              </label>
              <div className="onboarding-next-note">
                <strong>Next, we’ll build your calendar.</strong>
                <span>
                  First your recurring class schedule, then your school year dates and days off.
                </span>
              </div>
            </div>
          ) : null}

          <footer className="onboarding-form-actions">
            {step > 1 ? (
              <button
                className="secondary"
                type="button"
                onClick={() => setStep((current) => (current - 1) as OnboardingStep)}
              >
                Back
              </button>
            ) : (
              <span className="onboarding-save-note">Your progress saves in this browser.</span>
            )}
            <button type="submit" disabled={saving}>
              {saving ? 'Saving profile…' : step === 3 ? 'Save profile and continue' : 'Continue'}
            </button>
          </footer>
        </form>
      </div>
    </main>
  );
}
