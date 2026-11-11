import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CourseDetailResponse, UnitUpdateRequest } from '@teacheros/contracts';
import { isGoogleSlidesUrl } from '../lib/googleSlides.js';

type Course = CourseDetailResponse['course'];
type Unit = Course['units'][number];

export function CourseUnits({
  course,
  saving,
  onSave,
  onCreate,
  onDelete
}: {
  course: Course;
  saving: boolean;
  onSave: (id: string, patch: UnitUpdateRequest) => Promise<boolean>;
  onCreate: (title: string, description: string) => Promise<boolean>;
  onDelete: (unit: Unit) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  return (
    <section className="course-units-panel" aria-labelledby="course-units-title">
      <header className="course-panel-heading">
        <div className="course-heading-label">
          <h2 id="course-units-title">Units</h2>
          <span>{course.units.length}</span>
        </div>
        <button
          className="secondary"
          type="button"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          {adding ? 'Cancel' : '+ Unit'}
        </button>
      </header>
      {adding ? (
        <form
          className="course-inline-form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await onCreate(title.trim(), description.trim())) {
              setTitle('');
              setDescription('');
              setAdding(false);
            }
          }}
        >
          <label>
            Unit title
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            Description (optional)
            <input
              className="input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <button type="submit" disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Add unit'}
          </button>
        </form>
      ) : null}
      <div className="course-unit-list">
        {[...course.units]
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((unit) => (
            <CourseUnitRow
              key={unit.id}
              unit={unit}
              courseId={course.id}
              saving={saving}
              onSave={onSave}
              onDelete={onDelete}
            />
          ))}
      </div>
      {!course.units.length ? (
        <p className="course-empty">
          No units yet. Add a unit or build your curriculum in the{' '}
          <Link to={`/year-plan?course=${course.id}`}>Year Plan</Link>.
        </p>
      ) : null}
    </section>
  );
}

