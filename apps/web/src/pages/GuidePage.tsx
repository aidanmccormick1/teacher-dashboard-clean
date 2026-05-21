import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

type GuideStep = {
  id: string;
  title: string;
  plain: string;
  why: string;
  to: string;
  action: string;
  advanced?: string;
};

const GUIDE_STORAGE_KEY = 'teacheros_start_here_progress';

const steps: GuideStep[] = [
  {
    id: 'course',
    title: 'Create one course',
    plain: 'Add the class you teach, like Algebra I or English 10. Do not worry about every detail yet.',
    why: 'Courses are the folder that units, lessons, and class sections attach to.',
    to: '/curriculum',
    action: 'Add a course',
    advanced: 'Later, split the course into units, lessons, and timed segments for better pacing.'
  },
  {
    id: 'schedule',
    title: 'Add one section to the schedule',
    plain: 'Tell the app when that class meets. Start with one period and one meeting time.',
    why: 'The dashboard uses this to know what class is happening now and what is next.',
    to: '/schedule',
    action: 'Add schedule',
    advanced: 'If you have a messy pasted schedule, use the parser as a draft, then review before saving.'
  },
  {
    id: 'lesson',
    title: 'Add the next lesson',
    plain: 'Create the lesson you are actually going to teach next. A rough title is enough to begin.',
    why: 'The classroom page needs at least one lesson before it can resume and track progress.',
    to: '/curriculum',
    action: 'Add lesson',
    advanced: 'Timed lesson segments make it possible to stop at an exact point and continue next class.'
  },
  {
    id: 'teach',
    title: 'Open Classroom when class starts',
    plain: 'Use Classroom during the period. It shows the current class and the lesson to resume.',
    why: 'This keeps the teaching workflow separate from setup screens.',
    to: '/classroom',
    action: 'Open Classroom',
    advanced: 'Each section can move at its own pace, even when two sections share the same course.'
  },
  {
    id: 'note',
    title: 'End with one carry-over note',
    plain: 'Before moving on, write what happened and where to pick up next time.',
    why: 'This is the habit that makes the next dashboard useful.',
    to: '/classroom',
    action: 'Save note',
    advanced: 'Carry-over notes feed continuity planning and make reteach decisions easier to spot.'
  }
];

const glossary = [
  {
    term: 'Course',
    meaning: 'The subject or class container, like Algebra I.'
  },
  {
    term: 'Section',
    meaning: 'A specific group of students, like Period 2.'
  },
  {
    term: 'Unit',
    meaning: 'A larger chunk of curriculum inside a course.'
  },
  {
    term: 'Lesson',
    meaning: 'What you plan to teach in a class or across a few classes.'
  },
  {
    term: 'Segment',
    meaning: 'A smaller timed part of a lesson, like warm-up, mini lesson, or practice.'
  },
  {
    term: 'Carry-over note',
    meaning: 'A short note that says where to start next time.'
  }
];

function loadProgress(): string[] {
  try {
    const raw = window.localStorage.getItem(GUIDE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function GuidePage() {
  const [completedIds, setCompletedIds] = useState<string[]>(() => loadProgress());
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(completedIds));
  }, [completedIds]);

  const percentComplete = useMemo(
    () => Math.round((completedIds.length / steps.length) * 100),
    [completedIds.length]
  );

  return (
    <div className="guide-page stack">
      <section className="paper-hero">
        <div>
          <p className="eyebrow">Start Here</p>
          <h1>Set up your first usable teaching day</h1>
          <p>
            This walkthrough is for a teacher who does not want to think about software. Follow the
            left side first. Open the advanced notes only when you want more control.
          </p>
        </div>
        <div className="guide-progress-card">
          <span>{percentComplete}%</span>
          <progress max={100} value={percentComplete} />
          <p className="muted">{completedIds.length} of {steps.length} setup steps checked off.</p>
        </div>
      </section>

      <section className="guide-grid">
        <div className="card stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Simple path</p>
              <h2>Do these in order</h2>
            </div>
            <button
              className="secondary"
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
            >
              {showAdvanced ? 'Hide advanced' : 'Show advanced'}
            </button>
          </div>

          <div className="walkthrough-list">
            {steps.map((step, index) => {
              const checked = completedIds.includes(step.id);
              return (
                <article key={step.id} className={checked ? 'walkthrough-step complete' : 'walkthrough-step'}>
                  <label className="walkthrough-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setCompletedIds((previous) =>
                          event.target.checked
                            ? [...new Set([...previous, step.id])]
                            : previous.filter((id) => id !== step.id)
                        );
                      }}
                    />
                    <span>Step {index + 1}</span>
                  </label>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.plain}</p>
                    <p className="muted">Why this matters: {step.why}</p>
                    {showAdvanced && step.advanced ? (
                      <p className="advanced-note">Advanced: {step.advanced}</p>
                    ) : null}
                    <Link className="button-link secondary" to={step.to}>
                      {step.action}
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <aside className="stack">
          <div className="card stack">
            <p className="eyebrow">If you only have 5 minutes</p>
            <h2>Fastest useful demo</h2>
            <ol className="plain-list">
              <li>Open Dashboard and check the current class.</li>
              <li>Open Curriculum and confirm there is at least one lesson.</li>
              <li>Open Classroom and resume the lesson.</li>
              <li>Write one carry-over note before leaving.</li>
            </ol>
            <Link className="button-link" to="/">
              Go to Dashboard
            </Link>
          </div>

          <div className="card stack">
            <p className="eyebrow">Words in the app</p>
            <h2>Quick glossary</h2>
            <div className="glossary-list">
              {glossary.map((item) => (
                <div key={item.term}>
                  <strong>{item.term}</strong>
                  <span>{item.meaning}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card stack">
            <p className="eyebrow">Power user lane</p>
            <h2>When you are ready</h2>
            <p className="muted">
              The advanced workflow is: build course structure, create schedule sections, segment
              lessons, teach from Classroom, then use carry-over notes to keep sections independent.
            </p>
            <div className="mini-link-list">
              <Link to="/schedule">Schedule tools</Link>
              <Link to="/curriculum">Curriculum builder</Link>
              <Link to="/classroom">Classroom tracker</Link>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
