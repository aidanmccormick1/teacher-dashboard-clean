import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CourseDetailResponse, PublicCurriculumResponse } from '@teacheros/contracts';
import { UnitSlidesViewer } from '../components/UnitSlidesViewer.js';
import { ApiError, getPublicCurriculum, useApiClient } from '../lib/api.js';
import { useAppAuth } from '../lib/auth.js';

function safeHtml(value: string | null) {
  const doc = new DOMParser().parseFromString(value ?? '', 'text/html');
  for (const node of Array.from(doc.body.querySelectorAll('*'))) {
    if (
      !['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3'].includes(
        node.tagName
      )
    ) {
      node.replaceWith(...Array.from(node.childNodes));
    } else {
      for (const attribute of Array.from(node.attributes)) node.removeAttribute(attribute.name);
    }
  }
  return doc.body.innerHTML;
}

export function SharedCurriculumPage() {
  const { token = '' } = useParams();
  const auth = useAppAuth();
  const api = useApiClient();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicCurriculumResponse | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState(false);
  const [emptyCourses, setEmptyCourses] = useState<CourseDetailResponse['course'][]>([]);
  const [mode, setMode] = useState<'new_copy' | 'copy_into'>('new_copy');
  const [name, setName] = useState('');
  const [targetCourseId, setTargetCourseId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  useEffect(() => {
    void getPublicCurriculum(token)
      .then((result) => {
        setData(result);
        setName(result.course.name);
      })
      .catch(() => setError(true));
  }, [token]);
  useEffect(() => {
    if (!auth.isLoaded || !auth.isSignedIn) return;
    let cancelled = false;
    void api
      .listCourses()
      .then((result) =>
        Promise.all(
          result.courses
            .filter((course) => course.accessRole === 'owner')
            .map((course) => api.getCourseDetail(course.id))
        )
      )
      .then((courses) => {
        if (!cancelled)
          setEmptyCourses(
            courses.map((item) => item.course).filter((course) => !course.units.length)
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api, auth.isLoaded, auth.isSignedIn]);

  const addCurriculum = async () => {
    if (!data || (mode === 'new_copy' ? !name.trim() : !targetCourseId)) return;
    try {
      setImporting(true);
      setImportError(null);
      const result = await api.importPublicCurriculum(
        token,
        mode === 'new_copy' ? { mode, name: name.trim() } : { mode, targetCourseId }
      );
      navigate(`/courses/${result.course.id}`);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : 'Could not add this curriculum.');
    } finally {
      setImporting(false);
    }
  };
  if (error)
    return (
      <main className="shared-lesson">
        <h1>Curriculum unavailable</h1>
        <p>This link is private or no longer active.</p>
      </main>
    );
  if (!data) return <p className="muted">Loading curriculum…</p>;
  return (
    <main className="shared-lesson shared-curriculum">
      <p className="eyebrow">Shared curriculum · read-only</p>
      <h1>{data.course.name}</h1>
      <p>{[data.course.subject, data.course.gradeLevel].filter(Boolean).join(' · ')}</p>
      <section className="shared-curriculum-add" aria-labelledby="add-curriculum-title">
        <div>
          <p className="eyebrow">Use in TeacherDesk</p>
          <h2 id="add-curriculum-title">Add this curriculum to your courses</h2>
          <p>
            Make a new independent copy, or fill one of your existing empty courses without changing
            its name.
          </p>
        </div>
        {!auth.isLoaded ? (
          <p className="muted">Checking your account…</p>
        ) : !auth.isSignedIn ? (
          <Link
            className="button-link"
            to={`/login?next=${encodeURIComponent(`/shared/curriculum/${token}`)}`}
          >
            Sign in to add curriculum
          </Link>
        ) : (
          <div className="shared-curriculum-add-controls">
            <div className="shared-curriculum-mode" role="group" aria-label="How to add curriculum">
              <button
                type="button"
                className={mode === 'new_copy' ? '' : 'secondary'}
                aria-pressed={mode === 'new_copy'}
                onClick={() => setMode('new_copy')}
              >
                Add as a new course
              </button>
              <button
                type="button"
                className={mode === 'copy_into' ? '' : 'secondary'}
                aria-pressed={mode === 'copy_into'}
                disabled={!emptyCourses.length}
                onClick={() => setMode('copy_into')}
              >
                Fill an empty course
              </button>
            </div>
            {mode === 'new_copy' ? (
              <label>
                Course name
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            ) : (
              <label>
                Keep this course name
                <select
                  className="input"
                  value={targetCourseId}
                  onChange={(event) => setTargetCourseId(event.target.value)}
                >
                  <option value="">Choose an empty course…</option>
                  {emptyCourses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!emptyCourses.length ? (
              <small className="muted">
                You do not have an empty course yet. A new copy will be inactive until you connect a
                class.
              </small>
            ) : null}
            {importError ? <p className="notice warning">{importError}</p> : null}
            <button
              type="button"
              disabled={importing || (mode === 'new_copy' ? !name.trim() : !targetCourseId)}
              onClick={() => void addCurriculum()}
            >
              {importing ? 'Adding…' : mode === 'new_copy' ? 'Add curriculum' : 'Fill course'}
            </button>
          </div>
        )}
      </section>
      {data.course.units.map((unit, unitIndex) => (
        <section className="shared-curriculum-unit" key={`${unit.title}-${unitIndex}`}>
          <p className="eyebrow">Unit {unitIndex + 1}</p>
          <h2>{unit.title}</h2>
          {unit.description ? (
            <div dangerouslySetInnerHTML={{ __html: safeHtml(unit.description) }} />
          ) : null}
          {unit.lessons.map((lesson, lessonIndex) => (
            <article className="shared-curriculum-lesson" key={`${lesson.title}-${lessonIndex}`}>
              <header>
                <h3>
                  {lessonIndex + 1}. {lesson.title}
                </h3>
                {lesson.estimatedDurationMinutes ? (
                  <span>{lesson.estimatedDurationMinutes} min</span>
                ) : null}
              </header>
              {lesson.objective ? (
                <>
                  <h4>Objective</h4>
                  <div dangerouslySetInnerHTML={{ __html: safeHtml(lesson.objective) }} />
                </>
              ) : null}
              {lesson.materials ? (
                <>
                  <h4>Materials</h4>
                  <div dangerouslySetInnerHTML={{ __html: safeHtml(lesson.materials) }} />
                </>
              ) : null}
              <ol className="shared-curriculum-steps">
                {lesson.steps.map((step, stepIndex) => {
                  const key = `${unitIndex}:${lessonIndex}:${stepIndex}`;
                  return (
                    <li key={key}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked.has(key)}
                          onChange={() =>
                            setChecked((current) => {
                              const next = new Set(current);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        />
                        <span>
                          <strong>{step.title}</strong>
                          {step.durationMinutes ? ` · ${step.durationMinutes} min` : ''}
                          <div dangerouslySetInnerHTML={{ __html: safeHtml(step.description) }} />
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ol>
            </article>
          ))}
          {unit.unitSlides ? (
            <UnitSlidesViewer
              url={unit.unitSlides.url}
              initialSlide={unit.unitSlides.startSlide}
              compact
            />
          ) : null}
        </section>
      ))}
      <p className="muted">Checkmarks are temporary and clear when this page is reloaded.</p>
    </main>
  );
}
