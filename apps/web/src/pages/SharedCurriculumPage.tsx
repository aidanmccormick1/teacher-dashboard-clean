import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PublicCurriculumResponse } from '@teacheros/contracts';
import { getPublicCurriculum } from '../lib/api.js';

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
  const [data, setData] = useState<PublicCurriculumResponse | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState(false);
  useEffect(() => {
    void getPublicCurriculum(token)
      .then(setData)
      .catch(() => setError(true));
  }, [token]);
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
        </section>
      ))}
      <p className="muted">Checkmarks are temporary and clear when this page is reloaded.</p>
    </main>
  );
}
