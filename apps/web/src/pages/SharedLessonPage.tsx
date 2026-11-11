import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  CourseDetailResponse,
  CourseListResponse,
  PublicLessonResponse
} from '@teacheros/contracts';
import { UnitSlidesViewer } from '../components/UnitSlidesViewer.js';
import { SharedLessonResources } from '../components/LessonResources.js';
import { ApiError, getPublicLesson, useApiClient } from '../lib/api.js';

import { useAppAuth } from '../lib/auth.js';

function SharedLessonImport({ token }: { token: string }) {
  const auth = useAppAuth();
  const navigate = useNavigate();
  const api = useApiClient();
  const [open, setOpen] = useState(window.location.hash === '#add-to-course');
  const [courses, setCourses] = useState<CourseListResponse['courses'] | null>(null);
  const [units, setUnits] = useState<CourseDetailResponse['course']['units'] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [unitTitle, setUnitTitle] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ lessonId: string; sourceCourseName: string }>();
  const attempt = useRef<{ destination: string; requestId: string }>();
  const submitting = useRef(false);

  useEffect(() => {
    if (!open || !auth.isSignedIn) return;
    let current = true;
    void api
      .getProfile()
      .then(async ({ profile, school }) => {
        if (!current) return null;
        if (!profile?.onboarded || !school) {
          navigate('/onboarding', {
            state: { sharingReturn: `/shared/lessons/${token}#add-to-course` }
          });
          return null;
        }
        return api.listCourses();
      })
      .then((response) => {
        if (current && response)
          setCourses(response.courses.filter((course) => !course.archivedAt));
      })
      .catch(() => {
        if (current) setError('Could not load your courses.');
      });
    return () => {
      current = false;
    };
  }, [api, auth.isSignedIn, navigate, open, token]);

  useEffect(() => {
    if (!courseId) return;
    let current = true;
    void api
      .getCourseDetail(courseId)
      .then(({ course }) => {
        if (current) setUnits(course.units);
      })
      .catch(() => {
        if (current) setError('Could not load units for this course.');
      });
    return () => {
      current = false;
    };
  }, [api, courseId]);

  if (!auth.isLoaded) return null;
  if (!auth.isSignedIn)
    return (
      <Link
        className="button-link"
        to={`/login?next=${encodeURIComponent(`/shared/lessons/${token}#add-to-course`)}`}
      >
        Add to my course
      </Link>
    );
  if (result)
    return (
      <section id="add-to-course" className="card stack">
        <p role="status">Lesson added. Copied from {result.sourceCourseName}.</p>
        <Link to={`/lessons/${result.lessonId}`}>Open imported lesson</Link>
      </section>
    );
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Add to my course
      </button>
    );

  return (
    <form
      id="add-to-course"
      className="card stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current || !courseId || !unitId || (unitId === 'new' && !unitTitle.trim()))
          return;
        submitting.current = true;
        setSaving(true);
        setError('');
        const target = unitId === 'new' ? { unitTitle: unitTitle.trim() } : { unitId };
        const destination = JSON.stringify({ courseId, ...target });
        if (attempt.current?.destination !== destination)
          attempt.current = { destination, requestId: crypto.randomUUID() };
        try {
          setResult(
            await api.importSharedLesson(token, {
              courseId,
              ...target,
              requestId: attempt.current.requestId
            })
          );
        } catch (error) {
          setError(
            error instanceof ApiError ? error.message : 'Could not import the lesson. Try again.'
          );
        } finally {
          submitting.current = false;
          setSaving(false);
        }
      }}
    >
      <h2>Add to my course</h2>
      <p>This creates an editable copy in the unit you select.</p>
      <label>
        Course
        <select
          className="input"
          required
          disabled={saving || !courses}
          value={courseId}
          onChange={(event) => {
            setCourseId(event.target.value);
            setUnitId('');
            setUnits(null);
            setError('');
          }}
        >
          <option value="">{courses ? 'Select a course' : 'Loading courses…'}</option>
          {courses?.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
            </option>
          ))}
        </select>
      </label>
      {courses?.length === 0 ? <p>You need an editable course before importing a lesson.</p> : null}
      <label>
        Unit
        <select
          className="input"
          required
          disabled={saving || !units}
          value={unitId}
          onChange={(event) => setUnitId(event.target.value)}
        >
          <option value="">Select a unit</option>
          {units?.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.title}
            </option>
          ))}
          <option value="new">Create a new unit</option>
        </select>
      </label>
      {unitId === 'new' ? (
        <label>
          New unit name
          <input
            className="input"
            required
            maxLength={200}
            disabled={saving}
            value={unitTitle}
            onChange={(event) => setUnitTitle(event.target.value)}
          />
        </label>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={saving || !courseId || !unitId}>
        {saving ? 'Importing…' : 'Confirm import'}
      </button>
    </form>
  );
}

