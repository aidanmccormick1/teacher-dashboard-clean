import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicLessonResponse } from '@teacheros/contracts';
import { getPublicLesson } from '../lib/api.js';

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
    void getPublicLesson(token)
      .then(setData)
      .catch(() => setError(true));
  }, [token]);

  useEffect(() => {
    if (data?.lesson.steps.length) setExpandedSteps(new Set([0]));
  }, [data]);

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
      <header className="shared-lesson-topbar">
        <a className="shared-lesson-brand" href="/" aria-label="TeacherDesk home">
          <span className="shared-brand-mark" aria-hidden="true">
            TD
          </span>
          <span>
            <strong>TeacherDesk</strong>
          </span>
        </a>
        <span className="shared-readonly-pill">
          <span aria-hidden="true">●</span> Shared lesson
        </span>
      </header>

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

      <nav className="shared-lesson-nav" aria-label="Lesson sections">
        <a href="#overview">At a glance</a>
        <a href="#lesson-flow">Steps</a>
        <a href="#join-teacherdesk">TeacherDesk</a>
      </nav>

      <section className="shared-overview" id="overview">
        <div className="shared-overview-grid">
          {lesson.objective ? (
            <article className="shared-info-card shared-info-card-objective">
              <div className="shared-info-card-icon" aria-hidden="true">
                ✦
              </div>
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
          {lesson.links.length ? (
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
                <ul className="shared-resource-list">
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