function CourseUnitRow({
  unit,
  courseId,
  saving,
  onSave,
  onDelete
}: {
  unit: Unit;
  courseId: string;
  saving: boolean;
  onSave: (id: string, patch: UnitUpdateRequest) => Promise<boolean>;
  onDelete: (unit: Unit) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [title, setTitle] = useState(unit.title);
  const [description, setDescription] = useState(unit.description ?? '');
  const [order, setOrder] = useState(String(unit.orderIndex));
  const [url, setUrl] = useState(unit.googleSlidesUrl ?? '');
  const [startSlide, setStartSlide] = useState(String(unit.googleSlidesStartSlide));
  const hasSlides = Boolean(unit.googleSlidesUrl && isGoogleSlidesUrl(unit.googleSlidesUrl));
  const validStart = Number.isInteger(Number(startSlide)) && Number(startSlide) >= 1;
  const contentId = `unit-content-${unit.id}`;
  const slidesId = `unit-slides-${unit.id}`;

  const toggleSlides = () => {
    if (!slidesOpen) {
      setUrl(unit.googleSlidesUrl ?? '');
      setStartSlide(String(unit.googleSlidesStartSlide));
    }
    setSlidesOpen(!slidesOpen);
  };

  return (
    <article className="course-unit-row">
      <div className="course-unit-line">
        <button
          className="course-unit-toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="course-unit-chevron" aria-hidden="true">
            {expanded ? '⌄' : '›'}
          </span>
          <span className="course-unit-number">{unit.orderIndex}</span>
          <span className="course-unit-name">{unit.title}</span>
          <span className="course-unit-count">
            {unit.lessons.length} {unit.lessons.length === 1 ? 'lesson' : 'lessons'}
          </span>
        </button>
        {hasSlides ? (
          <a
            className="course-slides-status has-slides"
            href={unit.googleSlidesUrl!}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open slides for ${unit.title} (new tab)`}
            title="Open Google Slides"
          >
            <SlidesIcon /> <span>Slides</span>
          </a>
        ) : (
          <button
            className="course-slides-status no-slides"
            type="button"
            aria-expanded={slidesOpen}
            aria-controls={slidesId}
            aria-label={`Add slides to ${unit.title}`}
            onClick={toggleSlides}
          >
            <SlidesIcon /> <span>Add slides</span>
          </button>
        )}
      </div>
      {expanded ? (
        <div className="course-unit-content" id={contentId}>
          {unit.description ? <p>{unit.description}</p> : null}
          <div className="course-compact-actions">
            <Link to={`/year-plan?course=${courseId}`} className="button-link secondary">
              Edit lessons
            </Link>
            <button
              className="secondary"
              type="button"
              aria-expanded={slidesOpen}
              aria-controls={slidesId}
              onClick={toggleSlides}
            >
              {slidesOpen ? 'Close slides editor' : hasSlides ? 'Edit slides' : 'Add slides'}
            </button>
            <button
              className="secondary"
              type="button"
              aria-expanded={editing}
              onClick={() => {
                setTitle(unit.title);
                setDescription(unit.description ?? '');
                setOrder(String(unit.orderIndex));
                setEditing(!editing);
              }}
            >
              {editing ? 'Cancel edit' : 'Edit unit'}
            </button>
          </div>
          {editing ? (
            <form
              className="course-inline-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (
                  await onSave(unit.id, {
                    title: title.trim(),
                    description: description.trim() || null,
                    orderIndex: Number(order)
                  })
                )
                  setEditing(false);
              }}
            >
              <label>
                Title
                <input
                  className="input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </label>
              <label>
                Description
                <input
                  className="input"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label>
                Order
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="1"
                  value={order}
                  onChange={(event) => setOrder(event.target.value)}
                  required
                />
              </label>
              <div className="course-compact-actions">
                <button type="submit" disabled={saving || !title.trim()}>
                  {saving ? 'Saving…' : 'Save unit'}
                </button>
                <button
                  className="secondary danger"
                  type="button"
                  disabled={saving}
                  onClick={() => void onDelete(unit)}
                >
                  Delete unit
                </button>
              </div>
            </form>
          ) : null}
          {unit.lessons.length ? (
            <ol className="course-lesson-list">
              {[...unit.lessons]
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((lesson) => (
                  <li key={lesson.id}>
                    <Link to={`/lessons/${lesson.id}`}>
                      <span>{lesson.orderIndex}</span>
                      {lesson.title}
                    </Link>
                  </li>
                ))}
            </ol>
          ) : (
            <p className="course-empty">No lessons yet.</p>
          )}
        </div>
      ) : null}
      {slidesOpen ? (
        <form
          className="course-slides-form course-inline-form"
          id={slidesId}
          aria-label={`Slides for ${unit.title}`}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!validStart || !isGoogleSlidesUrl(url)) return;
            if (
              await onSave(unit.id, {
                googleSlidesUrl: url.trim(),
                googleSlidesStartSlide: Number(startSlide)
              })
            )
              setSlidesOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSlidesOpen(false);
          }}
        >
          <label>
            Google Slides link
            <input
              className="input"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://docs.google.com/presentation/d/…"
              autoFocus
              required
            />
          </label>
          <label>
            Start slide
            <input
              className="input"
              type="number"
              min="1"
              step="1"
              value={startSlide}
              onChange={(event) => setStartSlide(event.target.value)}
              required
            />
          </label>
          <div className="course-compact-actions">
            <button type="submit" disabled={saving || !isGoogleSlidesUrl(url) || !validStart}>
              {saving ? 'Saving…' : 'Save slides'}
            </button>
            <button type="button" className="secondary" onClick={() => setSlidesOpen(false)}>
              Cancel
            </button>
            {hasSlides ? (
              <button
                type="button"
                className="secondary danger"
                disabled={saving}
                onClick={async () => {
                  if (await onSave(unit.id, { googleSlidesUrl: null, googleSlidesStartSlide: 1 }))
                    setSlidesOpen(false);
                }}
              >
                Remove slides
              </button>
            ) : null}
          </div>
          {url && !isGoogleSlidesUrl(url) ? (
            <p className="course-field-error" role="status">
              Use a Google Slides presentation link.
            </p>
          ) : null}
        </form>
      ) : null}
    </article>
  );
}

function SlidesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="16" height="11" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 14v3m-4 0h8M6 7h8M6 10h5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