function safeHtml(value: string | null) {
  const doc = new DOMParser().parseFromString(value ?? '', 'text/html');
  for (const node of Array.from(doc.body.querySelectorAll('*'))) {
    if (
      !['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'A'].includes(
        node.tagName
      )
    )
      node.replaceWith(...Array.from(node.childNodes));
    else
      for (const attribute of Array.from(node.attributes)) {
        if (node.tagName !== 'A' || attribute.name !== 'href' || !/^https?:/i.test(attribute.value))
          node.removeAttribute(attribute.name);
      }
  }
  return doc.body.innerHTML;
}

function hostnameFor(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SharedLessonPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PublicLessonResponse | null>(null);
  const [error, setError] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(() => new Set());
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getPublicLesson(token)
        .then((next) => {
          if (active) {
            setData(next);
            setError(false);
          }
        })
        .catch(() => {
          if (active) setError(true);
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [token]);

  useEffect(() => {
    if (data?.lesson.steps.length) setExpandedSteps(new Set([0]));
  }, [data?.lesson.steps.length]);

  if (error)
    return (
      <main className="shared-lesson-state">
        <div className="shared-brand-mark" aria-hidden="true">
          TD
        </div>
        <p className="eyebrow">TeacherDesk</p>
        <h1>Lesson unavailable</h1>
        <p>This link is private or no longer active.</p>
        <a className="shared-lesson-button" href="/">
          Visit TeacherDesk <span aria-hidden="true">↗</span>
        </a>
      </main>
    );

  if (!data)
    return (
      <main className="shared-lesson-state shared-lesson-loading">
        <div className="shared-loading-orb" aria-hidden="true" />
        <p className="eyebrow">TeacherDesk · shared lesson</p>
        <p>Preparing your lesson…</p>
      </main>
    );

  const { lesson } = data;
  const completedCount = completedSteps.size;
  const progress = lesson.steps.length
    ? Math.round((completedCount / lesson.steps.length) * 100)
    : 0;

  const toggleStep = (index: number) => {
    setExpandedSteps((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleComplete = (index: number) => {
    const isCurrentlyComplete = completedSteps.has(index);
    setCompletedSteps((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

    if (!isCurrentlyComplete) {
      setExpandedSteps((current) => {
        const next = new Set(current);
        next.delete(index);
        const nextStepIndex = lesson.steps.findIndex(
          (_, candidateIndex) => candidateIndex > index && !completedSteps.has(candidateIndex)
        );
        if (nextStepIndex >= 0) next.add(nextStepIndex);
        return next;
      });
    }
  };

  return (
    <main className="shared-lesson shared-lesson-page">
      <section className="shared-lesson-hero" aria-labelledby="shared-lesson-title">
        <div className="shared-lesson-hero-copy">
          <p className="eyebrow shared-lesson-breadcrumb">
            <span>{data.courseName}</span>
            <span aria-hidden="true">/</span>
            <span>{data.unitTitle}</span>
          </p>
          <h1 id="shared-lesson-title">{lesson.title}</h1>
          {lesson.description ? (
            <div
              className="shared-lesson-description"
              dangerouslySetInnerHTML={{ __html: safeHtml(lesson.description) }}
            />
          ) : null}
          <div className="shared-lesson-meta" aria-label="Lesson details">
            {lesson.estimatedDurationMinutes ? (
              <span>
                <span aria-hidden="true">◷</span> {lesson.estimatedDurationMinutes} minutes
              </span>
            ) : null}
            <span>
              <span aria-hidden="true">☷</span> {lesson.steps.length}{' '}
              {lesson.steps.length === 1 ? 'part' : 'parts'}
            </span>
            <span>
              <span aria-hidden="true">↗</span> Read-only
            </span>
          </div>
        </div>
      </section>
      <SharedLessonImport key={token} token={token} />

      <section className="shared-overview" id="overview">
        <div className="shared-overview-grid">
          {lesson.objective ? (
            <article className="shared-info-card shared-info-card-objective">
              <div>
                <p className="shared-card-label">Objective</p>
                <div dangerouslySetInnerHTML={{ __html: safeHtml(lesson.objective) }} />
              </div>
            </article>
          ) : null}
          {lesson.materials ? (
            <article className="shared-info-card shared-info-card-materials">
              <div className="shared-info-card-icon" aria-hidden="true">
                ✚
              </div>
              <div>
                <p className="shared-card-label">Materials</p>
                <div dangerouslySetInnerHTML={{ __html: safeHtml(lesson.materials) }} />
              </div>
            </article>
          ) : null}
          {data.unitSlides || data.lessonSlides || lesson.links.length || data.resources?.length ? (
            <article
              className="shared-info-card shared-info-card-resources"
              aria-labelledby="shared-resources-heading"
            >
              <div className="shared-info-card-icon" aria-hidden="true">
                ↗
              </div>
              <div>
                <p className="shared-card-label" id="shared-resources-heading">
                  Resources
                </p>
                <SharedLessonResources resources={data.resources ?? []} token={token} />
                <ul className="shared-resource-list">
                  {data.unitSlides ? (
                    <li>
                      <a href="#unit-slides">
                        <strong>Unit Slides</strong>
                        <span>
                          Starts on slide {data.unitSlides.startSlide}{' '}
                          <span aria-hidden="true">↓</span>
                        </span>
                      </a>
                    </li>
                  ) : null}
                  {data.lessonSlides ? (
                    <li>
                      <a href="#lesson-slides">
                        <strong>Lesson Slides</strong>
                        <span>
                          Starts on slide {data.lessonSlides.startSlide}{' '}
                          <span aria-hidden="true">↓</span>
                        </span>
                      </a>
                    </li>
                  ) : null}
                  {lesson.links.map((link) => (
                    <li key={link.url}>
                      <a href={link.url} target="_blank" rel="noreferrer">
                        <strong>{link.title}</strong>
                        <span>
                          {hostnameFor(link.url)} <span aria-hidden="true">↗</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ) : null}
        </div>
      </section>

      <section className="shared-flow" id="lesson-flow">
        <div className="shared-flow-status">
          <div className="shared-progress-summary" aria-label={`${progress}% completed`}>
            <strong>
              {completedCount}/{lesson.steps.length}
            </strong>
            <span>completed</span>
          </div>
        </div>
        <div className="shared-progress-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="shared-step-list">
          {lesson.steps.map((step, index) => {
            const isExpanded = expandedSteps.has(index);
            const isComplete = completedSteps.has(index);
            const stepId = `shared-step-${index + 1}`;
            return (
              <article
                className={`shared-step-card${isExpanded ? ' is-open' : ''}${isComplete ? ' is-complete' : ''}`}
                key={`${step.title}-${index}`}
              >
                <button
                  className="shared-step-toggle"
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={stepId}
                  onClick={() => toggleStep(index)}
                >
                  <span className="shared-step-number" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="shared-step-title">
                    <span className="eyebrow">
                      {[
                        step.durationMinutes ? `${step.durationMinutes} min` : '',
                        step.stepType ?? ''
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Lesson part'}
                    </span>
                    <strong>{step.title}</strong>
                  </span>
                  <span className="shared-step-chevron" aria-hidden="true">
                    ⌄
                  </span>
                </button>
                {isExpanded ? (
                  <div className="shared-step-detail" id={stepId}>
                    <SharedLessonResources
                      resources={(data.resources ?? []).filter(
                        (resource) => resource.segmentId === step.id
                      )}
                      token={token}
                    />
                    {step.description ? (
                      <div dangerouslySetInnerHTML={{ __html: safeHtml(step.description) }} />
                    ) : (
                      <p className="muted">No additional notes were added for this part.</p>
                    )}
                    <button
                      className="shared-step-complete"
                      type="button"
                      onClick={() => toggleComplete(index)}
                    >
                      <span aria-hidden="true">{isComplete ? '✓' : '○'}</span>
                      {isComplete ? 'Marked as completed' : 'Mark as completed'}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      {data.unitSlides ? (
        <section id="unit-slides" className="shared-unit-slides">
          <UnitSlidesViewer url={data.unitSlides.url} initialSlide={data.unitSlides.startSlide} />
        </section>
      ) : null}
      {data.lessonSlides ? (
        <section id="lesson-slides" className="shared-unit-slides">
          <UnitSlidesViewer
            url={data.lessonSlides.url}
            initialSlide={data.lessonSlides.startSlide}
            deckTitle="Lesson Slides"
          />
        </section>
      ) : null}

      <footer className="shared-lesson-cta" id="join-teacherdesk">
        <div>
          <h2>Plan faster. Teach more.</h2>
          <p>TeacherDesk keeps your courses, lessons, and classroom momentum in one calm place.</p>
        </div>
        <a className="shared-lesson-button" href="/login">
          Join TeacherDesk
        </a>
      </footer>
    </main>
  );
}
