import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

type GuideStep = {
  id: string;
  title: string;
  task: string;
  result: string;
  to: string;
  action: string;
  detail?: string;
};

const GUIDE_STORAGE_KEY = 'teacheros_welcome_progress';

const steps: GuideStep[] = [
  {
    id: 'course',
    title: 'Course',
    task: 'Create the subject container.',
    result: 'Example: Algebra I, English 10, Biology.',
    to: '/curriculum',
    action: 'Create course',
    detail: 'Courses hold units, lessons, and the schedule sections that teach them.'
  },
  {
    id: 'unit',
    title: 'Curriculum',
    task: 'Add one unit and one lesson.',
    result: 'This gives Classroom something real to resume.',
    to: '/management',
    action: 'Open management',
    detail: 'A unit can be rough. The lesson should be the next thing you expect to teach.'
  },
  {
    id: 'segments',
    title: 'Segments',
    task: 'Break the lesson into timed parts.',
    result: 'Warm-up, mini lesson, practice, exit ticket.',
    to: '/schedule',
    action: 'Generate segments',
    detail: 'Segments make stopped-at tracking precise instead of vague.'
  },
  {
    id: 'schedule',
    title: 'Schedule',
    task: 'Connect the course to a class section.',
    result: 'Example: Period 2 meets Monday at 9:15.',
    to: '/schedule',
    action: 'Add section',
    detail: 'Sections let two groups move through the same course at different speeds.'
  },
  {
    id: 'teach',
    title: 'Teach',
    task: 'Use Classroom during the period.',
    result: 'Mark progress and keep the current section up to date.',
    to: '/classroom',
    action: 'Open Classroom',
    detail: 'Classroom is for teaching. Management is for setup.'
  },
  {
    id: 'note',
    title: 'Carry-over',
    task: 'Save one note before the next class.',
    result: 'The dashboard knows where to restart.',
    to: '/classroom',
    action: 'Save note',
    detail: 'This is what keeps sections from blending together.'
  }
];

const glossary = [
  {
    term: 'Course',
    meaning: 'Subject container.'
  },
  {
    term: 'Section',
    meaning: 'One scheduled group.'
  },
  {
    term: 'Unit',
    meaning: 'Curriculum chapter.'
  },
  {
    term: 'Lesson',
    meaning: 'What gets taught next.'
  },
  {
    term: 'Segment',
    meaning: 'Timed lesson part.'
  },
  {
    term: 'Carry-over note',
    meaning: 'Next class restart note.'
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
  const [showDetail, setShowDetail] = useState(false);

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
          <p className="eyebrow">Welcome</p>
          <h1>Set up the teaching backbone.</h1>
        </div>
        <div className="guide-progress-card">
          <span>{percentComplete}%</span>
          <progress max={100} value={percentComplete} />
          <p className="muted">{completedIds.length} of {steps.length} complete</p>
        </div>
      </section>

      <section className="guide-grid">
        <div className="card stack">
          <div className="section-heading">
            <div>
              <p className="eyebrow">First run</p>
              <h2>Build in this order</h2>
            </div>
            <button
              className="secondary"
              type="button"
              onClick={() => setShowDetail((current) => !current)}
            >
              {showDetail ? 'Hide detail' : 'Show detail'}
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
                    <p>{step.task}</p>
                    <p className="muted">{step.result}</p>
                    {showDetail && step.detail ? (
                      <p className="advanced-note">{step.detail}</p>
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
            <p className="eyebrow">Quick start</p>
            <h2>Minimum setup</h2>
            <ol className="plain-list">
              <li>One course.</li>
              <li>One unit.</li>
              <li>One lesson.</li>
              <li>One section.</li>
              <li>One carry-over note.</li>
            </ol>
            <Link className="button-link" to="/management">
              Open Management
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
            <p className="eyebrow">Advanced path</p>
            <h2>Go deeper</h2>
            <div className="mini-link-list">
              <Link to="/management">Management hub</Link>
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
