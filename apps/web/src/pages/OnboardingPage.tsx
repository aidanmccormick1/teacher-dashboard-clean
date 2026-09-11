import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SchoolSearchResponse } from '@teacheros/contracts';

import { ApiError, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';
import { schoolDirectory } from '../lib/schoolDirectory.js';

type OnboardingForm = {
  fullName: string;
  workEmail: string;
  phone: string;
  role: 'teacher' | 'admin';
  schoolName: string;
  schoolId: string | null;
  schoolInviteCode: string;
  schoolJoinMethod: 'invite' | 'name' | null;
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
  schoolId: null,
  schoolInviteCode: '',
  schoolJoinMethod: null,
  district: '',
  state: '',
  subjects: '',
  grades: ''
};

const steps: Record<OnboardingStep, string> = {
  1: 'About you',
  2: 'Your school',
  3: 'Your classes'
};

function loadOnboardingDraft(): OnboardingForm {
  try {
    const raw = window.localStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (!raw) return defaultForm;
    const saved = JSON.parse(raw) as Partial<OnboardingForm>;
    return {
      ...defaultForm,
      ...saved,
      schoolJoinMethod:
        saved.schoolJoinMethod ??
        (saved.schoolInviteCode?.trim() ? 'invite' : saved.schoolName?.trim() ? 'name' : null)
    };
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
  const [workEmailAcknowledged, setWorkEmailAcknowledged] = useState(false);
  const [schoolSearch, setSchoolSearch] = useState<SchoolSearchResponse['schools']>([]);
  const [schoolSearchLoading, setSchoolSearchLoading] = useState(false);
  const [schoolSearchError, setSchoolSearchError] = useState<string | null>(null);
  const [selectedSchool, setSelectedSchool] = useState<
    SchoolSearchResponse['schools'][number] | null
  >(null);
  const [adminCreateNewSchool, setAdminCreateNewSchool] = useState(false);

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

  useEffect(() => {
    if (step !== 2 || form.role !== 'admin' || form.schoolName.trim().length < 2) {
      setSchoolSearch([]);
      setSchoolSearchLoading(false);
      setSchoolSearchError(null);
      return;
    }

    const query = form.schoolName.trim();
    const timer = window.setTimeout(() => {
      setSchoolSearchLoading(true);
      setSchoolSearchError(null);
      void api
        .searchSchools(query)
        .then((result) => {
          setSchoolSearch(result.schools);
          const exact = result.schools.find(
            (school) => school.name.trim().toLowerCase() === query.toLowerCase()
          );
          setSelectedSchool((current) =>
            current?.name === exact?.name ? current : (exact ?? null)
          );
          if (exact) setAdminCreateNewSchool(false);
        })
        .catch((err) => {
          setSchoolSearchError(
            err instanceof ApiError ? err.message : 'Could not search existing schools.'
          );
        })
        .finally(() => setSchoolSearchLoading(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [api, form.role, form.schoolName, step]);

  const update = <TKey extends keyof OnboardingForm>(key: TKey, value: OnboardingForm[TKey]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setError(null);
  };

  const hasName = Boolean(form.fullName.trim());
  const hasValidEmail = Boolean(form.workEmail.trim() && validEmail(form.workEmail));
  const showWorkEmail = hasName;
  const showRoleDetails = hasName && hasValidEmail && workEmailAcknowledged;
  const schoolUsesInvite = form.schoolJoinMethod === 'invite';
  const schoolUsesName = form.schoolJoinMethod === 'name';
  const isAdminOnboarding = form.role === 'admin';
  const selectedClaimedSchool = selectedSchool?.claimStatus === 'claimed';

  const stepIsReady =
    step === 1
      ? Boolean(showRoleDetails)
      : step === 2
        ? Boolean(
            form.schoolJoinMethod &&
            (schoolUsesInvite
              ? form.schoolInviteCode.trim().length >= 4
              : Boolean(
                  form.schoolName.trim() &&
                  (!isAdminOnboarding || Boolean(selectedSchool) || adminCreateNewSchool) &&
                  !selectedClaimedSchool
                ))
          )
        : true;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!stepIsReady) {
      setError(
        step === 1
          ? 'Add your name and a valid work email to continue.'
          : 'Add a school name or enter a school invite code to continue.'
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
        schoolName: schoolUsesName ? form.schoolName.trim() : '',
        schoolId: schoolUsesName ? form.schoolId : null,
        schoolInviteCode: schoolUsesInvite ? form.schoolInviteCode.trim() || null : null,
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
      navigate(form.role === 'admin' ? '/admin/request-access' : '/guide', { replace: true });
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

      <div className="onboarding-layout">
        <form
          key={step}
          className="card onboarding-form-card onboarding-step-panel"
          onSubmit={(event) => void submit(event)}
        >
          <div className="onboarding-form-heading">
            <h2 ref={stepHeadingRef} tabIndex={-1}>
              {steps[step]}
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
                  onChange={(event) => {
                    if (!event.target.value.trim()) setWorkEmailAcknowledged(false);
                    update('fullName', event.target.value);
                  }}
                  placeholder="Taylor Teacher"
                  required
                />
              </label>
              {showWorkEmail ? (
                <label className="onboarding-reveal">
                  Work email <span className="field-required">Required</span>
                  <input
                    className="input"
                    type="email"
                    autoComplete="email"
                    onFocus={() => setWorkEmailAcknowledged(true)}
                    value={form.workEmail}
                    onChange={(event) => {
                      setWorkEmailAcknowledged(true);
                      update('workEmail', event.target.value);
                    }}
                    placeholder="teacher@school.edu"
                    required
                  />
                  <span className="field-help">
                    Collaborators use this address when they share curriculum with you.
                  </span>
                </label>
              ) : null}
              {showRoleDetails ? (
                <div className="onboarding-two-col onboarding-reveal">
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
              ) : null}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="onboarding-fields">
              <div className="onboarding-school-choice">
                <p className="onboarding-question">Do you have a school invite code?</p>
                <span className="field-help">
                  A code connects you to your school’s shared directory and calendar.
                </span>
                <div
                  className="onboarding-choice-grid"
                  role="radiogroup"
                  aria-label="School access"
                >
                  <button
                    className={`onboarding-choice${schoolUsesInvite ? ' selected' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={schoolUsesInvite}
                    onClick={() => update('schoolJoinMethod', 'invite')}
                  >
                    <strong>Yes, I have a code</strong>
                    <span>Join an existing school workspace.</span>
                  </button>
                  <button
                    className={`onboarding-choice${schoolUsesName ? ' selected' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={schoolUsesName}
                    onClick={() => update('schoolJoinMethod', 'name')}
                  >
                    <strong>No, I’ll add my school</strong>
                    <span>Start with the school name.</span>
                  </button>
                </div>
              </div>
              {schoolUsesInvite ? (
                <label className="onboarding-reveal">
                  School invite code <span className="field-required">Required</span>
                  <input
                    className="input"
                    aria-label="School invite code"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoFocus={!form.schoolInviteCode.trim()}
                    value={form.schoolInviteCode}
                    onChange={(event) =>
                      update('schoolInviteCode', event.target.value.toUpperCase())
                    }
                    placeholder="Enter invite code"
                    minLength={4}
                    required
                  />
                  <span className="field-help">Find this in your school’s Sharing page.</span>
                </label>
              ) : null}
              {schoolUsesName ? (
                <>
                  <label className="onboarding-reveal">
                    School name <span className="field-required">Required</span>
                    <input
                      className="input"
                      autoComplete="organization"
                      autoFocus={!form.schoolName.trim()}
                      list="teacherdesk-school-directory"
                      value={form.schoolName}
                      onChange={(event) => {
                        update('schoolName', event.target.value);
                        update('schoolId', null);
                        setSelectedSchool(null);
                        setAdminCreateNewSchool(false);
                      }}
                      placeholder="Start typing your school"
                      required
                    />
                    <datalist id="teacherdesk-school-directory">
                      {schoolDirectory.map((school) => (
                        <option key={school.name} value={school.name} />
                      ))}
                    </datalist>
                    <span className="field-help">
                      Choose from your school directory or enter a new school name.
                    </span>
                  </label>
                  {isAdminOnboarding ? (
                    <div className="admin-school-search" aria-live="polite">
                      <div>
                        <strong>Find the existing school first</strong>
                        <p className="field-help">
                          Administrator access is requested after you join the school. This keeps
                          teachers, courses, and schedules together.
                        </p>
                      </div>
                      {schoolSearchLoading ? (
                        <p className="muted">Searching existing schools...</p>
                      ) : null}
                      {schoolSearchError ? (
                        <p className="notice warning">{schoolSearchError}</p>
                      ) : null}
                      {schoolSearch.length ? (
                        <div
                          className="admin-school-search-results"
                          role="list"
                          aria-label="Existing school matches"
                        >
                          {schoolSearch.map((school) => {
                            const isSelected = selectedSchool?.id === school.id;
                            const isClaimed = school.claimStatus === 'claimed';
                            return (
                              <button
                                key={school.id}
                                className={`admin-school-search-result${isSelected ? ' selected' : ''}`}
                                type="button"
                                role="listitem"
                                disabled={isClaimed}
                                aria-pressed={isSelected}
                                onClick={() => {
                                  setSelectedSchool(school);
                                  setAdminCreateNewSchool(false);
                                  update('schoolName', school.name);
                                  update('schoolId', school.id);
                                }}
                              >
                                <span>
                                  <strong>{school.name}</strong>
                                  <small>
                                    {[school.district, school.state].filter(Boolean).join(' · ') ||
                                      'School location not listed'}
                                  </small>
                                </span>
                                <span>
                                  {school.memberCount}{' '}
                                  {school.memberCount === 1 ? 'member' : 'members'}
                                  <small>
                                    {isClaimed
                                      ? 'Already claimed'
                                      : isSelected
                                        ? 'Selected'
                                        : 'Unclaimed'}
                                  </small>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {selectedSchool ? (
                        <p className={selectedClaimedSchool ? 'notice warning' : 'notice success'}>
                          {selectedClaimedSchool
                            ? 'This school already has administrator access. Choose another school or join it as a teacher.'
                            : 'Existing school selected. After setup, submit the administrator access request for this school.'}
                        </p>
                      ) : schoolSearch.length ? (
                        <button
                          className="secondary admin-create-school-action"
                          type="button"
                          onClick={() => setAdminCreateNewSchool(true)}
                        >
                          None of these schools, create a new one
                        </button>
                      ) : form.schoolName.trim().length >= 2 && !schoolSearchLoading ? (
                        <button
                          className="secondary admin-create-school-action"
                          type="button"
                          onClick={() => setAdminCreateNewSchool(true)}
                        >
                          No match, continue with a new school
                        </button>
                      ) : null}
                      {adminCreateNewSchool && !selectedSchool ? (
                        <p className="notice">
                          New school selected. You will still need to request administrator access
                          after setup.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {form.schoolName.trim() ? (
                    <div className="onboarding-two-col onboarding-reveal">
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
                  ) : null}
                </>
              ) : null}
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

          {step > 1 || showRoleDetails ? (
            <footer className="onboarding-form-actions onboarding-reveal">
              {step > 1 ? (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setStep((current) => (current - 1) as OnboardingStep)}
                >
                  Back
                </button>
              ) : null}
              {step !== 2 || stepIsReady ? (
                <button
                  className={step === 2 ? 'onboarding-reveal' : undefined}
                  type="submit"
                  disabled={saving || !stepIsReady}
                >
                  {saving
                    ? 'Saving profile…'
                    : step === 3
                      ? 'Save profile and continue'
                      : 'Continue'}
                </button>
              ) : null}
            </footer>
          ) : null}
        </form>
      </div>
    </main>
  );
}
