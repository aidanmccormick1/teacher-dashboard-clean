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
export function SharedLessonPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PublicLessonResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    void getPublicLesson(token)
      .then(setData)
      .catch(() => setError(true));
  }, [token]);
  if (error)
    return (
      <main className="shared-lesson">
        <h1>Lesson unavailable</h1>
        <p>This link is private or no longer active.</p>
      </main>
    );
  if (!data) return <p className="muted">Loading lesson…</p>;
  return (
    <main className="shared-lesson">
      <p className="eyebrow">
        {data.courseName} / {data.unitTitle}
      </p>
      <h1>{data.lesson.title}</h1>
      {data.lesson.estimatedDurationMinutes ? (
        <p>{data.lesson.estimatedDurationMinutes} minutes</p>
      ) : null}
      <h2>Objective</h2>
      <div dangerouslySetInnerHTML={{ __html: safeHtml(data.lesson.objective) }} />
      <h2>Materials</h2>
      <div dangerouslySetInnerHTML={{ __html: safeHtml(data.lesson.materials) }} />
      <h2>Lesson</h2>
      {data.lesson.steps.map((step, index) => (
        <section key={`${step.title}-${index}`}>
          <p className="eyebrow">
            {step.durationMinutes ? `${step.durationMinutes} min` : ''} {step.stepType ?? ''}
          </p>
          <h3>{step.title}</h3>
          <div dangerouslySetInnerHTML={{ __html: safeHtml(step.description) }} />
        </section>
      ))}
    </main>
  );
}
